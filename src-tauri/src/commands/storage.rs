//! Settings → Storage: one folder for everything LU downloads and makes.
//!
//! Discord "Storage Management" (12. and 17.10.2026) and
//! a report in #bug-reports: choose where the models go, all of them in one
//! folder (LU Engine, ComfyUI models, voice), choose where the gallery lives,
//! and stop filling drive C:. 3.0.7 had the pieces, each in its own row: the
//! model folder (read, and the LU Engine downloads into it), the voice engine
//! and LU's Python on another drive (`runtime_root`), and ComfyUI downloads
//! into ComfyUI's own folders. ComfyUI downloads and the gallery could not
//! leave the ComfyUI install, and nothing that was already there moved.
//!
//! One folder now, with three parts below it:
//!
//! * `Models`: the model folder of Settings (`custom_model_dir`). The LU
//!   Engine reads and downloads GGUFs there; ComfyUI is handed its
//!   ComfyUI-shaped subfolders (custom_models.rs) and, new, ComfyUI downloads
//!   go there too ([`COMFY_DOWNLOADS_KEY`], read in `comfy_user_paths`).
//! * `Gallery`: ComfyUI's output folder ([`GALLERY_KEY`]), passed as
//!   `--output-directory` to a ComfyUI that LU starts. Not on the Mac, whose
//!   pictures are not made by ComfyUI.
//! * `Runtime`: the voice engine, the read-aloud voices and LU's Python
//!   (`runtime_root`), which must not sit inside the model folder (its scan).
//!
//! Choosing the folder changes where NEW files go. Moving what is there is a
//! second, explicit step ([`storage_apply`] with `move_files`), and it follows
//! the rules of `storage_move`: a move and not a copy, the space checked
//! first, nothing overwritten, nothing deleted that was not moved.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::custom_models::{self, RememberedRoot, COMFY_MODEL_FOLDERS};
use crate::runtime_root::{self, Kind, Roots};
use crate::state::AppState;
use crate::storage_move::{self, TreePlan, TreeReport};
use crate::os_error;

/// The one folder, as chosen. Shown in Settings; the parts below it are
/// stored under their own keys, so each part keeps working on its own.
pub const STORAGE_ROOT_KEY: &str = "storage_root";
/// True: ComfyUI downloads go into the model folder (`custom_model_dir`).
pub const COMFY_DOWNLOADS_KEY: &str = "comfy_downloads_in_model_folder";
/// The gallery: ComfyUI's output folder. Empty or missing is ComfyUI's own.
pub const GALLERY_KEY: &str = "comfy_output_dir";

pub const MODELS_SUB: &str = "Models";
pub const GALLERY_SUB: &str = "Gallery";
pub const RUNTIME_SUB: &str = "Runtime";

/// Free space a move leaves on the drive, at least: the system and the next
/// download need room too.
const SPARE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

static MOVING: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

// ── what config.json says ───────────────────────────────────────────────────

fn read_json(config: &Path) -> serde_json::Value {
    std::fs::read_to_string(config)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .filter(|v: &serde_json::Value| v.is_object())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn path_key(json: &serde_json::Value, key: &str) -> Option<PathBuf> {
    json.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
}

/// LU's own choice for ComfyUI, as `comfy_user_paths` folds it in.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LuChoice {
    /// ComfyUI downloads go below this folder, in ComfyUI's layout.
    pub downloads_root: Option<PathBuf>,
    pub gallery: Option<PathBuf>,
}

pub fn lu_choice_in(config: &Path) -> LuChoice {
    let json = read_json(config);
    let downloads = json.get(COMFY_DOWNLOADS_KEY).and_then(|v| v.as_bool()).unwrap_or(false);
    LuChoice {
        downloads_root: if downloads { path_key(&json, custom_models::REMEMBERED_ROOT_KEY) } else { None },
        gallery: path_key(&json, GALLERY_KEY),
    }
}

pub fn lu_choice() -> LuChoice {
    lu_choice_in(&crate::os_paths::app_config_json())
}

/// The folder a ComfyUI model of `key` goes into below `root`: the layout
/// that is there (`root/key` or `root/models/key`, the two the handover to
/// ComfyUI reads), else `root/key`.
pub fn comfy_dir_below(root: &Path, key: &str) -> PathBuf {
    [root.join(key), root.join("models").join(key)]
        .into_iter()
        .find(|p| p.is_dir())
        .unwrap_or_else(|| root.join(key))
}

/// The folder keys created below the model folder, so ComfyUI is handed every
/// one of them on its next start and sees a download the moment it lands.
/// The two old names (`clip`, `unet`) only when they are there already.
pub fn keys_to_create() -> impl Iterator<Item = &'static str> {
    COMFY_MODEL_FOLDERS.iter().copied().filter(|k| *k != "clip" && *k != "unet")
}

pub fn create_comfy_folders(root: &Path) -> std::io::Result<()> {
    for key in keys_to_create() {
        std::fs::create_dir_all(comfy_dir_below(root, key))?;
    }
    Ok(())
}

