//! Bring a model file of the user's own into the app.
//!
//! The system's document picker hands out a content address (Android) or a
//! security scoped address (iOS), never a path the engine could open. So the
//! file is copied into the model folder of the app, natively, in pieces, with
//! progress and a way to stop. The bytes never pass through the webview: a
//! model has gigabytes, and a webview would hold all of them in memory at
//! once.
//!
//! Three native steps, with every decision in between made here, where it is
//! tested on the desktop:
//!
//!   1. `importPick`: the picker. Answers the name, the size, the first
//!      bytes of the file and the free space of the model folder.
//!   2. `decide`: is it a GGUF file, is there room, is the name free.
//!   3. `importCopy`: the copy into `<name>.import` next to the target, with
//!      `model-import-progress` events. Renamed into place here, after the
//!      size was compared.
//!
//! The answer never is an error for something the user can understand: it
//! is `{ status }` with `imported`, `cancelled`, `not-gguf`, `no-space`,
//! `exists` or `failed`, and a sentence for the last four.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Runtime;

use crate::error::{Error, Result};
use crate::LuNative;

/// How a GGUF file begins.
pub const GGUF_MAGIC: &[u8; 4] = b"GGUF";
/// A GGUF file without a single tensor is still longer than this.
pub const MIN_MODEL_BYTES: u64 = 64;
/// Room that has to stay free after the copy, so the phone does not end up
/// with a full disk and an app that cannot write its settings.
pub const SPACE_MARGIN_BYTES: u64 = 64 * 1024 * 1024;
/// The ending of the file a copy is written to until it is complete.
pub const PARTIAL_EXTENSION: &str = "import";

/// The words of `ImportOutcome::status`.
pub mod status {
    pub const IMPORTED: &str = "imported";
    pub const CANCELLED: &str = "cancelled";
    pub const NOT_GGUF: &str = "not-gguf";
    pub const NO_SPACE: &str = "no-space";
    pub const EXISTS: &str = "exists";
    pub const FAILED: &str = "failed";
}

/// What `importPick` answers about the file the user chose.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Picked {
    #[serde(default)]
    pub cancelled: bool,
    /// Names the chosen file for the two steps that follow.
    #[serde(default)]
    pub token: String,
    /// The name the picker shows.
    #[serde(default)]
    pub name: String,
    /// Bytes, or less than 0 when the provider does not say.
    #[serde(default)]
    pub size: i64,
    /// The first bytes of the file, base64. Empty when it could not be read.
    #[serde(default)]
    pub head_base64: String,
    /// Free bytes in the model folder.
    #[serde(default)]
    pub free_bytes: u64,
}

/// What `importCopy` answers.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Copied {
    /// `copied`, `cancelled`, `no-space` or `failed`.
    #[serde(default)]
    status: String,
    #[serde(default)]
    bytes: u64,
}

/// The answer of `import_model_document`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub status: &'static str,
    /// The name the file has in the model folder, with `.gguf`.
    pub file_name: Option<String>,
    /// Where it is, once imported.
    pub path: Option<String>,
    /// The size of the file.
    pub bytes: u64,
    /// A sentence for the user, for every status but `imported` and `cancelled`.
    pub message: Option<String>,
}

impl ImportOutcome {
    fn plain(status: &'static str) -> Self {
        Self { status, file_name: None, path: None, bytes: 0, message: None }
    }

    fn refused(status: &'static str, name: Option<String>, bytes: u64, message: impl Into<String>) -> Self {
        Self { status, file_name: name, path: None, bytes, message: Some(message.into()) }
    }
}

