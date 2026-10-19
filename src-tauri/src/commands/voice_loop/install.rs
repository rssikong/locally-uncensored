//! The voice setup: a private Python, a venv with the locked packages, and
//! the models, each verified before it counts.
//!
//! One background job at a time. Every step first looks at what is already
//! there and only does what is missing, so a second run after a cancel, a
//! lost connection or a closed app continues instead of starting over, and a
//! run on a complete installation does nothing.
//!
//! Why a private Python. The sidecar needs CPython 3.11 or 3.12. The app's
//! own `install_python` installs 3.12 through winget on Windows only and has
//! nothing for macOS and Linux, and a Python found on the machine can be 3.10
//! or 3.13, an x86 build on an Apple silicon Mac, a Debian build without
//! `venv`, or gone after the next system update. A self-contained build from
//! python-build-standalone (the builds `uv` installs) is 22 to 34 MB next to
//! 700 MB of packages and models, is the same interpreter on every customer
//! machine, and is removed with the rest by uninstall. `python.json` pins it
//! with size and sha256 per platform.

use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::commands::install::pip::pip_install_streaming_with_retry_cancellable;
use crate::commands::install::sha256_file;
use crate::os_error;
use crate::state::InstallState;

use super::fetch::{self, FetchError};
use super::layout::{self, VoiceDirs};
use super::manifest::{self, ModelManifest, PythonBuild, PythonManifest};

/// The packages whose pinned versions the status shows.
pub const REPORTED_PACKAGES: &[&str] = &["pipecat-ai", "faster-whisper", "pocket-tts", "torch", "uvicorn"];

// Estimates, shown as such. The lock file does not carry sizes; these were
// measured with the lock of 06.10.2026 on macOS arm64 and differ a little per
// platform.
const PACKAGES_DOWNLOAD_ESTIMATE: u64 = 335_000_000;
const PACKAGES_DISK_ESTIMATE: u64 = 1_100_000_000;

/// Bytes done and bytes in all for the bar of the packages step.
///
/// pip announces the size of a wheel only when it gets to it, so its own
/// total starts at a few kilobytes and grows. Measured against that, the bar
/// stood at 100 percent after four seconds and then fell to 3 (box,
/// 07.10.2026). The estimate of the whole step is the floor of the total.
/// Once pip unpacks, which takes minutes and counts nothing, there are no
/// numbers: the bar pulses instead of standing at 100.
fn packages_meter(done: u64, announced: u64, unpacking: bool) -> (u64, u64) {
    if unpacking {
        return (0, 0);
    }
    (done, announced.max(PACKAGES_DOWNLOAD_ESTIMATE))
}

/// Has pip moved on from downloading to unpacking? Read from its own lines,
/// newest first: a run that downloads again after an earlier one unpacked
/// (pip upgrades itself first) is downloading.
fn unpacking(pip_lines: &[String]) -> bool {
    for line in pip_lines.iter().rev() {
        if crate::commands::install::pip::pip_downloads_finished(line) {
            return true;
        }
        if crate::commands::install::pip::parse_pip_download_size(line).is_some() {
            return false;
        }
    }
    false
}
/// The unpacked Python is about this many times its archive.
const PYTHON_UNPACK_FACTOR: u64 = 4;
/// Kept free on top of what the setup writes.
const SPACE_RESERVE: u64 = 250_000_000;

const CANCELLED: &str = "cancelled";
const LOG_LINES: usize = 200;

// ── marker ──────────────────────────────────────────────────────────────────

/// What the setup has finished, so the next run and the status do not have to
/// hash 373 MB of models or start an interpreter to find out.
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct Marker {
    /// Version of the private Python the venv was built from.
    #[serde(default)]
    pub python_version: String,
    /// sha256 of the `requirements.txt` that was installed. Empty until pip
    /// has finished, different after an app update with a new lock.
    #[serde(default)]
    pub requirements_sha256: String,
    /// Model path to the sha256 it was verified against.
    #[serde(default)]
    pub verified_models: BTreeMap<String, String>,
    /// The voice the user chose. Empty until one was chosen, which reads as
    /// the default voice.
    #[serde(default)]
    pub voice: String,
}

impl Marker {
    /// A missing or unreadable marker is an empty one: everything is checked
    /// again, nothing is assumed.
    pub fn load(dirs: &VoiceDirs) -> Marker {
        std::fs::read_to_string(dirs.marker())
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, dirs: &VoiceDirs) -> Result<(), String> {
        let write = || -> std::io::Result<()> {
            std::fs::create_dir_all(&dirs.root)?;
            let tmp = dirs.marker().with_extension("json.tmp");
            std::fs::write(&tmp, serde_json::to_vec_pretty(self).unwrap_or_default())?;
            std::fs::rename(&tmp, dirs.marker())
        };
        write().map_err(|e| {
            format!(
                "The voice setup could not save its progress in {}: {}. Check the folder permissions and the free space.",
                dirs.root.display(),
                os_error::io_english(&e)
            )
        })
    }
}

// ── job ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    #[default]
    Idle,
    Running,
    Complete,
    Cancelled,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    #[default]
    Idle,
    Checking,
    Python,
    Environment,
    Packages,
    Models,
    Done,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstallSnapshot {
    pub status: JobStatus,
    pub phase: Phase,
    /// One sentence for the headline of the setup panel.
    pub message: String,
    /// The file being downloaded, when one is.
    pub current_file: Option<String>,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub bytes_per_second: u64,
    /// The setup's own lines, oldest first.
    pub logs: Vec<String>,
    /// The last lines pip printed, while the packages are installed.
    pub detail: Vec<String>,
    pub error: Option<String>,
}

#[derive(Default)]
struct JobState {
    snapshot: InstallSnapshot,
    logs: VecDeque<String>,
    rate_mark: Option<(Instant, u64)>,
}

#[derive(Clone, Default)]
pub struct InstallJob {
    state: Arc<Mutex<JobState>>,
    cancel: Arc<AtomicBool>,
    /// The existing pip runner reports into this shape.
    pip: Arc<Mutex<InstallState>>,
}

impl InstallJob {
    fn lock(&self) -> MutexGuard<'_, JobState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn is_running(&self) -> bool {
        self.lock().snapshot.status == JobStatus::Running
    }

    /// Claim the job. False when a setup is already running.
    pub fn begin(&self) -> bool {
        let mut st = self.lock();
        if st.snapshot.status == JobStatus::Running {
            return false;
        }
        *st = JobState::default();
        st.snapshot.status = JobStatus::Running;
        st.snapshot.phase = Phase::Checking;
        st.snapshot.message = "Checking what is already installed.".to_string();
        self.cancel.store(false, Ordering::SeqCst);
        *self.pip.lock().unwrap_or_else(|e| e.into_inner()) = InstallState::default();
        true
    }

    /// Ask a running setup to stop. It ends at the next chunk or pip poll.
    pub fn cancel(&self) {
        if self.is_running() {
            self.cancel.store(true, Ordering::SeqCst);
        }
    }

    /// Back to idle, after an uninstall.
    pub fn reset(&self) {
        let mut st = self.lock();
        if st.snapshot.status != JobStatus::Running {
            *st = JobState::default();
        }
    }

    pub fn snapshot(&self) -> InstallSnapshot {
        let st = self.lock();
        let mut snap = st.snapshot.clone();
        snap.logs = st.logs.iter().cloned().collect();
        if snap.status == JobStatus::Running && snap.phase == Phase::Packages {
            let pip = self.pip.lock().unwrap_or_else(|e| e.into_inner());
            (snap.bytes_done, snap.bytes_total) = packages_meter(pip.download_progress, pip.download_total, unpacking(&pip.logs));
            snap.bytes_per_second = pip.download_speed.max(0.0) as u64;
            let skip = pip.logs.len().saturating_sub(30);
            snap.detail = pip.logs.iter().skip(skip).cloned().collect();
        }
        snap
    }

    fn check_cancel(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::SeqCst) {
            Err(CANCELLED.to_string())
        } else {
            Ok(())
        }
    }

    fn enter(&self, phase: Phase, message: impl Into<String>) {
        let message = message.into();
        tracing::info!(?phase, "voice setup: {message}");
        let mut st = self.lock();
        st.snapshot.phase = phase;
        st.snapshot.message = message.clone();
        st.snapshot.current_file = None;
        st.snapshot.bytes_done = 0;
        st.snapshot.bytes_total = 0;
        st.snapshot.bytes_per_second = 0;
        st.rate_mark = None;
        push_log(&mut st.logs, message);
    }

    fn log(&self, line: impl Into<String>) {
        push_log(&mut self.lock().logs, line.into());
    }

    fn set_file(&self, name: &str) {
        self.lock().snapshot.current_file = Some(name.to_string());
    }

    fn set_bytes(&self, done: u64, total: u64) {
        let mut st = self.lock();
        st.snapshot.bytes_done = done.min(total);
        st.snapshot.bytes_total = total;
        let now = Instant::now();
        match st.rate_mark {
            None => st.rate_mark = Some((now, done)),
            Some((at, before)) if now.duration_since(at) >= Duration::from_millis(700) => {
                let secs = now.duration_since(at).as_secs_f64().max(0.001);
                st.snapshot.bytes_per_second = (done.saturating_sub(before) as f64 / secs) as u64;
                st.rate_mark = Some((now, done));
            }
            _ => {}
        }
    }

    pub(crate) fn finish(&self, result: Result<(), String>) {
        let mut st = self.lock();
        st.snapshot.bytes_per_second = 0;
        st.snapshot.current_file = None;
        match result {
            Ok(()) => {
                st.snapshot.status = JobStatus::Complete;
                st.snapshot.phase = Phase::Done;
                st.snapshot.message = "The voice loop is installed.".to_string();
                push_log(&mut st.logs, "The voice loop is installed.".to_string());
            }
            Err(e) if e == CANCELLED => {
                st.snapshot.status = JobStatus::Cancelled;
                st.snapshot.message =
                    "The setup was cancelled. Start it again to continue where it stopped.".to_string();
                push_log(&mut st.logs, "Cancelled.".to_string());
            }
            Err(e) => {
                tracing::error!("voice setup failed: {e}");
                st.snapshot.status = JobStatus::Error;
                st.snapshot.message = "The voice setup did not finish.".to_string();
                st.snapshot.error = Some(e.clone());
                push_log(&mut st.logs, format!("Error: {e}"));
            }
        }
    }
}