fn write_keys(config: &Path, values: &[(&str, serde_json::Value)]) -> Result<(), String> {
    let mut json = read_json(config);
    for (k, v) in values {
        json[*k] = v.clone();
    }
    let write = || -> std::io::Result<()> {
        if let Some(parent) = config.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = config.with_extension("json.storage-tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(&json).unwrap_or_default())?;
        std::fs::rename(&tmp, config)
    };
    write().map_err(|e| format!("LU could not save the folder in {}: {}.", config.display(), os_error::io_english(&e)))
}

// ── drives ──────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    /// `C:\` on Windows, the mount point elsewhere.
    pub mount: String,
    pub free: u64,
    pub total: u64,
    /// The drive the system runs from (C: on Windows).
    pub system: bool,
}

fn system_mount() -> PathBuf {
    if cfg!(windows) {
        let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
        PathBuf::from(format!("{}\\", drive.trim_end_matches('\\')))
    } else {
        PathBuf::from("/")
    }
}

/// The drive `path` is on (its nearest existing folder decides).
pub fn drive_of(path: &Path) -> Option<Drive> {
    let existing = path.ancestors().find(|p| p.exists())?;
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let disk = disks
        .iter()
        .filter(|d| storage_move::is_within(existing, d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())?;
    let mount = disk.mount_point().to_path_buf();
    // On a Mac the data volume is mounted below / (System/Volumes/Data) and
    // the home folder reads as "/"; both are the system drive.
    let system = storage_move::same_volume(&mount, &system_mount())
        || (cfg!(target_os = "macos") && storage_move::same_volume(existing, &crate::os_paths::home()));
    Some(Drive { mount: mount.to_string_lossy().to_string(), free: disk.available_space(), total: disk.total_space(), system })
}

// ── where things are ────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    /// `models`, `comfyModels`, `gallery`, `runtime`.
    pub id: String,
    pub path: String,
    pub drive: Option<Drive>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatus {
    pub root: Option<String>,
    /// This machine runs ComfyUI (not the Mac), so there are ComfyUI models
    /// and a ComfyUI gallery to place.
    pub comfy_here: bool,
    /// The ComfyUI install LU uses, if it knows one on this machine.
    pub comfy_path: Option<String>,
    pub comfy_downloads_in_model_folder: bool,
    pub places: Vec<Place>,
    pub moving: bool,
    pub example: String,
}

fn example_root() -> &'static str {
    if cfg!(windows) {
        "D:\\LU"
    } else if cfg!(target_os = "macos") {
        "/Volumes/Data/LU"
    } else {
        "/mnt/data/LU"
    }
}

/// The ComfyUI folder on this machine, or None (Mac, none known, or a
/// ComfyUI on another host whose folders are not ours to move).
fn local_comfy(state: &AppState) -> Option<PathBuf> {
    if !crate::commands::process::comfy_supported_here() {
        return None;
    }
    let host = state.comfy_host.lock().map(|h| h.clone()).unwrap_or_default();
    if !crate::commands::process::is_local_host(host.trim().trim_matches(|c| c == '[' || c == ']')) {
        return None;
    }
    let path = state.comfy_path.lock().ok().and_then(|p| p.clone())?;
    let path = PathBuf::from(path.trim());
    path.join("main.py").is_file().then_some(path)
}

fn model_folder() -> PathBuf {
    match custom_models::remembered_root() {
        RememberedRoot::Folder(dir) => PathBuf::from(dir),
        _ => crate::os_paths::builtin_models_dir(),
    }
}

fn place(id: &str, path: &Path) -> Place {
    Place { id: id.to_string(), path: path.to_string_lossy().to_string(), drive: drive_of(path) }
}

fn status_now(app: &AppHandle, state: &AppState) -> StorageStatus {
    let json = read_json(&crate::os_paths::app_config_json());
    let comfy = local_comfy(state);
    let mut places = vec![place("models", &model_folder())];
    if let Some(comfy) = &comfy {
        let user = crate::commands::comfy_user_paths::UserComfyPaths::discover(comfy);
        let downloads = user.write_dir("checkpoints").unwrap_or_else(|| comfy.join("models").join("checkpoints"));
        let downloads = downloads.parent().map(Path::to_path_buf).unwrap_or(downloads);
        places.push(place("comfyModels", &downloads));
        places.push(place("gallery", &user.output_dir_or(comfy)));
    }
    let defaults = crate::commands::runtime_folder::defaults(app);
    if let Some(voice) = runtime_root::current(Kind::Voice, &runtime_root::roots(), &defaults) {
        let shown = voice.parent().map(Path::to_path_buf).unwrap_or(voice);
        places.push(place("runtime", &shown));
    }
    StorageStatus {
        root: path_key(&json, STORAGE_ROOT_KEY).map(|p| p.to_string_lossy().to_string()),
        comfy_here: crate::commands::process::comfy_supported_here(),
        comfy_path: comfy.map(|p| p.to_string_lossy().to_string()),
        comfy_downloads_in_model_folder: json.get(COMFY_DOWNLOADS_KEY).and_then(|v| v.as_bool()).unwrap_or(false),
        places,
        moving: MOVING.load(Ordering::SeqCst),
        example: example_root().to_string(),
    }
}

async fn blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "The storage task ended unexpectedly. Try again.".to_string())?
}

#[tauri::command]
pub async fn storage_status(app: AppHandle) -> Result<StorageStatus, String> {
    blocking(move || {
        let state = app.state::<AppState>();
        Ok(status_now(&app, &state))
    })
    .await
}

// ── the plan ────────────────────────────────────────────────────────────────

