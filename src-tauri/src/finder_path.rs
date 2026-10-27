//! What an app started from the Finder is missing: the user's PATH.
//!
//! A Mac app opened from the Finder, the Dock or Spotlight inherits the
//! launchd PATH, `/usr/bin:/bin:/usr/sbin:/sbin`, and nothing a shell profile
//! adds to it. Homebrew (`/opt/homebrew/bin`), the Ollama CLI
//! (`/usr/local/bin`), uv and pipx (`~/.local/bin`) are all invisible to a
//! bare `Command::new("name")`, although the same name works in the user's
//! terminal. Started from a terminal the app has the full PATH, which is why
//! this only ever shows on a customer's machine.
//!
//! Two answers live here, and each caller takes the one that fits:
//!
//!   * a program WE look for (Python, Ollama): `resolve_tool` checks PATH and
//!     then the fixed directories those programs install into. No shell is
//!     started for that.
//!   * a shell the AGENT runs commands in: `child_path` asks the user's login
//!     shell for its PATH once and the shell child gets that, so `brew`,
//!     `node` and `ffmpeg` resolve the way they do in a terminal.
//!
//! Windows has no such split and Linux desktop sessions hand the session PATH
//! to their apps, so both keep exactly what they had.

#[cfg(unix)]
use std::path::Path;
#[cfg(not(target_os = "windows"))]
use std::path::PathBuf;

/// The directories command line tools land in that a Finder-started app does
/// not have on its PATH: Homebrew on Apple Silicon, Homebrew on Intel together
/// with everything that installs into `/usr/local` (the Ollama CLI, python.org),
/// and the per-user bin of uv and pipx.
#[cfg(any(target_os = "macos", all(test, unix)))]
pub fn fixed_tool_dirs(home: &Path) -> Vec<PathBuf> {
    vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/opt/homebrew/sbin"),
        PathBuf::from("/usr/local/bin"),
        home.join(".local/bin"),
    ]
}

/// `name` in every one of `dirs` that holds it as a file, in their order.
#[cfg(not(target_os = "windows"))]
pub fn find_in_dirs(name: &str, dirs: &[PathBuf]) -> Vec<PathBuf> {
    dirs.iter().map(|d| d.join(name)).filter(|p| p.is_file()).collect()
}

/// Where `name` is, looked for the way a Finder-started app has to: the PATH
/// hit first, so a shell-started app keeps its exact behaviour, then the fixed
/// directories, then `extra`, the full paths only this program has (a CLI
/// inside its app bundle).
///
/// The PATH answer is passed in so the rule can be tested without touching
/// the process environment.
#[cfg(any(target_os = "macos", all(test, unix)))]
pub fn resolve_tool_from(
    name: &str,
    on_path: Option<PathBuf>,
    dirs: &[PathBuf],
    extra: &[PathBuf],
) -> Option<PathBuf> {
    on_path
        .or_else(|| find_in_dirs(name, dirs).into_iter().next())
        .or_else(|| extra.iter().find(|p| p.is_file()).cloned())
}

/// [`resolve_tool_from`] with the real PATH and the real home directory.
#[cfg(target_os = "macos")]
pub fn resolve_tool(name: &str, extra: &[PathBuf]) -> Option<PathBuf> {
    resolve_tool_from(
        name,
        which::which(name).ok(),
        &fixed_tool_dirs(&crate::os_paths::home()),
        extra,
    )
}

// ── The PATH of the user's login shell ──────────────────────────────────────

/// The markers the PATH is printed between. A profile may print anything it
/// likes before or after (a greeting, a version manager's banner), so the
/// value is cut out and never taken as "all of stdout".
#[cfg(unix)]
const PATH_START: &str = "__LU_PATH_START__";
#[cfg(unix)]
const PATH_END: &str = "__LU_PATH_END__";

/// How long the login shell gets. A healthy profile answers in well under a
/// tenth of a second; one that waits for a network mount or a prompt must not
/// hold the agent's first command, so after this the fixed directories are
/// used instead.
#[cfg(target_os = "macos")]
pub const LOGIN_PATH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// The PATH between the markers, or `None` when the shell printed none.
#[cfg(unix)]
fn parse_marked_path(stdout: &str) -> Option<String> {
    let start = stdout.rfind(PATH_START)? + PATH_START.len();
    let len = stdout[start..].find(PATH_END)?;
    let path = stdout[start..start + len].trim();
    (!path.is_empty()).then(|| path.to_string())
}

