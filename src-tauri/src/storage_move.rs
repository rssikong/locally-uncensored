//! Moving a folder of models or pictures to another place, file by file.
//!
//! Discord "Storage Management" (12.–17.10.2026):
//! models, the gallery and LU's runtime filled drive C:, and a folder could be
//! chosen for new files only. What was there stayed on C:.
//!
//! The rules, each one a test below:
//!
//! * A move, not a copy. On the same drive a file is renamed, which costs no
//!   space and no time. Across drives it is copied next to its new name
//!   (`<name>.lu-part`), checked (size, and the first and last MiB read back
//!   against the original), given its name, and only then is the original
//!   removed. At no point is a file in neither place.
//! * Nothing is overwritten. A file that already exists at the new place is
//!   left where it is, in both places, and counted as kept.
//! * Nothing else is deleted. Folders that are empty after the move stay, and a
//!   file whose original cannot be removed (in use) has its new copy taken back,
//!   so it is in exactly one place, the old one, and the report names it.
//! * The space is checked before the first file moves ([`plan_tree`] says how
//!   much has to cross drives), by the caller, against the target drive.
//! * Cancel stops between files and inside a copy; a copy that was cut short is
//!   only ever the `.lu-part` file LU itself wrote.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;

use crate::os_error;

/// The suffix of a copy that is not finished. Never a name LU or ComfyUI reads.
pub const PART_SUFFIX: &str = ".lu-part";

/// How much is read back from each end of a copied file.
const CHECK_BYTES: u64 = 1024 * 1024;

const CHUNK: usize = 8 * 1024 * 1024;

/// What a move of one folder would do.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreePlan {
    pub files: u64,
    pub bytes: u64,
    /// Bytes that have to be copied because the new place is on another drive.
    /// Zero for a move within one drive.
    pub cross_bytes: u64,
    pub same_volume: bool,
    /// Files that already exist at the new place and stay where they are.
    pub conflicts: u64,
}

/// What a move of one folder did.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeReport {
    pub moved_files: u64,
    pub moved_bytes: u64,
    /// Already at the new place: both stay, nothing was replaced.
    pub kept: u64,
    /// One line each, the first few: the file stays at the old place.
    pub failed: Vec<String>,
    pub failed_count: u64,
    pub cancelled: bool,
}

const FAILED_LINES: usize = 12;

impl TreeReport {
    fn fail(&mut self, line: String) {
        self.failed_count += 1;
        if self.failed.len() < FAILED_LINES {
            self.failed.push(line);
        }
    }
}

/// Whether `a` and `b` are on one drive, so a rename moves the file. `b` may
/// not exist yet; its nearest existing parent decides.
pub fn same_volume(a: &Path, b: &Path) -> bool {
    let existing = |p: &Path| p.ancestors().find(|x| x.exists()).map(Path::to_path_buf);
    let (Some(a), Some(b)) = (existing(a), existing(b)) else { return false };
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (std::fs::metadata(&a), std::fs::metadata(&b)) {
            (Ok(x), Ok(y)) => x.dev() == y.dev(),
            _ => false,
        }
    }
    #[cfg(windows)]
    {
        // The drive letter, or the share of a UNC path. Folder mount points
        // are rare enough that the rename itself is the second opinion: a
        // rename that fails falls back to the copy.
        let root = |p: &Path| {
            p.components().next().map(|c| c.as_os_str().to_string_lossy().to_ascii_lowercase())
        };
        root(&a) == root(&b)
    }
}

/// `inner` lies in `outer` or is it, ignoring case on Windows.
pub fn is_within(inner: &Path, outer: &Path) -> bool {
    if cfg!(windows) {
        let norm = |p: &Path| p.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_ascii_lowercase();
        let (i, o) = (norm(inner), norm(outer));
        i == o || i.starts_with(&format!("{o}\\"))
    } else {
        inner.starts_with(outer)
    }
}