/// One folder that would move.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPlan {
    /// `luEngine`, `modelFolder`, `comfy:<key>`, `gallery`, `runtime:<kind>`.
    pub id: String,
    /// `models`, `comfyModels`, `gallery`, `runtime`: the row it belongs to.
    pub group: String,
    pub from: String,
    pub to: String,
    pub plan: TreePlan,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePlan {
    pub root: String,
    pub models_dir: String,
    pub gallery_dir: Option<String>,
    pub runtime_dir: String,
    pub items: Vec<ItemPlan>,
    /// Bytes that have to be copied to the folder's drive.
    pub cross_bytes: u64,
    pub drive: Option<Drive>,
    pub enough_space: bool,
    /// Why the move cannot start right now, in a sentence. Choosing the folder
    /// for new files works anyway.
    pub blocker: Option<String>,
    /// Running engines LU stops for the move and starts again on demand.
    pub stops: Vec<String>,
}

/// What a typed or picked folder has to clear. Created when missing, and
/// written to once, so a drive that is read-only or gone says so now.
pub fn check_root(raw: &str) -> Result<PathBuf, String> {
    let text = raw.trim();
    if text.is_empty() {
        return Err("Choose a folder first.".to_string());
    }
    if text.starts_with('~') {
        return Err(format!("\"{text}\" starts with ~. Use a full path, for example {}.", example_root()));
    }
    let path = PathBuf::from(text);
    if !path.is_absolute() {
        return Err(format!("\"{text}\" is not a full path. Use one that starts at the drive, for example {}.", example_root()));
    }
    std::fs::create_dir_all(&path).map_err(|e| {
        format!(
            "LU cannot create {}: {}. Check that the drive is connected and that your account may write there.",
            path.display(),
            os_error::io_english(&e)
        )
    })?;
    let probe = path.join(format!(".lu-storage-probe-{}", std::process::id()));
    std::fs::write(&probe, b"probe")
        .map_err(|e| format!("LU cannot write to {}: {}. Choose a folder your account may write to.", path.display(), os_error::io_english(&e)))?;
    let _ = std::fs::remove_file(&probe);
    Ok(path)
}

/// The folders to move for `root`, before anything is decided. Pure, for the
/// tests: every input is handed in.
pub fn items_for(
    root: &Path,
    lu_engine_default: &Path,
    model_folder: Option<&Path>,
    comfy: Option<&Path>,
    gallery_now: Option<&Path>,
    runtime_found: &[(Kind, PathBuf)],
) -> Result<Vec<ItemPlan>, String> {
    let models = root.join(MODELS_SUB);
    let mut out: Vec<ItemPlan> = Vec::new();
    let mut sources: Vec<PathBuf> = Vec::new();
    let mut push = |id: String, group: &str, from: &Path, to: &Path, out: &mut Vec<ItemPlan>| {
        if storage_move::is_within(from, to) || !from.is_dir() {
            return;
        }
        let plan = storage_move::plan_tree(from, to);
        sources.push(from.to_path_buf());
        if plan.files == 0 && plan.conflicts == 0 {
            return;
        }
        out.push(ItemPlan {
            id,
            group: group.to_string(),
            from: from.to_string_lossy().to_string(),
            to: to.to_string_lossy().to_string(),
            plan,
        });
    };
    push("luEngine".to_string(), "models", lu_engine_default, &models, &mut out);
    if let Some(folder) = model_folder.filter(|f| !storage_move::is_within(f, lu_engine_default) && *f != lu_engine_default) {
        push("modelFolder".to_string(), "models", folder, &models, &mut out);
    }
    if let Some(comfy) = comfy {
        for key in COMFY_MODEL_FOLDERS {
            let from = comfy.join("models").join(key);
            push(format!("comfy:{key}"), "comfyModels", &from, &comfy_dir_below(&models, key), &mut out);
        }
        if let Some(gallery) = gallery_now {
            push("gallery".to_string(), "gallery", gallery, &root.join(GALLERY_SUB), &mut out);
        }
    }
    for (kind, from) in runtime_found {
        let to = root.join(RUNTIME_SUB).join(kind.sub());
        if from == &to || !from.exists() {
            continue;
        }
        let bytes = runtime_root::tree_size(from);
        // The runtime move copies, checks and starts the copy before the old
        // folder goes (runtime_root::move_entry), so it needs its whole size
        // on the drive even within one drive.
        out.push(ItemPlan {
            id: format!("runtime:{}", kind.sub()),
            group: "runtime".to_string(),
            from: from.to_string_lossy().to_string(),
            to: to.to_string_lossy().to_string(),
            plan: TreePlan { files: 1, bytes, cross_bytes: bytes, same_volume: storage_move::same_volume(from, &to), conflicts: 0 },
        });
    }
    // A folder inside one of the folders that move would be carried into
    // itself.
    if let Some(src) = sources.iter().find(|s| storage_move::is_within(root, s)) {
        return Err(format!("{} is inside {}, which is one of the folders that move. Choose a folder outside of it.", root.display(), src.display()));
    }
    Ok(out)
}