/// The name a picked file gets in the model folder: only what the engine
/// and the download list accept, and always ending in `.gguf`.
///
/// The same rule as `sanitize_model_file_name` of the app, so a model that
/// was imported is called like one that was linked in on the desktop.
pub fn model_file_name(display: &str) -> String {
    // A provider may hand out a whole path as the name.
    let last = display.rsplit(['/', '\\']).next().unwrap_or(display);
    let mut base: String = last
        .chars()
        .map(|c| if c == ':' || c == ' ' { '-' } else { c })
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .collect();
    if base.to_ascii_lowercase().ends_with(".gguf") {
        base.truncate(base.len() - ".gguf".len());
    }
    base = base.trim_matches(|c| c == '.' || c == '-').to_string();
    if base.is_empty() {
        base = "model".to_string();
    }
    // Room for the ending and for the partial file next to it.
    if base.len() > 120 {
        base.truncate(120);
    }
    format!("{base}.gguf")
}

/// True when the bytes are the beginning of a GGUF file.
pub fn is_gguf_head(head: &[u8]) -> bool {
    head.len() >= GGUF_MAGIC.len() && &head[..GGUF_MAGIC.len()] == GGUF_MAGIC
}

/// How large the file is in words a person reads: `1.9 GB`, `340 MB`.
pub fn human_bytes(bytes: u64) -> String {
    const GB: f64 = 1_073_741_824.0;
    const MB: f64 = 1_048_576.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} GB", b / GB)
    } else if b >= MB {
        format!("{:.0} MB", (b / MB).max(1.0))
    } else {
        "less than 1 MB".to_string()
    }
}

/// Where the copy goes, or why it does not happen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Copy { file_name: String, dest: PathBuf, partial: PathBuf, total: u64 },
    Refuse(ImportOutcome),
}

/// Judge a picked file before a byte is copied.
///
/// `taken` says whether a path exists; it is a parameter so that the rule is
/// tested without a disk.
pub fn decide(picked: &Picked, head: &[u8], dir: &Path, taken: &dyn Fn(&Path) -> bool) -> Decision {
    let size = u64::try_from(picked.size).unwrap_or(0);
    let shown = picked.name.trim();
    let shown = if shown.is_empty() { "That file" } else { shown };
    if !is_gguf_head(head) || (picked.size >= 0 && size < MIN_MODEL_BYTES) {
        return Decision::Refuse(ImportOutcome::refused(
            status::NOT_GGUF,
            None,
            size,
            format!("{shown} is not a GGUF model file. LU runs models in the GGUF format only."),
        ));
    }
    let file_name = model_file_name(&picked.name);
    let dest = dir.join(&file_name);
    // A download that is still running writes `<name>.download` and will
    // rename it to this very name.
    if taken(&dest) || taken(&dest.with_extension("download")) {
        return Decision::Refuse(ImportOutcome::refused(
            status::EXISTS,
            Some(file_name.clone()),
            size,
            format!("A model called {file_name} is already on this phone. Delete it first, or rename the file and import it again."),
        ));
    }
    if size > 0 && picked.free_bytes < size.saturating_add(SPACE_MARGIN_BYTES) {
        return Decision::Refuse(ImportOutcome::refused(
            status::NO_SPACE,
            Some(file_name),
            size,
            format!(
                "Not enough free space. The file needs {}, this phone has {} free. Free up space, then import it again.",
                human_bytes(size),
                human_bytes(picked.free_bytes)
            ),
        ));
    }
    let partial = dest.with_extension(PARTIAL_EXTENSION);
    Decision::Copy { file_name, dest, partial, total: size }
}

