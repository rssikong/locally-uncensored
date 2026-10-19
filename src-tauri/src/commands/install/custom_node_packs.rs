//! Die Knoten-Pakete in ComfyUIs `custom_nodes/` aus LU heraus verwalten
//! (GitHub-Wunsch #14, Discussion #72): auflisten, per Git-Link holen,
//! aktualisieren und in den Papierkorb legen.
//!
//! Holen und Aktualisieren laufen ueber `install_custom_node`
//! (custom_nodes.rs), denselben Weg, den LU fuer seine eigenen Pakete nimmt:
//! git, dann die `requirements.txt` in ComfyUIs Python, mit Torch-Sperre und
//! Freigabe gesperrter Dateien. Hier stehen nur die Teile, die es dort nicht
//! gibt: welche Links angenommen werden, welche Ordnernamen gelten, was im
//! Ordner liegt, das Protokoll fuer die Oberflaeche und das Entfernen.
//!
//! Entfernt wird nie endgueltig. Ein Paket geht in den Papierkorb des
//! Systems, und wenn das nicht geht, bleibt es, wo es ist.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{Manager, State};

use crate::state::AppState;

use super::custom_nodes::{git_in, ComfyPause};
use super::comfy_repair::OwnComfyStop;

// ── Welche Links angenommen werden ──────────────────────────────────────────

/// Die Hosts, von denen ein Paket geholt werden darf. Ein Link auf einen
/// anderen Server wird abgelehnt, bevor git ihn sieht.
pub(crate) const NODE_REPO_HOSTS: [&str; 3] = ["github.com", "gitlab.com", "codeberg.org"];

/// Ein angenommener Link: die Adresse, die git bekommt, und der Ordner, in
/// den geklont wird (der Name des Repositorys).
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct NodeRepo {
    pub(crate) url: String,
    pub(crate) folder: String,
}

/// Ein Teil eines Repository-Pfades: Buchstaben, Ziffern, `.`, `_`, `-`,
/// nicht mit `.` oder `-` am Anfang. Damit kann kein Teil `..` sein, keiner
/// ein git-Schalter und keiner einen Trenner tragen.
fn plain_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && !s.starts_with('.')
        && !s.starts_with('-')
        && !s.contains("..")
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
}

/// Prueft einen Git-Link und leitet den Ordnernamen ab. Angenommen wird nur
/// `https://<host>/<owner>/<repo>` (GitLab auch mit Untergruppen), ohne
/// Anmeldedaten, Port, Abfrage oder Anker; ein `.git` am Ende und ein
/// abschliessender Schraegstrich fallen weg. Links auf eine Datei oder einen
/// Zweig (`/tree/main`, `/blob/...`) werden abgelehnt statt geraten.
pub(crate) fn node_repo_from_url(raw: &str) -> Result<NodeRepo, String> {
    const ASK: &str = "Paste the https link of the repository, for example https://github.com/owner/repo.";
    let url = raw.trim();
    if url.len() > 512 || url.contains(|c: char| c.is_whitespace() || c.is_control()) {
        return Err(format!("That link is not a plain repository link. {ASK}"));
    }
    let Some(rest) = url.strip_prefix("https://") else {
        return Err(format!("Only https links are accepted. {ASK}"));
    };
    if rest.contains(['?', '#', '@', '\\', '%']) {
        return Err(format!("That link carries extra parts LU does not accept. {ASK}"));
    }
    let rest = rest.trim_end_matches('/');
    let mut parts = rest.split('/');
    let host = parts.next().unwrap_or("").to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    if !NODE_REPO_HOSTS.contains(&host.as_str()) {
        return Err(format!(
            "LU installs node packs from github.com, gitlab.com and codeberg.org only. {ASK}"
        ));
    }
    let mut path: Vec<&str> = parts.collect();
    if let Some(last) = path.last_mut() {
        if let Some(stripped) = last.strip_suffix(".git") {
            *last = stripped;
        }
    }
    let max_depth = if host == "gitlab.com" { 4 } else { 2 };
    if path.len() < 2 || path.len() > max_depth || !path.iter().all(|s| plain_segment(s)) {
        return Err(format!("That is not a link to a repository. {ASK}"));
    }
    if path.iter().any(|s| *s == "-" || s.eq_ignore_ascii_case("tree") || s.eq_ignore_ascii_case("blob")) {
        return Err(format!("That link points into a repository, not at it. {ASK}"));
    }
    let folder = path.last().copied().unwrap_or("").to_string();
    if !valid_pack_folder(&folder) {
        return Err(format!("LU cannot use that repository name as a folder. {ASK}"));
    }
    Ok(NodeRepo { url: format!("https://{}/{}", host, path.join("/")), folder })
}

