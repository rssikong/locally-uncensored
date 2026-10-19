//! Check files and Repair for installed models (GH #113, wish G16).
//!
//! A bundle that hangs after an aborted download had no way out: the card said
//! Retry or Get, and nothing could tell which of its files were whole. Check
//! files compares every file of a bundle (or a chat model and its image part)
//! with the catalog: the size always, against the catalog's exact byte count
//! or, where it has none, the host's; the SHA-256 where the catalog lists one.
//!
//! The digest of a 20 GB file takes minutes, so the check is a job: it runs on
//! a blocking thread, the frontend polls its progress and may cancel it at any
//! point, and the app keeps answering meanwhile.
//!
//! Repair itself is the frontend's: it moves a broken file to the Trash
//! (`trash_model_file`, never a permanent delete) and starts the file again
//! through the download path that fetched it the first time.

use crate::commands::download::{exact_remote_size, model_file_path, sanitize_filename};
use crate::state::AppState;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;

/// One file the check is asked about. Either `subfolder` (a ComfyUI model
/// folder, the bundle lane) or `dest_dir` (a chat model's own folder).
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VerifyFileRequest {
    pub filename: String,
    pub subfolder: Option<String>,
    pub dest_dir: Option<String>,
    /// Where the file comes from. Asked for the exact size when the catalog
    /// states none.
    pub url: Option<String>,
    /// The catalog's EXACT byte count, never a rounded estimate.
    pub expected_bytes: Option<u64>,
    pub sha256: Option<String>,
}

/// What a file is, after the check.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileState {
    /// The size matches, and the digest where the catalog lists one.
    Ok,
    /// Neither the file nor a partial of it is there.
    Missing,
    /// There, with another byte count than the catalog or the host states.
    WrongSize,
    /// The right size and the wrong content.
    WrongChecksum,
    /// Only the `.download` partial of an aborted transfer is there.
    Incomplete,
    /// There, but nobody could name an exact size and the catalog lists no
    /// digest (offline, or a host that states no length). Not called broken.
    Unconfirmed,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileVerdict {
    pub filename: String,
    pub state: FileState,
    /// Bytes of the file itself, 0 when it is not there.
    pub actual_bytes: u64,
    /// The exact size it was judged against, when there was one.
    pub expected_bytes: Option<u64>,
    /// Bytes of the `.download` partial, when there is one.
    pub partial_bytes: Option<u64>,
    /// How far the check went: "sha256", "size" or "none".
    pub checked: &'static str,
}

/// The first half of the check, everything that needs no reading of content.
#[derive(Debug, PartialEq, Eq)]
pub enum Precheck {
    Done(FileState),
    /// Size fine or unknown, and a digest to compare with.
    Hash,
}

/// Judge a file by what the disk and the exact size say.
///
/// `actual`: the file's length, `None` when it is not there. `partial`: the
/// length of its `.download` partial. `exact`: the size it must have.
pub fn precheck(actual: Option<u64>, partial: Option<u64>, exact: Option<u64>, has_sha: bool) -> Precheck {
    let Some(actual) = actual else {
        return Precheck::Done(if partial.is_some() { FileState::Incomplete } else { FileState::Missing });
    };
    match exact {
        Some(e) if e > 0 && e != actual => Precheck::Done(FileState::WrongSize),
        _ if has_sha => Precheck::Hash,
        Some(e) if e > 0 => Precheck::Done(FileState::Ok),
        _ => Precheck::Done(FileState::Unconfirmed),
    }
}

/// The partial a download of `file` leaves behind. The same rule as
/// download.rs (`with_extension("download")`), which REPLACES the extension.
pub fn partial_of(file: &Path) -> PathBuf {
    file.with_extension("download")
}

/// SHA-256 of `path`, read in pieces. Adds every piece to `progress` and
/// stops between two pieces once `cancel` is set (answer `Ok(None)`).
pub fn hash_file(path: &Path, cancel: &AtomicBool, progress: &AtomicU64) -> Result<Option<String>, String> {
    let mut f = std::fs::File::open(path).map_err(|e| format!("Open {}: {}", path.display(), crate::os_error::english(&e)))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 4 << 20];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Ok(None);
        }
        let n = f.read(&mut buf).map_err(|e| format!("Read {}: {}", path.display(), crate::os_error::english(&e)))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        progress.fetch_add(n as u64, Ordering::Relaxed);
    }
    Ok(Some(format!("{:x}", hasher.finalize())))
}