/// Remove what an import left behind that never finished (the app was ended
/// in the middle of a copy). Only called while no import runs.
pub fn sweep_partials(dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == PARTIAL_EXTENSION) && path.is_file() && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// After the copy: compare the size, look at the head once more (this time
/// the bytes on disk), then move the file into place.
pub fn finish(partial: &Path, dest: &Path, file_name: &str, copied: u64, expected: u64) -> ImportOutcome {
    let failed = |message: &str| {
        let _ = std::fs::remove_file(partial);
        ImportOutcome::refused(status::FAILED, Some(file_name.to_string()), copied, message)
    };
    let on_disk = match std::fs::metadata(partial) {
        Ok(meta) => meta.len(),
        Err(_) => return failed("The copy of the file was not found afterwards. Import it again."),
    };
    if on_disk != copied || (expected > 0 && on_disk != expected) {
        return failed("The file was not copied completely. Import it again.");
    }
    let mut head = [0u8; 4];
    let read = std::fs::File::open(partial).and_then(|mut f| std::io::Read::read_exact(&mut f, &mut head));
    if read.is_err() || !is_gguf_head(&head) {
        let _ = std::fs::remove_file(partial);
        return ImportOutcome::refused(
            status::NOT_GGUF,
            None,
            on_disk,
            "That file is not a GGUF model file. LU runs models in the GGUF format only.",
        );
    }
    if dest.exists() {
        let _ = std::fs::remove_file(partial);
        return ImportOutcome::refused(
            status::EXISTS,
            Some(file_name.to_string()),
            on_disk,
            format!("A model called {file_name} is already on this phone. Delete it first, or rename the file and import it again."),
        );
    }
    if std::fs::rename(partial, dest).is_err() {
        return failed("The file was copied but could not be moved into the model folder. Import it again.");
    }
    ImportOutcome {
        status: status::IMPORTED,
        file_name: Some(file_name.to_string()),
        path: Some(dest.to_string_lossy().into_owned()),
        bytes: on_disk,
        message: None,
    }
}

/// How long a file picker has to have been open before a new import may
/// take its place. Shorter than that is a second tap on the button, and that
/// is refused as before.
pub const STALE_PICK_AFTER: std::time::Duration = std::time::Duration::from_millis(1500);

/// One import at a time, and a way out when the picker never answers.
///
/// Before this, one flag was set from the first step to the last. The first
/// step is the system's file picker, and its answer can get lost: Android
/// destroys the activity under an open picker when memory is short (a model
/// is loaded), and the result then has nobody to go to. The flag stayed set
/// until the app was started again, and every further try read "A model file
/// is being imported already" (review of round 6, finding 12).
///
/// So the two phases are told apart. While a file is COPIED, a second import
/// is refused. While the picker is open, the user cannot reach the button in
/// the app at all: a new import that arrives then means the picker is gone
/// without an answer, and the new import takes over. The old one, should its
/// answer still come, finds that it was replaced and ends as cancelled.
#[derive(Debug, Default)]
pub struct ImportGate {
    state: std::sync::Mutex<GateState>,
}

#[derive(Debug, Default)]
struct GateState {
    /// Counts the imports that were let in. Names the one that holds the gate.
    turn: u64,
    phase: Phase,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum Phase {
    #[default]
    Idle,
    Picking {
        since: std::time::Instant,
    },
    Copying,
}

impl ImportGate {
    fn lock(&self) -> std::sync::MutexGuard<'_, GateState> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Let an import in. Answers its turn, or None while a copy runs or a
    /// picker was opened a moment ago.
    pub fn enter(&self, now: std::time::Instant) -> Option<u64> {
        let mut state = self.lock();
        match state.phase {
            Phase::Idle => {}
            Phase::Picking { since } if now.saturating_duration_since(since) >= STALE_PICK_AFTER => {}
            _ => return None,
        }
        state.turn += 1;
        state.phase = Phase::Picking { since: now };
        Some(state.turn)
    }

    /// The picker answered and the copy begins. False when another import
    /// took this one's place in the meantime: then nothing is copied.
    pub fn begin_copy(&self, turn: u64) -> bool {
        let mut state = self.lock();
        if state.turn != turn || !matches!(state.phase, Phase::Picking { .. }) {
            return false;
        }
        state.phase = Phase::Copying;
        true
    }

    /// The import of this turn is over. Does nothing for one that was replaced.
    pub fn leave(&self, turn: u64) {
        let mut state = self.lock();
        if state.turn == turn {
            state.phase = Phase::Idle;
        }
    }