/// The engines that hold files open, and whether LU can stop them itself.
fn running(state: &AppState) -> (Vec<String>, Option<String>) {
    let mut stops = Vec::new();
    let mut blocker = None;
    let comfy_child = state.comfy_process.lock().map(|p| p.is_some()).unwrap_or(false);
    let port = state.comfy_port.lock().map(|p| *p).unwrap_or(8188);
    if comfy_child {
        stops.push("ComfyUI".to_string());
    } else if crate::commands::process::comfy_supported_here() && crate::commands::process::is_comfyui_running_on_port(port) {
        blocker = Some("A ComfyUI that LU did not start is running. Close it, then move the files.".to_string());
    }
    if state.bundled_engine.lock().map(|e| e.is_some()).unwrap_or(false) || state.bundled_embed.lock().map(|e| e.is_some()).unwrap_or(false) {
        stops.push("the LU Engine".to_string());
    }
    let downloading = state
        .downloads
        .lock()
        .map(|d| d.values().any(|p| matches!(p.status.as_str(), "connecting" | "downloading" | "pausing" | "paused")))
        .unwrap_or(false);
    if downloading {
        blocker = Some("A download is running or paused. Let it finish or cancel it in the Model Manager, then move the files.".to_string());
    }
    if blocker.is_none() {
        blocker = crate::commands::runtime_folder::busy_reason(state).map(str::to_string);
    }
    if MOVING.load(Ordering::SeqCst) {
        blocker = Some("A move is already running.".to_string());
    }
    (stops, blocker)
}

fn plan_now(app: &AppHandle, state: &AppState, raw_root: &str) -> Result<StoragePlan, String> {
    let root = check_root(raw_root)?;
    let comfy = local_comfy(state);
    let gallery_now = comfy.as_ref().map(|c| crate::commands::comfy_user_paths::UserComfyPaths::discover(c).output_dir_or(c));
    let defaults = crate::commands::runtime_folder::defaults(app);
    let roots = runtime_root::roots();
    let runtime_found: Vec<(Kind, PathBuf)> =
        Kind::ALL.iter().filter_map(|k| runtime_root::found(*k, &roots, &defaults).map(|p| (*k, p))).collect();
    let folder = match custom_models::remembered_root() {
        RememberedRoot::Folder(dir) => Some(PathBuf::from(dir)),
        _ => None,
    };
    let items = items_for(
        &root,
        &crate::os_paths::builtin_models_dir(),
        folder.as_deref(),
        comfy.as_deref(),
        gallery_now.as_deref(),
        &runtime_found,
    )?;
    let cross_bytes: u64 = items.iter().map(|i| i.plan.cross_bytes).sum();
    let drive = drive_of(&root);
    let enough_space = drive.as_ref().map(|d| d.free >= cross_bytes.saturating_add(SPARE_BYTES)).unwrap_or(true);
    let (stops, blocker) = running(state);
    Ok(StoragePlan {
        root: root.to_string_lossy().to_string(),
        models_dir: root.join(MODELS_SUB).to_string_lossy().to_string(),
        gallery_dir: comfy.as_ref().map(|_| root.join(GALLERY_SUB).to_string_lossy().to_string()),
        runtime_dir: root.join(RUNTIME_SUB).to_string_lossy().to_string(),
        items,
        cross_bytes,
        drive,
        enough_space,
        blocker,
        stops,
    })
}

/// What choosing `root` would mean: the folders, what would move, the space.
/// Creates the folder (and only it); changes no setting and moves nothing.
#[tauri::command]
pub async fn storage_plan(app: AppHandle, root: String) -> Result<StoragePlan, String> {
    blocking(move || {
        let state = app.state::<AppState>();
        plan_now(&app, &state, &root)
    })
    .await
}

// ── choosing and moving ─────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemReport {
    pub id: String,
    pub group: String,
    pub from: String,
    pub to: String,
    pub report: TreeReport,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageApplied {
    pub root: String,
    /// The model folder to store in Settings (`hfDownloadPathOverride`).
    pub models_dir: String,
    pub gallery_dir: Option<String>,
    pub runtime_dir: String,
    pub moved: Vec<ItemReport>,
    pub runtime: Vec<runtime_root::MoveOutcome>,
    /// What LU stopped for the move; each starts again when it is next used.
    pub stopped: Vec<String>,
    pub cancelled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    id: &'a str,
    done: u64,
    total: u64,
    all_done: u64,
    all_total: u64,
    file: String,
}

/// Store the folder as the one for new files. The model folder itself is
/// stored by the frontend too (`hfDownloadPathOverride`, which then hands it
/// to ComfyUI); it is written here as well so a ComfyUI that starts before the
/// frontend has pushed it down already reads the new folders.
fn choose(root: &Path, comfy_here: bool) -> Result<(PathBuf, Option<PathBuf>, PathBuf), String> {
    let models = root.join(MODELS_SUB);
    std::fs::create_dir_all(&models).map_err(|e| format!("LU cannot create {}: {}.", models.display(), os_error::io_english(&e)))?;
    let gallery = if comfy_here {
        let g = root.join(GALLERY_SUB);
        std::fs::create_dir_all(&g).map_err(|e| format!("LU cannot create {}: {}.", g.display(), os_error::io_english(&e)))?;
        create_comfy_folders(&models).map_err(|e| format!("LU cannot create the model folders in {}: {}.", models.display(), os_error::io_english(&e)))?;
        Some(g)
    } else {
        None
    };
    let defaults = runtime_root::Defaults::here(None);
    let runtime = runtime_root::check_candidate(&root.join(RUNTIME_SUB).to_string_lossy(), &defaults)?;
    let config = crate::os_paths::app_config_json();
    let s = |p: &Path| serde_json::json!(p.to_string_lossy().to_string());
    let mut values: Vec<(&str, serde_json::Value)> = vec![
        (STORAGE_ROOT_KEY, s(root)),
        (custom_models::REMEMBERED_ROOT_KEY, s(&models)),
    ];
    if let Some(g) = &gallery {
        values.push((COMFY_DOWNLOADS_KEY, serde_json::json!(true)));
        values.push((GALLERY_KEY, s(g)));
    }
    write_keys(&config, &values)?;
    let current: Roots = runtime_root::roots();
    if current.chosen.as_deref() != Some(runtime.as_path()) {
        runtime_root::write_roots(&config, Some(&runtime))?;
    }
    Ok((models, gallery, runtime))
}

