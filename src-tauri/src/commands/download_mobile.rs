//! Model downloads on a phone.
//!
//! The desktop download (commands/download.rs) is a tokio task inside the
//! app. On a phone that task dies with the app: iOS suspends the process a
//! few seconds after it leaves the screen, Android stops its network. A
//! model takes minutes to hours, so there the transfer belongs to the
//! operating system (plugins/lu-native: URLSession in the background on iOS,
//! a foreground service on Android). It keeps running when the app is gone,
//! and it checks size and SHA-256 and renames the file into place without
//! any of this code being loaded.
//!
//! What this file does is keep the frontend from noticing. The commands
//! below carry the names and answer in the shapes of the desktop ones
//! (lib.rs registers these on Android and iOS and the originals on the
//! desktop), so the download store, the progress poll and the orphan scan
//! work unchanged. After a restart `download_progress` reports what is still
//! running AND what finished while the app was not there, because the list
//! lives on the native side, on disk.

// On the desktop only the tests call the translation below.
#![cfg_attr(not(mobile), allow(dead_code))]

use std::collections::HashMap;

use tauri_plugin_lu_native::{BgDownload, BgState};

use crate::state::DownloadProgress;

/// The status word the frontend knows for a state of the native list.
///
/// `None` for a cancelled download: on the desktop a cancelled transfer
/// leaves the map, so it has no word there either.
pub(crate) fn status_word(state: BgState) -> Option<&'static str> {
    match state {
        // "Wants to run and cannot" looks like a connection being made, and
        // that is what it is.
        BgState::Queued | BgState::Waiting => Some("connecting"),
        // Checking the file belongs to the download for the user: the bar
        // is full and the row is not finished yet.
        BgState::Running | BgState::Verifying => Some("downloading"),
        BgState::Paused => Some("paused"),
        BgState::Done => Some("complete"),
        BgState::Error => Some("error"),
        BgState::Cancelled => None,
    }
}

/// One line of the native list as the row the frontend polls.
pub(crate) fn to_progress(download: &BgDownload) -> Option<(String, DownloadProgress)> {
    let status = status_word(download.state)?;
    // Before the server has spoken the catalog size is the best there is,
    // the same fallback the desktop row uses.
    let total = if download.total_bytes > 0 { download.total_bytes } else { download.expected_bytes };
    let progress = DownloadProgress {
        progress: download.received_bytes,
        total,
        speed: if download.state == BgState::Running { download.bytes_per_second } else { 0.0 },
        filename: download.id.clone(),
        status: status.to_string(),
        error: if download.state == BgState::Error {
            Some(download.error.clone().unwrap_or_else(|| "The download failed.".to_string()))
        } else {
            None
        },
        dest: download.dest.clone(),
    };
    Some((download.id.clone(), progress))
}

/// The native list as the map `download_progress` answers with. Rows the
/// app's own map already has (the desktop lane, should it ever run on a
/// phone) are replaced by the native ones of the same id: the native side is
/// the one that survives a restart.
pub(crate) fn merge_progress(
    mut own: HashMap<String, DownloadProgress>,
    native: &[BgDownload],
) -> HashMap<String, DownloadProgress> {
    for download in native {
        if let Some((id, row)) = to_progress(download) {
            own.insert(id, row);
        }
    }
    own
}

/// File stems of the downloads the native side still owns. Their
/// `.download` files are not orphans.
pub(crate) fn owned_stems(native: &[BgDownload]) -> Vec<String> {
    native
        .iter()
        .filter(|d| !matches!(d.state, BgState::Done | BgState::Cancelled))
        .map(|d| crate::commands::download::file_stem_of(&d.id))
        .collect()
}

/// The request header that carries the Hugging Face token, for the hub and
/// for no other host. The same gate the desktop download has.
pub(crate) fn hub_headers(url: &str, token: Option<String>) -> HashMap<String, String> {
    let mut headers = HashMap::new();
    if crate::commands::download::is_huggingface_host(url) {
        if let Some(token) = token.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
            headers.insert("Authorization".to_string(), format!("Bearer {token}"));
        }
    }
    headers
}