    /// Does this turn still hold the gate?
    pub fn holds(&self, turn: u64) -> bool {
        let state = self.lock();
        state.turn == turn && state.phase != Phase::Idle
    }

    /// True while nothing is picked and nothing is copied.
    pub fn idle(&self) -> bool {
        self.lock().phase == Phase::Idle
    }

    /// True while a file is being copied.
    pub fn copying(&self) -> bool {
        self.lock().phase == Phase::Copying
    }
}

/// Gives the gate back when the import ends, whichever way it ends.
struct Turn<'a> {
    gate: &'a ImportGate,
    turn: u64,
}

impl Drop for Turn<'_> {
    fn drop(&mut self) {
        self.gate.leave(self.turn);
    }
}

/// Remove the leftovers of an import the app was ended under, once, when the
/// app starts. Before this they were removed only when the user imported
/// again, and a half copy of several gigabytes took the room in between
/// without showing up anywhere (review of round 6, finding 9). Never while a
/// file is being copied: that file is such a leftover until it is complete.
pub fn sweep_partials_at_start(gate: &ImportGate, dir: &Path) -> usize {
    if gate.copying() {
        return 0;
    }
    sweep_partials(dir)
}

impl<R: Runtime> LuNative<R> {
    /// Let the user pick a GGUF file and copy it into the model folder.
    /// `id` names this import in the `model-import-progress` events.
    pub async fn import_model(&self, id: &str) -> Result<ImportOutcome> {
        use base64::Engine as _;

        if !self.available() {
            return Err(Error::new(crate::error::NOT_ON_DESKTOP));
        }
        let Some(turn) = self.import_gate.enter(std::time::Instant::now()) else {
            return Err(Error::new("A model file is being imported already. Wait for it to finish."));
        };
        let _turn = Turn { gate: &self.import_gate, turn };

        let dir = self.models_dir().ok_or_else(|| Error::new("The app has no model folder on this device."))?;
        std::fs::create_dir_all(&dir).map_err(|_| Error::new("The model folder could not be created."))?;
        sweep_partials(&dir);

        let picked: Picked = self.call("importPick", json!({ "dir": dir })).await?;
        if picked.cancelled || picked.token.is_empty() {
            return Ok(ImportOutcome::plain(status::CANCELLED));
        }
        // The picker of an import that was replaced answered after all: the
        // file it names is let go, nothing is copied.
        if !self.import_gate.holds(turn) {
            let _: Result<Value> = self.call("importRelease", json!({ "token": picked.token })).await;
            return Ok(ImportOutcome::plain(status::CANCELLED));
        }
        let head = base64::engine::general_purpose::STANDARD.decode(picked.head_base64.as_bytes()).unwrap_or_default();
        let (file_name, dest, partial, total) = match decide(&picked, &head, &dir, &|p| p.exists()) {
            Decision::Copy { file_name, dest, partial, total } => (file_name, dest, partial, total),
            Decision::Refuse(outcome) => {
                let _: Result<Value> = self.call("importRelease", json!({ "token": picked.token })).await;
                return Ok(outcome);
            }
        };

        if !self.import_gate.begin_copy(turn) {
            let _: Result<Value> = self.call("importRelease", json!({ "token": picked.token })).await;
            return Ok(ImportOutcome::plain(status::CANCELLED));
        }
        let copied: Result<Copied> = self
            .call(
                "importCopy",
                json!({ "token": picked.token, "id": id, "partial": partial, "fileName": file_name, "totalBytes": total }),
            )
            .await;
        let copied = match copied {
            Ok(copied) => copied,
            Err(error) => {
                let _ = std::fs::remove_file(&partial);
                return Ok(ImportOutcome::refused(status::FAILED, Some(file_name), 0, error.0));
            }
        };
        match copied.status.as_str() {
            "copied" => {}
            "cancelled" => {
                let _ = std::fs::remove_file(&partial);
                return Ok(ImportOutcome::plain(status::CANCELLED));
            }
            "no-space" => {
                let _ = std::fs::remove_file(&partial);
                return Ok(ImportOutcome::refused(
                    status::NO_SPACE,
                    Some(file_name),
                    total,
                    "This phone ran out of free space while the file was copied. Free up space, then import it again.",
                ));
            }
            _ => {
                let _ = std::fs::remove_file(&partial);
                return Ok(ImportOutcome::refused(
                    status::FAILED,
                    Some(file_name),
                    total,
                    "The file could not be read to its end. If it lives in a cloud drive, download it to the phone first, then import it again.",
                ));
            }
        }
        let outcome = tauri::async_runtime::spawn_blocking(move || finish(&partial, &dest, &file_name, copied.bytes, total))
            .await
            .map_err(|_| Error::new("The import could not be finished."))?;
        Ok(outcome)
    }