/// The shell to ask. `$SHELL` when it is one that reads `-l -c` and writes
/// `$PATH` as one colon-separated string; anything else (fish keeps PATH as a
/// list, nushell has no `$PATH` at all) is replaced by zsh, the shell every
/// Mac since 10.15 ships, which still reads `/etc/zprofile` and with it
/// `path_helper` and the Homebrew line most installs put into `~/.zprofile`.
#[cfg(unix)]
fn login_shell_for(shell_env: Option<&str>) -> PathBuf {
    const POSIX_LIKE: [&str; 5] = ["zsh", "bash", "sh", "dash", "ksh"];
    shell_env
        .map(Path::new)
        .filter(|p| p.is_absolute())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| POSIX_LIKE.contains(&n))
        })
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("/bin/zsh"))
}

/// Ask `shell` for the PATH a login shell has, giving up after `max`.
///
/// `-l -c`, never `-i`: a login shell reads the profile files (`/etc/zprofile`,
/// `~/.zprofile`, `~/.bash_profile`), which is where PATH belongs and where
/// Homebrew writes it. An interactive shell would also read `~/.zshrc`, and
/// that is the file with prompts, completion setup and the occasional
/// `read`, the things that hang without a terminal. Standard input is closed
/// for the same reason. A PATH that is only set in `~/.zshrc` is therefore
/// not seen; the fixed directories cover the common part of that.
#[cfg(unix)]
fn read_login_path(shell: &Path, max: std::time::Duration) -> Option<String> {
    let mut cmd = crate::process_util::foreign_system_command(shell);
    cmd.arg("-l")
        .arg("-c")
        .arg(format!("printf '{PATH_START}%s{PATH_END}' \"$PATH\""));
    let stdout = crate::commands::shell::output_bounded(cmd, max)?;
    parse_marked_path(&stdout)
}

/// One PATH out of three sources, first mention wins: what the login shell
/// has, what this process inherited, and the fixed directories that exist.
///
/// The login shell goes first because its order is the user's own choice of
/// which `python3` or `git` wins. The inherited PATH follows so nothing the
/// app was started with is lost (a terminal start, a test, a wrapper script).
/// The fixed directories come last and are what is left when the shell gave
/// no answer in time.
#[cfg(any(target_os = "macos", all(test, unix)))]
fn merge_path(
    login: Option<&str>,
    inherited: Option<&std::ffi::OsStr>,
    fixed: &[PathBuf],
    exists: impl Fn(&Path) -> bool,
) -> std::ffi::OsString {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut push = |p: PathBuf| {
        if !p.as_os_str().is_empty() && !out.contains(&p) {
            out.push(p);
        }
    };
    if let Some(login) = login {
        std::env::split_paths(login).for_each(&mut push);
    }
    if let Some(inherited) = inherited {
        std::env::split_paths(inherited).for_each(&mut push);
    }
    fixed.iter().filter(|p| exists(p)).cloned().for_each(&mut push);
    // `join_paths` only fails on an entry that itself contains the separator,
    // which `split_paths` cannot have produced; the fixed ones have none.
    std::env::join_paths(out).unwrap_or_default()
}

/// The PATH a shell child gets on a Mac, worked out once per app run.
///
/// The first call may take as long as the login shell does (bounded by
/// [`LOGIN_PATH_TIMEOUT`]); every later call is a read. It is not refreshed
/// while the app runs: a tool installed in the meantime is found after the
/// next start, or at once when it went into one of the fixed directories.
#[cfg(target_os = "macos")]
pub fn child_path() -> &'static std::ffi::OsStr {
    static PATH: std::sync::OnceLock<std::ffi::OsString> = std::sync::OnceLock::new();
    PATH.get_or_init(|| {
        let shell = login_shell_for(std::env::var("SHELL").ok().as_deref());
        let login = read_login_path(&shell, LOGIN_PATH_TIMEOUT);
        if login.is_none() {
            println!(
                "[Path] {} gave no PATH within {} s, using the fixed tool directories",
                shell.display(),
                LOGIN_PATH_TIMEOUT.as_secs()
            );
        }
        merge_path(
            login.as_deref(),
            std::env::var_os("PATH").as_deref(),
            &fixed_tool_dirs(&crate::os_paths::home()),
            |p| p.is_dir(),
        )
    })
}

