//! Settings, Model Storage, "Voice and Python folder": the commands behind
//! the row. The rules live in `crate::runtime_root`; this is the wiring to
//! the app: its folders, its running processes and the system's trash.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::commands::voice_loop::layout::VoiceDirs;
use crate::runtime_root::{self, Defaults, EntryMove, Kind, MoveOutcome, Roots};
use crate::state::AppState;

/// One move at a time.
static MOVING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryStatus {
    pub kind: Kind,
    /// Where it is, or where a new install would go.
    pub path: String,
    /// Something of this kind is there.
    pub installed: bool,
    /// It is in the chosen folder already (or, with none chosen, in the
    /// default place). An install that is not can be moved.
    pub at_target: bool,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFolderStatus {
    /// The chosen folder, None for the default.
    pub chosen: Option<String>,
    /// The app data folder the default places are in.
    pub default_folder: String,
    pub entries: Vec<EntryStatus>,
    pub moving: bool,
}

fn defaults(app: &AppHandle) -> Defaults {
    Defaults::here(app.path().app_data_dir().ok())
}

fn entry_status(kind: Kind, roots: &Roots, defaults: &Defaults) -> Option<EntryStatus> {
    let target = runtime_root::locations(kind, roots, defaults).into_iter().next()?;
    let (path, installed) = match runtime_root::found(kind, roots, defaults) {
        Some(found) => (found, true),
        None => (target.clone(), false),
    };
    Some(EntryStatus {
        kind,
        path: path.to_string_lossy().to_string(),
        installed,
        at_target: path == target,
        bytes: if installed { runtime_root::tree_size(&path) } else { 0 },
    })
}

pub(crate) fn status_for(roots: &Roots, defaults: &Defaults) -> RuntimeFolderStatus {
    RuntimeFolderStatus {
        chosen: roots.chosen.as_ref().map(|p| p.to_string_lossy().to_string()),
        default_folder: defaults.data_dir.to_string_lossy().to_string(),
        entries: Kind::ALL.iter().filter_map(|k| entry_status(*k, roots, defaults)).collect(),
        moving: MOVING.load(Ordering::SeqCst),
    }
}

async fn blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "The folder task ended unexpectedly. Try again.".to_string())?
}

/// Where the voice engine, the read-aloud voices and LU's own Python are,
/// and how big each is.
#[tauri::command]
pub async fn runtime_folder_status(app: AppHandle) -> Result<RuntimeFolderStatus, String> {
    let defaults = defaults(&app);
    blocking(move || Ok(status_for(&runtime_root::roots(), &defaults))).await
}

/// Choose the folder. An empty path goes back to the app data folder.
/// Nothing moves: new installs go there, existing ones stay found where
/// they are.
#[tauri::command]
pub async fn set_runtime_folder(app: AppHandle, path: String) -> Result<RuntimeFolderStatus, String> {
    let defaults = defaults(&app);
    blocking(move || {
        let config = crate::os_paths::app_config_json();
        let next = if path.trim().is_empty() { None } else { Some(runtime_root::check_candidate(&path, &defaults)?) };
        let roots = runtime_root::write_roots(&config, next.as_deref())?;
        Ok(status_for(&roots, &defaults))
    })
    .await
}

/// What would stop a move right now, in a sentence.
fn busy_reason(state: &AppState) -> Option<&'static str> {
    if state.voice_loop.job.is_running() {
        return Some("The voice setup is running. Let it finish or cancel it, then move.");
    }
    let running = |s: &std::sync::Arc<std::sync::Mutex<crate::state::InstallState>>| {
        s.lock().map(|s| matches!(s.status.as_str(), "installing" | "downloading" | "running" | "cancelling")).unwrap_or(false)
    };
    for (slot, why) in [
        (&state.tts_install, "The read-aloud voice is being installed. Wait until it is done, then move."),
        (&state.whisper_install, "Speech-to-text is being installed. Wait until it is done, then move."),
        (&state.install_status, "ComfyUI is being installed or repaired. Wait until it is done, then move."),
        (&state.python_install, "Python is being installed. Wait until it is done, then move."),
        (&state.trainer_install, "The trainer is being set up. Wait until it is done, then move."),
        (&state.trainer_run, "A training is running. Wait until it is done, then move."),
    ] {
        if running(slot) {
            return Some(why);
        }
    }
    for slot in [&state.install_mlx_diffusion, &state.install_mlx_video] {
        if slot.is_running() {
            return Some("An image or video engine is being installed. Wait until it is done, then move.");
        }
    }
    None
}