fn push_log(logs: &mut VecDeque<String>, line: String) {
    if logs.len() == LOG_LINES {
        logs.pop_front();
    }
    logs.push_back(line);
}

// ── what is there, what is needed ───────────────────────────────────────────

/// A command on the private interpreter. `python_command` gives it UTF-8 I/O
/// and no console window on Windows; the user's global Python settings are
/// taken away so they cannot change what it imports.
pub(crate) fn private_python(exe: &Path) -> std::process::Command {
    let mut cmd = crate::python::python_command(exe);
    cmd.env_remove("PYTHONHOME").env_remove("PYTHONPATH").stdin(Stdio::null());
    cmd
}

fn python_exe(dirs: &VoiceDirs, build: &PythonBuild) -> PathBuf {
    build.exe.split('/').fold(dirs.python_home(), |path, part| path.join(part))
}

/// `3.12.15`, asked of the interpreter itself.
fn interpreter_version(exe: &Path) -> Option<String> {
    if !exe.is_file() {
        return None;
    }
    let out = private_python(exe)
        .args(["-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"])
        .stderr(Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !text.is_empty()).then_some(text)
}

fn requirements_path(sidecar_dir: &Path) -> PathBuf {
    sidecar_dir.join("requirements.txt")
}

fn model_path(dirs: &VoiceDirs, relative: &str) -> PathBuf {
    relative.split('/').fold(dirs.models(), |path, part| path.join(part))
}

fn has_size(path: &Path, size: u64) -> bool {
    std::fs::metadata(path).map(|m| m.is_file() && m.len() == size).unwrap_or(false)
}

/// The parts of an installation, from files only. No interpreter is started
/// and no model is hashed, so the status can ask on every poll.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub python: bool,
    pub packages: bool,
    pub models: bool,
    pub complete: bool,
}

pub fn installed(dirs: &VoiceDirs, sidecar_dir: &Path) -> Installed {
    let marker = Marker::load(dirs);
    let python = dirs.venv_python().is_file() && dirs.python_home().is_dir() && !marker.python_version.is_empty();
    let packages = python
        && !marker.requirements_sha256.is_empty()
        && sha256_file(&requirements_path(sidecar_dir)).is_ok_and(|now| now == marker.requirements_sha256);
    let models = ModelManifest::load(sidecar_dir).is_ok_and(|all| {
        chosen_models(&all, &marker).files().all(|f| is_verified(dirs, &marker, f))
    });
    Installed { python, packages, models, complete: python && packages && models }
}

/// The models of this installation: every model and the voice the user chose.
fn chosen_models(all: &ModelManifest, marker: &Marker) -> ModelManifest {
    all.with_voice(&all.resolve_voice(&marker.voice))
}

/// The file is on disk in full and was checked against the sha256 the list names.
fn is_verified(dirs: &VoiceDirs, marker: &Marker, file: &manifest::ModelFile) -> bool {
    marker.verified_models.get(&file.path) == Some(&file.remote.sha256)
        && has_size(&model_path(dirs, &file.path), file.remote.size)
}

