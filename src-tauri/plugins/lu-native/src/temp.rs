//! Temporary files: how large data gets from the webview, or from a server,
//! to a place the share sheet can read.
//!
//! A video as a JSON array of numbers over IPC is several times its own size
//! in memory, on a device that has little. So nothing large crosses the
//! bridge in one piece:
//!
//!   * `write_temp_file` takes a file in base64 pieces and appends them,
//!   * `download_to_temp` loads an address straight into a file and hands
//!     back only the path.
//!
//! Everything lands in one folder inside the app's cache, and every path a
//! command is handed is checked against the folders the app owns.

use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime};

use base64::Engine;
use futures_util::StreamExt;
use serde::Serialize;
use tokio::io::AsyncWriteExt;

use crate::download::{normalize_sha256, verify_file};
use crate::net::check_public_url;

pub const TEMP_FOLDER: &str = "lu-native-tmp";
/// A piece of an upload. Larger pieces gain nothing and cost memory twice.
pub const MAX_CHUNK_BYTES: usize = 8 * 1024 * 1024;
/// A Cloud video is far below this. The limit exists so a wrong address
/// cannot fill the phone.
pub const DEFAULT_MAX_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const STALE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TempFile {
    pub path: String,
    pub bytes: u64,
    /// From the `Content-Type` of a download, when the server named one.
    pub mime: Option<String>,
}

/// A file name that is safe inside one folder on every platform. Keeps the
/// extension, because the share sheet and the photo library read it.
pub fn safe_file_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let mut out: String = base
        .chars()
        .map(|c| if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    out = out.trim().trim_matches('.').to_string();
    if out.is_empty() {
        return "file".to_string();
    }
    if out.len() > 120 {
        // Keep the end, that is where the extension is.
        let mut start = out.len() - 120;
        while !out.is_char_boundary(start) {
            start += 1;
        }
        out = out[start..].to_string();
    }
    out
}

/// Purely lexical: no `..`, absolute, below one of the roots. Used for paths
/// that do not exist yet.
pub fn lexically_inside(path: &Path, roots: &[PathBuf]) -> bool {
    path.is_absolute()
        && !path.components().any(|c| matches!(c, Component::ParentDir))
        && roots.iter().any(|root| path.starts_with(root))
}

/// The real location of an existing file, if it lies below one of the roots.
/// Resolves links first, so a link inside the cache cannot point a share at a
/// file somewhere else.
pub fn existing_inside(path: &Path, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let real = std::fs::canonicalize(path).map_err(|_| "That file does not exist.".to_string())?;
    if !real.is_file() {
        return Err("That path is not a file.".to_string());
    }
    for root in roots {
        if let Ok(real_root) = std::fs::canonicalize(root) {
            if real.starts_with(&real_root) {
                return Ok(real);
            }
        }
    }
    Err("Only files inside the app's own folders can be shared or saved.".to_string())
}

pub fn ensure_temp_dir(cache_dir: &Path) -> Result<PathBuf, String> {
    let dir = cache_dir.join(TEMP_FOLDER);
    std::fs::create_dir_all(&dir).map_err(|_| "The temporary folder could not be created.".to_string())?;
    Ok(dir)
}

/// A fresh path in the temp folder. Each file gets its own folder, so the
/// file itself keeps exactly the name the user will see in the share sheet.
pub fn new_temp_path(temp_dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    let folder = temp_dir.join(uuid::Uuid::new_v4().simple().to_string());
    std::fs::create_dir_all(&folder).map_err(|_| "The temporary folder could not be created.".to_string())?;
    Ok(folder.join(safe_file_name(file_name)))
}

/// Remove what an earlier run left behind. Called once at start.
pub fn sweep_stale(temp_dir: &Path, now: SystemTime) -> usize {
    let mut removed = 0;
    let Ok(entries) = std::fs::read_dir(temp_dir) else { return 0 };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|m| now.duration_since(m).ok())
            .map(|age| age > STALE_AFTER)
            .unwrap_or(false);
        if !old {
            continue;
        }
        let path = entry.path();
        let ok = if path.is_dir() { std::fs::remove_dir_all(&path).is_ok() } else { std::fs::remove_file(&path).is_ok() };
        if ok {
            removed += 1;
        }
    }
    removed
}