/// Choose `root` for everything LU downloads and makes from now on, and with
/// `move_files` move what is there already. `skip` names plan items (ids from
/// [`storage_plan`]) the user unticked.
#[tauri::command]
pub async fn storage_apply(
    app: AppHandle,
    root: String,
    move_files: bool,
    skip: Option<Vec<String>>,
) -> Result<StorageApplied, String> {
    let skip = skip.unwrap_or_default();
    let state = app.state::<AppState>();
    let plan = {
        let app = app.clone();
        let root = root.clone();
        blocking(move || {
            let state = app.state::<AppState>();
            plan_now(&app, &state, &root)
        })
        .await?
    };
    if move_files {
        if let Some(why) = &plan.blocker {
            return Err(why.clone());
        }
        let wanted: u64 = plan.items.iter().filter(|i| !skip.contains(&i.id)).map(|i| i.plan.cross_bytes).sum();
        if let Some(drive) = &plan.drive {
            if drive.free < wanted.saturating_add(SPARE_BYTES) {
                return Err(format!(
                    "The move needs {} on {} and {} is free there (LU keeps {} spare). Nothing was moved or changed.",
                    gib(wanted),
                    drive.mount,
                    gib(drive.free),
                    gib(SPARE_BYTES)
                ));
            }
        }
        if MOVING.swap(true, Ordering::SeqCst) {
            return Err("A move is already running.".to_string());
        }
    }
    let comfy_here = local_comfy(&state).is_some();
    let root_path = PathBuf::from(&plan.root);
    let chosen = {
        let root_path = root_path.clone();
        blocking(move || choose(&root_path, comfy_here)).await
    };
    let (models, gallery, runtime) = match chosen {
        Ok(c) => c,
        Err(e) => {
            if move_files {
                MOVING.store(false, Ordering::SeqCst);
            }
            return Err(e);
        }
    };
    let mut applied = StorageApplied {
        root: plan.root.clone(),
        models_dir: models.to_string_lossy().to_string(),
        gallery_dir: gallery.as_ref().map(|g| g.to_string_lossy().to_string()),
        runtime_dir: runtime.to_string_lossy().to_string(),
        moved: Vec::new(),
        runtime: Vec::new(),
        stopped: Vec::new(),
        cancelled: false,
    };
    if !move_files {
        return Ok(applied);
    }

    CANCEL.store(false, Ordering::SeqCst);
    // Files the engines hold open cannot move on Windows. Both start again
    // the next time something needs them.
    {
        let app = app.clone();
        let stops = plan.stops.clone();
        applied.stopped = stops.clone();
        let _ = blocking(move || {
            let state = app.state::<AppState>();
            if stops.iter().any(|s| s == "ComfyUI") {
                let _ = crate::commands::process::stop_comfyui_blocking(&state);
            }
            crate::commands::engine::stop_engine_on_request(&state);
            crate::commands::engine::stop_embed_locked(&state);
            Ok(())
        })
        .await;
    }

    let files: Vec<ItemPlan> = plan.items.iter().filter(|i| !skip.contains(&i.id) && i.group != "runtime").cloned().collect();
    let all_total: u64 = files.iter().map(|i| i.plan.bytes).sum();
    let moved = {
        let app = app.clone();
        blocking(move || {
            let mut out = Vec::new();
            let mut all_done = 0u64;
            let mut last = std::time::Instant::now() - std::time::Duration::from_secs(1);
            for item in files {
                if CANCEL.load(Ordering::SeqCst) {
                    break;
                }
                let (from, to) = (PathBuf::from(&item.from), PathBuf::from(&item.to));
                let base = all_done;
                let report = storage_move::move_tree(&from, &to, &CANCEL, &mut |done, file| {
                    if last.elapsed() >= std::time::Duration::from_millis(250) {
                        last = std::time::Instant::now();
                        let _ = app.emit(
                            "storage-move-progress",
                            Progress {
                                id: &item.id,
                                done,
                                total: item.plan.bytes,
                                all_done: base + done,
                                all_total,
                                file: file.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                            },
                        );
                    }
                });
                all_done = base + report.moved_bytes;
                out.push(ItemReport { id: item.id.clone(), group: item.group.clone(), from: item.from.clone(), to: item.to.clone(), report });
            }
            Ok(out)
        })
        .await
    };
    match moved {
        Ok(m) => applied.moved = m,
        Err(e) => {
            MOVING.store(false, Ordering::SeqCst);
            return Err(e);
        }
    }
    applied.cancelled = CANCEL.load(Ordering::SeqCst) || applied.moved.iter().any(|m| m.report.cancelled);
    // The voice engine and the Python: their own move, which copies, starts
    // the copy once and only then hands the old folder to the trash.
    let runtime_wanted = plan.items.iter().any(|i| i.group == "runtime" && !skip.contains(&i.id));
    if runtime_wanted && !applied.cancelled {
        match crate::commands::runtime_folder::run_runtime_move(&app, &state).await {
            Ok(outcomes) => applied.runtime = outcomes,
            Err(e) => applied.runtime.push(runtime_root::MoveOutcome {
                kind: Kind::Voice,
                from: String::new(),
                to: applied.runtime_dir.clone(),
                status: runtime_root::MoveStatus::Failed,
                detail: e,
            }),
        }
    }
    MOVING.store(false, Ordering::SeqCst);
    Ok(applied)
}

