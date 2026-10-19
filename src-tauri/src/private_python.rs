//! A Python of LU's own, for a machine that has none.
//!
//! The image and video engines build their venv from a Python 3.11 or newer.
//! A fresh Mac has none: the Command Line Tools bring 3.9, and most customers
//! do not even have those. Until 3.0.6 the answer was a sentence telling the
//! customer to run `brew install python@3.12` in a terminal.
//!
//! This module fetches one instead, into `<data_dir>/python` (or the folder
//! chosen for it, see [`crate::runtime_root`]), without admin
//! rights and without Homebrew. It is not a second way of doing that: the
//! voice loop already downloads a self-contained CPython (astral-sh
//! python-build-standalone) by pinned release and sha256, and this is the same
//! pin, the same resumable verified download and the same unpack. Only the
//! folder differs, because the voice setup removes its own Python on uninstall
//! and the engine venvs must not lose theirs with it.
//!
//! Three rules:
//!
//! * A Python found on the machine keeps its place. The private one is the
//!   last candidate, see [`with_fallback`].
//! * The pin is compiled into the binary ([`PIN`]). Nothing read at run time
//!   decides what is downloaded or which digest counts.
//! * `<data_dir>/python` exists only as a whole. The archive is unpacked next
//!   to it, the interpreter is started once there, and only then is the folder
//!   renamed into place with [`COMPLETE_MARKER`] in it. A folder without the
//!   marker is a leftover and is cleared, never used.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, TryLockError};
use std::time::{Duration, Instant};

use crate::commands::voice_loop::fetch::{self, FetchError};
use crate::commands::voice_loop::install::{private_python, rename_patiently, unpack_python};
use crate::commands::voice_loop::layout::{platform_support, twin};
use crate::commands::voice_loop::manifest::{PythonBuild, PythonManifest};
use crate::install_state::InstallSlot;
use crate::os_error;

/// The pinned release, one build per platform with size and sha256. The file
/// is the voice loop's list, taken into the binary at build time.
pub const PIN: &str = include_str!("../resources/voice_loop/python.json");

/// Written into the unpacked folder after the interpreter in it has answered,
/// and before the folder gets its real name. Holds the sha256 of the archive.
pub(crate) const COMPLETE_MARKER: &str = ".lu-python-complete";

/// What `fail` on the slot reads as a stop on request.
const CANCELLED: &str = "cancelled";

/// One download at a time. The image and the video setup have a slot each and
/// can both arrive here without a Python.
static FETCHING: Mutex<()> = Mutex::new(());

/// Where the private Python lives, below one root.
#[derive(Clone, Debug)]
pub struct Place {
    root: PathBuf,
}

impl Place {
    /// The Python in use: a finished install wherever it is found (the
    /// chosen folder, an earlier one, the app data folder), else the chosen
    /// folder, where a new one goes. `runtime_root` decides.
    pub fn current() -> Self {
        let home = crate::runtime_root::current_here(crate::runtime_root::Kind::Python, None)
            .unwrap_or_else(|| crate::os_paths::data_dir().join("python"));
        Self { root: home.parent().map(Path::to_path_buf).unwrap_or_else(crate::os_paths::data_dir) }
    }