/// Ein Ordner- oder Dateiname direkt unter `custom_nodes/`. Kein Trenner,
/// kein `..`, kein Laufwerk, nichts, was mit `.` oder `-` anfaengt; damit
/// zeigt `custom_nodes.join(name)` immer genau eine Ebene tiefer.
pub(crate) fn valid_pack_folder(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name != "__pycache__"
        && !name.starts_with('.')
        && !name.starts_with('-')
        && !name.contains("..")
        && !name.contains(['/', '\\', ':', '\0'])
        && !name.chars().any(|c| c.is_control())
}

// ── Protokoll fuer die Oberflaeche ──────────────────────────────────────────

const LOG_KEEP: usize = 600;
const LOG_LINE_MAX: usize = 400;

struct NodeLog {
    /// Nummer der ersten noch gehaltenen Zeile.
    first: usize,
    lines: VecDeque<String>,
}

static NODE_LOG: Mutex<NodeLog> = Mutex::new(NodeLog { first: 0, lines: VecDeque::new() });

/// Eine Zeile ins Protokoll der Paketverwaltung (und auf die Konsole, wie
/// bisher). Lange Zeilen werden gekuerzt, alte fallen vorne heraus.
pub(crate) fn node_log(line: &str) {
    println!("[Install] {line}");
    let mut line = line.trim_end().to_string();
    if line.chars().count() > LOG_LINE_MAX {
        line = line.chars().take(LOG_LINE_MAX).collect::<String>() + "…";
    }
    let Ok(mut log) = NODE_LOG.lock() else { return };
    log.lines.push_back(line);
    while log.lines.len() > LOG_KEEP {
        log.lines.pop_front();
        log.first += 1;
    }
}

/// Die Zeilen ab Nummer `since`, und die Nummer, mit der man das naechste Mal
/// fragt. Wer zu Beginn einer Aktion fragt, merkt sich `next` und sieht
/// danach nur die eigenen Zeilen.
fn log_since(since: usize) -> (Vec<String>, usize) {
    let Ok(log) = NODE_LOG.lock() else { return (Vec::new(), since) };
    let next = log.first + log.lines.len();
    let from = since.max(log.first).min(next);
    (log.lines.iter().skip(from - log.first).cloned().collect(), next)
}

#[tauri::command]
pub fn custom_node_log(since: Option<usize>) -> serde_json::Value {
    let (lines, next) = log_since(since.unwrap_or(usize::MAX));
    serde_json::json!({ "lines": lines, "next": next })
}

// ── Was in custom_nodes liegt ───────────────────────────────────────────────

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodePack {
    /// Der Name im Ordner, so wie er dort steht.
    folder: String,
    /// Der Name ohne `.disabled`.
    name: String,
    /// False fuer `X.disabled` und alles unter `custom_nodes/.disabled/`.
    enabled: bool,
    /// Liegt unter `custom_nodes/.disabled/` (der Ort, den ComfyUI-Manager
    /// fuer abgeschaltete Pakete nimmt).
    in_disabled_dir: bool,
    /// "git", "folder" (ohne git) oder "file" (ein einzelnes .py).
    kind: &'static str,
    origin: Option<String>,
    branch: Option<String>,
    commit: Option<String>,
    committed_at: Option<String>,
    has_requirements: bool,
}

