//! How an error of the file commands names a path.
//!
//! On a desktop an error names the full path: it is where the user can look.
//! On a phone the full path is the private folder of the app
//! ("/data/user/0/<package>/files/home/agent-workspace/new-chat-15c857/notes.md"),
//! a place nobody can open, and a small model repeats it word for word in its
//! answer (acceptance on Android with 8 GB, B11). The results of the file
//! tools were shortened in the frontend already (src/lib/phone-file-path.ts);
//! the errors of these commands still carried the folder.
//!
//! There an error names the path the way the model named it: inside the folder
//! of the chat. The rule is the same one phone-file-path.ts applies to
//! results, so a file is called the same thing whether a call worked or not.
//!
//! Only std in here, on purpose: the file compiles and tests on its own
//! (`rustc --test src-tauri/src/shown_path.rs`), without the build of the app.

use std::path::{Component, Path};

/// The path as an error message shows it.
///
/// `workspace_base` is the folder that holds one folder per chat
/// (`os_paths::agent_workspace_root`), `workspace_dir` its name. With
/// `phone` false the answer is the path as it is, byte for byte.
///
/// On a phone:
/// * a path inside `<base>/<chat>/` is its part behind the folder of the chat,
///   with forward slashes, `..` kept so an escape still reads as one;
/// * the folder of the chat itself is `.`;
/// * a path that is somewhere else is its last component. Nothing of the
///   folders above it is shown.
pub fn path_for_message(path: &Path, workspace_base: &Path, workspace_dir: &str, phone: bool) -> String {
    if !phone {
        return path.display().to_string();
    }
    let inside = match path.strip_prefix(workspace_base) {
        Ok(rest) => Some(parts_of(rest)),
        // The same folder can be reached under two spellings on Android
        // ("/data/user/0/..." and "/data/data/..."), so the name of the
        // workspace folder is looked for as well.
        Err(_) => {
            let all = parts_of(path);
            all.iter().rposition(|p| p == workspace_dir).map(|at| all[at + 1..].to_vec())
        }
    };
    match inside {
        // The first part is the folder of the chat.
        Some(parts) if parts.len() > 1 => parts[1..].join("/"),
        // The folder of the chat, or the folder that holds the chats.
        Some(_) => ".".to_string(),
        None => path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| ".".to_string()),
    }
}

fn parts_of(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|c| match c {
            Component::Normal(p) => Some(p.to_string_lossy().into_owned()),
            Component::ParentDir => Some("..".to_string()),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: &str = "/data/user/0/com.example.app/files/home/agent-workspace";
    const DIR: &str = "agent-workspace";

    fn phone(path: &str) -> String {
        path_for_message(Path::new(path), Path::new(BASE), DIR, true)
    }

    #[test]
    fn a_desktop_names_the_full_path_unchanged() {
        for p in [
            "/Users/me/agent-workspace/chat-1/notes.md",
            "/Users/me/projects/app/src/main.rs",
            "relative/file.txt",
            "",
        ] {
            assert_eq!(path_for_message(Path::new(p), Path::new("/Users/me/agent-workspace"), DIR, false), p);
        }
    }

    #[test]
    fn a_phone_names_the_file_inside_the_folder_of_the_chat() {
        assert_eq!(phone(&format!("{BASE}/new-chat-15c857/notes.md")), "notes.md");
        assert_eq!(phone(&format!("{BASE}/new-chat-15c857/out/data.csv")), "out/data.csv");
        assert_eq!(phone(&format!("{BASE}/new-chat-15c857/a/b/c.txt")), "a/b/c.txt");
    }

    #[test]
    fn the_folder_of_the_chat_itself_is_a_dot() {
        assert_eq!(phone(&format!("{BASE}/new-chat-15c857")), ".");
        assert_eq!(phone(&format!("{BASE}/new-chat-15c857/")), ".");
    }

    #[test]
    fn nothing_of_the_app_folder_is_in_any_answer() {
        for p in [
            format!("{BASE}/chat/notes.md"),
            format!("{BASE}/chat"),
            format!("{BASE}/chat/../../../shared_prefs/secret.xml"),
            BASE.to_string(),
            "/data/user/0/com.example.app/files/models/model.gguf".to_string(),
            "/data/data/com.example.app/files/home/agent-workspace/chat/notes.md".to_string(),
            "/etc/passwd".to_string(),
        ] {
            let shown = phone(&p);
            for leak in ["/data", "com.example.app", "files/home", "agent-workspace", "user/0"] {
                assert!(!shown.contains(leak), "{p} is shown as {shown}");
            }
            assert!(!shown.starts_with('/'), "{p} is shown as {shown}");
        }
    }

    #[test]
    fn an_escape_still_reads_as_an_escape() {
        assert_eq!(phone(&format!("{BASE}/chat/../../x.txt")), "../../x.txt");
        assert_eq!(phone(&format!("{BASE}/chat/sub/../../other-chat/notes.md")), "sub/../../other-chat/notes.md");
    }

    #[test]
    fn the_other_spelling_of_the_app_folder_on_android_is_cut_the_same_way() {
        assert_eq!(phone("/data/data/com.example.app/files/home/agent-workspace/chat/out/a.txt"), "out/a.txt");
        assert_eq!(phone("/data/data/com.example.app/files/home/agent-workspace/chat"), ".");
    }

    #[test]
    fn a_path_somewhere_else_is_its_file_name() {
        assert_eq!(phone("/etc/passwd"), "passwd");
        assert_eq!(phone("/data/user/0/com.example.app/files/models/model.gguf"), "model.gguf");
        assert_eq!(phone("/"), ".");
        assert_eq!(phone(BASE), ".");
    }

    #[test]
    fn the_rule_matches_the_one_the_frontend_uses_for_results() {
        // src/lib/phone-file-path.ts, insideChatFolder: same inputs, same answers.
        let ts = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/phone-file-path.ts"),
        )
        .expect("the frontend rule is readable");
        assert!(ts.contains("const WORKSPACE_DIR = 'agent-workspace'"), "the two rules name different folders");
        assert!(ts.contains("parts.slice(at + 2).join('/')"), "the frontend rule changed, look at both");
    }

    /// The file commands build their error texts with `shown(...)`. A bare
    /// `.display()` in an error of filesystem.rs is the full path again.
    #[test]
    fn no_error_of_the_file_commands_prints_a_path_on_its_own() {
        let src = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands/filesystem.rs"),
        )
        .expect("filesystem.rs is readable");
        let production = src.split("\n#[cfg(test)]\nmod tests {").next().unwrap_or(&src);
        assert!(production.contains("fn shown(path: &Path) -> String"), "the wrapper is gone");
        let lines: Vec<&str> = production.lines().collect();
        let mut found = Vec::new();
        for (i, line) in lines.iter().enumerate() {
            let code = line.split("//").next().unwrap_or("");
            if !code.contains(".display()") {
                continue;
            }
            // The statement the line belongs to: back to the line that opens it.
            let from = (0..=i).rev().find(|&k| {
                let l = lines[k];
                l.contains("Err(") || l.contains("format!(") || l.trim_end().ends_with(';') || l.trim().is_empty()
            });
            let opens_error = (from.unwrap_or(i)..=i)
                .any(|k| lines[k].contains("Err(") || lines[k].contains("format!("));
            if opens_error {
                found.push(format!("filesystem.rs:{}: {}", i + 1, line.trim()));
            }
        }
        assert!(found.is_empty(), "an error text names a full path:\n{}", found.join("\n"));
    }
}
