//! Where a model lives, asked of the engine that has to find it.
//!
//! A user (Discord help-chat, 2026-09-02, Windows 11, LU 2.6.7): FramePack
//! F1 and Wan 2.1 installed through our own Get button and never appeared in
//! the Create picker. Moving the files into a different ComfyUI folder by hand
//! fixed it.
//!
//! Both halves of that sentence are the bug. LU decided where the file goes on
//! its own: `<the folder we resolved>/models/<subfolder>`, built from a path we
//! found by looking for `main.py`. The picker asks something else entirely,
//! the RUNNING ComfyUI, through its `/object_info` enums. Two answers to one
//! question, and they only agree while the ComfyUI we found is the ComfyUI that
//! is running AND that ComfyUI keeps its models where we guessed.
//!
//! It does not, more often than we assumed:
//!   * The Comfy-Org desktop app keeps `main.py` in its program folder and the
//!     models under a base directory the user picked at install time, and it
//!     starts the server with `--base-directory`.
//!   * `--base-directory` does the same for anybody starting ComfyUI by hand.
//!   * An `extra_model_paths.yaml` adds roots that are nowhere near `main.py`.
//!     LU writes one itself for the Storage folder (see custom_models.rs).
//!   * A second install on the box is the classic one (2026-07-27).
//!
//! In every one of those the download lands in a tree nothing scans, the picker
//! stays empty, and moving the file into the other ComfyUI folder fixes it.
//!
//! ComfyUI answers the question itself, exactly and per folder key:
//!
//!   GET /internal/folder_paths
//!   {"checkpoints": ["C:\\...\\models\\checkpoints"],
//!    "diffusion_models": ["C:\\...\\models\\unet", "C:\\...\\models\\diffusion_models"],
//!    ...}
//!
//! (`folder_names_and_paths[key][0]`, the directory list, in
//! api_server/routes/internal/internal_routes.py.) That is the single
//! definition of where a model lives, and it is the one the picker will use,
//! because it comes from the process that builds the picker's enums.
//!
//! Everything here is best effort. A ComfyUI that is not running answers
//! nothing, and a download must still work then: the caller falls back to the
//! old rule, which is right whenever there is nothing better to know.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long an answer is trusted before it is asked again. Long enough that a
/// bundle of five files asks once, short enough that restarting ComfyUI
/// somewhere else is noticed within a click or two.
const CACHE_TTL: Duration = Duration::from_secs(30);

/// The engine is either there or it is not; a folder list is not worth a long
/// wait in front of a download.
///
/// Review Runde 2, R1-4: `delete_comfy_model` and `check_download_space`
/// became `async` and now `.await` this on the FIRST click of a session,
/// before the 30 s cache above has anything in it. At the old 3 s this made
/// the delete button feel broken on a cold ComfyUI (not running, or slow to
/// answer) with no progress indicator in front of it. A LOCAL loopback
/// request that is going to succeed at all answers in milliseconds; 3 full
/// seconds was really a "ComfyUI is not running" ceiling wearing a network-
/// timeout's clothes. 1 s keeps comfortably more headroom than any healthy
/// local server needs while cutting the worst-case stall to a third.
const FETCH_TIMEOUT: Duration = Duration::from_secs(1);

