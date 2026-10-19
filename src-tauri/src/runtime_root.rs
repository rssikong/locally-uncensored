//! Where the voice engine, the read-aloud voices and LU's own Python live.
//!
//! Discord wish D2: "choose where the models go, LU on another drive". The
//! model folder, the ComfyUI folder and the trainer folder could already be
//! chosen. These three could not: they sat in the app data folder
//! (`%LOCALAPPDATA%\lu-labs` on Windows), which is on the system drive, and
//! the voice engine alone is a few gigabytes.
//!
//! One folder for all three, stored in `config.json` under [`CONFIG_KEY`],
//! next to the ComfyUI and trainer paths. It is its own setting and not the
//! model folder: the model folder is walked four levels deep for GGUF files
//! and its ComfyUI shaped subfolders are handed to ComfyUI, so a venv with
//! tens of thousands of files in it would eat the scan budget, and a model
//! folder on a network share or an exFAT stick holds models fine but cannot
//! run a Python.
//!
//! Three rules:
//!
//! * Nothing installed is lost by choosing a folder. Every lookup walks the
//!   chosen folder, the folders chosen before it ([`HISTORY_KEY`]) and the old
//!   default, and takes the first one that holds an install. Only a NEW
//!   install goes to the chosen folder.
//! * Nothing moves by itself. [`move_entry`] runs on a click, copies, checks
//!   the copy, points the venvs at the new place, starts the moved Python
//!   once, and only then hands the old folder to the system's trash.
//! * Nothing is deleted for good. What has to go (the old folder, or a copy
//!   that failed its check) goes to the trash. If the trash refuses, the
//!   folder stays and the report names it.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::os_error;

/// The chosen folder in `config.json`. Empty or missing means the default.
pub const CONFIG_KEY: &str = "runtime_root";

/// Folders chosen before the current one, newest first. Their installs are
/// still found until they are moved.
pub const HISTORY_KEY: &str = "runtime_root_history";

/// How many earlier folders are remembered.
const HISTORY_LEN: usize = 8;

/// What lives below the folder.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    /// The voice engine: its Python, venv and models (`voice_loop`).
    Voice,
    /// LU's own Python for the engines, ComfyUI and the trainer
    /// (`private_python`).
    Python,
    /// The Piper voices of read-aloud (`commands::tts`).
    PiperVoices,
}

impl Kind {
    pub const ALL: [Kind; 3] = [Kind::Voice, Kind::Python, Kind::PiperVoices];

    /// The folder name below a root. The same names the defaults have, so a
    /// move is a copy of one folder each.
    pub fn sub(self) -> &'static str {
        match self {
            Kind::Voice => "voice",
            Kind::Python => "python",
            Kind::PiperVoices => "piper_voices",
        }
    }

    /// Whether `dir` holds an install of this kind, or the remains of one
    /// that is worth keeping. Only the files LU itself writes count.
    pub fn holds(self, dir: &Path) -> bool {
        match self {
            Kind::Voice => {
                dir.join("install.json").is_file()
                    || dir.join("venv").join("pyvenv.cfg").is_file()
                    || dir.join("python").is_dir()
                    || dir.join("models").is_dir()
            }
            Kind::Python => dir.join(crate::private_python::COMPLETE_MARKER).is_file(),
            Kind::PiperVoices => std::fs::read_dir(dir)
                .map(|entries| {
                    entries
                        .flatten()
                        .any(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("onnx")))
                })
                .unwrap_or(false),
        }
    }
}

/// What `config.json` says.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Roots {
    pub chosen: Option<PathBuf>,
    pub history: Vec<PathBuf>,
}

/// The places each kind had before a folder could be chosen. The Piper
/// voices sit in Tauri's app data folder, which only an `AppHandle` knows,
/// so that one is optional.
#[derive(Clone, Debug)]
pub struct Defaults {
    pub data_dir: PathBuf,
    pub app_data_dir: Option<PathBuf>,
}

impl Defaults {
    pub fn here(app_data_dir: Option<PathBuf>) -> Self {
        Self { data_dir: crate::os_paths::data_dir(), app_data_dir }
    }

    fn of(&self, kind: Kind) -> Option<PathBuf> {
        match kind {
            Kind::Voice | Kind::Python => Some(self.data_dir.join(kind.sub())),
            Kind::PiperVoices => self.app_data_dir.as_ref().map(|d| d.join(kind.sub())),
        }
    }
}

fn read_json(config: &Path) -> serde_json::Value {
    std::fs::read_to_string(config)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

/// The roots stored in `config`. A missing or broken file is no choice.
pub fn read_roots(config: &Path) -> Roots {
    let json = read_json(config);
    let chosen = json
        .get(CONFIG_KEY)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    let history = json
        .get(HISTORY_KEY)
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(PathBuf::from)
                .collect()
        })
        .unwrap_or_default();
    Roots { chosen, history }
}