/// A file with everything the check needs, already resolved.
#[derive(Debug, Clone)]
pub struct Resolved {
    pub filename: String,
    pub path: Option<PathBuf>,
    /// The exact size: the catalog's, else the host's, else unknown.
    pub exact: Option<u64>,
    pub sha256: Option<String>,
}

fn file_len(p: &Path) -> Option<u64> {
    std::fs::metadata(p).ok().filter(|m| m.is_file()).map(|m| m.len())
}

/// The whole check over resolved files, on the calling thread. Returns `None`
/// when it was cancelled. `current` names the file being hashed.
pub fn verify_resolved(
    files: &[Resolved],
    cancel: &AtomicBool,
    hashed: &AtomicU64,
    hash_total: &AtomicU64,
    current: &Mutex<Option<String>>,
) -> Result<Option<Vec<FileVerdict>>, String> {
    let mut out: Vec<FileVerdict> = Vec::with_capacity(files.len());
    let mut to_hash: Vec<usize> = Vec::new();
    for f in files {
        let actual = f.path.as_deref().and_then(file_len);
        let partial = f.path.as_deref().map(partial_of).as_deref().and_then(file_len);
        let pre = precheck(actual, partial, f.exact, f.sha256.is_some());
        let (state, checked) = match pre {
            Precheck::Done(s) => {
                let checked = match s {
                    FileState::Ok | FileState::WrongSize => "size",
                    _ => "none",
                };
                (s, checked)
            }
            Precheck::Hash => {
                to_hash.push(out.len());
                hash_total.fetch_add(actual.unwrap_or(0), Ordering::Relaxed);
                // Placeholder until the digest is in.
                (FileState::Unconfirmed, "none")
            }
        };
        out.push(FileVerdict {
            filename: f.filename.clone(),
            state,
            actual_bytes: actual.unwrap_or(0),
            expected_bytes: f.exact,
            partial_bytes: partial,
            checked,
        });
    }
    for i in to_hash {
        let f = &files[i];
        let Some(path) = f.path.as_deref() else { continue };
        if let Ok(mut c) = current.lock() {
            *c = Some(f.filename.clone());
        }
        let Some(digest) = hash_file(path, cancel, hashed)? else {
            return Ok(None);
        };
        let expected = f.sha256.as_deref().unwrap_or("").trim().to_ascii_lowercase();
        out[i].state = if digest == expected { FileState::Ok } else { FileState::WrongChecksum };
        out[i].checked = "sha256";
    }
    if let Ok(mut c) = current.lock() {
        *c = None;
    }
    Ok(Some(out))
}

// ── Jobs ────────────────────────────────────────────────────────────

struct Job {
    cancel: AtomicBool,
    hashed: AtomicU64,
    hash_total: AtomicU64,
    current: Mutex<Option<String>>,
    /// "running", "done", "cancelled" or "error".
    status: Mutex<&'static str>,
    files: Mutex<Vec<FileVerdict>>,
    error: Mutex<Option<String>>,
}

impl Job {
    fn new() -> Self {
        Job {
            cancel: AtomicBool::new(false),
            hashed: AtomicU64::new(0),
            hash_total: AtomicU64::new(0),
            current: Mutex::new(None),
            status: Mutex::new("running"),
            files: Mutex::new(Vec::new()),
            error: Mutex::new(None),
        }
    }
}

/// Running and recently finished checks, oldest first, by id.
type JobList = Vec<(String, Arc<Job>)>;

static JOBS: Lazy<Mutex<JobList>> = Lazy::new(|| Mutex::new(Vec::new()));

/// Finished jobs kept for a late poll. Older finished ones are dropped.
const KEEP_FINISHED: usize = 8;