/// The name of a download in the notification of the system. The page hands
/// in the name it shows for the model ("Qwen 3.5 0.8B"); without one, or with
/// an empty one, it is the file name, as before (short check on Android,
/// package 8: the notification read "Downloading Qwen3.5-0.8B-Q4_K_M.gguf").
/// One line, no control characters, at most 80 characters: it is foreign text
/// on its way into a system surface.
pub(crate) fn notification_title(given: Option<String>, file_name: &str) -> String {
    let clean: String = given
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .chars()
        .take(80)
        .collect();
    if clean.is_empty() {
        file_name.to_string()
    } else {
        clean
    }
}

#[cfg(mobile)]
mod phone {
    use std::path::PathBuf;

    use serde_json::{json, Value};
    use tauri::{AppHandle, State};
    use tauri_plugin_lu_native::download::BgCommand;
    use tauri_plugin_lu_native::{BgStart, LuNativeExt};

    use super::*;
    use crate::commands::download::{
        exact_remote_size, judge_existing, normalize_sha256, sanitize_filename, scan_for_partials, Existing,
        OrphanDownload,
    };
    use crate::os_error;
    use crate::state::AppState;

    async fn start(
        app: &AppHandle,
        id: String,
        url: String,
        dest: PathBuf,
        expected_bytes: Option<u64>,
        expected_sha256: Option<String>,
        title: Option<String>,
    ) -> Result<&'static str, String> {
        let headers = hub_headers(&url, crate::commands::mlx::hf_token());
        // What the notification of the system calls the download: the name the app
        // shows for the model, when the page handed one in, else the file name.
        let title = notification_title(title, &id);
        let start = BgStart {
            id: id.clone(),
            url,
            dest: dest.to_string_lossy().into_owned(),
            expected_bytes,
            // The catalog size is an estimate. Only the size the server
            // states decides whether a transfer is complete.
            expected_bytes_exact: false,
            sha256: expected_sha256,
            headers,
            title: Some(title),
        };
        app.lu_native().bg_start(start).await.map_err(String::from)
    }

    #[tauri::command]
    #[allow(non_snake_case)]
    pub async fn download_model_to_path(
        app: AppHandle,
        url: String,
        destDir: String,
        filename: String,
        expectedBytes: Option<u64>,
        expectedSha256: Option<String>,
        title: Option<String>,
    ) -> Result<Value, String> {
        let expected_sha256 = match expectedSha256.as_deref() {
            Some(s) => Some(normalize_sha256(s)?),
            None => None,
        };
        let dir = PathBuf::from(&destDir);
        std::fs::create_dir_all(&dir).map_err(|e| format!("Create dest dir: {}", os_error::english(&e)))?;
        let dest_file = dir.join(sanitize_filename(&filename));

        if dest_file.exists() {
            // The rule of the desktop command: only a size the SERVER states
            // may call a file complete.
            let actual = dest_file.metadata().map(|m| m.len()).unwrap_or(0);
            match judge_existing(actual, exact_remote_size(&url).await) {
                Existing::Complete | Existing::Unverified { .. } => {
                    return Ok(json!({"status": "exists", "path": dest_file.to_string_lossy()}));
                }
                Existing::Mismatch { .. } => {}
            }
        }

        let id = filename.clone();
        match start(&app, id.clone(), url, dest_file.clone(), expectedBytes, expected_sha256, title).await {
            Ok("already_running") => Ok(json!({"status": "already_running", "id": id})),
            Ok("done") => Ok(json!({"status": "exists", "path": dest_file.to_string_lossy()})),
            Ok(_) => Ok(json!({"status": "started", "id": id})),
            // The desktop answers a refused start as a row with an error,
            // not as a rejected call. Same here.
            Err(e) => Ok(json!({"status": "error", "error": e})),
        }
    }

    #[tauri::command]
    pub async fn download_progress(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
        let own = state.downloads.lock().map(|d| d.clone()).unwrap_or_default();
        // A native side that cannot answer yet (the app is still starting)
        // is an empty list, not an error: the poll comes again.
        let native = app.lu_native().bg_list().await.unwrap_or_default();
        Ok(serde_json::to_value(merge_progress(own, &native)).unwrap_or_default())
    }

    /// Settings, Storage: megabytes per second, 0 for no limit. The native
    /// layer keeps the number and holds every download to it, also the ones
    /// it continues while no page is open. Where the system carries the
    /// transfer itself (iOS) there is nothing to limit: that is an error
    /// here, so nobody takes a number that was set for one that works.
    #[tauri::command]
    pub async fn set_download_limit(app: AppHandle, mb_per_sec: f64) -> Result<(), String> {
        let bps = crate::commands::download::download_limit_bps(mb_per_sec)?;
        match app.lu_native().bg_limit(Some(bps)).await.map_err(String::from)? {
            Some(_) => Ok(()),
            None if bps == 0 => Ok(()),
            None => Err("This phone cannot limit the download speed: the system carries the download itself.".to_string()),
        }
    }

    #[tauri::command]
    pub async fn pause_download(app: AppHandle, id: String) -> Result<Value, String> {
        match app.lu_native().bg_command(&id, BgCommand::Pause).await {
            Ok("not_found") => Ok(json!({"status": "not_active"})),
            Ok(_) => Ok(json!({"status": "pausing"})),
            // Finished, failed or being checked: nothing to pause.
            Err(_) => Ok(json!({"status": "not_active"})),
        }
    }

    /// The user does not want this file: the transfer stops AND the partial
    /// file goes, as on the desktop.
    #[tauri::command]
    pub async fn cancel_download(app: AppHandle, id: String) -> Result<Value, String> {
        let native = app.lu_native();
        // A finished download is not cancelled, its row is only taken away.
        if native.bg_command(&id, BgCommand::Cancel).await.is_err() {
            let _ = native.bg_command(&id, BgCommand::Forget).await;
        }
        Ok(json!({"status": "cancelled"}))
    }

    /// Take a settled row out of the list and leave the disk alone.
    #[tauri::command]
    pub async fn clear_download_entry(app: AppHandle, id: String) -> Result<Value, String> {
        match app.lu_native().bg_command(&id, BgCommand::Forget).await {
            Ok("not_found") => Ok(json!({"status": "not_found"})),
            Ok(_) => Ok(json!({"status": "cleared"})),
            Err(_) => Ok(json!({"status": "still_active"})),
        }
    }

    #[tauri::command]
    #[allow(non_snake_case)]
    pub async fn resume_download(
        app: AppHandle,
        id: String,
        url: String,
        subfolder: String,
        expectedBytes: Option<u64>,
        expectedSha256: Option<String>,
        authToken: Option<String>,
        title: Option<String>,
    ) -> Result<Value, String> {
        // `subfolder` names a ComfyUI folder and `authToken` is a CivitAI
        // key. A phone downloads text models into the app's model folder.
        let _ = (subfolder, authToken);
        let native = app.lu_native();
        if let Some(existing) = native.bg_find(&id).await.map_err(String::from)? {
            return match native.bg_command(&id, BgCommand::Resume).await {
                Ok("already_running") => Ok(json!({"status": "already_running", "id": id})),
                Ok(_) => Ok(json!({"status": "resuming", "offset": existing.received_bytes})),
                Err(e) => Ok(json!({"status": "error", "error": String::from(e)})),
            };
        }
        // No line for it: a partial file from before the list knew it. It
        // starts again under the same name.
        let expected_sha256 = match expectedSha256.as_deref() {
            Some(s) => Some(normalize_sha256(s)?),
            None => None,
        };
        let dest = crate::commands::engine::builtin_models_dir()?.join(sanitize_filename(&id));
        match start(&app, id.clone(), url, dest, expectedBytes, expected_sha256, title).await {
            Ok("already_running") => Ok(json!({"status": "already_running", "id": id})),
            Ok(_) => Ok(json!({"status": "resuming", "offset": 0})),
            Err(e) => Ok(json!({"status": "error", "error": e})),
        }
    }

    /// Partial files nothing is working on. What the native side still owns
    /// (running, paused, failed) has a row and is left out.
    #[tauri::command]
    #[allow(non_snake_case)]
    pub async fn find_orphan_downloads(
        app: AppHandle,
        extraDirs: Option<Vec<String>>,
    ) -> Result<Vec<OrphanDownload>, String> {
        let mut roots: Vec<PathBuf> = Vec::new();
        if let Ok(dir) = crate::commands::engine::builtin_models_dir() {
            roots.push(dir);
        }
        for dir in extraDirs.unwrap_or_default() {
            let path = PathBuf::from(dir);
            if path.is_absolute() {
                roots.push(path);
            }
        }
        let native = app.lu_native().bg_list().await.unwrap_or_default();
        let live = owned_stems(&native);
        tokio::task::spawn_blocking(move || scan_for_partials(roots, live))
            .await
            .map_err(|e| format!("Orphan scan failed: {}", e))
    }
}