/// Store `next` as the chosen folder (None goes back to the default). The
/// folder chosen until now joins the history, so what was installed there
/// is still found. Every other key of the file stays as it was.
pub fn write_roots(config: &Path, next: Option<&Path>) -> Result<Roots, String> {
    let before = read_roots(config);
    let mut history: Vec<PathBuf> = before.chosen.iter().cloned().chain(before.history).collect();
    history.retain(|p| Some(p.as_path()) != next);
    let mut seen: Vec<PathBuf> = Vec::new();
    history.retain(|p| {
        let fresh = !seen.contains(p);
        seen.push(p.clone());
        fresh
    });
    history.truncate(HISTORY_LEN);
    let mut json = read_json(config);
    if !json.is_object() {
        json = serde_json::json!({});
    }
    json[CONFIG_KEY] = serde_json::json!(next.map(|p| p.to_string_lossy().to_string()).unwrap_or_default());
    json[HISTORY_KEY] = serde_json::json!(history.iter().map(|p| p.to_string_lossy().to_string()).collect::<Vec<_>>());
    let write = || -> std::io::Result<()> {
        if let Some(parent) = config.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = config.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(&json).unwrap_or_default())?;
        std::fs::rename(&tmp, config)
    };
    write().map_err(|e| format!("LU could not save the folder in {}: {}.", config.display(), os_error::io_english(&e)))?;
    Ok(Roots { chosen: next.map(Path::to_path_buf), history })
}

/// Every place `kind` may be, in the order it is looked for: the chosen
/// folder (or, with none chosen, the default), the earlier ones, the
/// default. The first is where a new install goes.
pub fn locations(kind: Kind, roots: &Roots, defaults: &Defaults) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    // With no folder chosen (never, or Reset) a new install goes to the
    // default, as the row promises, and not to the folder chosen last. Box
    // run d307-e: after Reset the Python and the voices still pointed into
    // the earlier folder. What is installed there is still found below.
    let target = match &roots.chosen {
        Some(root) => Some(root.join(kind.sub())),
        None => defaults.of(kind),
    };
    let candidates = target
        .into_iter()
        .chain(roots.history.iter().map(|root| root.join(kind.sub())))
        .chain(defaults.of(kind));
    for path in candidates {
        if !out.contains(&path) {
            out.push(path);
        }
    }
    out
}

/// The place that holds an install of `kind`, if any does.
pub fn found(kind: Kind, roots: &Roots, defaults: &Defaults) -> Option<PathBuf> {
    locations(kind, roots, defaults).into_iter().find(|p| kind.holds(p))
}

/// Where `kind` is used from: the install that is there, else the place a
/// new one goes. None only for the Piper voices without an app data folder
/// and without a chosen folder.
pub fn current(kind: Kind, roots: &Roots, defaults: &Defaults) -> Option<PathBuf> {
    found(kind, roots, defaults).or_else(|| locations(kind, roots, defaults).into_iter().next())
}

/// The roots of this app, from its `config.json`.
pub fn roots() -> Roots {
    read_roots(&crate::os_paths::app_config_json())
}

/// [`current`] for this app. The voice engine and the Python have a place
/// without an `AppHandle`; the Piper voices need the app data folder.
pub fn current_here(kind: Kind, app_data_dir: Option<PathBuf>) -> Option<PathBuf> {
    current(kind, &roots(), &Defaults::here(app_data_dir))
}

/// The folders below a chosen root that hold code LU runs. The agent's file
/// tools keep out of them the way they keep out of the app data folder.
pub fn owned_outside_defaults() -> Vec<PathBuf> {
    owned_below(&roots())
}

fn owned_below(roots: &Roots) -> Vec<PathBuf> {
    roots
        .chosen
        .iter()
        .chain(roots.history.iter())
        .flat_map(|root| Kind::ALL.map(|k| root.join(k.sub())))
        .collect()
}

// ── choosing a folder ───────────────────────────────────────────────────────

fn example_path() -> &'static str {
    if cfg!(target_os = "windows") {
        "D:\\LU Runtime"
    } else if cfg!(target_os = "macos") {
        "/Volumes/Data/LU Runtime"
    } else {
        "/mnt/data/LU Runtime"
    }
}

/// Everything a typed or picked folder has to clear before it is stored.
/// The folder is created when it is not there, and LU writes a file in it
/// (and on macOS and Linux a link, which a Python needs and exFAT and FAT32
/// cannot hold) to find out whether a Python could live there at all.
pub fn check_candidate(raw: &str, defaults: &Defaults) -> Result<PathBuf, String> {
    let text = raw.trim();
    if text.starts_with('~') {
        return Err(format!(
            "\"{text}\" starts with ~, and this field uses the path exactly as typed. Use a full path, for example {}.",
            example_path()
        ));
    }
    let path = PathBuf::from(text);
    if !path.is_absolute() {
        return Err(format!(
            "\"{text}\" is not a full path. Use one that starts at the drive, for example {}.",
            example_path()
        ));
    }
    // A folder inside one of the places themselves would copy a folder into
    // itself on the next move.
    for kind in Kind::ALL {
        if let Some(default) = defaults.of(kind) {
            if path.starts_with(&default) {
                return Err(format!(
                    "{} is inside the folder LU keeps its {} in. Choose a folder outside of it.",
                    path.display(),
                    describe(kind)
                ));
            }
        }
    }
    std::fs::create_dir_all(&path).map_err(|e| {
        format!(
            "LU cannot create {}: {}. Check that the drive is connected and that your account may write there.",
            path.display(),
            os_error::io_english(&e)
        )
    })?;
    probe_writable(&path)?;
    Ok(path)
}