fn register(id: &str, job: Arc<Job>) {
    let mut jobs = JOBS.lock().unwrap_or_else(|p| p.into_inner());
    let finished: Vec<String> = jobs
        .iter()
        .filter(|(_, j)| *j.status.lock().unwrap_or_else(|p| p.into_inner()) != "running")
        .map(|(k, _)| k.clone())
        .collect();
    if finished.len() >= KEEP_FINISHED {
        let drop_n = finished.len() + 1 - KEEP_FINISHED;
        let gone: Vec<&String> = finished.iter().take(drop_n).collect();
        jobs.retain(|(k, _)| !gone.contains(&k));
    }
    jobs.push((id.to_string(), job));
}

fn find(id: &str) -> Option<Arc<Job>> {
    JOBS.lock()
        .unwrap_or_else(|p| p.into_inner())
        .iter()
        .find(|(k, _)| k == id)
        .map(|(_, j)| Arc::clone(j))
}

/// What the frontend reads while the check runs and after.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VerifyJobView {
    pub id: String,
    pub status: &'static str,
    pub current: Option<String>,
    pub hashed_bytes: u64,
    pub hash_total_bytes: u64,
    pub files: Vec<FileVerdict>,
    pub error: Option<String>,
}

fn view(id: &str, job: &Job) -> VerifyJobView {
    VerifyJobView {
        id: id.to_string(),
        status: *job.status.lock().unwrap_or_else(|p| p.into_inner()),
        current: job.current.lock().ok().and_then(|c| c.clone()),
        hashed_bytes: job.hashed.load(Ordering::Relaxed),
        hash_total_bytes: job.hash_total.load(Ordering::Relaxed),
        files: job.files.lock().map(|f| f.clone()).unwrap_or_default(),
        error: job.error.lock().ok().and_then(|e| e.clone()),
    }
}

/// A chat model's own folder: an absolute path, and only a `.gguf` in it.
fn dest_dir_file(dest_dir: &str, filename: &str) -> Option<PathBuf> {
    let dir = PathBuf::from(dest_dir);
    if !dir.is_absolute() || dest_dir.split(['/', '\\']).any(|s| s == "..") {
        return None;
    }
    let base = sanitize_filename(filename);
    if base.is_empty() || !base.to_ascii_lowercase().ends_with(".gguf") {
        return None;
    }
    Some(dir.join(base))
}

/// The file names Check files and Repair may act on: model weights, nothing
/// else. Keeps `trash_model_file` from being a way to bin any file at all.
fn is_model_file_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".safetensors", ".gguf", ".ckpt", ".pt", ".pth", ".bin", ".sft", ".onnx"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

async fn resolve_path(state: &State<'_, AppState>, req: &VerifyFileRequest) -> Option<PathBuf> {
    if !is_model_file_name(&req.filename) {
        return None;
    }
    if let Some(dir) = req.dest_dir.as_deref().filter(|d| !d.trim().is_empty()) {
        return dest_dir_file(dir, &req.filename);
    }
    let sub = req.subfolder.as_deref()?;
    model_file_path(state, sub, &req.filename).await.ok().flatten()
}

/// Start a check. Answers `{ id }` at once; the work runs in the background.
#[tauri::command]
pub async fn verify_model_files(
    files: Vec<VerifyFileRequest>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    if files.is_empty() {
        return Err("No files to check.".to_string());
    }
    let mut resolved: Vec<(Resolved, Option<String>)> = Vec::with_capacity(files.len());
    for req in &files {
        let path = resolve_path(&state, req).await;
        let sha256 = req
            .sha256
            .as_deref()
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()));
        resolved.push((
            Resolved { filename: req.filename.clone(), path, exact: req.expected_bytes.filter(|n| *n > 0), sha256 },
            req.url.clone(),
        ));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let job = Arc::new(Job::new());
    register(&id, Arc::clone(&job));
    tokio::spawn(async move {
        // The host's exact size, only for a file that is there and whose
        // catalog entry states none. Offline this is "cannot tell", quickly.
        let mut files: Vec<Resolved> = Vec::with_capacity(resolved.len());
        for (mut r, url) in resolved {
            if job.cancel.load(Ordering::Relaxed) {
                break;
            }
            if r.exact.is_none() && r.path.as_deref().and_then(file_len).is_some() {
                if let Some(u) = url.as_deref() {
                    r.exact = exact_remote_size(u).await;
                }
            }
            files.push(r);
        }
        let worker = Arc::clone(&job);
        let outcome = if job.cancel.load(Ordering::Relaxed) {
            Ok(Ok(None))
        } else {
            tokio::task::spawn_blocking(move || {
                verify_resolved(&files, &worker.cancel, &worker.hashed, &worker.hash_total, &worker.current)
            })
            .await
        };
        let mut status = job.status.lock().unwrap_or_else(|p| p.into_inner());
        match outcome {
            Ok(Ok(Some(verdicts))) => {
                if let Ok(mut f) = job.files.lock() {
                    *f = verdicts;
                }
                *status = "done";
            }
            Ok(Ok(None)) => *status = "cancelled",
            Ok(Err(e)) => {
                if let Ok(mut slot) = job.error.lock() {
                    *slot = Some(e);
                }
                *status = "error";
            }
            Err(e) => {
                if let Ok(mut slot) = job.error.lock() {
                    *slot = Some(e.to_string());
                }
                *status = "error";
            }
        }
    });
    Ok(serde_json::json!({ "id": id }))
}

