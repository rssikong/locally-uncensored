//! Saved characters of Create, kept beside the store backup on a phone.
//!
//! A saved character is a name and up to 30 photos. The WebView keeps them in
//! IndexedDB (`lu-saved-characters`, src/lib/saved-characters.ts), and on
//! Android a full phone can make the WebView drop the whole IndexedDB of the
//! app at the next start (mobile-docs/r35/n6b.md, 24 of 25 runs). The chats
//! come back from `store_backup.json`; the characters had no copy and were
//! gone (gap L3, mobile-docs/r37/reste.md).
//!
//! Layout under the store folder:
//!   saved-characters/index.json   names, dates and the photo ids, small
//!   saved-characters/photos/<id>  one photo each, base64, content addressed
//!                                 (sha256 of the base64 text, like the chat
//!                                 attachments)
//!
//! One photo per call, so no single IPC string carries a whole character.
//! Photos nothing in the index points at are removed when a new index lands.
//!
//! Registered on a phone only (lib.rs). The desktop keeps its characters in
//! IndexedDB as before and never calls these.

use crate::commands::chat_attachments::{read_attachment, write_attachment};
use crate::os_error;
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};

/// The largest photo the backup takes, as base64 text. A 4K PNG of a
/// generated image is about 12 MB, 16 MB in base64.
pub(crate) const MAX_PHOTO_CHARS: usize = 24 * 1024 * 1024;
/// The most all photos of the backup may take together. 30 photos of a
/// handful of characters fit many times over; a phone that runs past it keeps
/// the newer photos in IndexedDB only, and the WebView logs that.
pub(crate) const MAX_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
/// The index holds names and ids only.
pub(crate) const MAX_INDEX_CHARS: usize = 2 * 1024 * 1024;

const INDEX: &str = "index.json";
const PHOTOS: &str = "photos";

pub(crate) fn backup_dir() -> Result<PathBuf, String> {
    Ok(crate::commands::system::persistent_dir()?.join("saved-characters"))
}

fn photos_dir(dir: &Path) -> PathBuf {
    dir.join(PHOTOS)
}