fn probe_writable(dir: &Path) -> Result<(), String> {
    let probe = dir.join(format!(".lu-write-probe-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&probe);
    let outcome = (|| -> std::io::Result<()> {
        std::fs::create_dir(&probe)?;
        std::fs::write(probe.join("file"), b"probe")?;
        #[cfg(unix)]
        std::os::unix::fs::symlink("file", probe.join("link"))?;
        Ok(())
    })();
    // Only the probe LU just made goes, and nothing else.
    let _ = std::fs::remove_dir_all(&probe);
    outcome.map_err(|e| {
        if cfg!(unix) {
            format!(
                "LU cannot keep a Python in {}: {}. The folder has to be writable for your account, and the drive has to hold links (exFAT and FAT32 cannot).",
                dir.display(),
                os_error::io_english(&e)
            )
        } else {
            format!("LU cannot write to {}: {}. Choose a folder your account may write to.", dir.display(), os_error::io_english(&e))
        }
    })
}

/// The name of each kind in a sentence.
pub fn describe(kind: Kind) -> &'static str {
    match kind {
        Kind::Voice => "voice engine",
        Kind::Python => "own Python",
        Kind::PiperVoices => "read-aloud voices",
    }
}

// ── moving ──────────────────────────────────────────────────────────────────

/// One folder to move, and the venvs that point into it.
#[derive(Clone, Debug)]
pub struct EntryMove {
    pub kind: Kind,
    pub from: PathBuf,
    pub to: PathBuf,
    /// Venvs inside the moved folder, relative to it (the voice engine's).
    pub venvs_inside: Vec<PathBuf>,
    /// Venvs elsewhere that may have been built from the moved Python
    /// (the engines', ComfyUI's, the trainer's). Only the ones whose
    /// `pyvenv.cfg` points into `from` are changed.
    pub venvs_outside: Vec<PathBuf>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MoveStatus {
    /// Copied, checked, in use at the new place, the old one is in the trash.
    Moved,
    /// In use at the new place, but the old folder is still there.
    MovedOldKept,
    /// Not moved; the old folder is in use as before.
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveOutcome {
    pub kind: Kind,
    pub from: String,
    pub to: String,
    pub status: MoveStatus,
    /// What the customer should know, in one sentence or two. Empty when
    /// everything went as planned.
    pub detail: String,
}

/// The staging name next to the target. Never a name LU reads as an install.
fn staging_of(to: &Path) -> PathBuf {
    let mut name = to.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".lu-moving");
    to.with_file_name(name)
}

/// Bytes in a tree, links counted as nothing.
pub fn tree_size(path: &Path) -> u64 {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => std::fs::read_dir(path)
            .map(|entries| entries.flatten().map(|e| tree_size(&e.path())).sum())
            .unwrap_or(0),
        Ok(meta) if meta.is_file() => meta.len(),
        _ => 0,
    }
}

fn copy_link(from: &Path, to: &Path) -> std::io::Result<()> {
    let target = std::fs::read_link(from)?;
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&target, to)
    }
    #[cfg(windows)]
    {
        if std::fs::metadata(from).map(|m| m.is_dir()).unwrap_or(false) {
            std::os::windows::fs::symlink_dir(&target, to)
        } else {
            std::os::windows::fs::symlink_file(&target, to)
        }
    }
}

/// Copy a tree. Links stay links, files keep their permissions.
pub fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(from)?;
    if meta.file_type().is_symlink() {
        return copy_link(from, to);
    }
    if meta.is_dir() {
        std::fs::create_dir(to)?;
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            copy_tree(&entry.path(), &to.join(entry.file_name()))?;
        }
        // After the children: a read-only folder still takes them first.
        return std::fs::set_permissions(to, meta.permissions());
    }
    std::fs::copy(from, to).map(|_| ())
}

/// The copy holds the same names, the same kinds, the same file sizes and
/// the same link targets as the original. Returns the first difference.
pub fn verify_copy(from: &Path, to: &Path) -> Result<(), String> {
    let differs = |what: &str, path: &Path| Err(format!("{what}: {}", path.display()));
    let a = std::fs::symlink_metadata(from).map_err(|e| format!("{}: {}", from.display(), os_error::io_english(&e)))?;
    let b = match std::fs::symlink_metadata(to) {
        Ok(b) => b,
        Err(_) => return differs("missing in the copy", to),
    };
    if a.file_type().is_symlink() {
        if !b.file_type().is_symlink() || std::fs::read_link(from).ok() != std::fs::read_link(to).ok() {
            return differs("a link differs in the copy", to);
        }
        return Ok(());
    }
    if a.is_dir() {
        if !b.is_dir() {
            return differs("not a folder in the copy", to);
        }
        let names = |dir: &Path| -> Result<Vec<std::ffi::OsString>, String> {
            let mut v: Vec<_> = std::fs::read_dir(dir)
                .map_err(|e| format!("{}: {}", dir.display(), os_error::io_english(&e)))?
                .flatten()
                .map(|e| e.file_name())
                .collect();
            v.sort();
            Ok(v)
        };
        let (left, right) = (names(from)?, names(to)?);
        if left != right {
            return differs("the copy holds other files than", from);
        }
        for name in left {
            verify_copy(&from.join(&name), &to.join(&name))?;
        }
        return Ok(());
    }
    if !b.is_file() || a.len() != b.len() {
        return differs("a file differs in size in the copy", to);
    }
    Ok(())
}