    #[cfg(test)]
    fn at(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn home(&self) -> PathBuf {
        self.root.join("python")
    }

    fn unpack(&self) -> PathBuf {
        self.root.join("python.partial")
    }

    fn archive(&self) -> PathBuf {
        self.root.join("python.tar.gz")
    }

    fn exe_in(home: &Path, build: &PythonBuild) -> PathBuf {
        build.exe.split('/').fold(home.to_path_buf(), |path, part| path.join(part))
    }

    /// The interpreter of a finished install, or None. Finished means the
    /// marker is there and so is the interpreter; nothing is started here.
    pub fn installed(&self, build: &PythonBuild) -> Option<PathBuf> {
        let home = self.home();
        let exe = Self::exe_in(&home, build);
        (home.join(COMPLETE_MARKER).is_file() && exe.is_file()).then_some(exe)
    }
}

fn pinned() -> Result<PythonManifest, String> {
    PythonManifest::parse(PIN)
}

fn pinned_build(manifest: &PythonManifest) -> Result<&PythonBuild, String> {
    let target = platform_support(std::env::consts::OS, std::env::consts::ARCH, None)
        .map_err(|_| "LU has no Python of its own for this system.".to_string())?;
    manifest
        .build_for(target)
        .map_err(|_| format!("LU has no Python of its own for this system ({target})."))
}

/// The private interpreter when a finished one is on disk.
pub fn installed() -> Option<PathBuf> {
    let manifest = pinned().ok()?;
    let build = pinned_build(&manifest).ok()?;
    Place::current().installed(build)
}

/// Whether the finished install in `home` (a `python` folder) starts and
/// is the pinned version. Asked after a move, before the old copy goes.
pub(crate) fn starts_from(home: &Path) -> bool {
    let Ok(manifest) = pinned() else { return false };
    let Ok(build) = pinned_build(&manifest) else { return false };
    let exe = Place::exe_in(home, build);
    home.join(COMPLETE_MARKER).is_file() && proven_version(&exe).as_deref() == Some(manifest.version.as_str())
}

/// The candidates in the order they are asked: everything found on the
/// machine first, LU's own Python last and only once.
pub fn with_fallback(system: Vec<PathBuf>, own: Option<PathBuf>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for path in system.into_iter().filter(|p| Some(p) != own.as_ref()).chain(own.clone()) {
        if !out.contains(&path) {
            out.push(path);
        }
    }
    out
}

/// Where a setup that fetches the private Python reports to. The engine
/// setups have an [`InstallSlot`]; ComfyUI and the trainer have their own
/// status channel and cancel flag ([`StatusProgress`]). Both reach the same
/// download through this.
pub trait Progress: Sync {
    fn log(&self, line: String);
    /// The flag a Stop sets. The download reads it between chunks.
    fn cancel_flag(&self) -> Arc<AtomicBool>;
    fn set_download(&self, done: u64, total: u64, speed: u64);
}

impl Progress for InstallSlot {
    fn log(&self, line: String) {
        InstallSlot::log(self, line);
    }
    fn cancel_flag(&self) -> Arc<AtomicBool> {
        InstallSlot::cancel_flag(self)
    }
    fn set_download(&self, done: u64, total: u64, speed: u64) {
        InstallSlot::set_download(self, done, total, speed);
    }
}

/// The status channel ComfyUI and the trainer share their shape with: one
/// `InstallState` the panel polls and one cancel flag.
pub struct StatusProgress<'a> {
    pub status: &'a Arc<Mutex<crate::state::InstallState>>,
    pub cancel: &'a Arc<AtomicBool>,
}

impl Progress for StatusProgress<'_> {
    fn log(&self, line: String) {
        tracing::info!("[install] {line}");
        if let Ok(mut s) = self.status.lock() {
            s.logs.push(line);
        }
    }
    fn cancel_flag(&self) -> Arc<AtomicBool> {
        self.cancel.clone()
    }
    fn set_download(&self, done: u64, total: u64, speed: u64) {
        if let Ok(mut s) = self.status.lock() {
            s.download_progress = if total > 0 { done.min(total) } else { done };
            s.download_total = total;
            s.download_speed = speed as f64;
        }
    }
}

/// Why the private Python is fetched, in the two places the customer reads
/// it: the log line before the download and the sentence when it fails.
#[derive(Clone, Copy)]
pub struct Why<'a> {
    /// Starts the log line, lower case: "<log>, downloading Python 3.12.15".
    pub log: &'a str,
    /// Starts the failure sentence: "<sentence>, and LU could not download its own".
    pub sentence: &'a str,
}

/// The engines (MLX, video) need 3.11 or newer.
const ENGINES: Why<'static> = Why {
    log: "no Python 3.11 or newer on this computer",
    sentence: "This computer has no Python 3.11 or newer",
};

/// The private interpreter, downloaded first when it is not there. Called by
/// an engine setup that found no Python 3.11 or newer on the machine.
pub fn ensure(slot: &InstallSlot) -> Result<PathBuf, String> {
    ensure_for(slot, ENGINES)
}

/// The same for any other setup, with its own reason.
pub fn ensure_for(progress: &dyn Progress, why: Why<'_>) -> Result<PathBuf, String> {
    let manifest = pinned()?;
    let build = pinned_build(&manifest)?;
    ensure_at(&Place::current(), &manifest.version, build, progress, why, &proven_version)
}