#[cfg(mobile)]
pub use phone::*;

#[cfg(test)]
mod tests {
    use super::*;

    // Short check on Android, package 8: the notification named the file, not the model.
    #[test]
    fn the_notification_names_the_model_as_the_app_shows_it() {
        assert_eq!(notification_title(Some("Qwen 3.5 0.8B".to_string()), "Qwen3.5-0.8B-Q4_K_M.gguf"), "Qwen 3.5 0.8B");
        assert_eq!(notification_title(Some("  Document model \n".to_string()), "embed.gguf"), "Document model");
    }

    #[test]
    fn without_a_name_it_is_the_file_name_as_before() {
        assert_eq!(notification_title(None, "Qwen3.5-0.8B-Q4_K_M.gguf"), "Qwen3.5-0.8B-Q4_K_M.gguf");
        assert_eq!(notification_title(Some("   ".to_string()), "m.gguf"), "m.gguf");
        assert_eq!(notification_title(Some("\u{0007}\n".to_string()), "m.gguf"), "m.gguf");
    }

    #[test]
    fn a_name_is_one_line_and_not_longer_than_a_title() {
        let long = "x".repeat(300);
        assert_eq!(notification_title(Some(long), "m.gguf").chars().count(), 80);
        assert_eq!(notification_title(Some("Two\nlines".to_string()), "m.gguf"), "Twolines");
    }