/// `value` with the leading `old` replaced by `new`, when it starts with it
/// as a whole path. On Windows the comparison ignores case and the slash
/// direction, the way the file system does.
fn replace_prefix(value: &str, old: &str, new: &str) -> Option<String> {
    let windows = cfg!(windows);
    // ASCII only, so the byte offsets of `value` still hold after it.
    let norm = |s: &str| if windows { s.replace('/', "\\").to_ascii_lowercase() } else { s.to_string() };
    let (v, o) = (norm(value), norm(old.trim_end_matches(['/', '\\'])));
    if !v.starts_with(&o) {
        return None;
    }
    let rest = &value[o.len()..];
    if !(rest.is_empty() || rest.starts_with('/') || rest.starts_with('\\')) {
        return None;
    }
    Some(format!("{}{}", new.trim_end_matches(['/', '\\']), rest))
}

/// Point a venv that was built from a Python below `old` at the same Python
/// below `new`. `pyvenv.cfg` names the base by its full path, and on macOS
/// and Linux `bin/python` is a link to it. Returns whether the venv pointed
/// into `old` at all; a venv that did not is left untouched.
pub fn repoint_venv(venv: &Path, old: &Path, new: &Path) -> std::io::Result<bool> {
    let cfg = venv.join("pyvenv.cfg");
    let Ok(text) = std::fs::read_to_string(&cfg) else { return Ok(false) };
    let (old_s, new_s) = (old.to_string_lossy().to_string(), new.to_string_lossy().to_string());
    let mut touched = false;
    let lines: Vec<String> = text
        .lines()
        .map(|line| match line.split_once('=') {
            Some((key, value)) => match replace_prefix(value.trim(), &old_s, &new_s) {
                Some(next) => {
                    touched = true;
                    format!("{} = {}", key.trim(), next)
                }
                None => line.to_string(),
            },
            None => line.to_string(),
        })
        .collect();
    // `command = /old/python -m venv /old/venv` carries the path mid line.
    let lines: Vec<String> = lines
        .into_iter()
        .map(|line| {
            if line.trim_start().starts_with("command") && line.contains(&old_s) {
                touched = true;
                line.replace(&old_s, &new_s)
            } else {
                line
            }
        })
        .collect();
    if !touched {
        return Ok(false);
    }
    let mut out = lines.join("\n");
    if text.ends_with('\n') {
        out.push('\n');
    }
    std::fs::write(&cfg, out)?;
    #[cfg(unix)]
    for dir in ["bin", "lib64"] {
        let Ok(entries) = std::fs::read_dir(venv.join(dir)) else { continue };
        for entry in entries.flatten() {
            let link = entry.path();
            let Ok(target) = std::fs::read_link(&link) else { continue };
            if let Some(next) = replace_prefix(&target.to_string_lossy(), &old_s, &new_s) {
                std::fs::remove_file(&link)?;
                std::os::unix::fs::symlink(next, &link)?;
            }
        }
    }
    Ok(true)
}

/// Hand a folder to the trash, or say why it stays.
fn discard(path: &Path, trash: &dyn Fn(&Path) -> Result<(), String>) -> Result<(), String> {
    if std::fs::symlink_metadata(path).is_err() {
        return Ok(());
    }
    trash(path)
}