/// The venvs LU builds from its own Python, wherever they are. ComfyUI is
/// asked of what the app already knows (its cache, `config.json`, the
/// default folder) and never searched for on the disk: that walk takes long
/// and on a Mac asks for folder access.
fn engine_venvs(app: &AppHandle, state: &AppState) -> Vec<PathBuf> {
    let data = crate::os_paths::data_dir();
    let mut comfy: Vec<PathBuf> = vec![data.join("ComfyUI")];
    if let Some(cached) = state.comfy_path.lock().ok().and_then(|p| p.clone()) {
        comfy.push(PathBuf::from(cached));
    }
    let config = std::fs::read_to_string(crate::os_paths::app_config_json())
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
    if let Some(path) = config.as_ref().and_then(|c| c.get("comfyui_path")).and_then(|v| v.as_str()) {
        comfy.push(PathBuf::from(path));
    }
    let mut out = vec![data.join("mlx").join("venv"), data.join("mlx-video").join("venv")];
    for dir in comfy {
        for name in ["venv", ".venv"] {
            let venv = dir.join(name);
            if !out.contains(&venv) {
                out.push(venv);
            }
        }
    }
    out.push(crate::commands::trainer::trainer_root(app).join("venv"));
    out
}

pub(crate) fn plans(roots: &Roots, defaults: &Defaults, engine_venvs: &[PathBuf]) -> Vec<EntryMove> {
    // Moving is into a chosen folder only. After Reset an install in an
    // earlier folder keeps working there and is not carried back.
    if roots.chosen.is_none() {
        return Vec::new();
    }
    Kind::ALL
        .iter()
        .filter_map(|kind| {
            let to = runtime_root::locations(*kind, roots, defaults).into_iter().next()?;
            let from = runtime_root::found(*kind, roots, defaults)?;
            (from != to).then(|| EntryMove {
                kind: *kind,
                from,
                to,
                venvs_inside: if *kind == Kind::Voice { vec![PathBuf::from("venv")] } else { vec![] },
                venvs_outside: if *kind == Kind::Python { engine_venvs.to_vec() } else { vec![] },
            })
        })
        .collect()
}

fn prove(plan: &EntryMove) -> bool {
    match plan.kind {
        Kind::Python => crate::private_python::starts_from(&plan.to),
        Kind::Voice => {
            let dirs = VoiceDirs { root: plan.to.clone() };
            // A setup that stopped before its venv has nothing to start yet.
            !dirs.venv().exists() || crate::commands::voice_loop::install::venv_works(&dirs)
        }
        Kind::PiperVoices => true,
    }
}

