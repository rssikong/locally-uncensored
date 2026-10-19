//! REA, "Reverse Engineer Anything" (github.com/morluto/rea, MIT), as a
//! plugin of the agents: a local MCP server over stdio that the WebView starts
//! with npx, as it starts every external MCP server (api/mcp/external-client).
//!
//! What runs is one package, fixed here: the official npm tarball of one
//! version, checked against the sha512 the registry publishes for it. This
//! module fetches that file into the plugin's folder and checks it again
//! before every start, so npx is handed a file on disk and never resolves a
//! name on the registry (the project warns of look-alike repositories). Its
//! own `setup`, which writes the configuration of other apps, is never run.
//!
//! The rest of what a start needs comes from here too: the folder it works
//! in, the PATH a Mac app started from the Finder lacks (see `finder_path`),
//! and whether this Node is one the package runs on.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// The version LU runs. A new one is a change here, with its integrity.
pub const REA_VERSION: &str = "6.5.0";
/// The official tarball of that version on the npm registry.
pub const REA_TARBALL_URL: &str = "https://registry.npmjs.org/rea-agents/-/rea-agents-6.5.0.tgz";
/// `dist.integrity` of rea-agents 6.5.0 on the registry (17.10.2026).
pub const REA_INTEGRITY: &str =
    "sha512-C6BG7LyrAdR74mSjertM6PrxJkcNZ2bfQNOJornPo9erDEp2tyPRVYPnV5Yodr+1RqewCQla68WulXlVnveD+A==";
/// The tarball is 5.6 MB; anything far past that is not it.
const MAX_TARBALL_BYTES: u64 = 64 * 1024 * 1024;
/// `engines.node` of 6.5.0: ^22.19.0 || ^24.11.0 || >=26.0.0.
const NODE_RANGE: &str = "22.19 or newer within 22, 24.11 or newer within 24, or 26 and later";

/// The plugin's folder: the tarball and the folder REA works in.
pub fn plugin_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("plugins").join("rea")
}

fn tarball_path(dir: &Path) -> PathBuf {
    dir.join(format!("rea-agents-{REA_VERSION}.tgz"))
}

fn work_dir(dir: &Path) -> PathBuf {
    dir.join("work")
}

/// The integrity string of `bytes` in the registry's form.
pub fn integrity_of(bytes: &[u8]) -> String {
    use base64::Engine;
    use sha2::{Digest, Sha512};
    format!("sha512-{}", base64::engine::general_purpose::STANDARD.encode(Sha512::digest(bytes)))
}

/// Is the file at `path` the pinned tarball?
pub fn tarball_verified(path: &Path) -> bool {
    match std::fs::read(path) {
        Ok(bytes) => integrity_of(&bytes) == REA_INTEGRITY,
        Err(_) => false,
    }
}

/// Does this `node --version` run the package?
pub fn node_fits(version: &str) -> bool {
    let v = version.trim().trim_start_matches('v');
    let mut parts = v.split('.').map(|p| p.parse::<u32>().unwrap_or(0));
    let (major, minor) = (parts.next().unwrap_or(0), parts.next().unwrap_or(0));
    match major {
        22 => minor >= 19,
        24 => minor >= 11,
        m => m >= 26,
    }
}

