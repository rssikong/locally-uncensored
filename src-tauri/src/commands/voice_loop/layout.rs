//! Where the voice loop lives on disk, and which machines it runs on.
//!
//! Two roots. The sidecar directory is read-only and ships with the app
//! (`lu_voice_loop/`, `requirements.txt`, `models.json`, `python.json`). The
//! data root is `data_dir()/voice`, or `voice` in the folder chosen for it
//! (`crate::runtime_root`), and holds everything the setup downloads: the
//! private Python, the venv, the models and the install marker.
//!
//! Nothing here needs a `tauri::AppHandle`. The commands resolve the two roots
//! once and pass them down, so the same code runs against a temporary folder
//! in the tests.

use std::path::{Path, PathBuf};

/// The files that make a directory the voice loop sidecar. A directory missing
/// one of them is a broken bundle and is reported as such.
pub const SIDECAR_FILES: &[&str] = &[
    "lu_voice_loop/__main__.py",
    "lu_voice_loop/__init__.py",
    "requirements.txt",
    "models.json",
    "python.json",
];

/// The sidecar directory below the app's resource directory. The same relative
/// path `tauri.conf.json` maps the files to.
pub const SIDECAR_RESOURCE_PATH: &str = "resources/voice_loop";

/// The wheels need macOS 14 on Apple silicon (torch and onnxruntime publish
/// no older arm64 builds for the pinned versions).
pub const MIN_MACOS_MAJOR: u32 = 14;

/// Everything the setup writes, below one root.
#[derive(Clone, Debug)]
pub struct VoiceDirs {
    pub root: PathBuf,
}

impl VoiceDirs {
    /// The voice engine in use: an install wherever it is found (the chosen
    /// folder, an earlier one, the app data folder), else the chosen folder,
    /// where a new setup goes.
    pub fn current() -> Self {
        let root = crate::runtime_root::current_here(crate::runtime_root::Kind::Voice, None)
            .unwrap_or_else(|| crate::os_paths::data_dir().join("voice"));
        Self { root }
    }

    /// A root of the test's choosing.
    #[cfg(test)]
    pub fn at(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The unpacked private Python (`python.exe` or `bin/python3.12` inside).
    pub fn python_home(&self) -> PathBuf {
        self.root.join("python")
    }

    pub fn venv(&self) -> PathBuf {
        self.root.join("venv")
    }

    pub fn venv_python(&self) -> PathBuf {
        venv_python_in(&self.venv(), cfg!(windows))
    }

    pub fn models(&self) -> PathBuf {
        self.root.join("models")
    }

    pub fn marker(&self) -> PathBuf {
        self.root.join("install.json")
    }

    /// pip's wheel cache during the setup. Kept inside the root so a second
    /// attempt does not download finished wheels again, removed on success.
    pub fn pip_cache(&self) -> PathBuf {
        self.root.join("pip-cache")
    }

    pub fn python_archive(&self) -> PathBuf {
        self.root.join("python.tar.gz")
    }

    pub fn python_unpack(&self) -> PathBuf {
        self.root.join("python.partial")
    }

    pub fn log_file(&self) -> PathBuf {
        self.root.join("sidecar.log")
    }

    /// Every entry the setup may have created. Uninstall removes exactly
    /// these and nothing else that happens to sit in the folder.
    pub fn owned_entries(&self) -> Vec<PathBuf> {
        vec![
            self.venv(),
            self.models(),
            self.python_home(),
            self.python_unpack(),
            self.pip_cache(),
            self.python_archive(),
            twin(&self.python_archive()),
            self.marker(),
            self.log_file(),
        ]
    }
}

/// The resumable twin of a download target: `model.bin.download`.
pub fn twin(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".download");
    dest.with_file_name(name)
}

pub fn venv_python_in(venv: &Path, windows: bool) -> PathBuf {
    if windows {
        venv.join("Scripts").join("python.exe")
    } else {
        venv.join("bin").join("python")
    }
}

pub fn is_sidecar_dir(dir: &Path) -> bool {
    SIDECAR_FILES.iter().all(|f| dir.join(f).is_file())
}