/// Move what is not in the chosen folder yet into it. Copies, checks the
/// copy, starts it once, then puts the old folder in the trash.
#[tauri::command]
pub async fn move_runtime_folder(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<MoveOutcome>, String> {
    if let Some(why) = busy_reason(&state) {
        return Err(why.to_string());
    }
    if MOVING.swap(true, Ordering::SeqCst) {
        return Err("A move is already running.".to_string());
    }
    // Voice and dictation run from these folders; both start again by
    // themselves the next time they are used.
    if let Ok(mut whisper) = state.whisper.lock() {
        if whisper.is_running() {
            whisper.stop();
        }
    }
    let voice = state.voice_loop.clone();
    let defaults = defaults(&app);
    let venvs = engine_venvs(&app, &state);
    let result = blocking(move || {
        voice.sidecar.stop(crate::commands::voice_loop::sidecar::STOP_GRACE);
        let Some(_downloads) = crate::private_python::hold_if_idle() else {
            return Err("LU is downloading its Python right now. Wait until it is done, then move.".to_string());
        };
        let roots = runtime_root::roots();
        let mut out = Vec::new();
        for plan in plans(&roots, &defaults, &venvs) {
            let free = plan.to.ancestors().find(|p| p.exists()).and_then(crate::commands::download::available_space_for);
            out.push(runtime_root::move_entry(&plan, free, &prove, &crate::commands::mlx_outputs::system_trash));
        }
        Ok(out)
    })
    .await;
    MOVING.store(false, Ordering::SeqCst);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_status_names_each_place_and_what_can_be_moved() {
        let tmp = tempfile::tempdir().unwrap();
        let defaults = Defaults { data_dir: tmp.path().join("data"), app_data_dir: Some(tmp.path().join("app")) };
        let chosen = tmp.path().join("D drive").join("LU Runtime");
        let roots = Roots { chosen: Some(chosen.clone()), history: vec![] };
        std::fs::create_dir_all(defaults.data_dir.join("voice")).unwrap();
        std::fs::write(defaults.data_dir.join("voice").join("install.json"), "{}").unwrap();

        let status = status_for(&roots, &defaults);
        assert_eq!(status.chosen.as_deref(), Some(chosen.to_string_lossy().as_ref()));
        let voice = status.entries.iter().find(|e| e.kind == Kind::Voice).unwrap();
        assert!(voice.installed && !voice.at_target);
        assert_eq!(voice.bytes, 2);
        let python = status.entries.iter().find(|e| e.kind == Kind::Python).unwrap();
        assert!(!python.installed && python.at_target);
        assert_eq!(python.path, chosen.join("python").to_string_lossy());

        let engine = vec![tmp.path().join("ComfyUI").join("venv")];
        let plans = plans(&roots, &defaults, &engine);
        assert_eq!(plans.len(), 1, "only what is installed and elsewhere");
        assert_eq!(plans[0].kind, Kind::Voice);
        assert_eq!(plans[0].to, chosen.join("voice"));
        assert_eq!(plans[0].venvs_inside, vec![PathBuf::from("venv")]);
        assert!(plans[0].venvs_outside.is_empty());

        // Without a chosen folder nothing has anywhere to go.
        assert!(super::plans(&Roots::default(), &defaults, &engine).is_empty());
    }

    #[test]
    fn after_reset_new_installs_go_to_the_default_and_the_earlier_install_stays_put() {
        let tmp = tempfile::tempdir().unwrap();
        let defaults = Defaults { data_dir: tmp.path().join("data"), app_data_dir: Some(tmp.path().join("app")) };
        let earlier = tmp.path().join("Runtime Folder");
        std::fs::create_dir_all(earlier.join("voice")).unwrap();
        std::fs::write(earlier.join("voice").join("install.json"), "{}").unwrap();
        // Reset: nothing chosen, the folder of before in the history.
        let roots = Roots { chosen: None, history: vec![earlier.clone()] };

        let status = status_for(&roots, &defaults);
        let voice = status.entries.iter().find(|e| e.kind == Kind::Voice).unwrap();
        assert_eq!(voice.path, earlier.join("voice").to_string_lossy(), "still found where it is");
        assert!(voice.installed && !voice.at_target, "and named as a folder chosen earlier");
        let python = status.entries.iter().find(|e| e.kind == Kind::Python).unwrap();
        assert_eq!(python.path, defaults.data_dir.join("python").to_string_lossy(), "a new install goes to the default");
        let piper = status.entries.iter().find(|e| e.kind == Kind::PiperVoices).unwrap();
        assert_eq!(piper.path, tmp.path().join("app").join("piper_voices").to_string_lossy());

        assert!(plans(&roots, &defaults, &[]).is_empty(), "nothing is carried back by itself");
    }

    #[test]
    fn the_python_takes_the_engine_venvs_along() {
        let tmp = tempfile::tempdir().unwrap();
        let defaults = Defaults { data_dir: tmp.path().join("data"), app_data_dir: None };
        let python = defaults.data_dir.join("python");
        std::fs::create_dir_all(&python).unwrap();
        std::fs::write(python.join(crate::private_python::COMPLETE_MARKER), "sha").unwrap();
        let roots = Roots { chosen: Some(tmp.path().join("E")), history: vec![] };
        let engine = vec![tmp.path().join("ComfyUI").join("venv")];
        let plans = plans(&roots, &defaults, &engine);
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].kind, Kind::Python);
        assert_eq!(plans[0].venvs_outside, engine);
        assert!(plans[0].venvs_inside.is_empty());
    }
}