/// The PATH the REA process gets: the user's own on a Mac, where a Finder
/// start has only the launchd one; elsewhere the app's, unchanged.
fn child_path() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        Some(crate::finder_path::child_path().to_string_lossy().into_owned())
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// `node --version` on that PATH, or None where there is no Node.
fn node_version(path: Option<&str>) -> Option<String> {
    let mut cmd = std::process::Command::new(if cfg!(windows) { "node.exe" } else { "node" });
    cmd.arg("--version");
    if let Some(p) = path {
        cmd.env("PATH", p);
    }
    crate::process_util::suppress_window(&mut cmd);
    let out = cmd.output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// The folders a Node.js version manager keeps its versions in, newest
/// first. A Mac app started from the Finder gets the login shell's PATH, and
/// nvm, fnm and asdf set theirs up in the interactive shell only: on such a
/// Mac `node` works in the terminal and is not on that PATH (found on the
/// owner's Mac with nvm, 17.10.2026).
fn manager_node_dirs(home: &Path) -> Vec<PathBuf> {
    let mut versioned: Vec<PathBuf> = Vec::new();
    for root in [
        home.join(".nvm/versions/node"),
        home.join(".local/state/fnm_multishells"),
        home.join(".fnm/node-versions"),
        home.join(".asdf/installs/nodejs"),
    ] {
        if let Ok(entries) = std::fs::read_dir(&root) {
            for e in entries.flatten() {
                let base = e.path();
                for bin in [base.join("bin"), base.join("installation/bin")] {
                    if bin.join("node").is_file() {
                        versioned.push(bin);
                    }
                }
            }
        }
    }
    // Newest first, by the version in the folder name (v24.15.0 before v22.1.0).
    versioned.sort_by_key(|p| std::cmp::Reverse(version_key(p)));
    let mut dirs = versioned;
    for fixed in [home.join(".volta/bin"), PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")] {
        if fixed.join("node").is_file() {
            dirs.push(fixed);
        }
    }
    dirs
}

fn version_key(dir: &Path) -> (u32, u32, u32) {
    let name = dir.ancestors().find_map(|a| {
        let n = a.file_name()?.to_string_lossy().to_string();
        n.trim_start_matches('v').split('.').next()?.parse::<u32>().ok().map(|_| n)
    });
    let name = name.unwrap_or_default();
    let mut parts = name.trim_start_matches('v').split('.').map(|p| p.parse::<u32>().unwrap_or(0));
    (parts.next().unwrap_or(0), parts.next().unwrap_or(0), parts.next().unwrap_or(0))
}

/// The PATH and the Node REA starts with: the app's PATH where its Node
/// fits, otherwise the newest fitting Node of a version manager put in front.
fn path_and_node(path: Option<String>, home: &Path) -> (Option<String>, Option<String>) {
    let on_path = node_version(path.as_deref());
    if on_path.as_deref().is_some_and(node_fits) {
        return (path, on_path);
    }
    for dir in manager_node_dirs(home) {
        let joined = match &path {
            Some(p) => format!("{}:{p}", dir.display()),
            None => format!("{}:{}", dir.display(), std::env::var("PATH").unwrap_or_default()),
        };
        let found = node_version(Some(&joined));
        if found.as_deref().is_some_and(node_fits) {
            return (Some(joined), found);
        }
    }
    (path, on_path)
}

/// Everything the WebView needs to show the plugin and start it.
pub fn status_in(dir: &Path, path: Option<String>, node: Option<String>) -> Value {
    let tarball = tarball_path(dir);
    let ready = tarball_verified(&tarball);
    let node_ok = node.as_deref().is_some_and(node_fits);
    json!({
        "version": REA_VERSION,
        "ready": ready,
        "tarball": ready.then(|| tarball.to_string_lossy().into_owned()),
        "workDir": work_dir(dir).to_string_lossy(),
        "path": path,
        "node": node,
        "nodeOk": node_ok,
        "nodeRange": NODE_RANGE,
    })
}

/// Keep `bytes` as the tarball when they are the pinned one: written beside
/// it first, so a broken write never leaves a file that reads as fetched.
pub fn keep_tarball(dir: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let got = integrity_of(bytes);
    if got != REA_INTEGRITY {
        return Err(format!(
            "The REA package that came down is not the official {REA_VERSION} (its checksum differs), so it was not kept."
        ));
    }
    std::fs::create_dir_all(work_dir(dir)).map_err(|e| format!("Could not create the plugin folder: {}", crate::os_error::english(&e)))?;
    let target = tarball_path(dir);
    let part = target.with_extension("tgz.part");
    std::fs::write(&part, bytes).map_err(|e| format!("Could not write the REA package: {}", crate::os_error::english(&e)))?;
    std::fs::rename(&part, &target).map_err(|e| format!("Could not keep the REA package: {}", crate::os_error::english(&e)))?;
    Ok(target)
}

#[tauri::command]
pub async fn plugin_rea_status() -> Result<Value, String> {
    tokio::task::spawn_blocking(|| {
        let (path, node) = path_and_node(child_path(), &crate::os_paths::home());
        status_in(&plugin_dir(&crate::os_paths::data_dir()), path, node)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn plugin_rea_fetch() -> Result<Value, String> {
    let dir = plugin_dir(&crate::os_paths::data_dir());
    if !tarball_verified(&tarball_path(&dir)) {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client
            .get(REA_TARBALL_URL)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("Could not download REA {REA_VERSION}: {}", crate::os_error::english(&e)))?;
        if resp.content_length().is_some_and(|n| n > MAX_TARBALL_BYTES) {
            return Err("The REA package is far larger than the official one, so it was not downloaded.".into());
        }
        let bytes = resp.bytes().await.map_err(|e| format!("Could not download REA {REA_VERSION}: {}", crate::os_error::english(&e)))?;
        if bytes.len() as u64 > MAX_TARBALL_BYTES {
            return Err("The REA package is far larger than the official one, so it was not kept.".into());
        }
        let keep_dir = dir.clone();
        tokio::task::spawn_blocking(move || keep_tarball(&keep_dir, &bytes))
            .await
            .map_err(|e| e.to_string())??;
    }
    // The folder REA starts in: a spawn into a missing one fails.
    std::fs::create_dir_all(work_dir(&dir)).map_err(|e| format!("Could not create the plugin folder: {}", crate::os_error::english(&e)))?;
    plugin_rea_status().await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("lu-rea-{}-{}", std::process::id(), rand_suffix()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn rand_suffix() -> u128 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    }

    #[test]
    fn the_integrity_is_written_the_way_the_registry_writes_it() {
        // sha512 of the empty input, base64, as `npm view x dist.integrity` shows it.
        assert_eq!(
            integrity_of(b""),
            "sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg=="
        );
        assert!(REA_INTEGRITY.starts_with("sha512-") && REA_TARBALL_URL.ends_with(&format!("-{REA_VERSION}.tgz")));
        assert!(REA_TARBALL_URL.starts_with("https://registry.npmjs.org/rea-agents/"));
    }

    #[test]
    fn a_package_that_is_not_the_pinned_one_is_not_kept() {
        let dir = temp();
        let err = keep_tarball(&dir, b"a look-alike package").unwrap_err();
        assert!(err.contains("not the official 6.5.0"), "{err}");
        assert!(!tarball_path(&dir).exists());
        assert!(!tarball_path(&dir).with_extension("tgz.part").exists());
        // The status then offers no file to start.
        let s = status_in(&dir, None, Some("v24.11.0".into()));
        assert_eq!(s["ready"], false);
        assert!(s["tarball"].is_null());
    }

    #[test]
    fn a_file_changed_after_the_fetch_reads_as_not_ready() {
        let dir = temp();
        std::fs::write(tarball_path(&dir), b"changed on disk").unwrap();
        assert!(!tarball_verified(&tarball_path(&dir)));
        assert_eq!(status_in(&dir, None, None)["ready"], false);
    }

    #[test]
    fn the_node_range_is_the_packages_own() {
        for ok in ["v22.19.0", "v22.20.1", "v24.11.0", "v24.12.0", "v26.0.0", "v27.1.0"] {
            assert!(node_fits(ok), "{ok}");
        }
        for not in ["v20.18.0", "v22.18.9", "v23.5.0", "v24.10.0", "v25.2.0", "", "garbage"] {
            assert!(!node_fits(not), "{not}");
        }
    }

    #[test]
    fn the_status_names_the_folder_the_path_and_the_node() {
        let dir = temp();
        let s = status_in(&dir, Some("/opt/homebrew/bin:/usr/bin".into()), Some("v24.11.0".into()));
        assert_eq!(s["version"], REA_VERSION);
        assert_eq!(s["nodeOk"], true);
        assert_eq!(s["path"], "/opt/homebrew/bin:/usr/bin");
        assert!(s["workDir"].as_str().unwrap().ends_with("work"));
        assert_eq!(status_in(&dir, None, None)["nodeOk"], false);
    }

    #[test]
    fn a_node_of_a_version_manager_is_found_newest_first() {
        let home = temp();
        for v in ["v22.1.0", "v24.15.0", "v20.18.0"] {
            let bin = home.join(".nvm/versions/node").join(v).join("bin");
            std::fs::create_dir_all(&bin).unwrap();
            std::fs::write(bin.join("node"), b"").unwrap();
        }
        // Only the version folders under this home: the fixed folders after
        // them (Homebrew, /usr/local/bin) belong to the machine running the test.
        let dirs: Vec<_> = manager_node_dirs(&home).into_iter().filter(|d| d.starts_with(&home)).collect();
        let names: Vec<String> = dirs.iter().map(|d| d.parent().unwrap().file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, ["v24.15.0", "v22.1.0", "v20.18.0"]);
    }

    #[test]
    #[ignore = "reads this machine's Node: LU_REAL_RUN=1"]
    fn a_finder_start_finds_a_fitting_node_on_this_machine() {
        if std::env::var("LU_REAL_RUN").as_deref() != Ok("1") {
            return;
        }
        // The PATH a Finder start has, and nothing a shell profile adds.
        let (path, node) = path_and_node(Some("/usr/bin:/bin:/usr/sbin:/sbin".into()), &crate::os_paths::home());
        println!("node {node:?} path {path:?}");
        assert!(node.as_deref().is_some_and(node_fits), "{node:?}");
    }

    #[test]
    #[ignore = "downloads the real package: LU_REAL_RUN=1"]
    fn the_real_tarball_on_the_registry_is_the_pinned_one() {
        if std::env::var("LU_REAL_RUN").as_deref() != Ok("1") {
            return;
        }
        let bytes = reqwest::blocking::get(REA_TARBALL_URL).unwrap().bytes().unwrap();
        let dir = temp();
        keep_tarball(&dir, &bytes).unwrap();
        assert_eq!(status_in(&dir, None, None)["ready"], true);
    }
}