/// `(3, 12)` when LU has a Python of its own for this system, None when the
/// pin carries no build for it (an Intel Mac, ARM Linux, ARM Windows). Asks
/// nothing on disk and nothing on the network.
pub fn version_here() -> Option<(u32, u32)> {
    let manifest = pinned().ok()?;
    pinned_build(&manifest).ok()?;
    let mut parts = manifest.version.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    Some((major, minor))
}

/// `3.12.15` from an interpreter that can also do what the engines ask of it
/// first: build a venv, bootstrap pip into it and open a TLS connection.
pub(crate) fn proven_version(exe: &Path) -> Option<String> {
    let out = private_python(exe)
        .args(["-c", "import sys, venv, ensurepip, ssl; print('%d.%d.%d' % sys.version_info[:3])"])
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !text.is_empty()).then_some(text)
}

/// Remove a file or a folder, whatever is there. Nothing there is fine.
fn clear(path: &Path) -> Result<(), String> {
    let done = match std::fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
        Ok(meta) if meta.is_dir() => std::fs::remove_dir_all(path),
        Ok(_) => std::fs::remove_file(path),
    };
    done.map_err(|e| format!("Could not remove {}: {}.", path.display(), os_error::io_english(&e)))
}

/// Wait for another setup that is fetching the same Python, and stop waiting
/// when this one is cancelled.
fn wait_for_turn(slot: &dyn Progress) -> Result<MutexGuard<'static, ()>, String> {
    let mut said = false;
    loop {
        match FETCHING.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(TryLockError::Poisoned(poisoned)) => return Ok(poisoned.into_inner()),
            Err(TryLockError::WouldBlock) => {}
        }
        if cancel_requested(slot) {
            return Err(CANCELLED.to_string());
        }
        if !said {
            slot.log("waiting for the Python download another setup has started".to_string());
            said = true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

/// The download lock, when nobody is fetching right now. A move of the
/// Python holds it, so no setup unpacks into the folder being moved.
pub(crate) fn hold_if_idle() -> Option<MutexGuard<'static, ()>> {
    match FETCHING.try_lock() {
        Ok(guard) => Some(guard),
        Err(TryLockError::Poisoned(poisoned)) => Some(poisoned.into_inner()),
        Err(TryLockError::WouldBlock) => None,
    }
}

fn cancel_requested(slot: &dyn Progress) -> bool {
    slot.cancel_flag().load(Ordering::SeqCst)
}

/// The sentence for a download that did not arrive.
fn fetch_sentence(error: &FetchError, why: Why<'_>) -> String {
    match error {
        FetchError::Cancelled => CANCELLED.to_string(),
        FetchError::Network(detail) => format!(
            "{}, and LU could not download its own: {detail}. Check the internet connection and start the setup again, the download continues where it stopped.",
            why.sentence
        ),
        other => other.user_message("Python"),
    }
}

fn megabytes(bytes: u64) -> u64 {
    bytes.div_ceil(1_000_000)
}

fn download(place: &Place, build: &PythonBuild, slot: &dyn Progress, why: Why<'_>) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("The download could not be started: {}.", os_error::io_english(&e)))?;
    let client = fetch::http_client()?;
    let total = build.remote.size;
    let cancel = slot.cancel_flag();
    let meter = slot;
    let started = Instant::now();
    let mut first: Option<u64> = None;
    let mut on_progress = move |done: u64| {
        // A resumed download starts above zero; the speed is what this run added.
        let base = *first.get_or_insert(done);
        let seconds = started.elapsed().as_secs_f64().max(0.001);
        meter.set_download(done, total, (done.saturating_sub(base) as f64 / seconds) as u64);
    };
    let fetched =
        runtime.block_on(fetch::fetch_verified(&client, &build.remote, &place.archive(), &cancel, &mut on_progress));
    // The bar belongs to the next step again.
    slot.set_download(0, 0, 0);
    fetched.map_err(|e| fetch_sentence(&e, why))
}