/// Das Verzeichnis mit den git-Daten eines Checkouts: `.git` selbst, oder
/// wohin eine `.git`-Datei zeigt (Worktree, Submodul).
fn git_dir_of(pack: &Path) -> Option<PathBuf> {
    let dot = pack.join(".git");
    let meta = std::fs::symlink_metadata(&dot).ok()?;
    if meta.is_dir() {
        return Some(dot);
    }
    let text = std::fs::read_to_string(&dot).ok()?;
    let target = text.lines().next()?.strip_prefix("gitdir:")?.trim();
    let path = PathBuf::from(target);
    Some(if path.is_absolute() { path } else { pack.join(path) })
}

/// Wo die Referenzen liegen: bei einem Worktree im gemeinsamen Verzeichnis.
fn common_dir_of(git_dir: &Path) -> PathBuf {
    match std::fs::read_to_string(git_dir.join("commondir")) {
        Ok(t) => {
            let p = PathBuf::from(t.trim());
            if p.is_absolute() { p } else { git_dir.join(p) }
        }
        Err(_) => git_dir.to_path_buf(),
    }
}

/// Die Adresse von `origin` aus der git-Konfiguration, gelesen, nicht
/// ausgefuehrt.
fn origin_from_config(config: &str) -> Option<String> {
    let mut in_origin = false;
    for line in config.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            let header = line.trim_start_matches('[').trim_end_matches(']').trim();
            in_origin = header.eq_ignore_ascii_case("remote \"origin\"");
            continue;
        }
        if !in_origin {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            if key.trim().eq_ignore_ascii_case("url") {
                return Some(value.trim().trim_matches('"').to_string());
            }
        }
    }
    None
}

/// Anmeldedaten (`https://user:token@host/...`) haben in der Liste nichts zu
/// suchen.
fn without_credentials(url: &str) -> String {
    if let Some((scheme, rest)) = url.split_once("://") {
        let (authority, path) = rest.split_once('/').map(|(a, p)| (a, Some(p))).unwrap_or((rest, None));
        if let Some((_, host)) = authority.rsplit_once('@') {
            return match path {
                Some(p) => format!("{scheme}://{host}/{p}"),
                None => format!("{scheme}://{host}"),
            };
        }
    }
    url.to_string()
}

fn resolve_ref(common: &Path, git_dir: &Path, refname: &str) -> Option<String> {
    for dir in [git_dir, common] {
        if let Ok(t) = std::fs::read_to_string(dir.join(refname)) {
            let id = t.trim().to_string();
            if !id.is_empty() {
                return Some(id);
            }
        }
    }
    let packed = std::fs::read_to_string(common.join("packed-refs")).ok()?;
    packed.lines().find_map(|line| {
        let (id, name) = line.split_once(' ')?;
        (name.trim() == refname && !id.starts_with('#')).then(|| id.to_string())
    })
}

/// Zweig und Stand eines Checkouts, aus den Dateien gelesen.
fn head_of(git_dir: &Path) -> (Option<String>, Option<String>) {
    let common = common_dir_of(git_dir);
    let Ok(head) = std::fs::read_to_string(git_dir.join("HEAD")) else { return (None, None) };
    let head = head.trim();
    let (branch, id) = match head.strip_prefix("ref:") {
        Some(r) => {
            let r = r.trim();
            (r.strip_prefix("refs/heads/").map(str::to_string), resolve_ref(&common, git_dir, r))
        }
        None => (None, Some(head.to_string())),
    };
    let short = id.filter(|i| i.len() >= 7 && i.bytes().all(|b| b.is_ascii_hexdigit())).map(|i| i[..7].to_string());
    (branch, short)
}