/// The whole move of one folder. `prove` starts what was moved once at its
/// new place (the Python, the voice venv) and says whether it ran; `trash`
/// is the system's trash. Both are handed in so the tests run neither.
pub fn move_entry(
    plan: &EntryMove,
    free_bytes: Option<u64>,
    prove: &dyn Fn(&EntryMove) -> bool,
    trash: &dyn Fn(&Path) -> Result<(), String>,
) -> MoveOutcome {
    let outcome = |status: MoveStatus, detail: String| MoveOutcome {
        kind: plan.kind,
        from: plan.from.to_string_lossy().to_string(),
        to: plan.to.to_string_lossy().to_string(),
        status,
        detail,
    };
    let failed = |detail: String| outcome(MoveStatus::Failed, detail);
    let what = describe(plan.kind);

    if plan.to.starts_with(&plan.from) || plan.from.starts_with(&plan.to) {
        return failed(format!("The new folder for the {what} lies inside the old one. Choose a folder outside of it."));
    }
    if std::fs::symlink_metadata(&plan.to).is_ok() {
        // An empty folder in the way is a leftover of nothing; anything else
        // is not LU's to replace.
        if std::fs::remove_dir(&plan.to).is_err() {
            return failed(format!(
                "{} is already there and not empty. LU did not touch it; rename or remove it, then move again.",
                plan.to.display()
            ));
        }
    }
    let size = tree_size(&plan.from);
    if let Some(free) = free_bytes {
        if free < size.saturating_add(size / 20) {
            return failed(format!(
                "The {what} needs {:.1} GB and the new drive has {:.1} GB free. Nothing was moved.",
                size as f64 / 1e9,
                free as f64 / 1e9
            ));
        }
    }

    let staging = staging_of(&plan.to);
    if std::fs::symlink_metadata(&staging).is_ok() {
        if let Err(e) = discard(&staging, trash) {
            return failed(format!("An earlier move left {} behind and it could not be cleared: {e}", staging.display()));
        }
    }
    if let Some(parent) = plan.to.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return failed(format!("LU cannot create {}: {}.", parent.display(), os_error::io_english(&e)));
        }
    }
    let give_up = |detail: String, leftover: &Path| {
        let tail = match discard(leftover, trash) {
            Ok(()) => String::new(),
            Err(_) => format!(" The unfinished copy is still at {}; you can remove it.", leftover.display()),
        };
        failed(format!("{detail} The {what} stays where it was and keeps working.{tail}"))
    };

    if let Err(e) = copy_tree(&plan.from, &staging) {
        return give_up(format!("Copying the {what} failed: {}.", os_error::io_english(&e)), &staging);
    }
    if let Err(e) = verify_copy(&plan.from, &staging) {
        return give_up(format!("The copy of the {what} did not match the original ({e})."), &staging);
    }
    for rel in &plan.venvs_inside {
        if let Err(e) = repoint_venv(&staging.join(rel), &plan.from, &plan.to) {
            return give_up(format!("The {what} could not be pointed at its new place: {}.", os_error::io_english(&e)), &staging);
        }
    }
    if let Err(e) = crate::commands::voice_loop::install::rename_patiently(&staging, &plan.to) {
        return give_up(format!("The copy could not be given its name: {}.", os_error::io_english(&e)), &staging);
    }
    if !prove(plan) {
        // Back under the staging name first: a copy under the real name
        // would be found and used if the trash then refused it.
        let leftover = if std::fs::rename(&plan.to, &staging).is_ok() { staging.clone() } else { plan.to.clone() };
        return give_up(format!("The {what} did not start from {}.", plan.to.display()), &leftover);
    }

    // The Python is in place and runs. Now the venvs built from it.
    let mut stuck: Vec<String> = Vec::new();
    for venv in &plan.venvs_outside {
        if let Err(e) = repoint_venv(venv, &plan.from, &plan.to) {
            stuck.push(format!("{} ({})", venv.display(), os_error::io_english(&e)));
        }
    }
    if !stuck.is_empty() {
        return outcome(
            MoveStatus::MovedOldKept,
            format!(
                "The {what} runs from the new folder, but these environments still point at the old one, so it stays where it was: {}.",
                stuck.join(", ")
            ),
        );
    }
    match discard(&plan.from, trash) {
        Ok(()) => outcome(MoveStatus::Moved, String::new()),
        Err(e) => outcome(
            MoveStatus::MovedOldKept,
            format!(
                "The {what} runs from the new folder. The old copy at {} could not go to the trash ({e}); close the programs that use it and remove it yourself.",
                plan.from.display()
            ),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn defaults(base: &Path) -> Defaults {
        Defaults { data_dir: base.join("app data"), app_data_dir: Some(base.join("tauri data")) }
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// A voice install the way the setup leaves it, with a venv that points
    /// at its own Python by full path.
    fn voice_install(root: &Path) {
        write(&root.join("install.json"), "{}");
        write(&root.join("python").join("bin").join("python3.12"), "interpreter");
        write(&root.join("models").join("stt").join("a.bin"), "0123456789");
        let home = root.join("python").join("bin");
        write(
            &root.join("venv").join("pyvenv.cfg"),
            &format!(
                "home = {}\ninclude-system-site-packages = false\nversion = 3.12.15\nexecutable = {}\ncommand = {} -m venv {}\n",
                home.display(),
                home.join("python3.12").display(),
                home.join("python3.12").display(),
                root.join("venv").display()
            ),
        );
        #[cfg(unix)]
        {
            std::fs::create_dir_all(root.join("venv").join("bin")).unwrap();
            std::os::unix::fs::symlink(home.join("python3.12"), root.join("venv").join("bin").join("python")).unwrap();
            std::os::unix::fs::symlink("python", root.join("venv").join("bin").join("python3")).unwrap();
        }
    }

    // ── the setting ─────────────────────────────────────────────────────────

    #[test]
    fn no_setting_keeps_every_place_where_it_always_was() {
        let tmp = tempfile::tempdir().unwrap();
        let d = defaults(tmp.path());
        let roots = read_roots(&tmp.path().join("missing.json"));
        assert_eq!(roots, Roots::default());
        assert_eq!(current(Kind::Voice, &roots, &d), Some(d.data_dir.join("voice")));
        assert_eq!(current(Kind::Python, &roots, &d), Some(d.data_dir.join("python")));
        assert_eq!(current(Kind::PiperVoices, &roots, &d), Some(tmp.path().join("tauri data").join("piper_voices")));
    }

    #[test]
    fn a_chosen_folder_takes_new_installs_and_the_old_ones_are_still_found() {
        let tmp = tempfile::tempdir().unwrap();
        let d = defaults(tmp.path());
        let config = tmp.path().join("cfg").join("config.json");
        write(&config, r#"{"comfyui_path":"D:\\ComfyUI","trainer_root":"E:\\Trainer"}"#);
        let chosen = tmp.path().join("other drive").join("LU Runtime");
        let roots = write_roots(&config, Some(&chosen)).unwrap();
        assert_eq!(read_roots(&config), roots);
        // The other settings in the file are untouched.
        let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&config).unwrap()).unwrap();
        assert_eq!(json["comfyui_path"], "D:\\ComfyUI");
        assert_eq!(json["trainer_root"], "E:\\Trainer");

        // Nothing installed anywhere: the new folder.
        assert_eq!(current(Kind::Voice, &roots, &d), Some(chosen.join("voice")));
        // Installed at the old default: still used from there.
        voice_install(&d.data_dir.join("voice"));
        assert_eq!(current(Kind::Voice, &roots, &d), Some(d.data_dir.join("voice")));
        write(&d.app_data_dir.as_ref().unwrap().join("piper_voices").join("en_US-lessac-medium.onnx"), "x");
        assert_eq!(current(Kind::PiperVoices, &roots, &d), Some(d.app_data_dir.clone().unwrap().join("piper_voices")));
        // The Python is only an install with its marker.
        write(&d.data_dir.join("python").join("bin").join("python3.12"), "x");
        assert_eq!(current(Kind::Python, &roots, &d), Some(chosen.join("python")));
        write(&d.data_dir.join("python").join(crate::private_python::COMPLETE_MARKER), "sha");
        assert_eq!(current(Kind::Python, &roots, &d), Some(d.data_dir.join("python")));
        // Installed in the chosen folder as well: the chosen one wins.
        voice_install(&chosen.join("voice"));
        assert_eq!(current(Kind::Voice, &roots, &d), Some(chosen.join("voice")));
    }

    #[test]
    fn a_folder_chosen_before_is_remembered_so_its_installs_are_not_lost() {
        let tmp = tempfile::tempdir().unwrap();
        let d = defaults(tmp.path());
        let config = tmp.path().join("config.json");
        let (first, second) = (tmp.path().join("D drive"), tmp.path().join("E drive"));
        write_roots(&config, Some(&first)).unwrap();
        voice_install(&first.join("voice"));
        let roots = write_roots(&config, Some(&second)).unwrap();
        assert_eq!(roots.history, vec![first.clone()]);
        assert_eq!(current(Kind::Voice, &roots, &d), Some(first.join("voice")));
        assert_eq!(
            locations(Kind::Voice, &roots, &d),
            vec![second.join("voice"), first.join("voice"), d.data_dir.join("voice")]
        );
        // Back to the default: both stay in the history, newest first, once.
        let roots = write_roots(&config, None).unwrap();
        assert_eq!(roots.chosen, None);
        assert_eq!(roots.history, vec![second.clone(), first.clone()]);
        // A new install goes to the default again, the old one is still found.
        assert_eq!(locations(Kind::Python, &roots, &d)[0], d.data_dir.join("python"));
        assert_eq!(current(Kind::Python, &roots, &d), Some(d.data_dir.join("python")));
        assert_eq!(current(Kind::Voice, &roots, &d), Some(first.join("voice")));
        let roots = write_roots(&config, Some(&first)).unwrap();
        assert_eq!(roots.history, vec![second]);
    }

    #[test]
    fn the_folders_below_a_chosen_root_are_named_for_the_agent_jail_and_nothing_else() {
        assert!(owned_below(&Roots::default()).is_empty(), "the defaults are closed as the app data folder already");
        let (a, b) = (PathBuf::from("/d/LU Runtime"), PathBuf::from("/e/old"));
        let owned = owned_below(&Roots { chosen: Some(a.clone()), history: vec![b.clone()] });
        assert_eq!(owned.len(), 6);
        assert!(owned.contains(&a.join("voice")) && owned.contains(&a.join("python")) && owned.contains(&a.join("piper_voices")));
        assert!(owned.contains(&b.join("python")));
        assert!(!owned.contains(&a), "the chosen folder itself stays the user's");
    }

    #[test]
    fn a_broken_config_file_is_no_choice_and_is_replaced_whole() {
        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join("config.json");
        write(&config, "{ not json");
        assert_eq!(read_roots(&config), Roots::default());
        write(&config, r#"{"runtime_root":"   ","runtime_root_history":[""," ",7]}"#);
        assert_eq!(read_roots(&config), Roots::default());
        let chosen = tmp.path().join("x");
        write_roots(&config, Some(&chosen)).unwrap();
        assert_eq!(read_roots(&config).chosen, Some(chosen));
    }

    #[test]
    fn a_path_with_spaces_on_another_drive_is_accepted_and_written_to() {
        let tmp = tempfile::tempdir().unwrap();
        let d = defaults(tmp.path());
        let wanted = tmp.path().join("Other Drive").join("LU Runtime");
        let got = check_candidate(&format!("  {}  ", wanted.display()), &d).unwrap();
        assert_eq!(got, wanted);
        assert!(wanted.is_dir());
        assert_eq!(std::fs::read_dir(&wanted).unwrap().count(), 0, "the probe leaves nothing behind");
    }

    #[test]
    fn a_relative_path_a_tilde_or_a_folder_inside_the_old_place_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let d = defaults(tmp.path());
        assert!(check_candidate("~/LU", &d).unwrap_err().contains("starts with ~"));
        assert!(check_candidate("LU Runtime", &d).unwrap_err().contains("not a full path"));
        let inside = d.data_dir.join("voice").join("deeper");
        assert!(check_candidate(&inside.to_string_lossy(), &d).unwrap_err().contains("voice engine"));
        assert!(!inside.exists(), "a refused folder is not created");
    }

    #[cfg(windows)]
    #[test]
    fn a_windows_drive_path_is_a_full_path() {
        assert!(Path::new("D:\\LU Runtime").is_absolute());
        assert_eq!(
            replace_prefix("c:/users/u/appdata/local/lu-labs/python", "C:\\Users\\U\\AppData\\Local\\lu-labs", "D:\\LU Runtime").as_deref(),
            Some("D:\\LU Runtime/python")
        );
    }

    // ── the venv ────────────────────────────────────────────────────────────

    #[test]
    fn a_prefix_is_replaced_only_as_a_whole_path() {
        assert_eq!(replace_prefix("/a/lu/python/bin", "/a/lu", "/b/x y").as_deref(), Some("/b/x y/python/bin"));
        assert_eq!(replace_prefix("/a/lu", "/a/lu/", "/b").as_deref(), Some("/b"));
        assert_eq!(replace_prefix("/a/lu-other/python", "/a/lu", "/b"), None);
        assert_eq!(replace_prefix("/c/python", "/a/lu", "/b"), None);
    }

    #[test]
    fn a_venv_built_from_the_old_python_points_at_the_new_one_and_others_are_left_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let old = tmp.path().join("old place");
        let new = tmp.path().join("new place");
        voice_install(&old);
        assert!(repoint_venv(&old.join("venv"), &old, &new).unwrap());
        let cfg = std::fs::read_to_string(old.join("venv").join("pyvenv.cfg")).unwrap();
        assert!(cfg.contains(&format!("home = {}", new.join("python").join("bin").display())), "{cfg}");
        assert!(cfg.contains("include-system-site-packages = false"), "{cfg}");
        assert!(cfg.contains(&format!("-m venv {}", new.join("venv").display())), "{cfg}");
        assert!(!cfg.contains(&old.to_string_lossy().to_string()), "{cfg}");
        #[cfg(unix)]
        {
            let bin = old.join("venv").join("bin");
            assert_eq!(std::fs::read_link(bin.join("python")).unwrap(), new.join("python").join("bin").join("python3.12"));
            assert_eq!(std::fs::read_link(bin.join("python3")).unwrap(), PathBuf::from("python"), "relative links stay");
        }
        // A venv of a Python somewhere else is not LU's to change.
        let foreign = tmp.path().join("foreign");
        write(&foreign.join("pyvenv.cfg"), "home = /usr/bin\n");
        assert!(!repoint_venv(&foreign, &old, &new).unwrap());
        assert_eq!(std::fs::read_to_string(foreign.join("pyvenv.cfg")).unwrap(), "home = /usr/bin\n");
        assert!(!repoint_venv(&tmp.path().join("no venv"), &old, &new).unwrap());
    }

    // ── the move ────────────────────────────────────────────────────────────

    fn voice_plan(from: PathBuf, to: PathBuf) -> EntryMove {
        EntryMove { kind: Kind::Voice, from, to, venvs_inside: vec![PathBuf::from("venv")], venvs_outside: vec![] }
    }

    /// The trash of the tests: a folder of its own, so a test can see what
    /// went there and that nothing was deleted.
    fn bin(dir: &Path) -> impl Fn(&Path) -> Result<(), String> + '_ {
        move |path: &Path| {
            std::fs::create_dir_all(dir).unwrap();
            let n = std::fs::read_dir(dir).unwrap().count();
            std::fs::rename(path, dir.join(format!("{n}"))).map_err(|e| os_error::io_english(&e))
        }
    }

    #[test]
    fn a_move_copies_checks_repoints_starts_and_only_then_trashes_the_old_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("app data").join("voice");
        let to = tmp.path().join("D drive").join("LU Runtime").join("voice");
        voice_install(&from);
        let trash_dir = tmp.path().join("trash");
        let proved = RefCell::new(false);
        let prove = |plan: &EntryMove| {
            // Started at the new place, with the old one still there.
            assert!(plan.to.join("venv").join("pyvenv.cfg").is_file());
            assert!(plan.from.is_dir(), "the original is kept until the copy has run");
            *proved.borrow_mut() = true;
            true
        };
        let out = move_entry(&voice_plan(from.clone(), to.clone()), Some(u64::MAX), &prove, &bin(&trash_dir));
        assert_eq!(out.status, MoveStatus::Moved, "{}", out.detail);
        assert!(*proved.borrow());
        assert!(!from.exists());
        assert!(Kind::Voice.holds(&to));
        assert_eq!(std::fs::read_to_string(to.join("models").join("stt").join("a.bin")).unwrap(), "0123456789");
        let cfg = std::fs::read_to_string(to.join("venv").join("pyvenv.cfg")).unwrap();
        assert!(cfg.contains(&to.join("python").to_string_lossy().to_string()), "{cfg}");
        // In the trash, whole.
        assert!(trash_dir.join("0").join("install.json").is_file());
        assert!(!staging_of(&to).exists());
    }

    #[test]
    fn a_copy_that_does_not_start_is_discarded_and_the_old_folder_keeps_working() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("old").join("voice");
        let to = tmp.path().join("new").join("voice");
        voice_install(&from);
        let before = std::fs::read_to_string(from.join("venv").join("pyvenv.cfg")).unwrap();
        let trash_dir = tmp.path().join("trash");
        let out = move_entry(&voice_plan(from.clone(), to.clone()), None, &|_| false, &bin(&trash_dir));
        assert_eq!(out.status, MoveStatus::Failed);
        assert!(out.detail.contains("did not start"), "{}", out.detail);
        assert!(out.detail.contains("keeps working"), "{}", out.detail);
        assert!(Kind::Voice.holds(&from));
        assert_eq!(std::fs::read_to_string(from.join("venv").join("pyvenv.cfg")).unwrap(), before, "the original is untouched");
        assert!(!to.exists());
        assert!(trash_dir.join("0").join("install.json").is_file(), "the failed copy went to the trash, not away");
    }

    #[test]
    fn a_copy_that_does_not_start_and_cannot_go_to_the_trash_is_never_found_as_an_install() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("old").join("voice");
        let to = tmp.path().join("new").join("voice");
        voice_install(&from);
        let refuse = |_: &Path| -> Result<(), String> { Err("in use".to_string()) };
        let out = move_entry(&voice_plan(from.clone(), to.clone()), None, &|_| false, &refuse);
        assert_eq!(out.status, MoveStatus::Failed);
        assert!(!Kind::Voice.holds(&to), "the lookup would take a copy that does not start");
        assert!(out.detail.contains(&staging_of(&to).to_string_lossy().to_string()), "{}", out.detail);
        assert!(Kind::Voice.holds(&from));
    }

    #[test]
    fn a_full_drive_or_a_folder_in_the_way_stops_the_move_before_anything_is_written() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("old").join("voice");
        voice_install(&from);
        let never = |_: &Path| -> Result<(), String> { panic!("nothing may go to the trash") };
        let to = tmp.path().join("new").join("voice");
        let out = move_entry(&voice_plan(from.clone(), to.clone()), Some(3), &|_| true, &never);
        assert_eq!(out.status, MoveStatus::Failed);
        assert!(out.detail.contains("GB free"), "{}", out.detail);
        assert!(!to.exists());

        write(&to.join("somebody's file.txt"), "mine");
        let out = move_entry(&voice_plan(from.clone(), to.clone()), None, &|_| true, &never);
        assert_eq!(out.status, MoveStatus::Failed);
        assert!(out.detail.contains("not empty"), "{}", out.detail);
        assert_eq!(std::fs::read_to_string(to.join("somebody's file.txt")).unwrap(), "mine");
        assert!(Kind::Voice.holds(&from));

        // An empty folder in the way is no reason to stop.
        std::fs::remove_file(to.join("somebody's file.txt")).unwrap();
        let trash_dir = tmp.path().join("trash");
        let out = move_entry(&voice_plan(from, to.clone()), None, &|_| true, &bin(&trash_dir));
        assert_eq!(out.status, MoveStatus::Moved, "{}", out.detail);
        assert!(Kind::Voice.holds(&to));
    }

    #[test]
    fn a_move_into_itself_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("voice");
        voice_install(&from);
        let never = |_: &Path| -> Result<(), String> { panic!("nothing may go to the trash") };
        let out = move_entry(&voice_plan(from.clone(), from.join("inner")), None, &|_| true, &never);
        assert_eq!(out.status, MoveStatus::Failed);
        assert!(Kind::Voice.holds(&from));
    }

    #[test]
    fn when_the_trash_refuses_the_old_folder_stays_and_the_report_names_it() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("old").join("voice");
        let to = tmp.path().join("new").join("voice");
        voice_install(&from);
        let refuse = |_: &Path| -> Result<(), String> { Err("in use".to_string()) };
        let out = move_entry(&voice_plan(from.clone(), to.clone()), None, &|_| true, &refuse);
        assert_eq!(out.status, MoveStatus::MovedOldKept);
        assert!(out.detail.contains(&from.to_string_lossy().to_string()), "{}", out.detail);
        assert!(Kind::Voice.holds(&from), "never deleted for good");
        assert!(Kind::Voice.holds(&to));
    }

    #[test]
    fn moving_the_python_repoints_the_engine_venvs_built_from_it_and_no_others() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("app data").join("python");
        let to = tmp.path().join("D drive").join("python");
        write(&from.join("bin").join("python3.12"), "interpreter");
        write(&from.join(crate::private_python::COMPLETE_MARKER), "sha");
        let engine = tmp.path().join("app data").join("mlx").join("venv");
        write(&engine.join("pyvenv.cfg"), &format!("home = {}\n", from.join("bin").display()));
        let comfy = tmp.path().join("ComfyUI").join("venv");
        write(&comfy.join("pyvenv.cfg"), "home = /opt/homebrew/bin\n");
        let plan = EntryMove {
            kind: Kind::Python,
            from: from.clone(),
            to: to.clone(),
            venvs_inside: vec![],
            venvs_outside: vec![engine.clone(), comfy.clone(), tmp.path().join("no trainer").join("venv")],
        };
        let trash_dir = tmp.path().join("trash");
        let out = move_entry(&plan, None, &|p| Kind::Python.holds(&p.to), &bin(&trash_dir));
        assert_eq!(out.status, MoveStatus::Moved, "{}", out.detail);
        assert_eq!(std::fs::read_to_string(engine.join("pyvenv.cfg")).unwrap(), format!("home = {}\n", to.join("bin").display()));
        assert_eq!(std::fs::read_to_string(comfy.join("pyvenv.cfg")).unwrap(), "home = /opt/homebrew/bin\n");
        assert!(!from.exists());
    }

    #[test]
    fn a_copy_with_a_missing_file_does_not_pass_the_check() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("a");
        voice_install(&from);
        let to = tmp.path().join("b");
        copy_tree(&from, &to).unwrap();
        verify_copy(&from, &to).unwrap();
        std::fs::write(to.join("models").join("stt").join("a.bin"), "short").unwrap();
        assert!(verify_copy(&from, &to).unwrap_err().contains("size"));
        std::fs::remove_file(to.join("models").join("stt").join("a.bin")).unwrap();
        assert!(verify_copy(&from, &to).is_err());
    }
}