/// The PATH a Linux user's login shell has, asked fresh, or None.
///
/// A Linux app started from the menu gets the desktop session's PATH, which
/// holds nothing a shell profile adds. Only asked when a program the app
/// needs (Node for REA) is not on its own PATH, so it is not cached: a Node
/// installed while the app runs is found at the next switch.
#[cfg(all(unix, not(target_os = "macos")))]
pub fn linux_login_path() -> Option<String> {
    linux_login_path_within(std::time::Duration::from_secs(3))
}

/// The same with a deadline of the caller's choice: a test on a busy machine
/// must not fail because a real login shell took longer than an app may wait.
#[cfg(any(all(unix, not(target_os = "macos")), all(test, unix)))]
fn linux_login_path_within(max: std::time::Duration) -> Option<String> {
    let shell = std::env::var("SHELL").ok();
    let shell = shell
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| login_shell_for(Some(s)))
        .filter(|p| p.as_os_str() != "/bin/zsh" || p.exists())
        .unwrap_or_else(|| PathBuf::from("/bin/bash"));
    let shell = if shell.exists() { shell } else { PathBuf::from("/bin/sh") };
    read_login_path(&shell, max)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// The PATH launchd gives an app opened from the Finder.
    const FINDER_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

    fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write script");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        path
    }

    /// Fund 2: Ollama sits in `/usr/local/bin`, PATH does not name it, and the
    /// app said it was not installed.
    #[test]
    fn a_tool_outside_the_finder_path_is_found_in_the_fixed_directories() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let brew = tmp.path().join("homebrew-bin");
        let local = tmp.path().join("usr-local-bin");
        std::fs::create_dir_all(&brew).unwrap();
        std::fs::create_dir_all(&local).unwrap();
        std::fs::write(local.join("ollama"), "").unwrap();
        let dirs = vec![brew.clone(), local.clone()];

        assert_eq!(resolve_tool_from("ollama", None, &dirs, &[]), Some(local.join("ollama")));

        // Both there: the order of the directories decides.
        std::fs::write(brew.join("ollama"), "").unwrap();
        assert_eq!(resolve_tool_from("ollama", None, &dirs, &[]), Some(brew.join("ollama")));
    }

    #[test]
    fn a_path_hit_wins_so_a_terminal_start_behaves_as_before() {
        let tmp = tempfile::tempdir().expect("tempdir");
        std::fs::write(tmp.path().join("ollama"), "").unwrap();
        let on_path = PathBuf::from("/somewhere/on/path/ollama");
        assert_eq!(
            resolve_tool_from("ollama", Some(on_path.clone()), &[tmp.path().to_path_buf()], &[]),
            Some(on_path)
        );
    }

    /// Only Ollama.app is installed and its CLI link was never created: the
    /// binary inside the bundle is the one left.
    #[test]
    fn the_copy_inside_an_app_bundle_is_the_last_resort() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let bundled = tmp.path().join("Ollama.app/Contents/Resources/ollama");
        std::fs::create_dir_all(bundled.parent().unwrap()).unwrap();
        let missing = tmp.path().join("nowhere/ollama");
        let extra = vec![missing, bundled.clone()];
        assert_eq!(resolve_tool_from("ollama", None, &[], &extra), None, "a directory entry is not there yet");
        std::fs::write(&bundled, "").unwrap();
        assert_eq!(resolve_tool_from("ollama", None, &[], &extra), Some(bundled));
    }

    #[test]
    fn nothing_anywhere_is_none() {
        assert_eq!(resolve_tool_from("ollama", None, &[PathBuf::from("/nonexistent-lu")], &[]), None);
    }

    #[test]
    fn the_fixed_directories_name_homebrew_and_usr_local() {
        let dirs = fixed_tool_dirs(Path::new("/Users/someone"));
        for want in ["/opt/homebrew/bin", "/usr/local/bin", "/Users/someone/.local/bin"] {
            assert!(dirs.contains(&PathBuf::from(want)), "{want} missing from {dirs:?}");
        }
    }

    #[test]
    fn the_path_is_cut_out_of_whatever_a_profile_prints() {
        let noisy = format!("Welcome back!\nnvm: using node 22\n{PATH_START}/opt/homebrew/bin:/usr/bin{PATH_END}\n");
        assert_eq!(parse_marked_path(&noisy).as_deref(), Some("/opt/homebrew/bin:/usr/bin"));
        assert_eq!(parse_marked_path("/opt/homebrew/bin:/usr/bin"), None, "unmarked output is not a PATH");
        assert_eq!(parse_marked_path(&format!("{PATH_START}{PATH_END}")), None);
        assert_eq!(parse_marked_path(&format!("{PATH_START}/usr/bin")), None, "a cut-off answer is no answer");
    }

    #[test]
    fn only_a_shell_that_prints_a_colon_path_is_asked() {
        assert_eq!(login_shell_for(Some("/bin/zsh")), PathBuf::from("/bin/zsh"));
        assert_eq!(login_shell_for(Some("/opt/homebrew/bin/bash")), PathBuf::from("/opt/homebrew/bin/bash"));
        assert_eq!(login_shell_for(Some("/opt/homebrew/bin/fish")), PathBuf::from("/bin/zsh"));
        assert_eq!(login_shell_for(Some("/opt/homebrew/bin/nu")), PathBuf::from("/bin/zsh"));
        assert_eq!(login_shell_for(Some("zsh")), PathBuf::from("/bin/zsh"), "a bare name is not trusted");
        assert_eq!(login_shell_for(None), PathBuf::from("/bin/zsh"));
    }

    /// Fund 7: the agent's shell had the Finder PATH and nothing of Homebrew.
    #[test]
    fn the_linux_login_path_comes_back_from_the_users_shell() {
        // Built for Linux; the same code runs here against this machine's
        // shell, which is enough to see it asks with -l -c and parses.
        let path = linux_login_path_within(std::time::Duration::from_secs(30)).expect("a login PATH");
        assert!(path.split(':').any(|p| p == "/usr/bin"), "{path}");
    }

    #[test]
    fn the_child_path_carries_the_login_shell_first_and_loses_nothing() {
        let merged = merge_path(
            Some("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"),
            Some(std::ffi::OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin:/custom/wrapper")),
            &[PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/Users/x/.local/bin")],
            |_| true,
        );
        assert_eq!(
            merged.to_str().unwrap(),
            "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/custom/wrapper:/Users/x/.local/bin"
        );
    }

    #[test]
    fn without_an_answer_from_the_shell_the_fixed_directories_that_exist_are_added() {
        let merged = merge_path(
            None,
            Some(std::ffi::OsStr::new(FINDER_PATH)),
            &[PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")],
            |p| p == Path::new("/opt/homebrew/bin"),
        );
        assert_eq!(merged.to_str().unwrap(), format!("{FINDER_PATH}:/opt/homebrew/bin"));
    }

    /// A stand-in for a login shell whose profile adds Homebrew and chatters.
    #[test]
    fn a_login_shell_is_asked_with_l_and_c_and_its_path_comes_back() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let shell = script(
            tmp.path(),
            "zsh",
            r#"[ "$1" = "-l" ] && [ "$2" = "-c" ] || exit 9
echo "profile banner"
PATH="/opt/homebrew/bin:$PATH"
export PATH
eval "$3""#,
        );
        let path = read_login_path(&shell, std::time::Duration::from_secs(10)).expect("a PATH");
        assert!(path.starts_with("/opt/homebrew/bin:"), "{path}");
        assert!(!path.contains("banner"), "{path}");
    }

    /// A profile that waits forever must cost the timeout and no more.
    #[test]
    fn a_profile_that_hangs_is_given_up_on() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let shell = script(tmp.path(), "zsh", "sleep 30");
        let started = std::time::Instant::now();
        let path = read_login_path(&shell, std::time::Duration::from_millis(300));
        assert_eq!(path, None);
        assert!(started.elapsed() < std::time::Duration::from_secs(10), "{:?}", started.elapsed());
    }

    /// The real thing on this Mac: from the Finder PATH alone, the login shell
    /// still knows the system's own additions (`/etc/paths` through
    /// `path_helper`), which is the mechanism Homebrew rides on.
    #[cfg(target_os = "macos")]
    #[test]
    fn this_macs_login_shell_answers_with_a_path() {
        let path = read_login_path(Path::new("/bin/zsh"), std::time::Duration::from_secs(20))
            .expect("/bin/zsh -l -c answered");
        assert!(std::env::split_paths(&path).any(|p| p == Path::new("/usr/bin")), "{path}");
        assert!(child_path().to_string_lossy().contains("/usr/bin"));
    }
}