fn describe_pack(path: &Path, folder: &str, in_disabled_dir: bool, with_dates: bool) -> Option<NodePack> {
    let meta = std::fs::metadata(path).ok()?;
    let enabled = !in_disabled_dir && !folder.ends_with(".disabled");
    let name = folder.strip_suffix(".disabled").unwrap_or(folder).to_string();
    if meta.is_file() {
        if !name.ends_with(".py") {
            return None;
        }
        return Some(NodePack {
            folder: folder.to_string(), name, enabled, in_disabled_dir, kind: "file",
            origin: None, branch: None, commit: None, committed_at: None, has_requirements: false,
        });
    }
    if !meta.is_dir() {
        return None;
    }
    let has_requirements = path.join("requirements.txt").is_file();
    let Some(git_dir) = git_dir_of(path) else {
        return Some(NodePack {
            folder: folder.to_string(), name, enabled, in_disabled_dir, kind: "folder",
            origin: None, branch: None, commit: None, committed_at: None, has_requirements,
        });
    };
    let config = std::fs::read_to_string(common_dir_of(&git_dir).join("config")).unwrap_or_default();
    let origin = origin_from_config(&config).map(|u| without_credentials(&u));
    let (branch, commit) = head_of(&git_dir);
    // Das Datum ist das einzige, was git selbst sagen muss. Faellt es aus
    // (kein git, fremder Besitzer), fehlt nur das Datum.
    let committed_at = if with_dates {
        git_in(path, &["log", "-1", "--format=%cI"])
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
    } else {
        None
    };
    Some(NodePack {
        folder: folder.to_string(), name, enabled, in_disabled_dir, kind: "git",
        origin, branch, commit, committed_at, has_requirements,
    })
}

/// Alle Pakete unter `custom_nodes/` und unter `custom_nodes/.disabled/`,
/// nach Namen sortiert. `__pycache__`, versteckte Ordner und Dateien, die
/// kein .py sind, gehoeren nicht dazu (ComfyUI laedt sie auch nicht).
pub(crate) fn list_packs(custom_nodes: &Path, with_dates: bool) -> Vec<NodePack> {
    let mut packs = Vec::new();
    for (dir, in_disabled_dir) in [(custom_nodes.to_path_buf(), false), (custom_nodes.join(".disabled"), true)] {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let folder = e.file_name().to_string_lossy().into_owned();
            if !valid_pack_folder(&folder) {
                continue;
            }
            if let Some(p) = describe_pack(&e.path(), &folder, in_disabled_dir, with_dates) {
                packs.push(p);
            }
        }
    }
    packs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then(a.enabled.cmp(&b.enabled).reverse()));
    packs
}

/// Der lokale ComfyUI-Ordner, so wie die Installation ihn findet.
fn local_comfy_dir(comfy_path: Option<String>) -> Result<PathBuf, String> {
    comfy_path
        .filter(|p| !p.trim().is_empty())
        .or_else(crate::commands::process::find_comfyui_path)
        .map(PathBuf::from)
        .ok_or_else(|| "ComfyUI not found. Install ComfyUI first.".to_string())
}

#[tauri::command]
pub async fn list_custom_nodes(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    if let Some(remote) = crate::commands::download::remote_comfy(&state) {
        return Ok(serde_json::json!({
            "available": false,
            "reason": format!(
                "Your ComfyUI runs on {}. LU cannot manage node packs on another machine. Install them there, then restart that ComfyUI.",
                remote.host
            ),
            "packs": [],
        }));
    }
    let comfy_path = { state.comfy_path.lock().unwrap().clone() };
    tauri::async_runtime::spawn_blocking(move || {
        let comfy_dir = match local_comfy_dir(comfy_path) {
            Ok(d) => d,
            Err(reason) => return serde_json::json!({ "available": false, "reason": reason, "packs": [] }),
        };
        let custom_nodes = comfy_dir.join("custom_nodes");
        serde_json::json!({
            "available": true,
            "path": custom_nodes.to_string_lossy(),
            "packs": list_packs(&custom_nodes, true),
        })
    })
    .await
    .map_err(|e| format!("Listing the node packs failed to run: {e}"))
}

// ── Entfernen: in den Papierkorb, nie endgueltig ────────────────────────────