fn is_id(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn photos_size(dir: &Path) -> u64 {
    std::fs::read_dir(photos_dir(dir))
        .map(|entries| entries.flatten().filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum())
        .unwrap_or(0)
}

/// The ids of `ids` that have no intact photo yet. A name that is no id is
/// never asked for, it could not be written either.
pub(crate) fn missing_photos(dir: &Path, ids: &[String]) -> Vec<String> {
    let photos = photos_dir(dir);
    ids.iter()
        .filter(|id| is_id(id) && read_attachment(&photos, id).is_err())
        .cloned()
        .collect()
}

/// Write one photo. Idempotent, atomic, checked against its id.
pub(crate) fn put_photo(dir: &Path, id: &str, data: &str) -> Result<(), String> {
    if data.len() > MAX_PHOTO_CHARS {
        return Err("This photo is too large for the backup of saved characters.".into());
    }
    let photos = photos_dir(dir);
    if is_id(id) && read_attachment(&photos, id).is_ok() {
        return Ok(());
    }
    if photos_size(dir) + data.len() as u64 > MAX_TOTAL_BYTES {
        return Err("The backup of saved characters is full.".into());
    }
    write_attachment(&photos, id, data)
}

pub(crate) fn read_photo(dir: &Path, id: &str) -> Result<String, String> {
    read_attachment(&photos_dir(dir), id)
}

/// The photo ids an index names. None when it is not an index at all.
fn index_photo_ids(index: &str) -> Option<HashSet<String>> {
    let serde_json::Value::Array(rows) = serde_json::from_str::<serde_json::Value>(index).ok()? else {
        return None;
    };
    let mut ids = HashSet::new();
    for row in rows {
        let photos = row.get("photos")?.as_array()?;
        for photo in photos {
            let id = photo.get("id")?.as_str()?;
            if !is_id(id) {
                return None;
            }
            ids.insert(id.to_string());
        }
    }
    Some(ids)
}

/// Replace the index, then remove the photos it no longer names. Refused
/// when an id it names has no photo: an index must never point at nothing.
pub(crate) fn write_index(dir: &Path, index: &str) -> Result<(), String> {
    if index.len() > MAX_INDEX_CHARS {
        return Err("The list of saved characters is too large.".into());
    }
    let ids = index_photo_ids(index).ok_or_else(|| "Not a list of saved characters.".to_string())?;
    let mut wanted: Vec<String> = ids.iter().cloned().collect();
    wanted.sort();
    if !missing_photos(dir, &wanted).is_empty() {
        return Err("A photo of a saved character is not in the backup yet.".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| os_error::english(&e))?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|e| os_error::english(&e))?;
    tmp.write_all(index.as_bytes()).map_err(|e| os_error::english(&e))?;
    tmp.as_file().sync_all().map_err(|e| os_error::english(&e))?;
    tmp.persist(dir.join(INDEX)).map_err(|e| os_error::english(&e.error))?;
    if let Ok(entries) = std::fs::read_dir(photos_dir(dir)) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !ids.contains(&name) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}

pub(crate) fn read_index(dir: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(dir.join(INDEX)) {
        Ok(raw) => Ok(Some(raw)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(os_error::english(&e)),
    }
}

async fn blocking<T: Send + 'static>(work: impl FnOnce(PathBuf) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || work(backup_dir()?))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn saved_characters_backup_missing(ids: Vec<String>) -> Result<Vec<String>, String> {
    blocking(move |dir| Ok(missing_photos(&dir, &ids))).await
}

#[tauri::command]
pub async fn saved_characters_backup_put(id: String, data: String) -> Result<(), String> {
    blocking(move |dir| put_photo(&dir, &id, &data)).await
}

#[tauri::command]
pub async fn saved_characters_backup_write_index(index: String) -> Result<(), String> {
    blocking(move |dir| write_index(&dir, &index)).await
}

#[tauri::command]
pub async fn saved_characters_backup_read_index() -> Result<Option<String>, String> {
    blocking(|dir| read_index(&dir)).await
}

#[tauri::command]
pub async fn saved_characters_backup_read_photo(id: String) -> Result<String, String> {
    blocking(move |dir| read_photo(&dir, &id)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::chat_attachments::content_id;

    fn index(photos: &[&str]) -> String {
        let list: Vec<serde_json::Value> = photos
            .iter()
            .map(|d| serde_json::json!({ "id": content_id(d), "type": "image/jpeg" }))
            .collect();
        serde_json::json!([{ "id": "c1", "name": "Mira", "createdAt": 1, "photos": list }]).to_string()
    }

    #[test]
    fn a_character_goes_in_and_comes_back() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = ("YWJj", "ZGVm");
        let ids = vec![content_id(a), content_id(b)];
        assert_eq!(missing_photos(dir.path(), &ids), ids);
        put_photo(dir.path(), &ids[0], a).unwrap();
        put_photo(dir.path(), &ids[1], b).unwrap();
        put_photo(dir.path(), &ids[1], b).unwrap();
        assert!(missing_photos(dir.path(), &ids).is_empty());
        let idx = index(&[a, b]);
        write_index(dir.path(), &idx).unwrap();
        assert_eq!(read_index(dir.path()).unwrap().as_deref(), Some(idx.as_str()));
        assert_eq!(read_photo(dir.path(), &ids[1]).unwrap(), b);
    }

    #[test]
    fn no_index_before_the_first_write() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_index(dir.path()).unwrap(), None);
    }

    #[test]
    fn an_index_that_names_a_missing_photo_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        put_photo(dir.path(), &content_id("YWJj"), "YWJj").unwrap();
        assert!(write_index(dir.path(), &index(&["YWJj", "ZGVm"])).is_err());
        assert_eq!(read_index(dir.path()).unwrap(), None);
        assert!(write_index(dir.path(), "{\"not\":\"a list\"}").is_err());
        assert!(write_index(dir.path(), "[{\"photos\":[{\"id\":\"../index.json\"}]}]").is_err());
    }

    #[test]
    fn photos_no_index_names_are_removed() {
        let dir = tempfile::tempdir().unwrap();
        for d in ["YWJj", "ZGVm"] {
            put_photo(dir.path(), &content_id(d), d).unwrap();
        }
        write_index(dir.path(), &index(&["ZGVm"])).unwrap();
        assert_eq!(missing_photos(dir.path(), &[content_id("YWJj"), content_id("ZGVm")]), vec![content_id("YWJj")]);
        write_index(dir.path(), "[]").unwrap();
        assert_eq!(std::fs::read_dir(photos_dir(dir.path())).unwrap().count(), 0);
    }

    #[test]
    fn a_wrong_id_or_a_path_never_writes() {
        let dir = tempfile::tempdir().unwrap();
        assert!(put_photo(dir.path(), &"a".repeat(64), "YWJj").is_err());
        assert!(put_photo(dir.path(), "../index.json", "YWJj").is_err());
        assert!(read_photo(dir.path(), "../index.json").is_err());
        assert!(missing_photos(dir.path(), &["../index.json".to_string()]).is_empty());
        assert!(!dir.path().join(INDEX).exists());
    }

    #[test]
    fn the_size_limits_hold() {
        let dir = tempfile::tempdir().unwrap();
        let big = "A".repeat(MAX_PHOTO_CHARS + 4);
        let err = put_photo(dir.path(), &content_id(&big), &big).unwrap_err();
        assert!(err.contains("too large"), "{err}");
        // A full backup refuses a new photo, and still answers for one it has.
        let small = "YWJj";
        put_photo(dir.path(), &content_id(small), small).unwrap();
        let filler = photos_dir(dir.path()).join("filler");
        std::fs::File::create(&filler).unwrap().set_len(MAX_TOTAL_BYTES).unwrap();
        let err = put_photo(dir.path(), &content_id("ZGVm"), "ZGVm").unwrap_err();
        assert!(err.contains("full"), "{err}");
        put_photo(dir.path(), &content_id(small), small).unwrap();
    }
}
