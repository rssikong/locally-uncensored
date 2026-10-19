//! Gallery delete reaches the file too (Discord 2026-09-25:
//! "when deleting files in app from gallery, they are still in output
//! folder, which is getting bigger and bigger").
//!
//! The render goes to the Recycle Bin / Trash, not into oblivion: a misclick
//! in the gallery must stay recoverable. Only files inside ComfyUI's output
//! folder are touched, by the same path rules as the model probes (no
//! absolute paths, no `..`, media extensions only).

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::commands::download::{safe_subfolder, sanitize_filename};
use crate::state::AppState;

const MEDIA_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "mov", "mkv", "wav", "mp3", "flac", "ogg"];

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrashResult {
    /// The file was found and moved to the Recycle Bin / Trash.
    pub trashed: bool,
    /// Nothing to do: the file was not there (already gone, or ComfyUI writes
    /// to an output folder this app does not know).
    pub missing: bool,
}

/// The file a gallery entry names, inside `output_dir`, or None when the name
/// tries to leave it or is not a media file.
pub fn output_file(output_dir: &Path, filename: &str, subfolder: &str) -> Option<PathBuf> {
    if filename.is_empty() || sanitize_filename(filename) != filename {
        return None;
    }
    if !subfolder.is_empty() && safe_subfolder(subfolder).is_err() {
        return None;
    }
    let ext = Path::new(filename).extension()?.to_str()?.to_ascii_lowercase();
    if !MEDIA_EXTENSIONS.contains(&ext.as_str()) {
        return None;
    }
    let dir = if subfolder.is_empty() { output_dir.to_path_buf() } else { output_dir.join(subfolder.replace('\\', "/")) };
    Some(dir.join(filename))
}

#[tauri::command]
pub async fn trash_comfy_output(filename: String, subfolder: String, state: State<'_, AppState>) -> Result<TrashResult, String> {
    let comfy_path = {
        let mut p = state.comfy_path.lock().map_err(|e| e.to_string())?;
        if p.is_none() {
            if let Some(found) = crate::commands::process::find_comfyui_path() {
                *p = Some(found);
            }
        }
        p.clone()
    };
    let Some(base) = comfy_path else {
        return Ok(TrashResult { trashed: false, missing: true });
    };
    // GH #183: the output folder the user set for ComfyUI (start script or
    // ComfyUI Desktop), which is where a ComfyUI LU starts writes now too.
    let output_dir = crate::commands::comfy_user_paths::UserComfyPaths::discover(Path::new(&base))
        .output_dir_or(&PathBuf::from(&base));
    let path = output_file(&output_dir, &filename, &subfolder)
        .ok_or_else(|| "That gallery entry does not name a file in the ComfyUI output folder.".to_string())?;
    if !path.is_file() {
        return Ok(TrashResult { trashed: false, missing: true });
    }
    tauri::async_runtime::spawn_blocking(move || trash::delete(&path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Could not move the file to the trash: {e}"))?;
    Ok(TrashResult { trashed: true, missing: false })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_media_files_inside_the_output_folder() {
        let out = PathBuf::from("/comfy/output");
        assert_eq!(output_file(&out, "locally_uncensored_00001_.png", ""), Some(out.join("locally_uncensored_00001_.png")));
        assert_eq!(output_file(&out, "clip.mp4", "video"), Some(out.join("video").join("clip.mp4")));
        assert_eq!(output_file(&out, "../../secret.png", ""), None);
        assert_eq!(output_file(&out, "x.png", "../.."), None);
        assert_eq!(output_file(&out, "x.png", "/etc"), None);
        assert_eq!(output_file(&out, "model.safetensors", ""), None);
        assert_eq!(output_file(&out, "noext", ""), None);
        assert_eq!(output_file(&out, "", ""), None);
    }
}