/// Unpack the verified archive next to its target, start the interpreter once,
/// and only then give the folder its real name.
fn unpack_and_prove(
    place: &Place,
    version: &str,
    build: &PythonBuild,
    prove: &dyn Fn(&Path) -> Option<String>,
) -> Result<PathBuf, String> {
    let unpack = place.unpack();
    unpack_python(&place.archive(), &unpack).map_err(|e| {
        format!(
            "Python could not be unpacked into {}: {}. Check the free space, then start the setup again.",
            place.root.display(),
            os_error::io_english(&e)
        )
    })?;
    let staged = unpack.join("python");
    match prove(&Place::exe_in(&staged, build)) {
        Some(found) if found == version => {}
        Some(found) => {
            return Err(format!(
                "The downloaded Python reports version {found} instead of {version} and was removed. Start the setup again."
            ))
        }
        None => {
            return Err(format!(
                "The downloaded Python could not be started from {}. A security program may be blocking it. Allow the folder and start the setup again.",
                place.root.display()
            ))
        }
    }
    std::fs::write(staged.join(COMPLETE_MARKER), &build.remote.sha256)
        .and_then(|()| rename_patiently(&staged, &place.home()))
        .map_err(|e| {
            format!(
                "Python could not be moved to {}: {}. Start the setup again.",
                place.home().display(),
                os_error::io_english(&e)
            )
        })?;
    Ok(Place::exe_in(&place.home(), build))
}