/// Is this an absolute path anywhere, not only on the platform this build runs
/// on? The answer comes from ComfyUI, so a Windows answer has to read as
/// absolute in a test on any machine; `is_absolute` alone calls `D:\\models`
/// relative everywhere but Windows. Whether the path is USABLE is a separate
/// question, and `folders_of` answers it by refusing to ask a remote engine at
/// all: those paths are on the other machine.
fn looks_absolute(raw: &str) -> bool {
    let b = raw.as_bytes();
    // A POSIX root. This is the half `is_absolute` got wrong in the other
    // direction: on Windows it calls `/srv/ai/vae` relative, and ComfyUI hands
    // us exactly that whenever the engine runs on Linux, in WSL or in a
    // container while LU runs on Windows. Also covers the `//server/share`
    // spelling of a share.
    if b.first() == Some(&b'/') {
        return true;
    }
    // A UNC share, or a drive letter followed by a separator.
    raw.starts_with("\\\\")
        || (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/'))
}

/// The last segment of a path, splitting on BOTH separators rather than on the
/// one this build calls a separator. Same reason as `looks_absolute`: the path
/// comes from ComfyUI and a Windows answer has to be readable in a test on any
/// machine (`Path::file_name` hands back the whole of `D:\\a\\b` off Windows).
fn last_segment(p: &std::path::Path) -> String {
    p.to_string_lossy()
        .trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .to_string()
}

/// The directories the running ComfyUI scans, per `folder_paths` key.
#[derive(Clone, Debug, Default)]
pub struct ComfyFolders {
    dirs: HashMap<String, Vec<PathBuf>>,
}

impl ComfyFolders {
    /// Read one `/internal/folder_paths` answer.
    ///
    /// Tolerant of the shapes that answer can have: a list of directories per
    /// key is the documented one, a bare string is accepted because it costs a
    /// line, and anything else is skipped rather than guessed at. Relative
    /// entries are dropped: this is used to build an absolute write target, and
    /// a path relative to ComfyUI's working directory is not one we can join.
    pub fn parse(value: &serde_json::Value) -> Self {
        fn keep(raw: &str) -> Option<PathBuf> {
            if looks_absolute(raw) { Some(PathBuf::from(raw)) } else { None }
        }
        let mut dirs: HashMap<String, Vec<PathBuf>> = HashMap::new();
        let Some(map) = value.as_object() else {
            return Self::default();
        };
        for (key, entry) in map {
            let mut paths: Vec<PathBuf> = Vec::new();
            match entry {
                serde_json::Value::Array(list) => {
                    for item in list {
                        if let Some(p) = item.as_str().and_then(keep) {
                            paths.push(p);
                        }
                    }
                }
                serde_json::Value::String(s) => {
                    if let Some(p) = keep(s) {
                        paths.push(p);
                    }
                }
                _ => {}
            }
            if !paths.is_empty() {
                dirs.insert(key.to_ascii_lowercase(), paths);
            }
        }
        Self { dirs }
    }

    pub fn is_empty(&self) -> bool {
        self.dirs.is_empty()
    }

    /// Every directory the engine scans, for the delete and the size probe:
    /// those have to look where the download wrote, or the file is on disk and
    /// the app can neither measure nor remove it.
    pub fn all_dirs(&self) -> Vec<PathBuf> {
        let mut out: Vec<PathBuf> = Vec::new();
        for list in self.dirs.values() {
            for p in list {
                if !out.contains(p) {
                    out.push(p.clone());
                }
            }
        }
        out
    }

    /// Where a file of this catalog subfolder belongs, according to the engine.
    ///
    /// `None` when the engine does not know the key at all, which is the honest
    /// answer for a pack folder under `custom_nodes` (ComfyUI has no
    /// `folder_paths` key for those) and for a ComfyUI too old to serve the
    /// route. The caller then keeps the old rule.
    ///
    /// Which one, when the key has several: the directory whose own name is the
    /// subfolder we were asked about, and the first one otherwise. ComfyUI lists
    /// `diffusion_models` as `[models\unet, models\diffusion_models]`, and a
    /// file the catalog calls a `diffusion_models` file belongs in the folder of
    /// that name. Both are scanned, so this is about keeping the tree the way
    /// the user (and our own delete) expects it, not about visibility.
    /// Every directory the engine scans for one key (`diffusion_models` is
    /// `[models/unet, models/diffusion_models]` plus extra_model_paths).
    pub fn dirs_for(&self, key: &str) -> Vec<PathBuf> {
        self.dirs.get(&key.trim().to_ascii_lowercase()).cloned().unwrap_or_default()
    }

    pub fn dir_for(&self, subfolder: &str) -> Option<PathBuf> {
        let key = subfolder.trim().to_ascii_lowercase();
        if key.is_empty() || key.contains('/') || key.contains('\\') {
            return None;
        }
        let paths = self.dirs.get(&key)?;
        let named = paths.iter().find(|p| last_segment(p).eq_ignore_ascii_case(&key));
        named.or_else(|| paths.first()).cloned()
    }
}

static CACHE: Mutex<Option<(Instant, ComfyFolders)>> = Mutex::new(None);

/// The last answer, without asking again. For the paths that cannot await (the
/// delete command): a stale answer is still the engine's answer, and the
/// alternative is the guess this module exists to replace.
pub fn cached() -> Option<ComfyFolders> {
    CACHE
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|(_, f)| f.clone()))
}