/// Progress and, once it is done, the verdicts of a check.
#[tauri::command]
pub fn verify_model_files_status(id: String) -> Result<VerifyJobView, String> {
    let job = find(&id).ok_or_else(|| "This check is not running any more.".to_string())?;
    Ok(view(&id, &job))
}

/// Stop a running check. The file being hashed is left alone.
#[tauri::command]
pub fn verify_model_files_cancel(id: String) -> Result<serde_json::Value, String> {
    if let Some(job) = find(&id) {
        job.cancel.store(true, Ordering::Relaxed);
    }
    Ok(serde_json::json!({ "cancelled": true }))
}

/// Move one broken model file to the Trash before Repair fetches it again.
/// Never a permanent delete: a file the check called wrong may still be the
/// user's own, and the Trash gives it back.
#[tauri::command]
#[allow(non_snake_case)]
pub async fn trash_model_file(
    filename: String,
    subfolder: Option<String>,
    destDir: Option<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let req = VerifyFileRequest {
        filename: filename.clone(),
        subfolder,
        dest_dir: destDir,
        url: None,
        expected_bytes: None,
        sha256: None,
    };
    let path = resolve_path(&state, &req)
        .await
        .ok_or_else(|| format!("{} is not a model file LU can move.", filename))?;
    trash_one(&path, crate::commands::mlx_outputs::system_trash)
}