    fn line(id: &str, state: BgState) -> BgDownload {
        BgDownload {
            id: id.to_string(),
            url: "https://huggingface.co/a/b/resolve/main/m.gguf".to_string(),
            dest: format!("/data/models/{id}"),
            state,
            received_bytes: 500,
            total_bytes: 1000,
            expected_bytes: 900,
            bytes_per_second: 250.0,
            sha256: None,
            error: None,
            error_code: None,
            resumable: false,
            created_at: 1,
            updated_at: 2,
        }
    }

    #[test]
    fn every_state_has_the_word_the_frontend_knows() {
        // The words of the desktop map (state.rs, DownloadProgress.status).
        let known = ["connecting", "downloading", "pausing", "paused", "complete", "error"];
        for state in [
            BgState::Queued,
            BgState::Running,
            BgState::Waiting,
            BgState::Paused,
            BgState::Verifying,
            BgState::Done,
            BgState::Error,
        ] {
            let word = status_word(state).expect("a word");
            assert!(known.contains(&word), "{state:?} maps to {word}, which the frontend does not know");
        }
        assert_eq!(status_word(BgState::Cancelled), None, "a cancelled download has no row");
    }

    #[test]
    fn a_live_state_is_never_shown_as_settled() {
        // `clearable` decides whether the frontend may drop a row. A row the
        // native side is still writing must not look droppable.
        for state in [BgState::Queued, BgState::Running, BgState::Waiting, BgState::Verifying] {
            assert!(state.is_live());
            let word = status_word(state).unwrap();
            assert!(!crate::commands::download::clearable(word), "{state:?} as {word} would be clearable");
        }
        for state in [BgState::Paused, BgState::Done, BgState::Error] {
            assert!(crate::commands::download::clearable(status_word(state).unwrap()));
        }
    }

    #[test]
    fn a_row_carries_bytes_total_speed_name_and_place() {
        let (id, row) = to_progress(&line("m.gguf", BgState::Running)).unwrap();
        assert_eq!(id, "m.gguf");
        assert_eq!(row.filename, "m.gguf");
        assert_eq!((row.progress, row.total), (500, 1000));
        assert_eq!(row.speed, 250.0);
        assert_eq!(row.dest, "/data/models/m.gguf");
        assert_eq!(row.status, "downloading");
        assert_eq!(row.error, None);
    }