/// Write or append one base64 piece.
///
/// Without `path` a new file is created under `file_name`. With `path` the
/// piece is appended to that file, which has to be one this function made.
pub fn write_chunk(
    temp_dir: &Path,
    path: Option<&str>,
    file_name: Option<&str>,
    data_base64: &str,
) -> Result<TempFile, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.trim())
        .map_err(|_| "That piece of the file is not valid base64.".to_string())?;
    if bytes.len() > MAX_CHUNK_BYTES {
        return Err("That piece of the file is too large. Send at most 8 MB at a time.".to_string());
    }
    let target = match path {
        Some(p) => {
            let p = PathBuf::from(p);
            if !lexically_inside(&p, &[temp_dir.to_path_buf()]) || !p.is_file() {
                return Err("That is not a temporary file of this app.".to_string());
            }
            p
        }
        None => new_temp_path(temp_dir, file_name.unwrap_or("file"))?,
    };
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&target)
        .map_err(|_| "The temporary file could not be opened.".to_string())?;
    file.write_all(&bytes).map_err(|e| write_error(&e))?;
    let total = file.metadata().map(|m| m.len()).unwrap_or(0);
    Ok(TempFile { path: target.to_string_lossy().into_owned(), bytes: total, mime: None })
}

fn write_error(error: &std::io::Error) -> String {
    // ENOSPC is 28 on Linux, Android, macOS and iOS alike.
    if error.raw_os_error() == Some(28) {
        "There is not enough free storage on this device.".to_string()
    } else {
        "The file could not be written.".to_string()
    }
}

/// One piece of a temp file, for the webview.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TempPiece {
    pub data_base64: String,
    /// How many bytes this piece holds.
    pub bytes: u64,
    /// The size of the whole file.
    pub total_bytes: u64,
    /// True when this piece reaches the end of the file.
    pub done: bool,
}

/// Read one piece of a temp file: `length` bytes from `offset`, at most
/// MAX_CHUNK_BYTES. The way back of `write_chunk`, for a file the native
/// side put there (a document the user picked) and the page has to read.
/// Only a file that really lies in the temp folder: links are resolved first.
pub fn read_chunk(temp_dir: &Path, path: &str, offset: u64, length: Option<u64>) -> Result<TempPiece, String> {
    let real = existing_inside(Path::new(path), &[temp_dir.to_path_buf()])
        .map_err(|_| "That is not a temporary file of this app.".to_string())?;
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(&real).map_err(|_| "The temporary file could not be opened.".to_string())?;
    let total = file.metadata().map(|m| m.len()).map_err(|_| "The temporary file could not be read.".to_string())?;
    if offset > total {
        return Err("That piece lies behind the end of the file.".to_string());
    }
    let want = length.unwrap_or(MAX_CHUNK_BYTES as u64).min(MAX_CHUNK_BYTES as u64).min(total - offset);
    file.seek(SeekFrom::Start(offset)).map_err(|_| "The temporary file could not be read.".to_string())?;
    let mut bytes = vec![0u8; want as usize];
    file.read_exact(&mut bytes).map_err(|_| "The temporary file could not be read.".to_string())?;
    Ok(TempPiece {
        data_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        bytes: want,
        total_bytes: total,
        done: offset + want >= total,
    })
}

/// How many documents one visit to the picker may bring: 1 to 20, 1 unless said.
pub fn pick_limit(raw: Option<u32>) -> u32 {
    raw.unwrap_or(1).clamp(1, 20)
}

/// Delete a temp file together with its own folder.
pub fn delete(temp_dir: &Path, path: &str) -> Result<bool, String> {
    let p = PathBuf::from(path);
    if !lexically_inside(&p, &[temp_dir.to_path_buf()]) {
        return Err("That is not a temporary file of this app.".to_string());
    }
    if !p.exists() {
        return Ok(false);
    }
    std::fs::remove_file(&p).map_err(|_| "The temporary file could not be removed.".to_string())?;
    if let Some(parent) = p.parent() {
        if parent != temp_dir {
            let _ = std::fs::remove_dir(parent);
        }
    }
    Ok(true)
}

/// A file name for a download: the one the caller gave, else the last part
/// of the address, else `download`.
pub fn name_for_download(given: Option<&str>, url: &url::Url) -> String {
    if let Some(name) = given.map(str::trim).filter(|n| !n.is_empty()) {
        return safe_file_name(name);
    }
    let last = url.path_segments().and_then(|mut s| s.next_back()).unwrap_or("");
    let decoded = percent_decode(last);
    if decoded.is_empty() { "download".to_string() } else { safe_file_name(&decoded) }
}

fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub struct DownloadToTemp<'a> {
    pub url: &'a str,
    pub file_name: Option<&'a str>,
    pub headers: &'a std::collections::HashMap<String, String>,
    pub max_bytes: Option<u64>,
    pub sha256: Option<&'a str>,
    pub user_agent: &'a str,
    pub allow_test_hosts: bool,
}

/// Load an address into a temp file and return its path.
///
/// https to a public host only, checked again on every redirect. A signed
/// result address of LU Cloud is exactly that. The file is removed again when
/// anything goes wrong, a half download is never handed out.
pub async fn download_to_temp(temp_dir: &Path, req: DownloadToTemp<'_>) -> Result<TempFile, String> {
    let url = check_public_url(req.url, req.allow_test_hosts)?;
    let sha256 = match req.sha256 {
        Some(s) => Some(normalize_sha256(s)?),
        None => None,
    };
    let max_bytes = req.max_bytes.unwrap_or(DEFAULT_MAX_DOWNLOAD_BYTES).min(DEFAULT_MAX_DOWNLOAD_BYTES);
    let allow = req.allow_test_hosts;
    let client = reqwest::Client::builder()
        .user_agent(req.user_agent)
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 8 {
                return attempt.error("too many redirects");
            }
            match check_public_url(attempt.url().as_str(), allow) {
                Ok(_) => attempt.follow(),
                Err(_) => attempt.error("redirect to an address that is not allowed"),
            }
        }))
        .build()
        .map_err(|_| "The network client could not be set up.".to_string())?;

    let mut builder = client.get(url.clone());
    for (name, value) in req.headers {
        let lower = name.to_ascii_lowercase();
        if !matches!(lower.as_str(), "host" | "content-length" | "connection" | "transfer-encoding" | "user-agent") {
            builder = builder.header(name.as_str(), value.as_str());
        }
    }
    let resp = builder.send().await.map_err(|e| {
        if e.is_timeout() {
            "The server did not answer in time.".to_string()
        } else if e.is_redirect() {
            "The address redirects to a place that is not allowed.".to_string()
        } else {
            "The file could not be downloaded. Check the connection and try again.".to_string()
        }
    })?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("The server refused the download (HTTP {}).", status.as_u16()));
    }
    if resp.content_length().map(|n| n > max_bytes).unwrap_or(false) {
        return Err("That file is too large to download here.".to_string());
    }
    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or(v).trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty());
    let declared = resp.content_length();

    let target = new_temp_path(temp_dir, &name_for_download(req.file_name, &url))?;
    let result = async {
        let mut file = tokio::fs::File::create(&target)
            .await
            .map_err(|_| "The temporary file could not be created.".to_string())?;
        let mut written: u64 = 0;
        let mut stream = resp.bytes_stream();
        while let Some(piece) = stream.next().await {
            let piece = piece.map_err(|_| "The connection dropped during the download. Try again.".to_string())?;
            written += piece.len() as u64;
            if written > max_bytes {
                return Err("That file is too large to download here.".to_string());
            }
            file.write_all(&piece).await.map_err(|e| write_error(&e))?;
        }
        file.flush().await.map_err(|e| write_error(&e))?;
        file.sync_all().await.map_err(|e| write_error(&e))?;
        drop(file);
        let path = target.clone();
        let sha = sha256.clone();
        tokio::task::spawn_blocking(move || verify_file(&path, declared, sha.as_deref()))
            .await
            .map_err(|_| "The downloaded file could not be checked.".to_string())?
            .map_err(|e| e.message())
    }
    .await;

    match result {
        Ok(bytes) => Ok(TempFile { path: target.to_string_lossy().into_owned(), bytes, mime }),
        Err(e) => {
            let _ = std::fs::remove_file(&target);
            if let Some(parent) = target.parent() {
                let _ = std::fs::remove_dir(parent);
            }
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;
    use tokio::net::TcpListener;

    #[test]
    fn a_percent_sign_before_a_multibyte_letter_does_not_panic() {
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("x%41"), "xA");
        assert_eq!(percent_decode("50%"), "50%");
        assert_eq!(percent_decode("%\u{00e9}x"), "%\u{00e9}x");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    fn b64(data: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(data)
    }

    #[test]
    fn a_temp_file_is_read_back_in_pieces_and_nothing_else_is() {
        let root = std::env::temp_dir().join(format!("lu-read-chunk-{}", uuid::Uuid::new_v4().simple()));
        let temp_dir = ensure_temp_dir(&root).unwrap();
        let made = write_chunk(&temp_dir, None, Some("notes.txt"), &b64(b"hello world")).unwrap();
        let first = read_chunk(&temp_dir, &made.path, 0, Some(5)).unwrap();
        assert_eq!(first, TempPiece { data_base64: b64(b"hello"), bytes: 5, total_bytes: 11, done: false });
        let rest = read_chunk(&temp_dir, &made.path, 5, None).unwrap();
        assert_eq!(rest, TempPiece { data_base64: b64(b" world"), bytes: 6, total_bytes: 11, done: true });
        // The end itself is an empty last piece, behind it is an error.
        let end = read_chunk(&temp_dir, &made.path, 11, Some(4)).unwrap();
        assert!(end.done && end.bytes == 0 && end.data_base64.is_empty());
        assert!(read_chunk(&temp_dir, &made.path, 12, Some(1)).is_err());
        // A piece is never larger than the limit, whatever is asked for.
        assert!(read_chunk(&temp_dir, &made.path, 0, Some(u64::MAX)).unwrap().bytes == 11);
        // A file outside the temp folder, a folder, a missing file, a way out with dots.
        let outside = root.join("outside.txt");
        std::fs::write(&outside, b"secret").unwrap();
        assert!(read_chunk(&temp_dir, &outside.to_string_lossy(), 0, None).is_err());
        assert!(read_chunk(&temp_dir, &temp_dir.to_string_lossy(), 0, None).is_err());
        assert!(read_chunk(&temp_dir, &temp_dir.join("missing.txt").to_string_lossy(), 0, None).is_err());
        let dotted = temp_dir.join("..").join("outside.txt");
        assert!(read_chunk(&temp_dir, &dotted.to_string_lossy(), 0, None).is_err());
        // A link inside the temp folder that points outside is not followed.
        #[cfg(unix)]
        {
            let link = temp_dir.join("link.txt");
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            assert!(read_chunk(&temp_dir, &link.to_string_lossy(), 0, None).is_err());
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_picker_brings_one_to_twenty_documents() {
        assert_eq!(pick_limit(None), 1);
        assert_eq!(pick_limit(Some(0)), 1);
        assert_eq!(pick_limit(Some(3)), 3);
        assert_eq!(pick_limit(Some(500)), 20);
    }

    #[test]
    fn file_names_stay_inside_their_folder() {
        assert_eq!(safe_file_name("bild.png"), "bild.png");
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_file_name("C:\\Users\\x\\clip.mp4"), "clip.mp4");
        assert_eq!(safe_file_name("a:b*c?.txt"), "a_b_c_.txt");
        assert_eq!(safe_file_name(".."), "file");
        assert_eq!(safe_file_name(""), "file");
        let long = format!("{}.mp4", "x".repeat(300));
        let cut = safe_file_name(&long);
        assert!(cut.len() <= 120 && cut.ends_with(".mp4"));
    }

    #[test]
    fn a_path_outside_the_roots_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("cache");
        let other = dir.path().join("secrets");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(root.join("ok.txt"), b"x").unwrap();
        std::fs::write(other.join("token"), b"x").unwrap();
        let roots = vec![root.clone()];

        assert!(existing_inside(&root.join("ok.txt"), &roots).is_ok());
        assert!(existing_inside(&other.join("token"), &roots).is_err());
        assert!(existing_inside(&root.join("../secrets/token"), &roots).is_err());
        assert!(existing_inside(&root.join("missing.txt"), &roots).is_err());
        // A folder is not a file.
        assert!(existing_inside(&root, &roots).is_err());

        assert!(lexically_inside(&root.join("new.bin"), &roots));
        assert!(!lexically_inside(&root.join("../secrets/new.bin"), &roots));
        assert!(!lexically_inside(Path::new("relative.bin"), &roots));
    }

    #[cfg(unix)]
    #[test]
    fn a_link_out_of_the_cache_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("cache");
        let other = dir.path().join("secrets");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(other.join("token"), b"x").unwrap();
        std::os::unix::fs::symlink(other.join("token"), root.join("innocent.txt")).unwrap();
        assert!(existing_inside(&root.join("innocent.txt"), &[root]).is_err());
    }

    #[test]
    fn pieces_are_appended_in_order() {
        let dir = tempfile::tempdir().unwrap();
        let tmp = ensure_temp_dir(dir.path()).unwrap();
        let first = write_chunk(&tmp, None, Some("clip.mp4"), &b64(b"hello ")).unwrap();
        assert_eq!(first.bytes, 6);
        assert!(first.path.ends_with("clip.mp4"));
        let second = write_chunk(&tmp, Some(&first.path), None, &b64(b"world")).unwrap();
        assert_eq!(second.path, first.path);
        assert_eq!(second.bytes, 11);
        assert_eq!(std::fs::read(&first.path).unwrap(), b"hello world");
    }

    #[test]
    fn two_uploads_with_one_name_do_not_collide() {
        let dir = tempfile::tempdir().unwrap();
        let tmp = ensure_temp_dir(dir.path()).unwrap();
        let a = write_chunk(&tmp, None, Some("a.png"), &b64(b"1")).unwrap();
        let b = write_chunk(&tmp, None, Some("a.png"), &b64(b"2")).unwrap();
        assert_ne!(a.path, b.path);
    }

    #[test]
    fn appending_is_only_possible_to_a_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let tmp = ensure_temp_dir(dir.path()).unwrap();
        let outside = dir.path().join("outside.txt");
        std::fs::write(&outside, b"keep").unwrap();
        assert!(write_chunk(&tmp, Some(outside.to_str().unwrap()), None, &b64(b"x")).is_err());
        assert_eq!(std::fs::read(&outside).unwrap(), b"keep");
        // Not an existing file either.
        assert!(write_chunk(&tmp, Some(tmp.join("nope/x.bin").to_str().unwrap()), None, &b64(b"x")).is_err());
        assert!(write_chunk(&tmp, None, Some("x.bin"), "not base64 !!!").is_err());
    }

    #[test]
    fn delete_takes_the_file_and_its_folder() {
        let dir = tempfile::tempdir().unwrap();
        let tmp = ensure_temp_dir(dir.path()).unwrap();
        let f = write_chunk(&tmp, None, Some("a.png"), &b64(b"1")).unwrap();
        let folder = Path::new(&f.path).parent().unwrap().to_path_buf();
        assert_eq!(delete(&tmp, &f.path), Ok(true));
        assert!(!folder.exists());
        assert_eq!(delete(&tmp, &f.path), Ok(false));
        assert!(delete(&tmp, dir.path().join("x").to_str().unwrap()).is_err());
        assert!(tmp.exists());
    }

    #[test]
    fn old_leftovers_are_swept_and_fresh_files_stay() {
        let dir = tempfile::tempdir().unwrap();
        let tmp = ensure_temp_dir(dir.path()).unwrap();
        let f = write_chunk(&tmp, None, Some("a.png"), &b64(b"1")).unwrap();
        assert_eq!(sweep_stale(&tmp, SystemTime::now()), 0);
        assert!(Path::new(&f.path).exists());
        let later = SystemTime::now() + Duration::from_secs(25 * 60 * 60);
        assert_eq!(sweep_stale(&tmp, later), 1);
        assert!(!Path::new(&f.path).exists());
    }

    #[test]
    fn download_names_come_from_the_caller_or_the_address() {
        let u = url::Url::parse("https://cdn.example/results/My%20Clip.mp4?sig=abc").unwrap();
        assert_eq!(name_for_download(None, &u), "My Clip.mp4");
        assert_eq!(name_for_download(Some("  "), &u), "My Clip.mp4");
        assert_eq!(name_for_download(Some("bild.png"), &u), "bild.png");
        let bare = url::Url::parse("https://cdn.example/").unwrap();
        assert_eq!(name_for_download(None, &bare), "download");
    }

    /// Answers one GET with `body`, optionally lying about the length.
    async fn serve(body: Vec<u8>, status: &'static str, declared_len: Option<usize>) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { break };
                let body = body.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let _ = sock.read(&mut buf).await;
                    let head = format!(
                        "HTTP/1.1 {status}\r\nContent-Type: image/png; charset=binary\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        declared_len.unwrap_or(body.len())
                    );
                    let _ = sock.write_all(head.as_bytes()).await;
                    let _ = sock.write_all(&body).await;
                });
            }
        });
        port
    }

    fn req<'a>(url: &'a str, headers: &'a std::collections::HashMap<String, String>) -> DownloadToTemp<'a> {
        DownloadToTemp {
            url,
            file_name: None,
            headers,
            max_bytes: None,
            sha256: None,
            user_agent: "LU-Mobile/test",
            allow_test_hosts: true,
        }
    }

    #[tokio::test]
    async fn a_download_lands_in_a_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let tmp = ensure_temp_dir(dir.path()).unwrap();
        let body: Vec<u8> = (0..200_000).map(|i| (i % 256) as u8).collect();
        let port = serve(body.clone(), "200 OK", None).await;
        let url = format!("http://127.0.0.1:{port}/out/bild.png?sig=1");
        let h = Default::default();
        let f = download_to_temp(&tmp, req(&url, &h)).await.unwrap();
        assert_eq!(f.bytes, 200_000);
        assert_eq!(f.mime.as_deref(), Some("image/png"));
        assert!(f.path.ends_with("bild.png"));
        assert_eq!(std::fs::read(&f.path).unwrap(), body);
    }

    #[tokio::test]
    async fn without_the_acceptance_switch_a_local_server_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let tmp = ensure_temp_dir(dir.path()).unwrap();
        let h = Default::default();
        let mut r = req("http://127.0.0.1:9/x.png", &h);
        r.allow_test_hosts = false;
        assert!(download_to_temp(&tmp, r).await.is_err());
    }

    #[tokio::test]
    async fn a_refusal_names_the_status_and_leaves_no_file() {
        let dir = tempfile::tempdir().unwrap();
        let tmp = ensure_temp_dir(dir.path()).unwrap();
        let port = serve(b"gone".to_vec(), "404 Not Found", None).await;
        let url = format!("http://127.0.0.1:{port}/x.png");
        let h = Default::default();
        let e = download_to_temp(&tmp, req(&url, &h)).await.unwrap_err();
        assert!(e.contains("(HTTP 404)"), "{e}");
        assert_eq!(std::fs::read_dir(&tmp).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn a_wrong_checksum_leaves_no_file() {
        let dir = tempfile::tempdir().unwrap();
        let tmp = ensure_temp_dir(dir.path()).unwrap();
        let port = serve(b"abc".to_vec(), "200 OK", None).await;
        let url = format!("http://127.0.0.1:{port}/x.bin");
        let h = Default::default();
        let mut r = req(&url, &h);
        r.sha256 = Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        let e = download_to_temp(&tmp, r).await.unwrap_err();
        assert!(e.contains("checksum"), "{e}");
        assert_eq!(std::fs::read_dir(&tmp).unwrap().count(), 0);

        let mut r = req(&url, &h);
        r.sha256 = Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(download_to_temp(&tmp, r).await.unwrap().bytes, 3);
    }

    #[tokio::test]
    async fn a_transfer_that_ends_early_is_not_handed_out() {
        let dir = tempfile::tempdir().unwrap();
        let tmp = ensure_temp_dir(dir.path()).unwrap();
        // Promises 1000 bytes, sends 3, closes.
        let port = serve(b"abc".to_vec(), "200 OK", Some(1000)).await;
        let url = format!("http://127.0.0.1:{port}/x.bin");
        let h = Default::default();
        assert!(download_to_temp(&tmp, req(&url, &h)).await.is_err());
        assert_eq!(std::fs::read_dir(&tmp).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn the_size_limit_holds() {
        let dir = tempfile::tempdir().unwrap();
        let tmp = ensure_temp_dir(dir.path()).unwrap();
        let port = serve(vec![7u8; 5000], "200 OK", None).await;
        let url = format!("http://127.0.0.1:{port}/x.bin");
        let h = Default::default();
        let mut r = req(&url, &h);
        r.max_bytes = Some(1000);
        let e = download_to_temp(&tmp, r).await.unwrap_err();
        assert!(e.contains("too large"), "{e}");
        assert_eq!(std::fs::read_dir(&tmp).unwrap().count(), 0);
    }
}