/// One voice the user can choose.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceChoice {
    /// The name the sidecar knows the voice by.
    pub name: String,
    pub license: String,
    /// Credit line the license asks for.
    pub attribution: Option<String>,
    pub bytes: u64,
    /// The file is on disk and verified, so choosing it downloads nothing.
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonNeed {
    pub version: String,
    pub installed: bool,
    pub download_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagesNeed {
    pub installed: bool,
    /// Measured once, not read from the lock: shown as "about".
    pub download_bytes_estimate: u64,
    pub disk_bytes_estimate: u64,
    pub versions: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelNeed {
    pub id: String,
    pub name: String,
    pub role: String,
    pub license: String,
    pub attribution: Option<String>,
    pub bytes: u64,
    pub installed: bool,
}

/// What a setup would download and write right now.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Requirements {
    pub supported: bool,
    pub unsupported_reason: Option<String>,
    pub installed: bool,
    pub install_dir: String,
    pub python: Option<PythonNeed>,
    pub packages: PackagesNeed,
    /// The models of this installation: of the voices only the chosen one.
    pub models: Vec<ModelNeed>,
    pub models_bytes: u64,
    /// The voice the answers are spoken in.
    pub voice: String,
    /// Every voice LU offers.
    pub voices: Vec<VoiceChoice>,
    /// Everything that is still to be downloaded. Contains the estimate for
    /// the packages when they are not installed yet.
    pub download_bytes: u64,
    /// Free space the setup needs to finish, with a reserve.
    pub disk_bytes_needed: u64,
    pub disk_bytes_free: Option<u64>,
    pub enough_space: bool,
}

/// `platform` is the result of [`layout::platform_support`] and `free` the
/// free space on the drive of the voice folder; both are passed in so the
/// arithmetic is testable.
pub fn requirements(
    dirs: &VoiceDirs,
    sidecar_dir: &Path,
    platform: Result<&str, String>,
    free: Option<u64>,
) -> Result<Requirements, String> {
    let all_models = ModelManifest::load(sidecar_dir)?;
    let python_manifest = PythonManifest::load(sidecar_dir)?;
    let lock = std::fs::read_to_string(requirements_path(sidecar_dir)).map_err(|e| {
        format!("The voice loop file requirements.txt could not be read: {}. Reinstall LU to restore it.", os_error::io_english(&e))
    })?;
    let marker = Marker::load(dirs);
    let have = installed(dirs, sidecar_dir);
    let voice = all_models.resolve_voice(&marker.voice);
    let models = all_models.with_voice(&voice);
    let voices: Vec<VoiceChoice> = all_models
        .voices()
        .map(|entry| VoiceChoice {
            name: entry.voice().unwrap_or_default().to_string(),
            license: entry.license.clone(),
            attribution: entry.attribution.clone(),
            bytes: entry.bytes(),
            installed: entry.files.iter().all(|f| is_verified(dirs, &marker, f)),
        })
        .collect();

    let mut download = 0u64;
    let mut disk = 0u64;

    let (supported, unsupported_reason, build) = match &platform {
        Ok(target) => match python_manifest.build_for(target) {
            Ok(build) => (true, None, Some(build)),
            Err(e) => (false, Some(e), None),
        },
        Err(reason) => (false, Some(reason.clone()), None),
    };
    let python = build.map(|build| {
        let installed = have.python && marker.python_version == python_manifest.version;
        if !installed {
            download += build.remote.size;
            disk += build.remote.size * (1 + PYTHON_UNPACK_FACTOR);
        }
        PythonNeed { version: python_manifest.version.clone(), installed, download_bytes: build.remote.size }
    });

    if !have.packages {
        download += PACKAGES_DOWNLOAD_ESTIMATE;
        disk += PACKAGES_DOWNLOAD_ESTIMATE + PACKAGES_DISK_ESTIMATE;
    }

    let model_needs: Vec<ModelNeed> = models
        .models
        .iter()
        .map(|entry| {
            let mut installed = true;
            for file in &entry.files {
                let dest = model_path(dirs, &file.path);
                let verified = marker.verified_models.get(&file.path) == Some(&file.remote.sha256)
                    && has_size(&dest, file.remote.size);
                if !verified {
                    installed = false;
                    // A finished file that only lacks its check costs nothing,
                    // a partial one costs the rest.
                    let on_disk = if has_size(&dest, file.remote.size) {
                        file.remote.size
                    } else {
                        std::fs::metadata(layout::twin(&dest)).map(|m| m.len().min(file.remote.size)).unwrap_or(0)
                    };
                    download += file.remote.size - on_disk;
                    disk += file.remote.size - on_disk;
                }
            }
            ModelNeed {
                id: entry.id.clone(),
                name: entry.name.clone(),
                role: entry.role.clone(),
                license: entry.license.clone(),
                attribution: entry.attribution.clone(),
                bytes: entry.bytes(),
                installed,
            }
        })
        .collect();

    let disk_bytes_needed = if disk == 0 { 0 } else { disk + SPACE_RESERVE };
    Ok(Requirements {
        supported,
        unsupported_reason,
        installed: have.complete,
        install_dir: dirs.root.display().to_string(),
        python,
        packages: PackagesNeed {
            installed: have.packages,
            download_bytes_estimate: PACKAGES_DOWNLOAD_ESTIMATE,
            disk_bytes_estimate: PACKAGES_DISK_ESTIMATE,
            versions: manifest::pinned_versions(&lock, REPORTED_PACKAGES),
        },
        models_bytes: models.total_bytes(),
        models: model_needs,
        voice,
        voices,
        download_bytes: download,
        disk_bytes_needed,
        disk_bytes_free: free,
        enough_space: free.is_none_or(|f| f >= disk_bytes_needed),
    })
}

/// Megabytes the way the setup panel counts them (formatBytes in the
/// interface): 1 MB is 1,048,576 bytes. The headline of a step and the row of
/// the same download stand a few lines apart and have to show one number.
fn megabytes(bytes: u64) -> u64 {
    const MB: u64 = 1024 * 1024;
    (bytes + MB / 2) / MB
}

pub fn free_space(dirs: &VoiceDirs) -> Option<u64> {
    crate::commands::download::available_space_for(&dirs.root)
}

// ── the steps ───────────────────────────────────────────────────────────────

/// Remove a file or a folder, whatever is there. Nothing there is fine.
pub(crate) fn remove_tree(path: &Path) -> Result<(), String> {
    let attempt = |path: &Path| -> std::io::Result<()> {
        match std::fs::symlink_metadata(path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
            Ok(meta) if meta.is_dir() => std::fs::remove_dir_all(path),
            Ok(_) => std::fs::remove_file(path),
        }
    };
    let Err(first) = attempt(path) else { return Ok(()) };
    // Windows refuses to delete a read-only file, and a virus scanner can
    // hold a fresh file for a moment. Clear the flag, wait, try once more.
    for entry in walkdir::WalkDir::new(path).into_iter().flatten() {
        if let Ok(meta) = entry.metadata() {
            let mut perms = meta.permissions();
            if perms.readonly() && !meta.is_dir() {
                #[allow(clippy::permissions_set_readonly_false)]
                perms.set_readonly(false);
                let _ = std::fs::set_permissions(entry.path(), perms);
            }
        }
    }
    std::thread::sleep(Duration::from_millis(400));
    attempt(path).map_err(|second| {
        let e = if second.kind() == std::io::ErrorKind::NotFound { first } else { second };
        format!(
            "Could not remove {}: {}. Close any program that is using the voice files and try again.",
            path.display(),
            os_error::io_english(&e)
        )
    })
}

/// Rename, with patience: a scanner that is still reading a folder that was
/// unpacked a second ago makes the first tries fail on Windows.
pub(crate) fn rename_patiently(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut last = None;
    for _ in 0..12 {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => last = Some(e),
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err(last.unwrap_or_else(|| std::io::Error::other("rename failed")))
}

fn fetch_blocking(
    runtime: &tokio::runtime::Runtime,
    job: &InstallJob,
    remote: &manifest::RemoteFile,
    dest: &Path,
    what: &str,
    on_progress: &mut (dyn FnMut(u64) + Send),
) -> Result<(), String> {
    let client = fetch::http_client()?;
    runtime
        .block_on(fetch::fetch_verified(&client, remote, dest, &job.cancel, on_progress))
        .map_err(|e: FetchError| e.user_message(what))
}

pub(crate) fn unpack_python(archive: &Path, into: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(into)?;
    let file = std::fs::File::open(archive)?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(std::io::BufReader::new(file)));
    tar.set_overwrite(true);
    // `unpack` refuses entries that would land outside `into`.
    tar.unpack(into)
}

fn ensure_python(
    dirs: &VoiceDirs,
    manifest: &PythonManifest,
    build: &PythonBuild,
    job: &InstallJob,
    runtime: &tokio::runtime::Runtime,
    marker: &mut Marker,
) -> Result<PathBuf, String> {
    let exe = python_exe(dirs, build);
    if interpreter_version(&exe).as_deref() == Some(manifest.version.as_str()) {
        job.log(format!("Python {} is already there.", manifest.version));
        if marker.python_version != manifest.version {
            // The interpreter is right but the record is not: the venv may be
            // from another one. Build it again to be sure.
            remove_tree(&dirs.venv())?;
            marker.python_version = manifest.version.clone();
            marker.requirements_sha256.clear();
            marker.save(dirs)?;
        }
        return Ok(exe);
    }

    job.enter(
        Phase::Python,
        format!("Downloading Python {} ({} MB).", manifest.version, megabytes(build.remote.size)),
    );
    // The venv points into the interpreter that is about to be replaced.
    marker.python_version.clear();
    marker.requirements_sha256.clear();
    marker.save(dirs)?;
    remove_tree(&dirs.venv())?;
    remove_tree(&dirs.python_home())?;
    remove_tree(&dirs.python_unpack())?;

    let archive = dirs.python_archive();
    job.set_file("Python");
    let total = build.remote.size;
    let progress_job = job.clone();
    fetch_blocking(runtime, job, &build.remote, &archive, "Python", &mut move |done| {
        progress_job.set_bytes(done, total)
    })?;
    job.check_cancel()?;

    job.log("Unpacking Python.");
    let unpacked = dirs.python_unpack();
    let moved = unpack_python(&archive, &unpacked)
        .and_then(|()| rename_patiently(&unpacked.join("python"), &dirs.python_home()));
    if let Err(e) = moved {
        let _ = remove_tree(&unpacked);
        return Err(format!(
            "Python could not be unpacked into {}: {}. Check the free space and that no security program blocks the folder, then run the setup again.",
            dirs.root.display(),
            os_error::io_english(&e)
        ));
    }
    remove_tree(&unpacked)?;
    remove_tree(&archive)?;

    match interpreter_version(&exe) {
        Some(found) if found == manifest.version => {
            marker.python_version = found;
            marker.save(dirs)?;
            Ok(exe)
        }
        _ => Err(format!(
            "The downloaded Python could not be started from {}. A security program may be blocking it. Allow the folder and run the setup again.",
            dirs.python_home().display()
        )),
    }
}

pub(crate) fn venv_works(dirs: &VoiceDirs) -> bool {
    dirs.venv().join("pyvenv.cfg").is_file() && interpreter_version(&dirs.venv_python()).is_some()
}

fn ensure_venv(dirs: &VoiceDirs, python: &Path, job: &InstallJob, marker: &mut Marker) -> Result<(), String> {
    if venv_works(dirs) {
        return Ok(());
    }
    job.enter(Phase::Environment, "Creating the Python environment.");
    marker.requirements_sha256.clear();
    marker.save(dirs)?;
    remove_tree(&dirs.venv())?;
    let out = private_python(python)
        .args(["-m", "venv"])
        .arg(dirs.venv())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| {
            format!("The Python environment could not be created: {}. Run the setup again.", os_error::io_english(&e))
        })?;
    if !out.status.success() || !venv_works(dirs) {
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        let _ = remove_tree(&dirs.venv());
        return Err(format!(
            "The Python environment could not be created in {}. Check the free space and the folder permissions, then run the setup again.\n\n{}",
            dirs.venv().display(),
            tail(&os_error::english_child_text(&text), 12)
        ));
    }
    Ok(())
}