/// The Trash step on its own, so the rule (only an existing file, only to the
/// bin) can be proven without a system Trash.
pub fn trash_one(path: &Path, bin: impl FnOnce(&Path) -> Result<(), String>) -> Result<serde_json::Value, String> {
    if !path.is_file() {
        return Ok(serde_json::json!({ "trashed": false, "missing": true }));
    }
    let bin_name = if cfg!(windows) { "Recycle Bin" } else { "Trash" };
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    bin(path).map_err(|e| format!("Could not move {} to the {}: {}", name, bin_name, e))?;
    println!("[Verify] Moved {} to the {}", path.display(), bin_name);
    Ok(serde_json::json!({ "trashed": true, "missing": false }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const EMPTY_SHA: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    // sha256("hello world")
    const HELLO_SHA: &str = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

    fn run(files: &[Resolved]) -> Vec<FileVerdict> {
        let cancel = AtomicBool::new(false);
        let hashed = AtomicU64::new(0);
        let total = AtomicU64::new(0);
        let current = Mutex::new(None);
        verify_resolved(files, &cancel, &hashed, &total, &current).unwrap().unwrap()
    }

    fn file(dir: &Path, name: &str, body: &[u8]) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, body).unwrap();
        p
    }

    #[test]
    fn the_size_decides_before_any_byte_is_read() {
        assert_eq!(precheck(None, None, Some(10), true), Precheck::Done(FileState::Missing));
        assert_eq!(precheck(None, Some(4), Some(10), true), Precheck::Done(FileState::Incomplete));
        assert_eq!(precheck(Some(9), None, Some(10), true), Precheck::Done(FileState::WrongSize));
        assert_eq!(precheck(Some(10), None, Some(10), true), Precheck::Hash);
        assert_eq!(precheck(Some(10), None, Some(10), false), Precheck::Done(FileState::Ok));
        // No exact size anywhere: a digest can still decide, nothing else can.
        assert_eq!(precheck(Some(10), None, None, true), Precheck::Hash);
        assert_eq!(precheck(Some(10), None, None, false), Precheck::Done(FileState::Unconfirmed));
        // A zero is no size.
        assert_eq!(precheck(Some(10), None, Some(0), false), Precheck::Done(FileState::Unconfirmed));
    }

    #[test]
    fn the_partial_is_the_download_twin_with_its_extension_replaced() {
        assert_eq!(partial_of(Path::new("/m/vae/wan.safetensors")), PathBuf::from("/m/vae/wan.download"));
        assert_eq!(partial_of(Path::new("/m/x.mmproj.gguf")), PathBuf::from("/m/x.mmproj.download"));
    }

    #[test]
    fn every_state_comes_out_of_one_check() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let ok = file(d, "ok.safetensors", b"hello world");
        let bad = file(d, "bad.safetensors", b"hello wOrld");
        let short = file(d, "short.safetensors", b"hello");
        let sized = file(d, "sized.safetensors", b"abc");
        let loose = file(d, "loose.safetensors", b"abc");
        // Only the partial of an aborted transfer.
        std::fs::write(d.join("half.download"), b"hel").unwrap();
        let files = vec![
            Resolved { filename: "ok.safetensors".into(), path: Some(ok), exact: Some(11), sha256: Some(HELLO_SHA.into()) },
            Resolved { filename: "bad.safetensors".into(), path: Some(bad), exact: Some(11), sha256: Some(HELLO_SHA.into()) },
            Resolved { filename: "short.safetensors".into(), path: Some(short), exact: Some(11), sha256: Some(HELLO_SHA.into()) },
            Resolved { filename: "sized.safetensors".into(), path: Some(sized), exact: Some(3), sha256: None },
            Resolved { filename: "loose.safetensors".into(), path: Some(loose), exact: None, sha256: None },
            Resolved { filename: "half.safetensors".into(), path: Some(d.join("half.safetensors")), exact: Some(11), sha256: None },
            Resolved { filename: "gone.safetensors".into(), path: Some(d.join("gone.safetensors")), exact: Some(11), sha256: None },
            // A name that was refused resolves to no path and counts as missing.
            Resolved { filename: "../evil.safetensors".into(), path: None, exact: None, sha256: None },
        ];
        let v = run(&files);
        let states: Vec<FileState> = v.iter().map(|f| f.state).collect();
        assert_eq!(
            states,
            vec![
                FileState::Ok,
                FileState::WrongChecksum,
                FileState::WrongSize,
                FileState::Ok,
                FileState::Unconfirmed,
                FileState::Incomplete,
                FileState::Missing,
                FileState::Missing,
            ]
        );
        assert_eq!(v[0].checked, "sha256");
        assert_eq!(v[1].checked, "sha256");
        assert_eq!(v[2].checked, "size", "a wrong size is never hashed");
        assert_eq!(v[3].checked, "size");
        assert_eq!(v[4].checked, "none");
        assert_eq!(v[5].partial_bytes, Some(3));
        assert_eq!(v[2].actual_bytes, 5);
        assert_eq!(v[2].expected_bytes, Some(11));
    }

    #[test]
    fn a_digest_in_capitals_is_the_same_digest() {
        let dir = tempfile::tempdir().unwrap();
        let p = file(dir.path(), "e.safetensors", b"");
        let v = run(&[Resolved { filename: "e".into(), path: Some(p), exact: None, sha256: Some(EMPTY_SHA.to_uppercase()) }]);
        assert_eq!(v[0].state, FileState::Ok);
    }

    #[test]
    fn hashing_streams_in_pieces_and_counts_every_byte() {
        let dir = tempfile::tempdir().unwrap();
        // Bigger than one 4 MiB piece, so the stream really is read in parts.
        let body: Vec<u8> = (0..(9u32 << 20)).map(|i| (i % 251) as u8).collect();
        let p = file(dir.path(), "big.safetensors", &body);
        let expected = format!("{:x}", Sha256::digest(&body));
        let cancel = AtomicBool::new(false);
        let progress = AtomicU64::new(0);
        assert_eq!(hash_file(&p, &cancel, &progress).unwrap().as_deref(), Some(expected.as_str()));
        assert_eq!(progress.load(Ordering::Relaxed), body.len() as u64);

        // And the job's own counters see the same total.
        let hashed = AtomicU64::new(0);
        let total = AtomicU64::new(0);
        let current = Mutex::new(None);
        let files = [Resolved { filename: "big".into(), path: Some(p), exact: Some(body.len() as u64), sha256: Some(expected) }];
        let v = verify_resolved(&files, &cancel, &hashed, &total, &current).unwrap().unwrap();
        assert_eq!(v[0].state, FileState::Ok);
        assert_eq!(total.load(Ordering::Relaxed), body.len() as u64);
        assert_eq!(hashed.load(Ordering::Relaxed), body.len() as u64);
        assert_eq!(*current.lock().unwrap(), None, "nothing is named once the check is done");
    }

    #[test]
    fn a_cancelled_check_stops_and_answers_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let p = file(dir.path(), "x.safetensors", b"hello world");
        let cancel = AtomicBool::new(true);
        let progress = AtomicU64::new(0);
        assert_eq!(hash_file(&p, &cancel, &progress).unwrap(), None);
        assert_eq!(progress.load(Ordering::Relaxed), 0);
        let hashed = AtomicU64::new(0);
        let total = AtomicU64::new(0);
        let current = Mutex::new(None);
        let files = [Resolved { filename: "x".into(), path: Some(p), exact: Some(11), sha256: Some(HELLO_SHA.into()) }];
        assert!(verify_resolved(&files, &cancel, &hashed, &total, &current).unwrap().is_none());
    }

    #[test]
    fn only_model_files_in_a_plain_absolute_folder_are_touched() {
        assert!(is_model_file_name("wan.safetensors"));
        assert!(is_model_file_name("M.Q4_K_M.GGUF"));
        assert!(!is_model_file_name("notes.txt"));
        assert!(!is_model_file_name("wan.download"));
        let abs = if cfg!(windows) { "C:\\models" } else { "/models" };
        assert!(dest_dir_file(abs, "m.gguf").is_some());
        assert!(dest_dir_file(abs, "m.safetensors").is_none(), "the chat lane holds GGUFs only");
        assert!(dest_dir_file("relative/dir", "m.gguf").is_none());
        assert!(dest_dir_file(&format!("{abs}/../etc"), "m.gguf").is_none());
        // A path in the name keeps only its last part.
        assert_eq!(dest_dir_file(abs, "../../x/m.gguf").unwrap(), PathBuf::from(abs).join("m.gguf"));
    }

    #[test]
    fn the_bin_takes_an_existing_file_and_nothing_is_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let p = file(dir.path(), "w.safetensors", b"abc");
        let mut binned: Option<PathBuf> = None;
        let out = trash_one(&p, |f| {
            binned = Some(f.to_path_buf());
            Ok(())
        })
        .unwrap();
        assert_eq!(out["trashed"], true);
        assert_eq!(binned.as_deref(), Some(p.as_path()));
        // The fake bin moved nothing, and nothing else removed the file.
        assert!(p.is_file());

        let gone = trash_one(&dir.path().join("none.safetensors"), |_| panic!("no bin for a missing file")).unwrap();
        assert_eq!(gone["missing"], true);

        let refused = trash_one(&p, |_| Err("no bin here".into())).unwrap_err();
        assert!(refused.contains("no bin here"), "{refused}");
        assert!(p.is_file(), "a bin that refuses leaves the file where it was");
    }

    #[test]
    fn a_finished_job_list_stays_small() {
        for i in 0..(KEEP_FINISHED + 5) {
            let j = Arc::new(Job::new());
            *j.status.lock().unwrap() = "done";
            register(&format!("t-{i}"), j);
        }
        let running = Arc::new(Job::new());
        register("t-running", Arc::clone(&running));
        let n = JOBS.lock().unwrap().len();
        assert!(n <= KEEP_FINISHED + 1, "{n}");
        assert!(find("t-running").is_some());
        let v = verify_model_files_status("t-running".into()).unwrap();
        assert_eq!(v.status, "running");
        verify_model_files_cancel("t-running".into()).unwrap();
        assert!(running.cancel.load(Ordering::Relaxed));
    }
}