/// Find the sidecar directory.
///
/// A debug build prefers the source tree, so an edit to the sidecar is live
/// without a rebuild. A release build only knows the resource directory. Same
/// two cases `whisper_server.py` has.
pub fn resolve_sidecar_dir(resource_dir: Option<&Path>, dev_dir: Option<&Path>) -> Result<PathBuf, String> {
    let bundled = resource_dir.map(|d| d.join(SIDECAR_RESOURCE_PATH));
    for candidate in [dev_dir.map(Path::to_path_buf), bundled].into_iter().flatten() {
        if is_sidecar_dir(&candidate) {
            return Ok(plain_path(&candidate));
        }
    }
    Err("The voice loop files are missing from this installation. Reinstall LU to restore them.".to_string())
}

/// The source tree's sidecar directory, in a debug build only.
pub fn dev_sidecar_dir() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        Some(Path::new(env!("CARGO_MANIFEST_DIR")).join(SIDECAR_RESOURCE_PATH))
    } else {
        None
    }
}

/// Drop the Windows verbatim prefix from a drive path.
///
/// The resource directory can arrive as `\\?\C:\Program Files\...`. A child
/// process cannot take such a path as its working directory, and Python
/// prints it into every traceback. A verbatim UNC path is left alone, there is
/// no short form that means the same.
pub fn plain_path(path: &Path) -> PathBuf {
    match plain_path_text(&path.to_string_lossy()) {
        Some(short) => PathBuf::from(short),
        None => path.to_path_buf(),
    }
}

pub(crate) fn plain_path_text(text: &str) -> Option<String> {
    let rest = text.strip_prefix(r"\\?\")?;
    let bytes = rest.as_bytes();
    let is_drive = bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\';
    is_drive.then(|| rest.to_string())
}

/// The release target this machine downloads a Python for, or the sentence
/// that tells the user why the voice loop cannot run here.
pub fn platform_support(os: &str, arch: &str, os_version: Option<&str>) -> Result<&'static str, String> {
    match (os, arch) {
        ("macos", "aarch64") => {
            let major = os_version.and_then(|v| v.split('.').next()).and_then(|m| m.trim().parse::<u32>().ok());
            match major {
                Some(found) if found < MIN_MACOS_MAJOR => Err(format!(
                    "The voice loop needs macOS {MIN_MACOS_MAJOR} or newer. This Mac runs macOS {}. Update macOS to use it.",
                    os_version.unwrap_or("an older version").trim()
                )),
                _ => Ok("aarch64-apple-darwin"),
            }
        }
        ("macos", _) => Err(
            "The voice loop needs a Mac with Apple silicon. Intel Macs are not supported.".to_string(),
        ),
        ("windows", "x86_64") => Ok("x86_64-pc-windows-msvc"),
        ("linux", "x86_64") => Ok("x86_64-unknown-linux-gnu"),
        ("windows", other) | ("linux", other) => Err(format!(
            "The voice loop needs a 64-bit Intel or AMD processor on this system. This machine reports {other}."
        )),
        (other, _) => Err(format!("The voice loop is not available on {other}.")),
    }
}