fn tail(text: &str, lines: usize) -> String {
    let all: Vec<&str> = text.lines().map(str::trim_end).filter(|l| !l.is_empty()).collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

/// The arguments of the one pip run. The lock file names the indexes itself.
pub(crate) fn pip_args(requirements: &Path, cache: &Path) -> Vec<String> {
    [
        "-m", "pip", "install",
        "--progress-bar", "off",
        "--no-input",
        "--disable-pip-version-check",
        // Nothing is compiled on a customer machine. docopt is pure Python
        // and ships no wheel, the lock allows exactly that one.
        "--only-binary", ":all:",
        "--no-binary", "docopt",
        "--cache-dir",
    ]
    .iter()
    .map(|s| s.to_string())
    .chain([cache.to_string_lossy().to_string(), "-r".to_string(), requirements.to_string_lossy().to_string()])
    .collect()
}

/// What the models step says. `on_disk` is a repair of an installation whose
/// model files are all there at their full size: every file is hashed again
/// and nothing is downloaded unless a hash is wrong.
fn models_headline(on_disk: bool, total: u64) -> String {
    if on_disk {
        "Checking the voice models.".to_string()
    } else {
        format!("Downloading the voice models ({} MB).", megabytes(total))
    }
}

/// The imports the sidecar needs at start. A package that installed but does
/// not load (a missing system library) is found here and not in a session.
const IMPORT_CHECK: &str = "import pipecat, faster_whisper, pocket_tts, uvicorn, torch, onnxruntime";

/// What the packages step says. `in_place` is a repair of an installation
/// whose packages are all there: it checks and does not download.
fn packages_headline(in_place: bool) -> String {
    if in_place {
        "Checking the voice packages.".to_string()
    } else {
        format!("Installing the voice packages (about {} MB).", megabytes(PACKAGES_DOWNLOAD_ESTIMATE))
    }
}

fn ensure_packages(
    dirs: &VoiceDirs,
    sidecar_dir: &Path,
    job: &InstallJob,
    marker: &mut Marker,
    force: bool,
) -> Result<(), String> {
    let requirements = requirements_path(sidecar_dir);
    let lock_digest = sha256_file(&requirements)?;
    if !force && marker.requirements_sha256 == lock_digest {
        job.log("The packages are already installed.");
        return Ok(());
    }
    // A repair of a complete installation downloads nothing: pip finds every
    // pinned package in place and only what is missing is fetched again.
    job.enter(Phase::Packages, packages_headline(marker.requirements_sha256 == lock_digest));
    marker.requirements_sha256.clear();
    marker.save(dirs)?;

    let python = dirs.venv_python().to_string_lossy().to_string();
    let args = pip_args(&requirements, &dirs.pip_cache());
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    pip_install_streaming_with_retry_cancellable(&arg_refs, &python, 3, &job.pip, Some(&job.cancel)).map_err(
        |diagnosis| {
            if diagnosis == CANCELLED {
                diagnosis
            } else {
                format!("The voice packages could not be installed. Run the setup again; finished downloads are kept.\n\n{diagnosis}")
            }
        },
    )?;
    job.check_cancel()?;

    job.log("Checking that the packages load.");
    let out = private_python(&dirs.venv_python())
        .args(["-c", IMPORT_CHECK])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("The installed packages could not be checked: {}.", os_error::io_english(&e)))?;
    if !out.status.success() {
        let text = String::from_utf8_lossy(&out.stderr).to_string();
        let hint = if cfg!(windows) && text.contains("DLL load failed") {
            " Install the Microsoft Visual C++ Redistributable (x64) from Microsoft, restart the computer and run the setup again."
        } else {
            " Run the setup again with the repair option."
        };
        return Err(format!(
            "The voice packages were installed but do not load.{hint}\n\n{}",
            tail(&os_error::english_child_text(&text), 8)
        ));
    }

    marker.requirements_sha256 = lock_digest;
    marker.save(dirs)?;
    // The wheels are installed, the cache has done its job.
    let _ = remove_tree(&dirs.pip_cache());
    Ok(())
}

fn ensure_models(
    dirs: &VoiceDirs,
    manifest: &ModelManifest,
    job: &InstallJob,
    runtime: &tokio::runtime::Runtime,
    marker: &mut Marker,
    force: bool,
) -> Result<(), String> {
    let total = manifest.total_bytes();
    if force {
        marker.verified_models.clear();
    }
    let known = |marker: &Marker, f: &manifest::ModelFile| is_verified(dirs, marker, f);
    if manifest.files().all(|f| known(marker, f)) {
        job.log("The voice models are already installed.");
        return Ok(());
    }

    let on_disk = manifest.files().all(|f| has_size(&model_path(dirs, &f.path), f.remote.size));
    job.enter(Phase::Models, models_headline(on_disk, total));
    let mut done_before = 0u64;
    for entry in &manifest.models {
        for file in &entry.files {
            job.check_cancel()?;
            let dest = model_path(dirs, &file.path);
            if !known(marker, file) {
                marker.verified_models.remove(&file.path);
                job.set_file(&entry.name);
                let base = done_before;
                let progress_job = job.clone();
                let what = format!("{} ({})", entry.name, file.path);
                fetch_blocking(runtime, job, &file.remote, &dest, &what, &mut move |done| {
                    progress_job.set_bytes(base + done, total)
                })?;
                marker.verified_models.insert(file.path.clone(), file.remote.sha256.clone());
                marker.save(dirs)?;
            }
            done_before += file.remote.size;
            job.set_bytes(done_before, total);
        }
        job.log(format!("{} is ready.", entry.name));
    }
    Ok(())
}

/// Run the whole setup on the calling thread.
///
/// `platform` is the release target of this machine, or the reason it is not
/// supported. With `force` (the repair) pip goes through the lock again, which
/// fetches only what is missing, the packages are loaded once, and every model
/// is hashed again: the repair for an installation that looks complete and
/// does not work.
pub fn run_install(
    dirs: &VoiceDirs,
    sidecar_dir: &Path,
    job: &InstallJob,
    platform: Result<&str, String>,
    force: bool,
) -> Result<(), String> {
    let target = platform?;
    let all_models = ModelManifest::load(sidecar_dir)?;
    let python_manifest = PythonManifest::load(sidecar_dir)?;
    let build = python_manifest.build_for(target)?;

    let need = requirements(dirs, sidecar_dir, Ok(target), free_space(dirs))?;
    if !need.enough_space {
        return Err(format!(
            "Not enough free space for the voice setup. It needs about {} MB on the drive that holds {}, and {} MB are free. Free some space and run the setup again.",
            megabytes(need.disk_bytes_needed),
            dirs.root.display(),
            megabytes(need.disk_bytes_free.unwrap_or(0))
        ));
    }
    std::fs::create_dir_all(&dirs.root).map_err(|e| {
        format!(
            "The voice folder {} could not be created: {}. Check the folder permissions.",
            dirs.root.display(),
            os_error::io_english(&e)
        )
    })?;

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("The voice setup could not start its downloader: {}.", os_error::io_english(&e)))?;
    let mut marker = Marker::load(dirs);

    job.check_cancel()?;
    let python = ensure_python(dirs, &python_manifest, build, job, &runtime, &mut marker)?;
    job.check_cancel()?;
    ensure_venv(dirs, &python, job, &mut marker)?;
    job.check_cancel()?;
    ensure_packages(dirs, sidecar_dir, job, &mut marker, force)?;
    job.check_cancel()?;
    // Drop records of files the list no longer names or names differently.
    // Measured against the whole list: a voice that is installed and not the
    // chosen one keeps its record, so choosing it again costs no download.
    marker
        .verified_models
        .retain(|path, digest| all_models.files().any(|f| &f.path == path && &f.remote.sha256 == digest));
    let models = chosen_models(&all_models, &marker);
    ensure_models(dirs, &models, job, &runtime, &mut marker, force)?;
    Ok(())
}

/// Make `voice` the voice of this installation.
///
/// Before the first setup this only records the choice; the setup then
/// fetches that voice with everything else. On an installed engine the one
/// missing file is fetched first, under the same rules as every other
/// download (resumable, verified against the sha256 of the list), and the
/// choice is recorded only when it is there. Nothing else is installed again,
/// and a running sidecar picks the voice up at the next session.
pub fn select_voice(dirs: &VoiceDirs, sidecar_dir: &Path, voice: &str, job: &InstallJob) -> Result<(), String> {
    let all_models = ModelManifest::load(sidecar_dir)?;
    let engine_installed = installed(dirs, sidecar_dir).complete;
    select_voice_from(dirs, &all_models, engine_installed, voice, job)
}

fn select_voice_from(
    dirs: &VoiceDirs,
    all_models: &ModelManifest,
    engine_installed: bool,
    voice: &str,
    job: &InstallJob,
) -> Result<(), String> {
    let entry = all_models
        .voice_entry(voice)
        .ok_or_else(|| format!("LU has no voice named {voice}. Pick one from the list."))?;
    let mut marker = Marker::load(dirs);
    if engine_installed {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("The voice could not be downloaded: {}.", os_error::io_english(&e)))?;
        for file in &entry.files {
            if is_verified(dirs, &marker, file) {
                continue;
            }
            marker.verified_models.remove(&file.path);
            let what = format!("the voice {voice} ({})", file.path);
            fetch_blocking(&runtime, job, &file.remote, &model_path(dirs, &file.path), &what, &mut |_| {})
                .map_err(voice_wording)?;
            marker.verified_models.insert(file.path.clone(), file.remote.sha256.clone());
            marker.save(dirs)?;
        }
    }
    marker.voice = voice.to_string();
    marker.save(dirs)
}