fn ensure_at(
    place: &Place,
    version: &str,
    build: &PythonBuild,
    slot: &dyn Progress,
    why: Why<'_>,
    prove: &dyn Fn(&Path) -> Option<String>,
) -> Result<PathBuf, String> {
    let _turn = wait_for_turn(slot)?;
    if let Some(exe) = place.installed(build) {
        return Ok(exe);
    }
    if cancel_requested(slot) {
        return Err(CANCELLED.to_string());
    }
    slot.log(format!(
        "{}, downloading Python {version} ({} MB) into LU's own folder",
        why.log,
        megabytes(build.remote.size)
    ));
    // Whatever is there without the marker is what a stopped run left behind.
    clear(&place.home())?;
    clear(&place.unpack())?;

    download(place, build, slot, why)?;
    if cancel_requested(slot) {
        // The verified archive stays; the next run unpacks it without a download.
        return Err(CANCELLED.to_string());
    }

    slot.log("unpacking Python".to_string());
    let outcome = unpack_and_prove(place, version, build, prove);
    let _ = clear(&place.unpack());
    let _ = clear(&place.archive());
    let _ = clear(&twin(&place.archive()));
    let exe = outcome?;
    slot.log(format!("Python {version} is ready at {}", place.home().display()));
    Ok(exe)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::voice_loop::fetch::test_server;
    use crate::commands::voice_loop::manifest::RemoteFile;

    const VERSION: &str = "3.12.15";

    fn sha(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
    }

    /// A `python/bin/python3.12` archive whose "interpreter" is the text it
    /// would print. No test here starts a process.
    fn archive(interpreter_says: &str) -> Vec<u8> {
        let gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        let mut tar = tar::Builder::new(gz);
        for (path, body) in [("python/bin/python3.12", interpreter_says), ("python/lib/python3.12/os.py", "# stdlib")] {
            let mut header = tar::Header::new_gnu();
            header.set_size(body.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            tar.append_data(&mut header, path, body.as_bytes()).unwrap();
        }
        tar.into_inner().unwrap().finish().unwrap()
    }

    fn build_at(url: &str, size: u64, sha256: String) -> PythonBuild {
        PythonBuild {
            target: "aarch64-apple-darwin".to_string(),
            remote: RemoteFile { url: url.to_string(), size, sha256 },
            exe: "bin/python3.12".to_string(),
        }
    }

    /// Stands in for starting the interpreter: the file's text is its answer.
    fn says(exe: &Path) -> Option<String> {
        std::fs::read_to_string(exe).ok().filter(|text| text != "does not start")
    }

    fn server_runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_multi_thread().worker_threads(1).enable_all().build().unwrap()
    }

    fn running_slot() -> InstallSlot {
        let slot = InstallSlot::default();
        assert!(slot.try_start());
        slot
    }

    fn nothing_left(place: &Place) {
        for path in [place.home(), place.unpack(), place.archive(), twin(&place.archive())] {
            assert!(!path.exists(), "{} was left behind", path.display());
        }
    }

    // ── the pin ─────────────────────────────────────────────────────────────

    /// The values are repeated here on purpose. Moving the pin means changing
    /// the list and this test, each against the release's SHA256SUMS; a slip
    /// in one of them fails here instead of reaching a customer.
    /// Checked on 08.10.2026 against
    /// github.com/astral-sh/python-build-standalone/releases/download/20261003/SHA256SUMS
    /// and the asset digest of the GitHub API.
    #[test]
    fn the_pin_is_compiled_in_and_names_one_verified_archive_for_the_mac() {
        let manifest = pinned().unwrap();
        assert_eq!(manifest.version, "3.12.15");
        let mac = manifest.build_for("aarch64-apple-darwin").unwrap();
        assert_eq!(
            mac.remote.url,
            "https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.12.15%2B20261003-aarch64-apple-darwin-install_only_stripped.tar.gz"
        );
        assert_eq!(mac.remote.sha256, "ad8d0c637c0a36b967b310e2c07254f4d2ca8cabaa7699e55ed6290aceb481a2");
        assert_eq!(mac.remote.size, 25_013_243);
        assert_eq!(mac.exe, "bin/python3.12");
        // Compiled in, not read from a file next to the app at run time.
        let source = include_str!("private_python.rs");
        let production = &source[..source.find("#[cfg(test)]\nmod tests").unwrap()];
        assert!(production.contains("pub const PIN: &str = include_str!(\"../resources/voice_loop/python.json\");"));
        for at_run_time in ["read_to_string", "PythonManifest::load", "resource_dir"] {
            assert!(!production.contains(at_run_time), "{at_run_time}: the pin must not come from disk");
        }
    }

    #[test]
    fn every_pinned_build_is_an_https_release_asset_with_a_full_digest() {
        for build in &pinned().unwrap().builds {
            assert!(
                build.remote.url.starts_with("https://github.com/astral-sh/python-build-standalone/releases/download/"),
                "{}",
                build.remote.url
            );
            assert!(build.remote.url.contains("install_only"), "{}", build.remote.url);
            assert_eq!(build.remote.sha256.len(), 64);
            assert!(build.remote.sha256.bytes().all(|b| b.is_ascii_hexdigit()));
            assert!(build.remote.size > 10_000_000, "{} is too small to be a Python", build.target);
        }
    }

    // ── the order ───────────────────────────────────────────────────────────

    #[test]
    fn a_python_found_on_the_machine_comes_before_lus_own() {
        let brew = PathBuf::from("/opt/homebrew/bin/python3.12");
        let clt = PathBuf::from("/usr/bin/python3");
        let own = PathBuf::from("/data/python/bin/python3.12");
        assert_eq!(
            with_fallback(vec![brew.clone(), clt.clone()], Some(own.clone())),
            vec![brew.clone(), clt.clone(), own.clone()]
        );
        // Found by the machine scan as well: still last, and only once.
        assert_eq!(
            with_fallback(vec![own.clone(), brew.clone(), own.clone()], Some(own.clone())),
            vec![brew.clone(), own.clone()]
        );
        assert_eq!(with_fallback(vec![], Some(own.clone())), vec![own]);
        assert_eq!(with_fallback(vec![brew.clone(), brew.clone()], None), vec![brew]);
    }

    // ── half a folder ───────────────────────────────────────────────────────

    #[test]
    fn a_folder_without_the_marker_or_without_the_interpreter_is_not_an_install() {
        let tmp = tempfile::tempdir().unwrap();
        let place = Place::at(tmp.path());
        let build = build_at("http://127.0.0.1:9/none", 1, sha(b"x"));
        assert_eq!(place.installed(&build), None, "nothing there");

        let exe = place.home().join("bin").join("python3.12");
        std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
        std::fs::write(&exe, VERSION).unwrap();
        assert_eq!(place.installed(&build), None, "an interpreter without the marker is a stopped unpack");

        std::fs::write(place.home().join(COMPLETE_MARKER), "digest").unwrap();
        assert_eq!(place.installed(&build), Some(exe.clone()));

        std::fs::remove_file(&exe).unwrap();
        assert_eq!(place.installed(&build), None, "a marker without the interpreter");

        // What is still being unpacked has another name and never counts.
        let staged = place.unpack().join("python");
        std::fs::create_dir_all(staged.join("bin")).unwrap();
        std::fs::write(staged.join("bin").join("python3.12"), VERSION).unwrap();
        std::fs::write(staged.join(COMPLETE_MARKER), "digest").unwrap();
        assert_eq!(place.installed(&build), None);
    }

    // ── the download ────────────────────────────────────────────────────────

    #[test]
    fn a_fresh_machine_gets_a_whole_python_and_the_leftover_of_a_stopped_run_is_replaced() {
        let rt = server_runtime();
        let bytes = archive(VERSION);
        let server = rt.block_on(test_server::start(bytes.clone()));
        let tmp = tempfile::tempdir().unwrap();
        let place = Place::at(tmp.path().join("data dir with spaces"));
        let build = build_at(&server.url, bytes.len() as u64, sha(&bytes));
        // A stopped earlier run: a folder under the real name, no marker.
        std::fs::create_dir_all(place.home().join("bin")).unwrap();
        std::fs::write(place.home().join("bin").join("python3.12"), "does not start").unwrap();
        std::fs::create_dir_all(place.unpack().join("python")).unwrap();

        let slot = running_slot();
        let exe = ensure_at(&place, VERSION, &build, &slot, ENGINES, &says).unwrap();
        assert_eq!(exe, place.home().join("bin").join("python3.12"));
        assert_eq!(std::fs::read_to_string(&exe).unwrap(), VERSION, "the old leftover is gone");
        assert!(place.home().join("lib/python3.12/os.py").is_file());
        assert_eq!(std::fs::read_to_string(place.home().join(COMPLETE_MARKER)).unwrap(), sha(&bytes));
        assert_eq!(place.installed(&build), Some(exe.clone()));
        for path in [place.unpack(), place.archive(), twin(&place.archive())] {
            assert!(!path.exists(), "{} was left behind", path.display());
        }
        let seen = slot.snapshot();
        assert!(seen.logs.iter().any(|l| l.contains("downloading Python 3.12.15")), "{:?}", seen.logs);
        assert!(seen.logs.iter().any(|l| l.contains("unpacking Python")), "{:?}", seen.logs);
        assert_eq!((seen.download_progress, seen.download_total), (0, 0), "the bar is handed back");

        // The second setup asks nobody: the address is dead and it still answers.
        let dead = build_at("http://127.0.0.1:9/none", bytes.len() as u64, sha(&bytes));
        let again = running_slot();
        assert_eq!(ensure_at(&place, VERSION, &dead, &again, ENGINES, &says).unwrap(), exe);
        // The tests of this module share the one download lock, so a second
        // call may have waited for another test. That line is the only one.
        let said = again.snapshot().logs;
        assert!(
            said.iter().all(|l| l.contains("waiting for the Python download")),
            "nothing to say when it is already there: {said:?}"
        );
    }

    #[test]
    fn a_wrong_digest_stops_the_setup_and_leaves_nothing_behind() {
        let rt = server_runtime();
        let bytes = archive(VERSION);
        let server = rt.block_on(test_server::start(bytes.clone()));
        let tmp = tempfile::tempdir().unwrap();
        let place = Place::at(tmp.path());
        // Right size, the digest of other bytes: what a tampered mirror sends.
        let build = build_at(&server.url, bytes.len() as u64, sha(b"another archive"));
        let slot = running_slot();
        let err = ensure_at(&place, VERSION, &build, &slot, ENGINES, &|_| panic!("an unverified archive was unpacked"))
            .unwrap_err();
        assert!(err.contains("did not match its checksum"), "{err}");
        nothing_left(&place);
        assert_eq!(place.installed(&build), None);
    }

    #[test]
    fn a_python_that_does_not_start_or_is_another_version_is_removed() {
        let rt = server_runtime();
        for (interpreter, expected) in [("does not start", "could not be started"), ("3.9.6", "reports version 3.9.6")] {
            let bytes = archive(interpreter);
            let server = rt.block_on(test_server::start(bytes.clone()));
            let tmp = tempfile::tempdir().unwrap();
            let place = Place::at(tmp.path());
            let build = build_at(&server.url, bytes.len() as u64, sha(&bytes));
            let err = ensure_at(&place, VERSION, &build, &running_slot(), ENGINES, &says).unwrap_err();
            assert!(err.contains(expected), "{err}");
            nothing_left(&place);
        }
    }

    #[test]
    fn an_archive_that_is_not_one_is_removed() {
        let rt = server_runtime();
        let bytes = b"<html>sign in to the hotel wifi</html>".to_vec();
        let server = rt.block_on(test_server::start(bytes.clone()));
        let tmp = tempfile::tempdir().unwrap();
        let place = Place::at(tmp.path());
        // Only reachable with a matching digest, so this is the unpack failing.
        let build = build_at(&server.url, bytes.len() as u64, sha(&bytes));
        let err = ensure_at(&place, VERSION, &build, &running_slot(), ENGINES, &says).unwrap_err();
        assert!(err.contains("could not be unpacked"), "{err}");
        nothing_left(&place);
    }

    #[test]
    fn a_cancelled_setup_downloads_nothing_and_ends_as_a_stop_not_as_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        let place = Place::at(tmp.path());
        let build = build_at("http://127.0.0.1:9/none", 10, sha(b"x"));
        let slot = running_slot();
        assert!(slot.cancel());
        let err = ensure_at(&place, VERSION, &build, &slot, ENGINES, &says).unwrap_err();
        assert_eq!(err, CANCELLED);
        nothing_left(&place);
        slot.fail(err);
        let seen = slot.snapshot();
        assert_eq!((seen.status.as_str(), seen.error), ("idle", None));
    }

    #[test]
    fn a_cancel_during_the_download_reaches_it_through_the_slot() {
        // The download reads the very flag `cancel` sets, not a copy of it.
        let slot = running_slot();
        let flag = slot.cancel_flag();
        assert!(!flag.load(std::sync::atomic::Ordering::SeqCst));
        assert!(slot.cancel());
        assert!(flag.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(fetch_sentence(&FetchError::Cancelled, ENGINES), CANCELLED);
    }

    /// The real archive through the real code: unpacked by the `tar` crate
    /// with its symlinks and modes, started, marked and renamed. Needs the
    /// pinned archive on disk, so it only runs when asked:
    /// `LU_PYTHON_ARCHIVE=/path/to/archive.tar.gz cargo test private_python -- --ignored`
    #[test]
    #[ignore = "needs the pinned archive, see LU_PYTHON_ARCHIVE"]
    fn the_pinned_archive_unpacks_and_its_interpreter_starts() {
        let source = PathBuf::from(std::env::var("LU_PYTHON_ARCHIVE").expect("LU_PYTHON_ARCHIVE names the archive"));
        let manifest = pinned().unwrap();
        let build = pinned_build(&manifest).unwrap();
        assert!(fetch::is_verified(&source, &build.remote), "the archive is not the pinned one");
        let tmp = tempfile::tempdir().unwrap();
        let place = Place::at(tmp.path().join("data dir with spaces"));
        std::fs::create_dir_all(&place.root).unwrap();
        std::fs::copy(&source, place.archive()).unwrap();
        let exe = unpack_and_prove(&place, &manifest.version, build, &proven_version).unwrap();
        assert_eq!(place.installed(build), Some(exe.clone()));
        assert_eq!(proven_version(&exe).as_deref(), Some(manifest.version.as_str()), "it still starts after the rename");
        // What the engines do with it next.
        let venv = tmp.path().join("venv");
        assert!(private_python(&exe).args(["-m", "venv"]).arg(&venv).status().unwrap().success());
        let pip = private_python(&venv.join("bin").join("python")).args(["-m", "pip", "--version"]).output().unwrap();
        assert!(pip.status.success(), "{}", String::from_utf8_lossy(&pip.stderr));
    }

    #[test]
    fn without_a_network_the_sentence_says_what_is_missing_and_what_to_do() {
        let said = fetch_sentence(&FetchError::Network("the server could not be reached".to_string()), ENGINES);
        assert!(said.contains("no Python 3.11 or newer"), "{said}");
        assert!(said.contains("the server could not be reached"), "{said}");
        assert!(said.contains("Check the internet connection"), "{said}");
        assert!(!said.contains("brew"), "the customer is not sent to a terminal: {said}");
    }
}