    /// Stop the copy that is running. Nothing running is not an error.
    pub async fn import_cancel(&self) -> Result<()> {
        if !self.available() {
            return Ok(());
        }
        let _: Value = self.call("importCancel", json!({})).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picked(name: &str, size: i64, free: u64) -> Picked {
        Picked { cancelled: false, token: "t".into(), name: name.into(), size, head_base64: String::new(), free_bytes: free }
    }

    const GB: u64 = 1_073_741_824;

    #[test]
    fn the_name_in_the_model_folder_is_tame_and_ends_in_gguf() {
        assert_eq!(model_file_name("SmolLM2-135M-Instruct-Q4_K_M.gguf"), "SmolLM2-135M-Instruct-Q4_K_M.gguf");
        assert_eq!(model_file_name("My Model (final).GGUF"), "My-Model-final.gguf");
        assert_eq!(model_file_name("primary:Download/qwen.gguf"), "qwen.gguf");
        assert_eq!(model_file_name("..\\..\\evil.gguf"), "evil.gguf");
        assert_eq!(model_file_name("model"), "model.gguf");
        assert_eq!(model_file_name("日本語.gguf"), "model.gguf");
        assert_eq!(model_file_name(""), "model.gguf");
        assert_eq!(model_file_name(".gguf"), "model.gguf");
        let long = model_file_name(&format!("{}.gguf", "a".repeat(400)));
        assert_eq!(long.len(), 125);
        assert!(!model_file_name("a/../b.gguf").contains('/'));
    }

    #[test]
    fn only_a_file_that_begins_like_gguf_is_copied() {
        let dir = Path::new("/models");
        let free = |_: &Path| false;
        let d = decide(&picked("photo.gguf", 5_000_000, 10 * GB), b"\x89PNG\r\n", dir, &free);
        let Decision::Refuse(outcome) = d else { panic!("a PNG was accepted") };
        assert_eq!(outcome.status, status::NOT_GGUF);
        assert!(outcome.message.unwrap().contains("photo.gguf is not a GGUF model file"));

        // Nothing readable is not a model either.
        assert!(matches!(decide(&picked("m.gguf", 5_000_000, 10 * GB), b"", dir, &free), Decision::Refuse(o) if o.status == status::NOT_GGUF));
        // Four right bytes and nothing behind them.
        assert!(matches!(decide(&picked("m.gguf", 4, 10 * GB), b"GGUF", dir, &free), Decision::Refuse(o) if o.status == status::NOT_GGUF));

        let ok = decide(&picked("m.gguf", 5_000_000, 10 * GB), b"GGUF\x03\x00\x00\x00", dir, &free);
        assert_eq!(
            ok,
            Decision::Copy {
                file_name: "m.gguf".into(),
                dest: PathBuf::from("/models/m.gguf"),
                partial: PathBuf::from("/models/m.import"),
                total: 5_000_000
            }
        );
    }

    #[test]
    fn a_file_that_does_not_fit_is_refused_before_a_byte_is_copied() {
        let dir = Path::new("/models");
        let free = |_: &Path| false;
        let d = decide(&picked("big.gguf", (2 * GB) as i64, GB), b"GGUF", dir, &free);
        let Decision::Refuse(outcome) = d else { panic!("copied without room") };
        assert_eq!(outcome.status, status::NO_SPACE);
        let text = outcome.message.unwrap();
        assert!(text.contains("needs 2.0 GB") && text.contains("has 1.0 GB free"), "{text}");
        // The margin counts: exactly the size of the file free is not enough.
        assert!(matches!(decide(&picked("big.gguf", GB as i64, GB), b"GGUF", dir, &free), Decision::Refuse(o) if o.status == status::NO_SPACE));
        assert!(matches!(decide(&picked("big.gguf", GB as i64, GB + SPACE_MARGIN_BYTES), b"GGUF", dir, &free), Decision::Copy { .. }));
        // A provider that does not say the size: the copy itself finds out.
        assert!(matches!(decide(&picked("big.gguf", -1, 0), b"GGUF", dir, &free), Decision::Copy { total: 0, .. }));
    }

    #[test]
    fn a_name_that_is_taken_is_never_overwritten() {
        let dir = Path::new("/models");
        let there = |p: &Path| p == Path::new("/models/m.gguf");
        let d = decide(&picked("m.gguf", 5_000_000, 10 * GB), b"GGUF", dir, &there);
        let Decision::Refuse(outcome) = d else { panic!("overwritten") };
        assert_eq!(outcome.status, status::EXISTS);
        assert_eq!(outcome.file_name.as_deref(), Some("m.gguf"));
        assert!(outcome.message.unwrap().contains("m.gguf is already on this phone"));
        // A download that is still writing this very file counts as well.
        let loading = |p: &Path| p == Path::new("/models/m.download");
        assert!(matches!(decide(&picked("m.gguf", 5_000_000, 10 * GB), b"GGUF", dir, &loading), Decision::Refuse(o) if o.status == status::EXISTS));
    }

    #[test]
    fn the_copy_is_checked_and_moved_into_place() {
        let dir = tempfile::tempdir().unwrap();
        let partial = dir.path().join("m.import");
        let dest = dir.path().join("m.gguf");
        let mut body = b"GGUF".to_vec();
        body.extend(std::iter::repeat_n(7u8, 200));

        std::fs::write(&partial, &body).unwrap();
        let done = finish(&partial, &dest, "m.gguf", body.len() as u64, body.len() as u64);
        assert_eq!(done.status, status::IMPORTED);
        assert_eq!(done.bytes, 204);
        assert_eq!(done.path.as_deref(), Some(dest.to_string_lossy().as_ref()));
        assert!(dest.is_file() && !partial.exists());

        // A second file of the same name does not replace the first.
        std::fs::write(&partial, &body).unwrap();
        assert_eq!(finish(&partial, &dest, "m.gguf", 204, 204).status, status::EXISTS);
        assert!(!partial.exists());
        assert_eq!(std::fs::read(&dest).unwrap(), body);

        // Shorter than the source said: not a model anybody should load.
        let other = dir.path().join("o.gguf");
        std::fs::write(&partial, &body[..100]).unwrap();
        let short = finish(&partial, &other, "o.gguf", 100, 204);
        assert_eq!(short.status, status::FAILED);
        assert!(!partial.exists() && !other.exists());

        // The bytes on disk are judged again, not only the ones the picker read.
        std::fs::write(&partial, vec![0u8; 204]).unwrap();
        assert_eq!(finish(&partial, &other, "o.gguf", 204, 204).status, status::NOT_GGUF);
        assert!(!partial.exists() && !other.exists());

        // No copy at all.
        assert_eq!(finish(&partial, &other, "o.gguf", 204, 204).status, status::FAILED);
    }

    #[test]
    fn leftovers_of_an_import_that_never_finished_are_removed() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.import"), b"x").unwrap();
        std::fs::write(dir.path().join("b.gguf"), b"x").unwrap();
        std::fs::write(dir.path().join("c.download"), b"x").unwrap();
        assert_eq!(sweep_partials(dir.path()), 1);
        assert!(!dir.path().join("a.import").exists());
        assert!(dir.path().join("b.gguf").exists() && dir.path().join("c.download").exists());
    }