    #[test]
    fn the_catalog_size_stands_in_until_the_server_spoke() {
        let mut d = line("m.gguf", BgState::Queued);
        d.total_bytes = 0;
        let (_, row) = to_progress(&d).unwrap();
        assert_eq!(row.total, 900);
        assert_eq!(row.status, "connecting");
    }

    #[test]
    fn only_a_running_download_has_a_speed() {
        for state in [BgState::Paused, BgState::Waiting, BgState::Done, BgState::Error, BgState::Verifying] {
            let (_, row) = to_progress(&line("m.gguf", state)).unwrap();
            assert_eq!(row.speed, 0.0, "{state:?}");
        }
    }

    #[test]
    fn an_error_row_always_has_a_sentence() {
        let mut d = line("m.gguf", BgState::Error);
        let (_, row) = to_progress(&d).unwrap();
        assert_eq!(row.error.as_deref(), Some("The download failed."));
        d.error = Some("The file was not found on the server (404).".to_string());
        let (_, row) = to_progress(&d).unwrap();
        assert_eq!(row.error.as_deref(), Some("The file was not found on the server (404)."));
        // And no other state carries one, even if the line still has an old text.
        let mut done = line("m.gguf", BgState::Done);
        done.error = Some("old".to_string());
        assert_eq!(to_progress(&done).unwrap().1.error, None);
    }

    #[test]
    fn the_row_serializes_in_the_shape_of_the_desktop_one() {
        let (_, row) = to_progress(&line("m.gguf", BgState::Done)).unwrap();
        let v = serde_json::to_value(&row).unwrap();
        let mut keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["dest", "filename", "progress", "speed", "status", "total"]);
        assert_eq!(v["status"], "complete");
    }

    #[test]
    fn the_native_list_wins_over_a_row_of_the_same_name_and_keeps_the_others() {
        let mut own = HashMap::new();
        let stale = DownloadProgress {
            progress: 1,
            total: 2,
            speed: 0.0,
            filename: "m.gguf".to_string(),
            status: "error".to_string(),
            error: Some("old".to_string()),
            dest: String::new(),
        };
        own.insert("m.gguf".to_string(), stale.clone());
        own.insert("other.safetensors".to_string(), DownloadProgress { filename: "other.safetensors".to_string(), ..stale });
        let merged = merge_progress(own, &[line("m.gguf", BgState::Done), line("gone.gguf", BgState::Cancelled)]);
        assert_eq!(merged["m.gguf"].status, "complete");
        assert_eq!(merged["other.safetensors"].status, "error");
        assert!(!merged.contains_key("gone.gguf"), "a cancelled download has no row");
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn a_download_finished_while_the_app_was_gone_is_reported() {
        // The list comes from disk. A line in state done is all that is left
        // of a download that ended without the app, and it has to show.
        let merged = merge_progress(HashMap::new(), &[line("m.gguf", BgState::Done)]);
        assert_eq!(merged["m.gguf"].status, "complete");
        assert_eq!(merged["m.gguf"].progress, 500);
    }

    #[test]
    fn what_the_native_side_owns_is_not_an_orphan() {
        let stems = owned_stems(&[
            line("running.gguf", BgState::Running),
            line("paused.Q4_K_M.gguf", BgState::Paused),
            line("failed.gguf", BgState::Error),
            line("done.gguf", BgState::Done),
        ]);
        // The partial of `paused.Q4_K_M.gguf` is `paused.Q4_K_M.download`.
        assert_eq!(stems, ["running", "paused.Q4_K_M", "failed"]);
    }

    #[test]
    fn the_hub_token_goes_to_the_hub_and_nowhere_else() {
        let hub = hub_headers("https://huggingface.co/a/b/resolve/main/m.gguf", Some(" hf_x ".to_string()));
        assert_eq!(hub.get("Authorization").map(String::as_str), Some("Bearer hf_x"));
        assert!(hub_headers("https://example.com/m.gguf", Some("hf_x".to_string())).is_empty());
        assert!(hub_headers("https://huggingface.co.evil.example/m.gguf", Some("hf_x".to_string())).is_empty());
        assert!(hub_headers("https://huggingface.co/a/b/resolve/main/m.gguf", None).is_empty());
        assert!(hub_headers("https://huggingface.co/a/b/resolve/main/m.gguf", Some("   ".to_string())).is_empty());
    }
}