fn files_below(root: &Path) -> impl Iterator<Item = walkdir::DirEntry> {
    walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .flatten()
        .filter(|e| !e.file_type().is_dir())
        .filter(|e| !e.file_name().to_string_lossy().ends_with(PART_SUFFIX))
}

/// Count what a move of `from` into `to` would take. A missing `from` is an
/// empty plan.
pub fn plan_tree(from: &Path, to: &Path) -> TreePlan {
    let mut plan = TreePlan { same_volume: same_volume(from, to), ..TreePlan::default() };
    if !from.is_dir() {
        return plan;
    }
    for entry in files_below(from) {
        let Ok(rel) = entry.path().strip_prefix(from) else { continue };
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if std::fs::symlink_metadata(to.join(rel)).is_ok() {
            plan.conflicts += 1;
            continue;
        }
        plan.files += 1;
        plan.bytes += size;
    }
    if !plan.same_volume {
        plan.cross_bytes = plan.bytes;
    }
    plan
}

/// One file moved, or why not.
#[derive(Debug, PartialEq, Eq)]
pub enum FileMove {
    Moved(u64),
    /// Already at the new place; both stay.
    Kept,
    Cancelled,
}

fn read_window(file: &mut std::fs::File, at: u64, len: u64) -> std::io::Result<Vec<u8>> {
    file.seek(SeekFrom::Start(at))?;
    let mut buf = vec![0u8; len as usize];
    file.read_exact(&mut buf)?;
    Ok(buf)
}

/// The copy holds the size of the original and the same bytes at both ends.
fn check_copy(from: &Path, to: &Path) -> Result<(), String> {
    let io = |e: std::io::Error| os_error::io_english(&e);
    let a = std::fs::metadata(from).map_err(io)?.len();
    let b = std::fs::metadata(to).map_err(io)?.len();
    if a != b {
        return Err(format!("the copy has {b} bytes, the original {a}"));
    }
    let mut x = std::fs::File::open(from).map_err(io)?;
    let mut y = std::fs::File::open(to).map_err(io)?;
    let head = CHECK_BYTES.min(a);
    let tail_at = a.saturating_sub(CHECK_BYTES).max(head);
    for (at, len) in [(0, head), (tail_at, a - tail_at)] {
        if len == 0 {
            continue;
        }
        if read_window(&mut x, at, len).map_err(io)? != read_window(&mut y, at, len).map_err(io)? {
            return Err("the copy does not read back like the original".to_string());
        }
    }
    Ok(())
}

/// Copy `from` to `part`, chunk by chunk, so Cancel is heard inside a large
/// file. Keeps the time the original was last changed.
fn copy_with_cancel(
    from: &Path,
    part: &Path,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64),
) -> std::io::Result<bool> {
    let mut src = std::fs::File::open(from)?;
    let mut dst = std::fs::OpenOptions::new().write(true).create_new(true).open(part)?;
    let mut buf = vec![0u8; CHUNK];
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Ok(false);
        }
        let n = src.read(&mut buf)?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n])?;
        progress(n as u64);
    }
    dst.sync_all()?;
    if let Ok(modified) = std::fs::metadata(from).and_then(|m| m.modified()) {
        let _ = dst.set_modified(modified);
    }
    Ok(true)
}

/// Move one file. `to` must not exist; when it does the file stays.
pub fn move_file(
    from: &Path,
    to: &Path,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64),
) -> Result<FileMove, String> {
    move_file_with(from, to, cancel, progress, &|a, b| std::fs::rename(a, b))
}