/// The download errors speak of the setup. Here the user picked a voice.
fn voice_wording(message: String) -> String {
    message
        .replace("run the setup again", "pick the voice again")
        .replace("Run the setup again", "Pick the voice again")
        .replace("Try the setup again", "Pick the voice again")
}

/// The voice of the installation in `dirs`, for the session that is about to start.
pub fn chosen_voice(dirs: &VoiceDirs, sidecar_dir: &Path) -> String {
    let marker = Marker::load(dirs);
    match ModelManifest::load(sidecar_dir) {
        Ok(all) => all.resolve_voice(&marker.voice),
        Err(_) => marker.voice,
    }
}

/// Start the setup in the background. False when one is already running.
pub fn spawn_install(dirs: VoiceDirs, sidecar_dir: PathBuf, job: InstallJob, force: bool) -> bool {
    if !job.begin() {
        return false;
    }
    std::thread::spawn(move || {
        let result = run_install(&dirs, &sidecar_dir, &job, layout::this_platform(), force);
        job.finish(result);
    });
    true
}

/// Remove everything the setup wrote. The caller has stopped the sidecar.
pub fn uninstall(dirs: &VoiceDirs) -> Result<(), String> {
    for entry in dirs.owned_entries() {
        remove_tree(&entry)?;
    }
    // Only when nothing else is in it: the folder is ours, its unknown
    // contents are not.
    let _ = std::fs::remove_dir(&dirs.root);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_repair_of_complete_models_says_checking_and_names_no_download() {
        // Seen on Windows: the repair hashed 356 MB of files that were all
        // there and the headline said "Downloading the voice models".
        assert_eq!(models_headline(true, 356_000_000), "Checking the voice models.");
        let fresh = models_headline(false, 356_000_000);
        assert!(fresh.starts_with("Downloading the voice models ("), "{fresh}");
        assert!(fresh.ends_with(" MB)."), "{fresh}");
    }

    #[test]
    fn a_repair_of_complete_packages_says_checking_and_names_no_download() {
        assert_eq!(packages_headline(true), "Checking the voice packages.");
        let fresh = packages_headline(false);
        assert!(fresh.starts_with("Installing the voice packages (about "), "{fresh}");
        assert!(fresh.ends_with(" MB)."), "{fresh}");
    }
    use crate::commands::voice_loop::fetch::test_server;

    fn sha(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
    }

    /// A sidecar directory with a manifest of our own and the real lock.
    fn sidecar_with(models_json: &str) -> tempfile::TempDir {
        let real = Path::new(env!("CARGO_MANIFEST_DIR")).join(layout::SIDECAR_RESOURCE_PATH);
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("models.json"), models_json).unwrap();
        for name in ["python.json", "requirements.txt"] {
            std::fs::copy(real.join(name), tmp.path().join(name)).unwrap();
        }
        tmp
    }

    fn two_models(url_a: &str, a: &[u8], url_b: &str, b: &[u8]) -> String {
        format!(
            r#"{{"schema":1,"models":[
              {{"id":"stt","role":"stt","name":"Speech model","license":"MIT","revision":"r1","files":[
                {{"path":"stt/a.bin","url":"{url_a}","size":{},"sha256":"{}"}}]}},
              {{"id":"tts","role":"tts","name":"Voice model","license":"CC-BY-4.0","attribution":"By someone.","revision":"r2","files":[
                {{"path":"tts/deep/b.bin","url":"{url_b}","size":{},"sha256":"{}"}}]}}]}}"#,
            a.len(),
            sha(a),
            b.len(),
            sha(b)
        )
    }

    fn body(len: usize, salt: u8) -> Vec<u8> {
        (0..len).map(|i| (i % 251) as u8 ^ salt).collect()
    }

    /// Pretend Python and packages are installed, so a test can look at the
    /// model step alone.
    fn fake_python_and_packages(dirs: &VoiceDirs, sidecar_dir: &Path) {
        std::fs::create_dir_all(dirs.python_home()).unwrap();
        std::fs::create_dir_all(dirs.venv_python().parent().unwrap()).unwrap();
        std::fs::write(dirs.venv_python(), b"").unwrap();
        let manifest = PythonManifest::load(sidecar_dir).unwrap();
        let mut marker = Marker::load(dirs);
        marker.python_version = manifest.version;
        marker.requirements_sha256 = sha256_file(&requirements_path(sidecar_dir)).unwrap();
        marker.save(dirs).unwrap();
    }

    // The manifest refuses plain http, the loopback test server has nothing
    // else. The model step is driven directly with a manifest built here.
    fn loopback_manifest(text: &str) -> ModelManifest {
        ModelManifest::parse(&text.replace("http://127.0.0.1", "https://127.0.0.1"))
            .map(|mut m| {
                for entry in &mut m.models {
                    for file in &mut entry.files {
                        file.remote.url = file.remote.url.replace("https://127.0.0.1", "http://127.0.0.1");
                    }
                }
                m
            })
            .unwrap()
    }

    fn server_runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_multi_thread().worker_threads(1).enable_all().build().unwrap()
    }

    fn client_runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap()
    }

    // ── marker ──────────────────────────────────────────────────────────

    #[test]
    fn the_marker_survives_a_round_trip_and_a_broken_one_reads_as_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        assert_eq!(Marker::load(&dirs), Marker::default());
        let mut marker = Marker { python_version: "3.12.15".into(), requirements_sha256: "abc".into(), ..Default::default() };
        marker.verified_models.insert("stt/a.bin".into(), "f00".into());
        marker.save(&dirs).unwrap();
        assert_eq!(Marker::load(&dirs), marker);
        std::fs::write(dirs.marker(), b"{half a file").unwrap();
        assert_eq!(Marker::load(&dirs), Marker::default());
    }

    // ── job ─────────────────────────────────────────────────────────────

    #[test]
    fn only_one_setup_runs_at_a_time() {
        let job = InstallJob::default();
        assert_eq!(job.snapshot().status, JobStatus::Idle);
        assert!(job.begin());
        assert!(!job.begin(), "a second setup must not start next to the first");
        assert!(job.is_running());
        job.finish(Ok(()));
        let snap = job.snapshot();
        assert_eq!((snap.status, snap.phase), (JobStatus::Complete, Phase::Done));
        assert!(job.begin(), "a finished job can run again");
    }

    #[test]
    fn a_cancelled_run_is_not_an_error_and_an_error_keeps_its_sentence() {
        let job = InstallJob::default();
        job.begin();
        job.cancel();
        assert!(job.check_cancel().is_err());
        job.finish(Err(CANCELLED.to_string()));
        let snap = job.snapshot();
        assert_eq!(snap.status, JobStatus::Cancelled);
        assert!(snap.error.is_none());
        assert!(snap.message.contains("continue"));

        // The next run starts with a clear flag.
        job.begin();
        assert!(job.check_cancel().is_ok());
        job.finish(Err("The download server refused Python (HTTP 500). Try the setup again later.".to_string()));
        let snap = job.snapshot();
        assert_eq!(snap.status, JobStatus::Error);
        assert!(snap.error.unwrap().contains("HTTP 500"));
    }

    #[test]
    fn cancel_on_an_idle_job_does_not_poison_the_next_run() {
        let job = InstallJob::default();
        job.cancel();
        assert!(!job.cancel.load(Ordering::SeqCst));
    }

    #[test]
    fn the_snapshot_serialises_for_the_frontend() {
        let job = InstallJob::default();
        job.begin();
        job.enter(Phase::Models, "Downloading the voice models (373 MB).");
        job.set_file("Speech model");
        job.set_bytes(10, 100);
        let json = serde_json::to_value(job.snapshot()).unwrap();
        assert_eq!(json["status"], "running");
        assert_eq!(json["phase"], "models");
        assert_eq!(json["currentFile"], "Speech model");
        assert_eq!(json["bytesDone"], 10);
        assert_eq!(json["bytesTotal"], 100);
        assert!(json["logs"].as_array().unwrap().iter().any(|l| l.as_str().unwrap().contains("373 MB")));
    }

    #[test]
    fn while_packages_install_the_snapshot_shows_pips_numbers_and_lines() {
        let job = InstallJob::default();
        job.begin();
        job.enter(Phase::Packages, "Installing the voice packages.");
        {
            let mut pip = job.pip.lock().unwrap();
            pip.download_progress = 50;
            pip.download_total = 200;
            pip.logs.push("Downloading torch-2.14.1 (80.1 MB)".to_string());
        }
        let snap = job.snapshot();
        assert_eq!((snap.bytes_done, snap.bytes_total), (50, PACKAGES_DOWNLOAD_ESTIMATE));
        assert_eq!(snap.detail, ["Downloading torch-2.14.1 (80.1 MB)"]);
    }

    #[test]
    fn the_bar_of_the_packages_step_neither_starts_full_nor_stands_at_the_end() {
        // Four seconds in: one small file announced and read. Not 100 percent.
        assert_eq!(packages_meter(3_700, 3_700, false), (3_700, PACKAGES_DOWNLOAD_ESTIMATE));
        // The total only grows past the estimate when pip announces more than expected.
        assert_eq!(packages_meter(10, PACKAGES_DOWNLOAD_ESTIMATE + 5, false), (10, PACKAGES_DOWNLOAD_ESTIMATE + 5));
        // Unpacking has no numbers.
        assert_eq!(packages_meter(320_000_000, 320_000_000, true), (0, 0));

        let lines = |l: &[&str]| l.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(!unpacking(&lines(&["Collecting torch", "Downloading torch-2.14.1 (80.1 MB)"])));
        assert!(unpacking(&lines(&["Downloading torch-2.14.1 (80.1 MB)", "Successfully built docopt", "Installing collected packages: torch"])));
        // pip upgraded itself first, then the real run downloads.
        assert!(!unpacking(&lines(&["Installing collected packages: pip", "Successfully installed pip-25", "Downloading av-19.0.1 (28.1 MB)"])));
        assert!(!unpacking(&[]));
    }

    #[test]
    fn the_log_keeps_the_newest_lines() {
        let job = InstallJob::default();
        job.begin();
        for i in 0..(LOG_LINES + 50) {
            job.log(format!("line {i}"));
        }
        let logs = job.snapshot().logs;
        assert_eq!(logs.len(), LOG_LINES);
        assert_eq!(logs.last().unwrap(), &format!("line {}", LOG_LINES + 49));
    }

    // ── pip arguments ───────────────────────────────────────────────────

    #[test]
    fn pip_installs_the_lock_from_wheels_only() {
        let args = pip_args(Path::new("/app dir/requirements.txt"), Path::new("/data/voice/pip-cache"));
        assert_eq!(&args[..3], ["-m", "pip", "install"]);
        let pair = |flag: &str| args.iter().position(|a| a == flag).map(|i| args[i + 1].as_str());
        assert_eq!(pair("--only-binary"), Some(":all:"));
        assert_eq!(pair("--no-binary"), Some("docopt"));
        assert_eq!(pair("--cache-dir"), Some("/data/voice/pip-cache"));
        // A path with a space stays one argument.
        assert_eq!(pair("-r"), Some("/app dir/requirements.txt"));
        assert!(args.contains(&"--no-input".to_string()));
        // No package and no version of its own: the lock file is the source.
        assert!(!args.iter().any(|a| a.contains("==")));
    }

    #[test]
    fn the_command_in_the_lock_files_header_is_the_one_that_runs() {
        let real = Path::new(env!("CARGO_MANIFEST_DIR")).join(layout::SIDECAR_RESOURCE_PATH).join("requirements.txt");
        let header = std::fs::read_to_string(real).unwrap();
        assert!(
            header.contains("pip install --only-binary :all: --no-binary docopt -r requirements.txt"),
            "requirements.txt documents a different install command"
        );
    }

    // ── requirements report ─────────────────────────────────────────────

    #[test]
    fn a_fresh_machine_is_told_everything_it_will_download() {
        let a = body(1000, 1);
        let b = body(3000, 2);
        let sidecar = sidecar_with(&two_models("https://e.org/a", &a, "https://e.org/b", &b));
        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        let need = requirements(&dirs, sidecar.path(), Ok("aarch64-apple-darwin"), Some(u64::MAX)).unwrap();
        assert!(need.supported && !need.installed && need.enough_space);
        let python = need.python.as_ref().unwrap();
        assert!(!python.installed && python.download_bytes > 10 << 20);
        assert_eq!(need.models_bytes, 4000);
        assert_eq!(need.models.len(), 2);
        assert!(need.models.iter().all(|m| !m.installed));
        assert_eq!(need.models[1].attribution.as_deref(), Some("By someone."));
        assert_eq!(need.download_bytes, python.download_bytes + PACKAGES_DOWNLOAD_ESTIMATE + 4000);
        assert!(need.disk_bytes_needed > need.download_bytes);
        assert!(need.packages.versions.contains_key("torch"));
        assert!(need.install_dir.ends_with("voice"));
    }

    // ── voices ──────────────────────────────────────────────────────────

    /// A speech model and three voices; `urls` are where the voices are fetched from.
    fn model_and_voices(urls: [&str; 3], bodies: [&[u8]; 3]) -> String {
        let base = body(900, 9);
        let mut entries = vec![format!(
            r#"{{"id":"tts","role":"tts","name":"Speech","license":"MIT","revision":"r","files":[{{"path":"tts/model.bin","url":"https://e.org/model","size":{},"sha256":"{}"}}]}}"#,
            base.len(),
            sha(&base)
        )];
        for ((name, url), data) in ["alba", "anna", "paul"].iter().zip(urls).zip(bodies) {
            entries.push(format!(
                r#"{{"id":"tts-voice-{name}","role":"tts-voice","name":"{name}","license":"CC0-1.0","attribution":"Voice {name}.","revision":"r","files":[{{"path":"tts/{name}.bin","url":"{url}","size":{},"sha256":"{}"}}]}}"#,
                data.len(),
                sha(data)
            ));
        }
        format!(r#"{{"schema":1,"models":[{}]}}"#, entries.join(","))
    }

    /// Put a file where the setup would have, with its record.
    fn place(dirs: &VoiceDirs, marker: &mut Marker, path: &str, data: &[u8]) {
        let dest = model_path(dirs, path);
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::write(&dest, data).unwrap();
        marker.verified_models.insert(path.to_string(), sha(data));
    }

    #[test]
    fn the_setup_counts_one_voice_and_offers_all_of_them() {
        let (a, b, c) = (body(100, 1), body(200, 2), body(300, 3));
        let sidecar = sidecar_with(&model_and_voices(["https://e.org/a", "https://e.org/b", "https://e.org/c"], [&a, &b, &c]));
        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));

        let need = requirements(&dirs, sidecar.path(), Ok("aarch64-apple-darwin"), Some(u64::MAX)).unwrap();
        assert_eq!(need.voice, "alba");
        assert_eq!(need.models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["tts", "tts-voice-alba"]);
        assert_eq!(need.models_bytes, 900 + 100);
        assert_eq!(need.voices.iter().map(|v| v.name.as_str()).collect::<Vec<_>>(), ["alba", "anna", "paul"]);
        assert!(need.voices.iter().all(|v| !v.installed));
        assert_eq!(need.voices[2].bytes, 300);
        assert_eq!(need.voices[1].attribution.as_deref(), Some("Voice anna."));

        // Chosen before the first setup: only the choice is written, and the
        // setup then counts that voice and not the default.
        let job = InstallJob::default();
        select_voice(&dirs, sidecar.path(), "paul", &job).unwrap();
        assert_eq!(Marker::load(&dirs).voice, "paul");
        assert!(!model_path(&dirs, "tts/paul.bin").exists());
        let need = requirements(&dirs, sidecar.path(), Ok("aarch64-apple-darwin"), Some(u64::MAX)).unwrap();
        assert_eq!(need.voice, "paul");
        assert_eq!(need.models_bytes, 900 + 300);
        assert_eq!(need.models[1].id, "tts-voice-paul");
        assert_eq!(chosen_voice(&dirs, sidecar.path()), "paul");
    }

    #[test]
    fn a_voice_that_is_not_in_the_list_is_refused_and_changes_nothing() {
        let a = body(100, 1);
        let sidecar = sidecar_with(&model_and_voices(["https://e.org/a", "https://e.org/b", "https://e.org/c"], [&a, &a, &a]));
        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        let err = select_voice(&dirs, sidecar.path(), "nobody", &InstallJob::default()).unwrap_err();
        assert_eq!(err, "LU has no voice named nobody. Pick one from the list.");
        assert!(!dirs.root.exists());
        assert_eq!(chosen_voice(&dirs, sidecar.path()), "alba");
    }

    #[test]
    fn installed_means_the_chosen_voice_and_not_every_voice() {
        let (a, b, c) = (body(100, 1), body(200, 2), body(300, 3));
        let sidecar = sidecar_with(&model_and_voices(["https://e.org/a", "https://e.org/b", "https://e.org/c"], [&a, &b, &c]));
        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        fake_python_and_packages(&dirs, sidecar.path());
        let mut marker = Marker::load(&dirs);
        place(&dirs, &mut marker, "tts/model.bin", &body(900, 9));
        place(&dirs, &mut marker, "tts/alba.bin", &a);
        marker.save(&dirs).unwrap();
        assert!(installed(&dirs, sidecar.path()).complete);

        // The choice moves to a voice that is not there: not complete, and
        // the report names what is missing.
        marker.voice = "anna".into();
        marker.save(&dirs).unwrap();
        assert!(!installed(&dirs, sidecar.path()).models);
        let need = requirements(&dirs, sidecar.path(), Ok("aarch64-apple-darwin"), Some(u64::MAX)).unwrap();
        assert_eq!(need.download_bytes, 200);
        assert_eq!(need.voices.iter().map(|v| v.installed).collect::<Vec<_>>(), [true, false, false]);
    }

    #[test]
    fn choosing_a_voice_on_an_installed_engine_fetches_that_one_file_and_nothing_else() {
        let server_rt = server_runtime();
        let (a, b, c) = (body(100, 1), body(70_000, 2), body(300, 3));
        let server_b = server_rt.block_on(test_server::start(b.clone()));
        let all = loopback_manifest(&model_and_voices(["http://127.0.0.1:9/a", &server_b.url, "http://127.0.0.1:9/c"], [&a, &b, &c]));
        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice dir with spaces"));
        let mut marker = Marker::default();
        place(&dirs, &mut marker, "tts/model.bin", &body(900, 9));
        place(&dirs, &mut marker, "tts/alba.bin", &a);
        marker.save(&dirs).unwrap();
        let job = InstallJob::default();

        select_voice_from(&dirs, &all, true, "anna", &job).unwrap();
        assert_eq!(std::fs::read(model_path(&dirs, "tts/anna.bin")).unwrap(), b);
        let saved = Marker::load(&dirs);
        assert_eq!(saved.voice, "anna");
        assert_eq!(saved.verified_models.len(), 3);
        // The speech model and the old voice were not touched.
        assert_eq!(std::fs::read(model_path(&dirs, "tts/alba.bin")).unwrap(), a);
        assert!(!model_path(&dirs, "tts/paul.bin").exists());

        // Back to the first voice and on to the second again: both are there,
        // nothing is requested.
        let before = server_b.ranges.lock().unwrap().len();
        select_voice_from(&dirs, &all, true, "alba", &job).unwrap();
        select_voice_from(&dirs, &all, true, "anna", &job).unwrap();
        assert_eq!(server_b.ranges.lock().unwrap().len(), before);
        assert_eq!(Marker::load(&dirs).voice, "anna");
    }

    #[test]
    fn a_voice_that_does_not_arrive_as_pinned_is_not_chosen() {
        let server_rt = server_runtime();
        let (a, b) = (body(100, 1), body(70_000, 2));
        // The server hands out other bytes than the list pins.
        let server_b = server_rt.block_on(test_server::start(body(70_000, 7)));
        let all = loopback_manifest(&model_and_voices(["http://127.0.0.1:9/a", &server_b.url, "http://127.0.0.1:9/c"], [&a, &b, &a]));
        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        let mut marker = Marker::default();
        place(&dirs, &mut marker, "tts/alba.bin", &a);
        marker.voice = "alba".into();
        marker.save(&dirs).unwrap();

        let err = select_voice_from(&dirs, &all, true, "anna", &InstallJob::default()).unwrap_err();
        assert!(err.contains("the voice anna") && err.contains("Pick the voice again"), "{err}");
        assert!(!err.contains("setup"), "{err}");
        assert!(!model_path(&dirs, "tts/anna.bin").exists(), "an unverified file must not stay");
        let saved = Marker::load(&dirs);
        assert_eq!(saved.voice, "alba");
        assert!(!saved.verified_models.contains_key("tts/anna.bin"));
    }

    #[test]
    fn a_marker_from_before_voices_reads_as_the_default_voice() {
        let marker: Marker = serde_json::from_str(r#"{"python_version":"3.12.15","requirements_sha256":"abc","verified_models":{}}"#).unwrap();
        assert_eq!(marker.voice, "");
        let a = body(10, 1);
        let all = ModelManifest::parse(&model_and_voices(["https://e.org/a", "https://e.org/b", "https://e.org/c"], [&a, &a, &a])).unwrap();
        assert_eq!(chosen_models(&all, &marker).models.len(), 2);
        assert_eq!(chosen_models(&all, &marker).models[1].id, "tts-voice-alba");
    }

    #[test]
    fn too_little_space_is_reported_before_anything_is_downloaded() {
        let a = body(10, 1);
        let sidecar = sidecar_with(&two_models("https://e.org/a", &a, "https://e.org/b", &a));
        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        let need = requirements(&dirs, sidecar.path(), Ok("x86_64-pc-windows-msvc"), Some(50_000_000)).unwrap();
        assert!(!need.enough_space);
        assert_eq!(need.disk_bytes_free, Some(50_000_000));
        // Unknown free space does not block: the setup would rather try.
        assert!(requirements(&dirs, sidecar.path(), Ok("x86_64-pc-windows-msvc"), None).unwrap().enough_space);
    }

    #[test]
    fn an_unsupported_machine_gets_the_reason_and_still_the_list() {
        let a = body(10, 1);
        let sidecar = sidecar_with(&two_models("https://e.org/a", &a, "https://e.org/b", &a));
        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        let reason = layout::platform_support("macos", "x86_64", Some("15.0")).map(|_| "").unwrap_err();
        let need = requirements(&dirs, sidecar.path(), Err(reason), Some(u64::MAX)).unwrap();
        assert!(!need.supported);
        assert!(need.unsupported_reason.unwrap().contains("Apple silicon"));
        assert!(need.python.is_none());
        assert_eq!(need.models.len(), 2);
    }

    #[test]
    fn a_partial_model_only_counts_its_missing_rest() {
        let a = body(1000, 1);
        let b = body(3000, 2);
        let sidecar = sidecar_with(&two_models("https://e.org/a", &a, "https://e.org/b", &b));
        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        fake_python_and_packages(&dirs, sidecar.path());
        let dest = model_path(&dirs, "tts/deep/b.bin");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::write(layout::twin(&dest), &b[..2500]).unwrap();
        let need = requirements(&dirs, sidecar.path(), Ok("aarch64-apple-darwin"), Some(u64::MAX)).unwrap();
        assert_eq!(need.download_bytes, 1000 + 500);
        assert!(need.python.unwrap().installed && need.packages.installed);
    }

    // ── installed ───────────────────────────────────────────────────────

    #[test]
    fn installed_needs_every_part_and_notices_a_new_lock() {
        let a = body(1000, 1);
        let b = body(3000, 2);
        let sidecar = sidecar_with(&two_models("https://e.org/a", &a, "https://e.org/b", &b));
        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        assert_eq!(installed(&dirs, sidecar.path()), Installed { python: false, packages: false, models: false, complete: false });

        fake_python_and_packages(&dirs, sidecar.path());
        let state = installed(&dirs, sidecar.path());
        assert!(state.python && state.packages && !state.models && !state.complete);

        let mut marker = Marker::load(&dirs);
        for (path, data) in [("stt/a.bin", &a), ("tts/deep/b.bin", &b)] {
            let dest = model_path(&dirs, path);
            std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
            std::fs::write(&dest, data).unwrap();
            marker.verified_models.insert(path.to_string(), sha(data));
        }
        marker.save(&dirs).unwrap();
        assert!(installed(&dirs, sidecar.path()).complete);

        // A model file that lost bytes is not installed any more.
        std::fs::write(model_path(&dirs, "stt/a.bin"), &a[..10]).unwrap();
        assert!(!installed(&dirs, sidecar.path()).models);
        std::fs::write(model_path(&dirs, "stt/a.bin"), &a).unwrap();

        // An app update with a new lock: the packages have to be installed again.
        let mut lock = std::fs::read(requirements_path(sidecar.path())).unwrap();
        lock.extend_from_slice(b"\n# changed\n");
        std::fs::write(requirements_path(sidecar.path()), lock).unwrap();
        let state = installed(&dirs, sidecar.path());
        assert!(state.python && !state.packages && state.models && !state.complete);
    }

    // ── model step against a local server ───────────────────────────────

    #[test]
    fn models_are_downloaded_verified_recorded_and_not_fetched_twice() {
        let server_rt = server_runtime();
        let a = body(120_000, 1);
        let b = body(260_000, 2);
        let server_a = server_rt.block_on(test_server::start(a.clone()));
        let server_b = server_rt.block_on(test_server::start(b.clone()));
        let manifest = loopback_manifest(&two_models(&server_a.url, &a, &server_b.url, &b));

        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice dir with spaces"));
        let job = InstallJob::default();
        job.begin();
        let mut marker = Marker::default();
        ensure_models(&dirs, &manifest, &job, &client_runtime(), &mut marker, false).unwrap();

        assert_eq!(std::fs::read(model_path(&dirs, "stt/a.bin")).unwrap(), a);
        assert_eq!(std::fs::read(model_path(&dirs, "tts/deep/b.bin")).unwrap(), b);
        assert_eq!(Marker::load(&dirs).verified_models.len(), 2);
        let snap = job.snapshot();
        assert_eq!((snap.bytes_done, snap.bytes_total), (380_000, 380_000));

        // Again: nothing is requested.
        let before = (server_a.ranges.lock().unwrap().len(), server_b.ranges.lock().unwrap().len());
        ensure_models(&dirs, &manifest, &job, &client_runtime(), &mut marker, false).unwrap();
        assert_eq!((server_a.ranges.lock().unwrap().len(), server_b.ranges.lock().unwrap().len()), before);
    }

    #[test]
    fn a_half_finished_model_download_is_repaired_by_the_next_run() {
        let server_rt = server_runtime();
        let a = body(120_000, 1);
        let b = body(260_000, 2);
        let server_a = server_rt.block_on(test_server::start(a.clone()));
        let server_b = server_rt.block_on(test_server::start(b.clone()));
        let manifest = loopback_manifest(&two_models(&server_a.url, &a, &server_b.url, &b));

        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        // What a closed app leaves: one file done but never recorded, one cut short.
        let dest_a = model_path(&dirs, "stt/a.bin");
        let dest_b = model_path(&dirs, "tts/deep/b.bin");
        std::fs::create_dir_all(dest_a.parent().unwrap()).unwrap();
        std::fs::create_dir_all(dest_b.parent().unwrap()).unwrap();
        std::fs::write(&dest_a, &a).unwrap();
        std::fs::write(layout::twin(&dest_b), &b[..200_000]).unwrap();

        let job = InstallJob::default();
        job.begin();
        let mut marker = Marker::default();
        ensure_models(&dirs, &manifest, &job, &client_runtime(), &mut marker, false).unwrap();

        // The finished file was hashed and accepted without a request, the
        // partial one was continued and not started over.
        assert!(server_a.ranges.lock().unwrap().is_empty());
        assert_eq!(*server_b.ranges.lock().unwrap(), vec![Some("bytes=200000-".to_string())]);
        assert_eq!(std::fs::read(&dest_b).unwrap(), b);
        assert_eq!(marker.verified_models.len(), 2);
    }

    #[test]
    fn a_corrupt_model_is_deleted_reported_and_the_good_one_is_kept() {
        let server_rt = server_runtime();
        let a = body(50_000, 1);
        let b = body(70_000, 2);
        let server_a = server_rt.block_on(test_server::start(a.clone()));
        // The server hands out other bytes than the manifest pins.
        let server_b = server_rt.block_on(test_server::start(body(70_000, 9)));
        let manifest = loopback_manifest(&two_models(&server_a.url, &a, &server_b.url, &b));

        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        let job = InstallJob::default();
        job.begin();
        let mut marker = Marker::default();
        let err = ensure_models(&dirs, &manifest, &job, &client_runtime(), &mut marker, false).unwrap_err();
        assert!(err.contains("checksum") && err.contains("deleted") && err.contains("Voice model"), "{err}");

        let dest_b = model_path(&dirs, "tts/deep/b.bin");
        assert!(!dest_b.exists() && !layout::twin(&dest_b).exists());
        assert!(model_path(&dirs, "stt/a.bin").exists());
        let saved = Marker::load(&dirs);
        assert_eq!(saved.verified_models.keys().collect::<Vec<_>>(), ["stt/a.bin"]);
    }

    #[test]
    fn repair_hashes_again_and_replaces_a_file_that_was_changed_on_disk() {
        let server_rt = server_runtime();
        let a = body(50_000, 1);
        let b = body(70_000, 2);
        let server_a = server_rt.block_on(test_server::start(a.clone()));
        let server_b = server_rt.block_on(test_server::start(b.clone()));
        let manifest = loopback_manifest(&two_models(&server_a.url, &a, &server_b.url, &b));
        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        let job = InstallJob::default();
        job.begin();
        let mut marker = Marker::default();
        ensure_models(&dirs, &manifest, &job, &client_runtime(), &mut marker, false).unwrap();

        // Same size, other content: the marker still vouches for it.
        std::fs::write(model_path(&dirs, "stt/a.bin"), body(50_000, 7)).unwrap();
        ensure_models(&dirs, &manifest, &job, &client_runtime(), &mut marker, false).unwrap();
        assert_ne!(std::fs::read(model_path(&dirs, "stt/a.bin")).unwrap(), a, "a normal run trusts the marker");

        ensure_models(&dirs, &manifest, &job, &client_runtime(), &mut marker, true).unwrap();
        assert_eq!(std::fs::read(model_path(&dirs, "stt/a.bin")).unwrap(), a);
        // The untouched file was only hashed, not fetched again.
        assert_eq!(server_b.ranges.lock().unwrap().len(), 1);
    }

    #[test]
    fn a_cancel_stops_before_the_next_model() {
        let a = body(10, 1);
        let manifest = loopback_manifest(&two_models("http://127.0.0.1:9/a", &a, "http://127.0.0.1:9/b", &a));
        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        let job = InstallJob::default();
        job.begin();
        job.cancel();
        let mut marker = Marker::default();
        let err = ensure_models(&dirs, &manifest, &job, &client_runtime(), &mut marker, false).unwrap_err();
        assert_eq!(err, CANCELLED);
    }

    // ── whole run, the parts that need no network ───────────────────────

    #[test]
    fn an_unsupported_machine_ends_the_setup_with_its_sentence() {
        let a = body(10, 1);
        let sidecar = sidecar_with(&two_models("https://e.org/a", &a, "https://e.org/b", &a));
        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        let job = InstallJob::default();
        job.begin();
        let platform = layout::platform_support("macos", "x86_64", Some("15.0"));
        let err = run_install(&dirs, sidecar.path(), &job, platform, false).unwrap_err();
        assert!(err.contains("Apple silicon"), "{err}");
        assert!(!dirs.root.exists(), "nothing may be written on an unsupported machine");
    }

    #[test]
    fn a_broken_bundle_ends_the_setup_before_anything_is_written() {
        let sidecar = sidecar_with("{not json");
        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        let job = InstallJob::default();
        job.begin();
        let err = run_install(&dirs, sidecar.path(), &job, Ok("aarch64-apple-darwin"), false).unwrap_err();
        assert!(err.contains("models.json"), "{err}");
        assert!(!dirs.root.exists());
    }

    // ── uninstall ───────────────────────────────────────────────────────

    #[test]
    fn uninstall_removes_what_the_setup_wrote_and_nothing_else() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        for dir in [dirs.venv().join("lib"), dirs.models().join("stt"), dirs.python_home().join("bin"), dirs.pip_cache()] {
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("file.bin"), b"x").unwrap();
        }
        Marker::default().save(&dirs).unwrap();
        std::fs::write(dirs.log_file(), b"log").unwrap();
        std::fs::write(layout::twin(&dirs.python_archive()), b"partial").unwrap();
        // A read-only file, as an unpacked archive can contain.
        let locked = dirs.python_home().join("bin").join("readonly.bin");
        std::fs::write(&locked, b"x").unwrap();
        let mut perms = std::fs::metadata(&locked).unwrap().permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&locked, perms).unwrap();
        // Not ours.
        let foreign = dirs.root.join("notes.txt");
        std::fs::write(&foreign, b"keep me").unwrap();

        uninstall(&dirs).unwrap();
        for entry in dirs.owned_entries() {
            assert!(!entry.exists(), "{} survived", entry.display());
        }
        assert!(foreign.exists(), "uninstall deleted a file it does not own");

        // With nothing foreign in it the folder itself goes too, and a second
        // uninstall on nothing is fine.
        std::fs::remove_file(&foreign).unwrap();
        uninstall(&dirs).unwrap();
        assert!(!dirs.root.exists());
        uninstall(&dirs).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn uninstall_removes_a_link_and_not_what_it_points_to() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("precious.txt"), b"x").unwrap();
        let dirs = VoiceDirs::at(tmp.path().join("voice"));
        std::fs::create_dir_all(&dirs.root).unwrap();
        std::os::unix::fs::symlink(&outside, dirs.models()).unwrap();
        uninstall(&dirs).unwrap();
        assert!(outside.join("precious.txt").exists());
        assert!(std::fs::symlink_metadata(dirs.models()).is_err());
    }

    #[test]
    fn megabytes_follow_the_rule_of_the_setup_panel_and_are_rounded() {
        assert_eq!(megabytes(0), 0);
        assert_eq!(megabytes(524_287), 0);
        assert_eq!(megabytes(524_288), 1);
        assert_eq!(megabytes(25_013_243), 24);
        // The panel lists the packages as "about 319.5 MB"; the headline of the step agrees.
        assert_eq!(megabytes(PACKAGES_DOWNLOAD_ESTIMATE), 319);
        // The shipped models: 140.9 + 208.9 + 5.9 MB in the list of the panel.
        let real = Path::new(env!("CARGO_MANIFEST_DIR")).join(layout::SIDECAR_RESOURCE_PATH);
        assert_eq!(megabytes(ModelManifest::load(&real).unwrap().with_voice("alba").total_bytes()), 356);
    }
}