/// Der Pfad eines Pakets, nachdem Name und Ort geprueft sind. Er liegt immer
/// genau eine Ebene unter `custom_nodes/` bzw. `custom_nodes/.disabled/`.
pub(crate) fn pack_path(custom_nodes: &Path, folder: &str, in_disabled_dir: bool) -> Result<PathBuf, String> {
    if !valid_pack_folder(folder) {
        return Err("Refusing to remove: invalid node pack name.".to_string());
    }
    let parent = if in_disabled_dir { custom_nodes.join(".disabled") } else { custom_nodes.to_path_buf() };
    let path = parent.join(folder);
    if path.parent() != Some(parent.as_path()) {
        return Err("Refusing to remove: invalid node pack name.".to_string());
    }
    if std::fs::symlink_metadata(&path).is_err() {
        return Err(format!("{folder} is not in the custom_nodes folder anymore."));
    }
    Ok(path)
}

/// Ob ein Paket gerade bewegt werden kann: einmal umbenennen und zurueck.
/// Unter Windows scheitert das, solange ComfyUI eine Datei darin offen hat,
/// und dann soll der Papierkorb gar nicht erst anfangen (er koennte die
/// Haelfte verschieben).
fn movable(path: &Path) -> Result<(), String> {
    let mut probe = path.as_os_str().to_owned();
    probe.push(".lu-check.disabled");
    let probe = PathBuf::from(probe);
    std::fs::rename(path, &probe).map_err(|e| crate::os_error::english(&e))?;
    if let Err(e) = std::fs::rename(&probe, path) {
        return Err(format!(
            "it was moved to {} and could not be moved back: {}",
            probe.display(),
            crate::os_error::english(&e)
        ));
    }
    Ok(())
}

/// Die Regel des Entfernens, ohne Dateisystem und ohne Prozess pruefbar:
/// erst schauen, ob sich das Paket bewegen laesst; wenn nicht, LUs eigenes,
/// ruhendes ComfyUI anhalten, dann in den Papierkorb, dann ComfyUI wieder
/// starten. Gibt zurueck, ob ComfyUI dabei neu gestartet wurde.
pub(crate) fn trash_freeing_lock(
    folder: &str,
    probe: &dyn Fn() -> Result<(), String>,
    trash: &dyn Fn() -> Result<(), String>,
    pause: &ComfyPause<'_>,
) -> Result<bool, String> {
    let reason = match probe() {
        Ok(()) => return trash().map(|_| false),
        Err(reason) => reason,
    };
    match (pause.stop)() {
        OwnComfyStop::Stopped => {
            let result = probe().and_then(|_| trash());
            (pause.start)();
            result.map(|_| true)
        }
        OwnComfyStop::Busy => Err(format!(
            "ComfyUI is generating something right now and has files of {folder} open. \
             Wait for the render to finish, then remove it again."
        )),
        OwnComfyStop::Foreign => Err(format!(
            "A ComfyUI this app did not start has files of {folder} open. Close that ComfyUI, then remove it again."
        )),
        _ => Err(format!("{folder} could not be moved: {reason}. Stop ComfyUI, then remove it again.")),
    }
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn remove_custom_node(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    folder: String,
    inDisabledDir: Option<bool>,
) -> Result<serde_json::Value, String> {
    if let Some(remote) = crate::commands::download::remote_comfy(&state) {
        return Err(format!("Your ComfyUI runs on {}. LU cannot remove node packs on another machine.", remote.host));
    }
    let comfy_path = { state.comfy_path.lock().unwrap().clone() };
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let custom_nodes = local_comfy_dir(comfy_path)?.join("custom_nodes");
        let path = pack_path(&custom_nodes, &folder, inDisabledDir.unwrap_or(false))?;
        node_log(&format!("Moving {folder} to the trash"));
        let pause = ComfyPause {
            stop: &|| super::comfy_repair::stop_own_idle_comfyui(&state),
            start: &|| {
                if let Err(e) = crate::commands::process::start_comfyui_blocking(&state) {
                    tracing::error!(error = %e, "comfyui did not start again after a node pack removal");
                }
            },
        };
        let restarted = trash_freeing_lock(
            &folder,
            &|| movable(&path),
            &|| {
                trash::delete(&path).map_err(|e| {
                    format!("Could not move {folder} to the trash: {e}. Nothing was deleted.")
                })
            },
            &pause,
        )
        .inspect_err(|e| node_log(e))?;
        node_log(&format!("{folder} is in the trash"));
        Ok(serde_json::json!({ "trashed": true, "folder": folder, "restarted": restarted }))
    })
    .await
    .map_err(|e| format!("Removing the node pack failed to run: {e}"))?
}