    #[test]
    fn leftovers_are_removed_at_the_start_and_never_under_a_running_copy() {
        let dir = tempfile::tempdir().unwrap();
        let gate = ImportGate::default();
        std::fs::write(dir.path().join("half.import"), vec![0u8; 4096]).unwrap();
        std::fs::write(dir.path().join("kept.gguf"), b"x").unwrap();
        // The app starts: nothing is being imported, the half copy goes.
        assert_eq!(sweep_partials_at_start(&gate, dir.path()), 1);
        assert!(!dir.path().join("half.import").exists());
        assert!(dir.path().join("kept.gguf").exists());
        // A folder that is not there yet is nothing to sweep.
        assert_eq!(sweep_partials_at_start(&gate, &dir.path().join("missing")), 0);
        // A copy is running: its file is left alone.
        let turn = gate.enter(std::time::Instant::now()).unwrap();
        assert!(gate.begin_copy(turn));
        std::fs::write(dir.path().join("running.import"), b"x").unwrap();
        assert_eq!(sweep_partials_at_start(&gate, dir.path()), 0);
        assert!(dir.path().join("running.import").exists());
        gate.leave(turn);
        assert_eq!(sweep_partials_at_start(&gate, dir.path()), 1);
    }

    #[test]
    fn one_import_at_a_time_while_a_file_is_copied() {
        let gate = ImportGate::default();
        let t0 = std::time::Instant::now();
        let first = gate.enter(t0).unwrap();
        assert!(gate.begin_copy(first));
        // However long the copy takes, a second import waits for it.
        assert_eq!(gate.enter(t0 + std::time::Duration::from_secs(3600)), None);
        gate.leave(first);
        assert!(gate.idle());
        assert!(gate.enter(t0 + std::time::Duration::from_secs(3601)).is_some());
    }