/// [`platform_support`] for the machine this build runs on.
pub fn this_platform() -> Result<&'static str, String> {
    let version = if cfg!(target_os = "macos") { sysinfo::System::os_version() } else { None };
    platform_support(std::env::consts::OS, std::env::consts::ARCH, version.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_sidecar(dir: &Path) {
        for f in SIDECAR_FILES {
            let p = dir.join(f);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, b"x").unwrap();
        }
    }

    #[test]
    fn the_bundle_is_found_below_the_resource_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let bundled = tmp.path().join("resources").join("voice_loop");
        fake_sidecar(&bundled);
        assert_eq!(resolve_sidecar_dir(Some(tmp.path()), None).unwrap(), bundled);
    }

    #[test]
    fn a_debug_build_prefers_the_source_tree() {
        let tmp = tempfile::tempdir().unwrap();
        let bundled = tmp.path().join("res").join("resources").join("voice_loop");
        let dev = tmp.path().join("src").join("voice_loop");
        fake_sidecar(&bundled);
        fake_sidecar(&dev);
        assert_eq!(resolve_sidecar_dir(Some(&tmp.path().join("res")), Some(&dev)).unwrap(), dev);
    }

    #[test]
    fn a_source_tree_that_is_not_there_falls_back_to_the_bundle() {
        let tmp = tempfile::tempdir().unwrap();
        let bundled = tmp.path().join("resources").join("voice_loop");
        fake_sidecar(&bundled);
        let gone = tmp.path().join("nowhere");
        assert_eq!(resolve_sidecar_dir(Some(tmp.path()), Some(&gone)).unwrap(), bundled);
    }

    #[test]
    fn a_bundle_missing_one_file_is_a_broken_installation() {
        let tmp = tempfile::tempdir().unwrap();
        let bundled = tmp.path().join("resources").join("voice_loop");
        fake_sidecar(&bundled);
        std::fs::remove_file(bundled.join("models.json")).unwrap();
        let err = resolve_sidecar_dir(Some(tmp.path()), None).unwrap_err();
        assert!(err.contains("Reinstall LU"), "{err}");
    }

    #[test]
    fn the_real_sidecar_in_the_source_tree_is_complete() {
        let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join(SIDECAR_RESOURCE_PATH);
        assert!(is_sidecar_dir(&dev), "{} is missing a sidecar file", dev.display());
    }

    #[test]
    fn a_verbatim_drive_path_loses_its_prefix() {
        assert_eq!(
            plain_path_text(r"\\?\C:\Program Files\Locally Uncensored\resources").as_deref(),
            Some(r"C:\Program Files\Locally Uncensored\resources")
        );
        // A network share has no short form, and a plain path needs nothing.
        assert_eq!(plain_path_text(r"\\?\UNC\server\share\x"), None);
        assert_eq!(plain_path_text(r"C:\Users\a b\x"), None);
        assert_eq!(plain_path_text("/opt/lu/resources"), None);
    }

    #[test]
    fn the_venv_interpreter_sits_where_each_system_puts_it() {
        let venv = Path::new("voice").join("venv");
        assert!(venv_python_in(&venv, true).ends_with(Path::new("Scripts").join("python.exe")));
        assert!(venv_python_in(&venv, false).ends_with(Path::new("bin").join("python")));
    }

    #[test]
    fn the_download_twin_keeps_the_full_file_name() {
        assert_eq!(twin(Path::new("m/model.bin")), Path::new("m/model.bin.download"));
        assert_eq!(twin(Path::new("m/python.tar.gz")), Path::new("m/python.tar.gz.download"));
    }

    #[test]
    fn uninstall_only_names_entries_inside_the_root() {
        let dirs = VoiceDirs::at("/data/voice");
        for entry in dirs.owned_entries() {
            assert!(entry.starts_with("/data/voice") && entry != Path::new("/data/voice"), "{}", entry.display());
        }
    }

    #[test]
    fn supported_machines_get_their_release_target() {
        assert_eq!(platform_support("macos", "aarch64", Some("15.3.1")).unwrap(), "aarch64-apple-darwin");
        assert_eq!(platform_support("macos", "aarch64", Some("14.0")).unwrap(), "aarch64-apple-darwin");
        assert_eq!(platform_support("windows", "x86_64", None).unwrap(), "x86_64-pc-windows-msvc");
        assert_eq!(platform_support("linux", "x86_64", None).unwrap(), "x86_64-unknown-linux-gnu");
        // An unreadable version does not lock a supported Mac out.
        assert!(platform_support("macos", "aarch64", None).is_ok());
        assert!(platform_support("macos", "aarch64", Some("garbage")).is_ok());
    }

    #[test]
    fn an_intel_mac_gets_a_sentence_and_not_a_crash() {
        let err = platform_support("macos", "x86_64", Some("15.0")).unwrap_err();
        assert!(err.contains("Apple silicon") && err.contains("Intel"), "{err}");
    }

    #[test]
    fn an_old_macos_is_told_which_version_it_needs() {
        let err = platform_support("macos", "aarch64", Some("13.6.1")).unwrap_err();
        assert!(err.contains("macOS 14") && err.contains("13.6.1"), "{err}");
    }

    #[test]
    fn other_processors_are_named() {
        assert!(platform_support("windows", "aarch64", None).unwrap_err().contains("aarch64"));
        assert!(platform_support("linux", "arm", None).unwrap_err().contains("arm"));
        assert!(platform_support("freebsd", "x86_64", None).unwrap_err().contains("freebsd"));
    }
}