/// For the tests of custom_nodes.rs: where the log stands, and what came after.
/// Only the Unix tests there read the log, so on Windows these two would be
/// dead code and fail `clippy --all-targets -D warnings`.
#[cfg(all(test, unix))]
pub(crate) fn tests_log_mark() -> usize {
    log_since(usize::MAX).1
}

#[cfg(all(test, unix))]
pub(crate) fn tests_log_since(mark: usize) -> Vec<String> {
    log_since(mark).0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn a_plain_repository_link_is_accepted_and_names_its_folder() {
        let r = node_repo_from_url("https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite").unwrap();
        assert_eq!(r.url, "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite");
        assert_eq!(r.folder, "ComfyUI-VideoHelperSuite");
        let r = node_repo_from_url("  https://www.GitHub.com/city96/ComfyUI-GGUF.git/ ").unwrap();
        assert_eq!(r.url, "https://github.com/city96/ComfyUI-GGUF");
        assert_eq!(r.folder, "ComfyUI-GGUF");
        let r = node_repo_from_url("https://codeberg.org/someone/comfy_nodes").unwrap();
        assert_eq!(r.folder, "comfy_nodes");
        let r = node_repo_from_url("https://gitlab.com/group/sub/pack.git").unwrap();
        assert_eq!(r.url, "https://gitlab.com/group/sub/pack");
        assert_eq!(r.folder, "pack");
    }

    #[test]
    fn every_other_link_is_refused_before_git_sees_it() {
        for bad in [
            "http://github.com/a/b",
            "git@github.com:a/b.git",
            "ssh://github.com/a/b",
            "ext::sh -c touch% /tmp/x",
            "file:///etc/passwd",
            "https://example.com/a/b",
            "https://github.com.evil.io/a/b",
            "https://user:token@github.com/a/b",
            "https://github.com:8443/a/b",
            "https://github.com/a",
            "https://github.com/a/b/c",
            "https://github.com/a/b/tree/main",
            "https://gitlab.com/a/b/-/tree/main",
            "https://github.com/a/..",
            "https://github.com/a/-upload-pack",
            "https://github.com/a/.hidden",
            "https://github.com/a/b?x=1",
            "https://github.com/a/b#readme",
            "https://github.com/a/b c",
            "https://github.com/a/b%2F..",
            "https://github.com/a\\b/c",
            "",
        ] {
            assert!(node_repo_from_url(bad).is_err(), "accepted: {bad}");
        }
    }

    #[test]
    fn a_folder_name_never_leaves_custom_nodes() {
        for good in ["ComfyUI-GGUF", "comfyui_controlnet_aux", "x.disabled", "single.py"] {
            assert!(valid_pack_folder(good), "refused: {good}");
        }
        for bad in ["", "..", "../x", "a/b", "a\\b", "C:x", ".git", ".disabled", "-rf", "__pycache__", "a..b", "a\u{0}b"] {
            assert!(!valid_pack_folder(bad), "accepted: {bad:?}");
        }
    }

    #[test]
    fn origin_is_read_from_the_config_without_its_credentials() {
        let cfg = "[core]\n\trepositoryformatversion = 0\n[remote \"upstream\"]\n\turl = https://github.com/x/y\n[remote \"origin\"]\n\turl = https://bob:ghp_secret@github.com/a/b.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n";
        let url = origin_from_config(cfg).unwrap();
        assert_eq!(without_credentials(&url), "https://github.com/a/b.git");
        assert_eq!(origin_from_config("[core]\n\tbare = false\n"), None);
        assert_eq!(without_credentials("https://github.com/a/b"), "https://github.com/a/b");
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// Ein Ordner wie nach einem Klon, von Hand gebaut, damit der Test ohne
    /// git laeuft: ein Zweig mit loser Referenz, ein abgehaengter Stand, ein
    /// Zweig nur in packed-refs.
    #[test]
    fn the_listing_names_origin_branch_state_and_what_is_disabled() {
        let tmp = tempfile::tempdir().unwrap();
        let cn = tmp.path().join("custom_nodes");
        let id = "58f1947a11567a9f8b707223185570850e773856";

        let a = cn.join("ComfyUI-GGUF");
        write(&a.join(".git/HEAD"), "ref: refs/heads/main\n");
        write(&a.join(".git/refs/heads/main"), &format!("{id}\n"));
        write(&a.join(".git/config"), "[remote \"origin\"]\n\turl = https://github.com/city96/ComfyUI-GGUF\n");
        write(&a.join("requirements.txt"), "gguf\n");

        let b = cn.join("ComfyUI-RMBG.disabled");
        write(&b.join(".git/HEAD"), &format!("{id}\n"));
        write(&b.join(".git/config"), "[remote \"origin\"]\n\turl = https://github.com/1038lab/ComfyUI-RMBG\n");

        let c = cn.join(".disabled/old-pack");
        write(&c.join(".git/HEAD"), "ref: refs/heads/master\n");
        write(&c.join(".git/packed-refs"), &format!("# pack-refs with: peeled\n{id} refs/heads/master\n"));

        write(&cn.join("loose/__init__.py"), "");
        write(&cn.join("single_node.py"), "");
        write(&cn.join("example_node.py.example"), "");
        std::fs::create_dir_all(cn.join("__pycache__")).unwrap();

        let packs = list_packs(&cn, false);
        let names: Vec<_> = packs.iter().map(|p| p.folder.as_str()).collect();
        assert_eq!(names, ["ComfyUI-GGUF", "ComfyUI-RMBG.disabled", "loose", "old-pack", "single_node.py"]);

        let gguf = &packs[0];
        assert_eq!((gguf.kind, gguf.enabled, gguf.has_requirements), ("git", true, true));
        assert_eq!(gguf.origin.as_deref(), Some("https://github.com/city96/ComfyUI-GGUF"));
        assert_eq!(gguf.branch.as_deref(), Some("main"));
        assert_eq!(gguf.commit.as_deref(), Some("58f1947"));

        let rmbg = &packs[1];
        assert_eq!((rmbg.name.as_str(), rmbg.enabled, rmbg.in_disabled_dir), ("ComfyUI-RMBG", false, false));
        assert_eq!((rmbg.branch.as_deref(), rmbg.commit.as_deref()), (None, Some("58f1947")));

        assert_eq!(packs[2].kind, "folder");
        let old = &packs[3];
        assert_eq!((old.enabled, old.in_disabled_dir, old.commit.as_deref()), (false, true, Some("58f1947")));
        assert_eq!(packs[4].kind, "file");
    }

    #[test]
    fn the_listing_of_a_missing_folder_is_empty() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(list_packs(&tmp.path().join("nope"), false).is_empty());
    }

    #[test]
    fn a_pack_path_stays_one_level_below_custom_nodes() {
        let tmp = tempfile::tempdir().unwrap();
        let cn = tmp.path().join("custom_nodes");
        std::fs::create_dir_all(cn.join("Pack")).unwrap();
        std::fs::create_dir_all(cn.join(".disabled/Old")).unwrap();
        assert_eq!(pack_path(&cn, "Pack", false).unwrap(), cn.join("Pack"));
        assert_eq!(pack_path(&cn, "Old", true).unwrap(), cn.join(".disabled/Old"));
        assert!(pack_path(&cn, "..", false).is_err());
        assert!(pack_path(&cn, "../custom_nodes", false).is_err());
        assert!(pack_path(&cn, ".disabled", false).is_err());
        assert!(pack_path(&cn, "Missing", false).unwrap_err().contains("not in the custom_nodes folder"));
    }

    #[test]
    fn a_movable_folder_is_left_where_it_was() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("Pack");
        write(&p.join("a.py"), "x");
        movable(&p).unwrap();
        assert!(p.join("a.py").exists());
        assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 1, "the probe name stayed behind");
    }

    fn run_remove(probe_fails: usize, found: fn() -> OwnComfyStop) -> (Result<bool, String>, Vec<&'static str>) {
        let events = RefCell::new(Vec::new());
        let left = std::cell::Cell::new(probe_fails);
        let probe = || {
            events.borrow_mut().push("probe");
            if left.get() > 0 {
                left.set(left.get() - 1);
                Err("access is denied".to_string())
            } else {
                Ok(())
            }
        };
        let trash = || {
            events.borrow_mut().push("trash");
            Ok(())
        };
        let stop = || {
            events.borrow_mut().push("stop");
            found()
        };
        let start = || events.borrow_mut().push("start");
        let r = trash_freeing_lock("Pack", &probe, &trash, &ComfyPause { stop: &stop, start: &start });
        (r, events.into_inner())
    }

    #[test]
    fn a_free_pack_goes_to_the_trash_without_touching_comfyui() {
        assert_eq!(run_remove(0, || OwnComfyStop::Stopped), (Ok(false), vec!["probe", "trash"]));
    }

    #[test]
    fn a_pack_held_by_the_apps_own_comfyui_is_freed_and_comfyui_comes_back() {
        assert_eq!(
            run_remove(1, || OwnComfyStop::Stopped),
            (Ok(true), vec!["probe", "stop", "probe", "trash", "start"])
        );
    }

    #[test]
    fn a_pack_that_stays_locked_is_never_trashed_and_comfyui_still_comes_back() {
        let (r, events) = run_remove(2, || OwnComfyStop::Stopped);
        assert!(r.is_err());
        assert_eq!(events, ["probe", "stop", "probe", "start"]);
    }

    #[test]
    fn a_render_or_a_foreign_comfyui_is_left_alone_and_named() {
        let (r, events) = run_remove(1, || OwnComfyStop::Busy);
        assert!(r.unwrap_err().starts_with("ComfyUI is generating something right now"));
        assert_eq!(events, ["probe", "stop"]);
        let (r, _) = run_remove(1, || OwnComfyStop::Foreign);
        assert!(r.unwrap_err().contains("Close that ComfyUI"));
    }

    #[test]
    fn the_log_hands_out_only_the_lines_after_the_mark() {
        let (_, mark) = log_since(usize::MAX);
        node_log("first line of this test");
        node_log(&"x".repeat(LOG_LINE_MAX + 50));
        let (lines, next) = log_since(mark);
        let mine: Vec<_> = lines.iter().filter(|l| l.as_str() == "first line of this test" || l.starts_with("xxx")).collect();
        assert_eq!(mine.len(), 2);
        assert!(mine[1].chars().count() <= LOG_LINE_MAX + 1);
        assert!(next >= mark + 2);
        assert!(log_since(next).0.len() <= lines.len());
    }

    /// Quelltext-Waechter: Entfernen heisst Papierkorb. Ein `remove_dir_all`
    /// in diesem Modul waere genau das endgueltige Loeschen, das es nicht
    /// geben darf.
    #[test]
    fn this_module_never_deletes_for_good() {
        let src = include_str!("custom_node_packs.rs");
        let shipped = src.split("#[cfg(test)]").next().unwrap();
        for forbidden in ["remove_dir_all", "remove_file(", "remove_dir("] {
            assert!(!shipped.contains(forbidden), "custom_node_packs.rs deletes with {forbidden}");
        }
        assert!(shipped.contains("trash::delete(&path)"));
    }
}