/// Stop a running move between files (or inside a copy).
#[tauri::command]
pub fn storage_cancel() -> bool {
    let running = MOVING.load(Ordering::SeqCst);
    if running {
        CANCEL.store(true, Ordering::SeqCst);
    }
    running
}

fn gib(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put(path: &Path, bytes: &[u8]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn the_choice_is_read_from_config_and_the_downloads_need_the_switch() {
        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join("config.json");
        let models = tmp.path().join("D").join("LU").join("Models");
        let gallery = tmp.path().join("D").join("LU").join("Gallery");
        std::fs::write(
            &config,
            serde_json::json!({
                "comfyui_port": 8188,
                "custom_model_dir": models.to_string_lossy(),
                "comfy_output_dir": gallery.to_string_lossy(),
            })
            .to_string(),
        )
        .unwrap();
        // A model folder alone (3.0.7 users) does not take the ComfyUI
        // downloads: that changed nothing for them.
        assert_eq!(lu_choice_in(&config), LuChoice { downloads_root: None, gallery: Some(gallery.clone()) });

        write_keys(&config, &[(COMFY_DOWNLOADS_KEY, serde_json::json!(true))]).unwrap();
        assert_eq!(lu_choice_in(&config), LuChoice { downloads_root: Some(models), gallery: Some(gallery) });
        // Every other key stays.
        assert_eq!(read_json(&config)["comfyui_port"], 8188);
    }

    #[test]
    fn a_relative_or_broken_value_is_no_choice() {
        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join("config.json");
        std::fs::write(&config, r#"{"comfy_downloads_in_model_folder": true, "custom_model_dir": "models", "comfy_output_dir": " "}"#).unwrap();
        assert_eq!(lu_choice_in(&config), LuChoice::default());
        std::fs::write(&config, "not json").unwrap();
        assert_eq!(lu_choice_in(&config), LuChoice::default());
    }

    #[test]
    fn the_comfy_layout_that_is_there_wins_else_the_flat_one() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Models");
        std::fs::create_dir_all(root.join("models").join("loras")).unwrap();
        assert_eq!(comfy_dir_below(&root, "loras"), root.join("models").join("loras"));
        assert_eq!(comfy_dir_below(&root, "vae"), root.join("vae"));
        create_comfy_folders(&root).unwrap();
        assert!(root.join("checkpoints").is_dir() && root.join("diffusion_models").is_dir());
        assert!(!root.join("loras").exists(), "the layout that was there is kept");
        assert!(!root.join("clip").exists() && !root.join("unet").exists(), "no old key names are made");
    }

    #[test]
    fn the_plan_names_every_folder_that_moves_and_skips_empty_ones() {
        let tmp = tempfile::tempdir().unwrap();
        let c = tmp.path().join("C");
        let engine = c.join("AppData").join("engine").join("models");
        put(&engine.join("qwen.gguf"), b"gguf");
        let comfy = c.join("ComfyUI");
        put(&comfy.join("main.py"), b"");
        put(&comfy.join("models").join("loras").join("a.safetensors"), b"lora");
        std::fs::create_dir_all(comfy.join("models").join("vae")).unwrap();
        put(&comfy.join("output").join("LU_0001.png"), b"png");
        let voice = c.join("AppData").join("app").join("voice");
        put(&voice.join("install.json"), b"{}");
        let root = tmp.path().join("D").join("LU");

        let items = items_for(&root, &engine, None, Some(&comfy), Some(&comfy.join("output")), &[(Kind::Voice, voice.clone())]).unwrap();
        let ids: Vec<&str> = items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, vec!["luEngine", "comfy:loras", "gallery", "runtime:voice"]);
        let lora = items.iter().find(|i| i.id == "comfy:loras").unwrap();
        assert_eq!(PathBuf::from(&lora.to), root.join("Models").join("loras"));
        assert_eq!(lora.plan.bytes, 4);
        assert_eq!(PathBuf::from(&items[2].to), root.join("Gallery"));
        assert_eq!(PathBuf::from(&items[3].to), root.join("Runtime").join("voice"));
        assert_eq!(items[3].plan.cross_bytes, 2, "the runtime move copies first, so it needs its size");
    }

    #[test]
    fn a_folder_inside_a_folder_that_moves_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let comfy = tmp.path().join("ComfyUI");
        put(&comfy.join("models").join("loras").join("a.safetensors"), b"lora");
        let engine = tmp.path().join("engine");
        let err = items_for(&comfy.join("models").join("loras").join("LU"), &engine, None, Some(&comfy), None, &[]).unwrap_err();
        assert!(err.contains("inside"), "{err}");
    }

    #[test]
    fn the_model_folder_already_in_place_is_not_moved_onto_itself() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("LU");
        put(&root.join("Models").join("x.gguf"), b"x");
        let engine = tmp.path().join("engine");
        let items = items_for(&root, &engine, Some(&root.join("Models")), None, None, &[]).unwrap();
        assert!(items.is_empty(), "{items:?}");
    }

    /// The real thing on a machine with two drives (C: and D: on Windows), run by
    /// hand: `LU_STORAGE_REAL_FROM=C:\\lu-work\\x\\src LU_STORAGE_REAL_TO=D:\\x\\LU
    /// cargo test real_move_across_drives -- --ignored --nocapture`. Only the
    /// two folders named there are written; the test makes its own files.
    #[test]
    #[ignore]
    fn real_move_across_drives() {
        let (Ok(from), Ok(to)) = (std::env::var("LU_STORAGE_REAL_FROM"), std::env::var("LU_STORAGE_REAL_TO")) else {
            panic!("set LU_STORAGE_REAL_FROM and LU_STORAGE_REAL_TO");
        };
        let mb: usize = std::env::var("LU_STORAGE_REAL_MB").ok().and_then(|v| v.parse().ok()).unwrap_or(200);
        let (from, to) = (PathBuf::from(from), PathBuf::from(to));
        assert!(!to.exists(), "the target must be new: {}", to.display());
        let body = |seed: u8, len: usize| -> Vec<u8> { (0..len).map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed)).collect() };
        let files = [
            ("checkpoints/big.safetensors", body(1, mb * 1024 * 1024)),
            ("loras/small.safetensors", body(2, 4096)),
            ("loras/sub/deeper.safetensors", body(3, 3 * 1024 * 1024 + 5)),
        ];
        for (rel, data) in &files {
            put(&from.join(rel), data);
        }
        // One already at the new place: it must stay untouched, and so must the original.
        put(&to.join("loras").join("small.safetensors"), b"already here");

        let df = drive_of(&from);
        let dt = drive_of(&to);
        println!("from {:?}\nto   {:?}", df, dt);
        let plan = storage_move::plan_tree(&from, &to);
        println!("plan {plan:?}");
        assert_eq!(plan.files, 2);
        assert_eq!(plan.conflicts, 1);
        if std::env::var("LU_STORAGE_EXPECT_CROSS").as_deref() == Ok("1") {
            assert!(!plan.same_volume, "two drives");
            assert_eq!(plan.cross_bytes, plan.bytes);
        }
        let started = std::time::Instant::now();
        let mut ticks = 0u32;
        let report = storage_move::move_tree(&from, &to, &AtomicBool::new(false), &mut |_, _| ticks += 1);
        println!("report {report:?} in {:.1} s, {ticks} progress calls", started.elapsed().as_secs_f64());
        assert_eq!((report.moved_files, report.kept, report.failed_count), (2, 1, 0));
        assert_eq!(std::fs::read(to.join(files[0].0)).unwrap(), files[0].1);
        assert_eq!(std::fs::read(to.join(files[2].0)).unwrap(), files[2].1);
        assert!(!from.join(files[0].0).exists() && !from.join(files[2].0).exists(), "moved, not copied");
        assert_eq!(std::fs::read(from.join(files[1].0)).unwrap(), files[1].1, "the one in the way stays at the old place");
        assert_eq!(std::fs::read(to.join(files[1].0)).unwrap(), b"already here");
        let parts = walkdir::WalkDir::new(&to).into_iter().flatten().filter(|e| e.file_name().to_string_lossy().ends_with(storage_move::PART_SUFFIX)).count();
        assert_eq!(parts, 0, "no part file left");
        println!("OK");
    }

    /// The whole backend flow on two real drives, run by hand on a machine with two drives:
    /// a ComfyUI-shaped folder on the system drive, the Storage folder on
    /// another drive. Plan, move, choose, then what ComfyUI and the downloads
    /// read from it; at the end everything moves back, so the other drive
    /// keeps only empty folders.
    /// `LU_STORAGE_REAL_COMFY=C:\\lu-work\\w1\\comfy LU_STORAGE_REAL_ROOT=D:\\w1\\LU
    /// cargo test real_storage_flow_on_two_drives -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_storage_flow_on_two_drives() {
        let (Ok(comfy), Ok(root)) = (std::env::var("LU_STORAGE_REAL_COMFY"), std::env::var("LU_STORAGE_REAL_ROOT")) else {
            panic!("set LU_STORAGE_REAL_COMFY and LU_STORAGE_REAL_ROOT");
        };
        let (comfy, root) = (PathBuf::from(comfy), PathBuf::from(root));
        assert!(!comfy.exists() && !root.exists(), "both folders must be new");
        let engine = comfy.parent().unwrap().join("engine-models");
        let mb = |n: usize, seed: u8| -> Vec<u8> { (0..n * 1024 * 1024).map(|i| (i as u8) ^ seed).collect() };
        put(&comfy.join("main.py"), b"# not a ComfyUI");
        put(&comfy.join("models").join("checkpoints").join("model.safetensors"), &mb(64, 1));
        put(&comfy.join("models").join("loras").join("style.safetensors"), &mb(8, 2));
        put(&comfy.join("models").join("custom_thing").join("keep.bin"), b"not a ComfyUI key, stays");
        put(&comfy.join("output").join("LU_00001_.png"), &mb(2, 3));
        put(&comfy.join("output").join("video").join("LU_00002_.mp4"), &mb(3, 4));
        put(&engine.join("qwen.gguf"), &mb(16, 5));

        let items = items_for(&root, &engine, None, Some(&comfy), Some(&comfy.join("output")), &[]).unwrap();
        let ids: Vec<&str> = items.iter().map(|i| i.id.as_str()).collect();
        println!("plan {ids:?}");
        assert_eq!(ids, vec!["luEngine", "comfy:checkpoints", "comfy:loras", "gallery"]);
        let cross: u64 = items.iter().map(|i| i.plan.cross_bytes).sum();
        println!("cross {cross} bytes, root drive {:?}, comfy drive {:?}", drive_of(&root), drive_of(&comfy));
        if std::env::var("LU_STORAGE_EXPECT_CROSS").as_deref() == Ok("1") {
            assert!(items.iter().all(|i| !i.plan.same_volume), "two drives");
            assert_eq!(cross, (64 + 8 + 2 + 3 + 16) * 1024 * 1024);
        }

        let started = std::time::Instant::now();
        for item in &items {
            let r = storage_move::move_tree(Path::new(&item.from), Path::new(&item.to), &AtomicBool::new(false), &mut |_, _| {});
            println!("{} -> {}: {r:?}", item.from, item.to);
            assert_eq!((r.failed_count, r.kept, r.cancelled), (0, 0, false), "{}", item.id);
        }
        println!("moved in {:.1} s", started.elapsed().as_secs_f64());
        assert_eq!(std::fs::read(root.join("Models").join("checkpoints").join("model.safetensors")).unwrap(), mb(64, 1));
        assert_eq!(std::fs::read(root.join("Models").join("qwen.gguf")).unwrap(), mb(16, 5));
        assert_eq!(std::fs::read(root.join("Gallery").join("video").join("LU_00002_.mp4")).unwrap(), mb(3, 4));
        assert!(!comfy.join("models").join("loras").join("style.safetensors").exists());
        assert!(comfy.join("models").join("custom_thing").join("keep.bin").is_file(), "only ComfyUI's model keys move");

        // What the choice makes of it, against a config of its own.
        let config = root.parent().unwrap().join("w1-config.json");
        let models = root.join("Models");
        create_comfy_folders(&models).unwrap();
        write_keys(&config, &[
            (custom_models::REMEMBERED_ROOT_KEY, serde_json::json!(models.to_string_lossy())),
            (COMFY_DOWNLOADS_KEY, serde_json::json!(true)),
            (GALLERY_KEY, serde_json::json!(root.join("Gallery").to_string_lossy())),
        ]).unwrap();
        let mut user = crate::commands::comfy_user_paths::UserComfyPaths::default();
        user.take_lu_storage(&lu_choice_in(&config), &config);
        assert!(storage_move::is_within(&user.write_dir("loras").unwrap(), &models));
        assert!(storage_move::is_within(&user.write_dir("diffusion_models").unwrap(), &models));
        assert_eq!(user.output_dir_or(&comfy), root.join("Gallery"));
        let args = user.launch_args();
        println!("ComfyUI args {args:?}");
        assert!(args.windows(2).any(|w| w[0] == "--output-directory" && Path::new(&w[1]) == root.join("Gallery")));
        let yaml_file = root.parent().unwrap().join("w1-extra.yaml");
        let res = custom_models::sync_custom_model_paths_to(&yaml_file, Some(&models.to_string_lossy())).unwrap();
        let yaml = std::fs::read_to_string(&yaml_file).unwrap();
        println!("yaml folders {}", res["folders"]);
        assert!(yaml.contains("checkpoints:") && yaml.contains("loras:") && yaml.contains("vae:"), "{yaml}");

        // And back, so the other drive keeps nothing but empty folders. The
        // ComfyUI folders first: the LU Engine part is the whole Models folder.
        for item in items.iter().rev() {
            let r = storage_move::move_tree(Path::new(&item.to), Path::new(&item.from), &AtomicBool::new(false), &mut |_, _| {});
            assert_eq!(r.failed_count, 0, "back: {}", item.id);
        }
        let left = walkdir::WalkDir::new(&root).into_iter().flatten().filter(|e| e.file_type().is_file()).count();
        assert_eq!(left, 0, "no file left on the other drive");
        assert_eq!(std::fs::read(comfy.join("models").join("checkpoints").join("model.safetensors")).unwrap(), mb(64, 1));
        println!("OK");
    }

    #[test]
    fn check_root_wants_a_full_path_and_a_folder_it_can_write() {
        assert!(check_root("").is_err());
        assert!(check_root("~/LU").unwrap_err().contains("~"));
        assert!(check_root("LU").unwrap_err().contains("full path"));
        let tmp = tempfile::tempdir().unwrap();
        let ok = check_root(&tmp.path().join("new").join("LU").to_string_lossy()).unwrap();
        assert!(ok.is_dir());
        assert_eq!(std::fs::read_dir(&ok).unwrap().count(), 0, "the probe is gone again");
    }
}