    #[test]
    fn a_second_tap_on_the_button_is_refused_while_the_picker_opens() {
        let gate = ImportGate::default();
        let t0 = std::time::Instant::now();
        let first = gate.enter(t0).unwrap();
        assert_eq!(gate.enter(t0 + std::time::Duration::from_millis(200)), None);
        assert!(gate.holds(first));
    }

    /// Finding 12 of the review of round 6: the picker never answers (the
    /// activity was destroyed under it). With the one flag of before, every
    /// later import was refused until the app was started again.
    #[test]
    fn a_picker_that_never_answers_does_not_lock_the_import_for_good() {
        let gate = ImportGate::default();
        let t0 = std::time::Instant::now();
        let lost = gate.enter(t0).unwrap();
        // The user is back in the app and taps Import again.
        let again = gate.enter(t0 + STALE_PICK_AFTER).expect("the lost picker must not hold the gate");
        assert_ne!(lost, again);
        // Should the lost picker answer after all, it finds itself replaced:
        // it copies nothing, and its end does not free the gate of the new one.
        assert!(!gate.holds(lost));
        assert!(!gate.begin_copy(lost));
        gate.leave(lost);
        assert!(gate.holds(again));
        assert!(gate.begin_copy(again));
        assert_eq!(gate.enter(t0 + std::time::Duration::from_secs(60)), None);
        gate.leave(again);
        assert!(gate.idle());
    }

    #[test]
    fn sizes_read_like_a_person_says_them() {
        assert_eq!(human_bytes(2 * GB), "2.0 GB");
        assert_eq!(human_bytes(340 * 1_048_576), "340 MB");
        assert_eq!(human_bytes(10), "less than 1 MB");
    }
}