fn fresh_enough() -> Option<ComfyFolders> {
    let guard = CACHE.lock().ok()?;
    let (at, folders) = guard.as_ref()?;
    if at.elapsed() < CACHE_TTL {
        Some(folders.clone())
    } else {
        None
    }
}

fn remember(folders: ComfyFolders) {
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some((Instant::now(), folders));
    }
}

/// Drop the cache, so the next question reaches the engine. Called when the
/// ComfyUI path or port changes under us.
pub fn forget() {
    if let Ok(mut guard) = CACHE.lock() {
        *guard = None;
    }
}

/// Is the engine on this machine? Only then are its folder names ours to use.
fn is_loopback(host: &str) -> bool {
    let h = host.trim().trim_matches(|c| c == '[' || c == ']').to_ascii_lowercase();
    h == "localhost"
        || h == "127.0.0.1"
        || h == "::1"
        || h.parse::<std::net::IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false)
}

/// Ask the running ComfyUI where its model folders are.
///
/// Answers `None` when there is no engine to ask, which is not an error: the
/// Model Manager downloads models with ComfyUI shut down all the time.
pub async fn folders_of(host: &str, port: u16) -> Option<ComfyFolders> {
    if let Some(hit) = fresh_enough() {
        return Some(hit);
    }
    let host = if host.trim().is_empty() { "127.0.0.1" } else { host.trim() };
    // A ComfyUI on another machine answers with folders on THAT machine, and
    // the download writes on this one. Nothing to learn here, so the caller
    // keeps its own rule (which is what a remote setup has always had).
    if !is_loopback(host) {
        return None;
    }
    let url = format!("http://{}:{}/internal/folder_paths", host, port);
    let client = reqwest::Client::builder().timeout(FETCH_TIMEOUT).build().ok()?;
    let body = client.get(&url).send().await.ok()?;
    if !body.status().is_success() {
        return None;
    }
    let json: serde_json::Value = body.json().await.ok()?;
    let folders = ComfyFolders::parse(&json);
    if folders.is_empty() {
        return None;
    }
    remember(folders.clone());
    Some(folders)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A real answer from a ComfyUI started with `--base-directory`, shortened.
    /// `main.py` sits in the program folder, the models do not.
    fn desktop_app_answer() -> serde_json::Value {
        json!({
            "checkpoints": ["D:\\Models\\ComfyUI\\models\\checkpoints"],
            "diffusion_models": [
                "D:\\Models\\ComfyUI\\models\\unet",
                "D:\\Models\\ComfyUI\\models\\diffusion_models"
            ],
            "vae": ["D:\\Models\\ComfyUI\\models\\vae"],
            "text_encoders": [
                "D:\\Models\\ComfyUI\\models\\text_encoders",
                "D:\\Models\\ComfyUI\\models\\clip"
            ],
            "clip_vision": ["D:\\Models\\ComfyUI\\models\\clip_vision"],
            "audio_encoders": ["D:\\Models\\ComfyUI\\models\\audio_encoders"],
            "loras": ["D:\\Models\\ComfyUI\\models\\loras"]
        })
    }

    /// The two files of the report, and the folder each one belongs in.
    #[test]
    fn the_engine_names_the_folder_for_the_two_models_that_went_missing() {
        let folders = ComfyFolders::parse(&desktop_app_answer());
        // Wan 2.1 1.3B and FramePack F1 both ship their main file as a
        // diffusion_models file.
        assert_eq!(
            folders.dir_for("diffusion_models"),
            Some(PathBuf::from("D:\\Models\\ComfyUI\\models\\diffusion_models")),
        );
        // FramePack's SigCLIP encoder, the one folder no reader used to know.
        assert_eq!(
            folders.dir_for("clip_vision"),
            Some(PathBuf::from("D:\\Models\\ComfyUI\\models\\clip_vision")),
        );
    }

    /// ComfyUI lists `models\unet` first for that key. A file the catalog calls
    /// a diffusion_models file goes into the folder of that name.
    #[test]
    fn the_folder_of_that_name_wins_over_the_first_in_the_list() {
        let folders = ComfyFolders::parse(&desktop_app_answer());
        assert_eq!(
            folders.dir_for("text_encoders"),
            Some(PathBuf::from("D:\\Models\\ComfyUI\\models\\text_encoders")),
        );
    }

    /// ...and when no entry carries that name, the first one is the answer,
    /// because the engine scans it and we have nothing better.
    #[test]
    fn the_first_entry_answers_when_none_is_named_after_the_key() {
        let folders = ComfyFolders::parse(&json!({
            "diffusion_models": ["/srv/ai/unet", "/srv/ai/second"]
        }));
        assert_eq!(folders.dir_for("diffusion_models"), Some(PathBuf::from("/srv/ai/unet")));
    }

    #[test]
    fn a_key_the_engine_does_not_have_is_not_invented() {
        let folders = ComfyFolders::parse(&desktop_app_answer());
        assert_eq!(folders.dir_for("upscale_models"), None);
        // A pack folder under custom_nodes is not a folder_paths key at all.
        assert_eq!(folders.dir_for("custom_nodes/ComfyUI-AnimateDiff-Evolved/models"), None);
        assert_eq!(folders.dir_for(""), None);
    }

    /// An answer we cannot use must read as no answer, never as an empty tree:
    /// the caller keeps its own rule on `None` and would write into nowhere on
    /// an empty map.
    #[test]
    fn a_useless_answer_is_no_answer() {
        assert!(ComfyFolders::parse(&json!({})).is_empty());
        assert!(ComfyFolders::parse(&json!([])).is_empty());
        assert!(ComfyFolders::parse(&json!("nope")).is_empty());
        // Relative entries cannot be joined into a write target.
        assert!(ComfyFolders::parse(&json!({"checkpoints": ["models/checkpoints"]})).is_empty());
        // A single string is accepted; it costs one line and some forks do it.
        assert_eq!(
            ComfyFolders::parse(&json!({"vae": "/srv/ai/vae"})).dir_for("vae"),
            Some(PathBuf::from("/srv/ai/vae")),
        );
    }

    #[test]
    fn a_windows_answer_reads_as_absolute_on_any_machine() {
        assert!(looks_absolute("D:\\Models\\ComfyUI\\models\\vae"));
        assert!(looks_absolute("C:/ComfyUI/models/vae"));
        assert!(looks_absolute("\\\\nas\\ai\\models\\vae"));
        assert!(looks_absolute("/srv/ai/models/vae"));
        assert!(!looks_absolute("models/vae"));
        assert!(!looks_absolute(""));
    }

    /// The engine on another machine names folders on that machine. Its answer
    /// is not a write target here, so it is never asked for one.
    #[test]
    fn only_an_engine_on_this_machine_is_asked() {
        assert!(is_loopback("127.0.0.1"));
        assert!(is_loopback("localhost"));
        assert!(is_loopback("::1"));
        assert!(is_loopback("[::1]"));
        assert!(!is_loopback("192.168.1.54"));
        assert!(!is_loopback("comfy.homelab"));
    }

    /// Every folder the engine named, for the delete and the size probe.
    #[test]
    fn all_dirs_lists_every_folder_once() {
        let folders = ComfyFolders::parse(&desktop_app_answer());
        let all = folders.all_dirs();
        assert!(all.contains(&PathBuf::from("D:\\Models\\ComfyUI\\models\\unet")));
        assert!(all.contains(&PathBuf::from("D:\\Models\\ComfyUI\\models\\clip_vision")));
        assert_eq!(all.len(), 9, "{all:?}");
    }
}