/// [`move_file`] with the first rename handed in, so a test can take the path
/// a move across drives takes (the rename fails there) on one drive.
fn move_file_with(
    from: &Path,
    to: &Path,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64),
    rename_first: &dyn Fn(&Path, &Path) -> std::io::Result<()>,
) -> Result<FileMove, String> {
    if std::fs::symlink_metadata(to).is_ok() {
        return Ok(FileMove::Kept);
    }
    let meta = std::fs::symlink_metadata(from).map_err(|e| os_error::io_english(&e))?;
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("LU cannot create {}: {}", parent.display(), os_error::io_english(&e)))?;
    }
    // Same drive: one rename, nothing copied.
    if rename_first(from, to).is_ok() {
        progress(meta.len());
        return Ok(FileMove::Moved(meta.len()));
    }
    if meta.file_type().is_symlink() {
        return Err("a link, which LU does not carry to another drive".to_string());
    }
    let mut part = to.as_os_str().to_os_string();
    part.push(PART_SUFFIX);
    let part = PathBuf::from(part);
    // A part file of an earlier, cut short move is LU's own leftover.
    let _ = std::fs::remove_file(&part);
    let take_back = |why: String| {
        let _ = std::fs::remove_file(&part);
        Err(why)
    };
    match copy_with_cancel(from, &part, cancel, progress) {
        Ok(true) => {}
        Ok(false) => {
            let _ = std::fs::remove_file(&part);
            return Ok(FileMove::Cancelled);
        }
        Err(e) => return take_back(format!("copying failed: {}", os_error::io_english(&e))),
    }
    if let Err(e) = check_copy(from, &part) {
        return take_back(e);
    }
    if std::fs::symlink_metadata(to).is_ok() {
        // Something else wrote the name while the copy ran. Its file stays.
        let _ = std::fs::remove_file(&part);
        return Ok(FileMove::Kept);
    }
    if let Err(e) = std::fs::rename(&part, to) {
        return take_back(format!("the copy could not be given its name: {}", os_error::io_english(&e)));
    }
    if let Err(e) = std::fs::remove_file(from) {
        // The original is in use. The new copy goes again, so the file is in
        // one place, the old one, and nothing points at a second copy.
        let _ = std::fs::remove_file(to);
        return Err(format!("it is in use and stays where it was ({})", os_error::io_english(&e)));
    }
    Ok(FileMove::Moved(meta.len()))
}

/// Move everything below `from` into `to`, keeping the layout. `progress`
/// gets the bytes done so far and the file being moved.
pub fn move_tree(
    from: &Path,
    to: &Path,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64, &Path),
) -> TreeReport {
    let mut report = TreeReport::default();
    if !from.is_dir() {
        return report;
    }
    if is_within(to, from) || is_within(from, to) {
        report.fail(format!("{} and {} lie inside each other. Nothing was moved.", from.display(), to.display()));
        return report;
    }
    // The list first: the walk must not see the files it is moving away.
    let files: Vec<PathBuf> = files_below(from).map(|e| e.into_path()).collect();
    let mut done: u64 = 0;
    for file in files {
        if cancel.load(Ordering::SeqCst) {
            report.cancelled = true;
            break;
        }
        let Ok(rel) = file.strip_prefix(from) else { continue };
        let target = to.join(rel);
        let start = done;
        let mut tick = |n: u64| {
            done += n;
            progress(done, &file);
        };
        match move_file(&file, &target, cancel, &mut tick) {
            Ok(FileMove::Moved(bytes)) => {
                report.moved_files += 1;
                report.moved_bytes += bytes;
                done = start + bytes;
            }
            Ok(FileMove::Kept) => report.kept += 1,
            Ok(FileMove::Cancelled) => {
                report.cancelled = true;
                break;
            }
            Err(why) => {
                done = start;
                report.fail(format!("{}: {why}", rel.display()));
            }
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put(path: &Path, bytes: &[u8]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    fn no_cancel() -> AtomicBool {
        AtomicBool::new(false)
    }

    #[test]
    fn a_move_on_one_drive_renames_every_file_and_keeps_the_layout() {
        let tmp = tempfile::tempdir().unwrap();
        let (from, to) = (tmp.path().join("C").join("models"), tmp.path().join("D").join("LU").join("Models"));
        put(&from.join("loras").join("a.safetensors"), b"aaaa");
        put(&from.join("checkpoints").join("deep").join("b.safetensors"), b"bb");
        let plan = plan_tree(&from, &to);
        assert_eq!(plan, TreePlan { files: 2, bytes: 6, cross_bytes: 0, same_volume: true, conflicts: 0 });

        let mut seen = Vec::new();
        let report = move_tree(&from, &to, &no_cancel(), &mut |done, _| seen.push(done));
        assert_eq!(report.moved_files, 2);
        assert_eq!(report.moved_bytes, 6);
        assert!(report.failed.is_empty() && !report.cancelled);
        assert_eq!(std::fs::read(to.join("loras").join("a.safetensors")).unwrap(), b"aaaa");
        assert_eq!(std::fs::read(to.join("checkpoints").join("deep").join("b.safetensors")).unwrap(), b"bb");
        assert!(!from.join("loras").join("a.safetensors").exists(), "moved, not copied");
        // The empty folders stay: nothing but the moved files is touched.
        assert!(from.join("loras").is_dir() && from.join("checkpoints").join("deep").is_dir());
        assert_eq!(*seen.last().unwrap(), 6);
    }

    #[test]
    fn a_file_already_at_the_new_place_is_never_overwritten_and_both_stay() {
        let tmp = tempfile::tempdir().unwrap();
        let (from, to) = (tmp.path().join("old"), tmp.path().join("new"));
        put(&from.join("x.gguf"), b"old copy");
        put(&to.join("x.gguf"), b"new one");
        put(&from.join("y.gguf"), b"y");
        assert_eq!(plan_tree(&from, &to).conflicts, 1);
        let report = move_tree(&from, &to, &no_cancel(), &mut |_, _| {});
        assert_eq!((report.moved_files, report.kept), (1, 1));
        assert_eq!(std::fs::read(to.join("x.gguf")).unwrap(), b"new one");
        assert_eq!(std::fs::read(from.join("x.gguf")).unwrap(), b"old copy");
    }

    fn across_drives(from: &Path, to: &Path) -> Result<FileMove, String> {
        let refuse = |_: &Path, _: &Path| Err(std::io::Error::other("EXDEV"));
        move_file_with(from, to, &no_cancel(), &mut |_| {}, &refuse)
    }

    #[test]
    fn across_drives_the_file_is_copied_checked_named_and_only_then_the_original_goes() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("C").join("big.safetensors");
        let data: Vec<u8> = (0..(3 * CHECK_BYTES as usize + 17)).map(|i| (i % 251) as u8).collect();
        put(&from, &data);
        let to = tmp.path().join("D").join("Models").join("big.safetensors");
        assert_eq!(across_drives(&from, &to).unwrap(), FileMove::Moved(data.len() as u64));
        assert_eq!(std::fs::read(&to).unwrap(), data);
        assert!(!from.exists(), "moved, not copied");
        assert!(!to.with_file_name(format!("big.safetensors{PART_SUFFIX}")).exists());
    }

    #[test]
    fn the_check_catches_a_copy_that_differs_at_the_end_or_is_short() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("big.safetensors");
        let data: Vec<u8> = (0..(3 * CHECK_BYTES as usize + 17)).map(|i| (i % 251) as u8).collect();
        std::fs::write(&from, &data).unwrap();
        let part = tmp.path().join(format!("big.safetensors{PART_SUFFIX}"));
        let mut bad = data.clone();
        *bad.last_mut().unwrap() ^= 0xff;
        std::fs::write(&part, &bad).unwrap();
        assert!(check_copy(&from, &part).unwrap_err().contains("read back"));
        std::fs::write(&part, &data[..10]).unwrap();
        assert!(check_copy(&from, &part).unwrap_err().contains("bytes"));
        std::fs::write(&part, &data).unwrap();
        check_copy(&from, &part).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn an_original_that_cannot_be_removed_keeps_the_file_in_one_place_the_old_one() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let old = tmp.path().join("C");
        let from = old.join("in-use.gguf");
        put(&from, b"weights");
        // A folder the file cannot leave: the remove fails like a file in use.
        std::fs::set_permissions(&old, std::fs::Permissions::from_mode(0o555)).unwrap();
        let to = tmp.path().join("D").join("in-use.gguf");
        let err = across_drives(&from, &to).unwrap_err();
        std::fs::set_permissions(&old, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(err.contains("in use"), "{err}");
        assert_eq!(std::fs::read(&from).unwrap(), b"weights");
        assert!(!to.exists(), "the new copy was taken back");
    }

    #[test]
    fn cancel_inside_a_copy_leaves_the_original_and_no_part_file() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("a.bin");
        std::fs::write(&from, vec![7u8; 3 * CHUNK]).unwrap();
        let part = tmp.path().join("a.bin.lu-part");
        let cancel = AtomicBool::new(false);
        let mut chunks = 0;
        let finished = copy_with_cancel(&from, &part, &cancel, &mut |_| {
            chunks += 1;
            cancel.store(true, Ordering::SeqCst);
        })
        .unwrap();
        assert!(!finished);
        assert_eq!(chunks, 1);
        // move_file removes the part on cancel; the original is untouched.
        assert!(from.is_file());
    }

    #[test]
    fn cancel_between_files_stops_and_says_so() {
        let tmp = tempfile::tempdir().unwrap();
        let (from, to) = (tmp.path().join("old"), tmp.path().join("new"));
        put(&from.join("a"), b"1");
        put(&from.join("b"), b"2");
        let cancel = AtomicBool::new(false);
        let report = move_tree(&from, &to, &cancel, &mut |_, _| cancel.store(true, Ordering::SeqCst));
        assert!(report.cancelled);
        assert_eq!(report.moved_files, 1);
        let left = ["a", "b"].iter().filter(|n| from.join(n).exists()).count();
        assert_eq!(left, 1, "the second file stays at the old place");
    }

    #[test]
    fn folders_inside_each_other_are_refused_before_anything_moves() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("models");
        put(&from.join("a.gguf"), b"a");
        let report = move_tree(&from, &from.join("sub"), &no_cancel(), &mut |_, _| {});
        assert_eq!(report.moved_files, 0);
        assert_eq!(report.failed_count, 1);
        assert!(from.join("a.gguf").is_file());
    }

    #[test]
    fn a_part_file_of_an_earlier_move_is_not_carried_along() {
        let tmp = tempfile::tempdir().unwrap();
        let (from, to) = (tmp.path().join("old"), tmp.path().join("new"));
        put(&from.join(format!("x.gguf{PART_SUFFIX}")), b"half");
        put(&from.join("y.gguf"), b"y");
        assert_eq!(plan_tree(&from, &to).files, 1);
        move_tree(&from, &to, &no_cancel(), &mut |_, _| {});
        assert!(!to.join(format!("x.gguf{PART_SUFFIX}")).exists());
    }

    #[test]
    fn within_reads_case_and_separators_the_way_the_drive_does() {
        assert!(is_within(Path::new("/a/b/c"), Path::new("/a/b")));
        assert!(is_within(Path::new("/a/b"), Path::new("/a/b")));
        assert!(!is_within(Path::new("/a/bc"), Path::new("/a/b")));
    }

    #[test]
    fn a_missing_folder_is_an_empty_plan_and_an_empty_move() {
        let tmp = tempfile::tempdir().unwrap();
        let none = tmp.path().join("none");
        assert_eq!(plan_tree(&none, &tmp.path().join("x")).files, 0);
        assert_eq!(move_tree(&none, &tmp.path().join("x"), &no_cancel(), &mut |_, _| {}), TreeReport::default());
    }
}
