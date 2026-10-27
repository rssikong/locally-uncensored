//! Free space on the file system that holds a given path.
//!
//! One answer, asked from two places: the download guard, which refuses a
//! model that will not fit, and the troubleshoot panel, which shows the number.
//!
//! On a desktop sysinfo's disk list is right and carries mount points, so the
//! longest matching prefix wins and a model folder on a mounted volume is
//! measured against that volume.
//!
//! On a phone sysinfo cannot answer. It builds the list out of /proc and /dev,
//! and an app sandbox does not get to read those: on Android SELinux denies
//! an untrusted app /proc/diskstats, /dev/block and /dev/fuse. What comes back
//! is not the file system the models live on. Measured on the old Android
//! branch (finding A11): sysinfo reported 2.9 GB free where `df` reported
//! 8.3 GB, so every local model download was refused with "free up some
//! space" on a device with plenty of it, and the troubleshoot panel showed
//! "0 GB". `statvfs` asks the kernel about the exact path instead, and it
//! exists on Android and on iOS alike.

use std::path::Path;

/// Free bytes on the file system holding `path`, or `None` if nobody can say.
/// `path` need not exist yet: the first ancestor that does is asked.
pub fn available_bytes(path: &Path) -> Option<u64> {
    #[cfg(mobile)]
    {
        statvfs_free_and_total(path).map(|(free, _)| free)
    }
    #[cfg(desktop)]
    {
        // Exactly the expression `download::available_space_for` carried
        // before it moved here.
        let disks = sysinfo::Disks::new_with_refreshed_list();
        disks
            .iter()
            .filter(|d| path.starts_with(d.mount_point()))
            .max_by_key(|d| d.mount_point().as_os_str().len())
            .map(|d| d.available_space())
    }
}

/// Free and total bytes straight from the kernel, for the nearest existing
/// ancestor of `path`.
///
/// Only the phones call it in production. It is also compiled into the test
/// build of every unix, so the desktop test run executes the very code a
/// phone depends on.
// The field types differ per system (u32 here, u64 there), so one of the two
// casts is always a no-op on some platform.
#[cfg(all(unix, any(mobile, test)))]
#[allow(clippy::unnecessary_cast)]
pub(crate) fn statvfs_free_and_total(path: &Path) -> Option<(u64, u64)> {
    use std::os::unix::ffi::OsStrExt;
    let dir = path.ancestors().find(|p| p.exists())?;
    let c = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
    // SAFETY: `st` is a plain C struct that statvfs fills in completely on
    // success, and `c` is a NUL-terminated path that outlives the call.
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
        return None;
    }
    let block = st.f_frsize as u64;
    Some((
        (st.f_bavail as u64).saturating_mul(block),
        (st.f_blocks as u64).saturating_mul(block),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_something_for_a_path_that_exists() {
        let here = Path::new(env!("CARGO_MANIFEST_DIR"));
        let free = available_bytes(here).expect("a mounted file system");
        assert!(free > 0, "free space came back as zero for {}", here.display());
    }

    #[test]
    fn answers_for_a_file_that_does_not_exist_yet() {
        // The download guard asks before the file, and often before its whole
        // directory chain, has been created.
        let ghost = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("no")
            .join("such")
            .join("dir")
            .join("model.gguf");
        assert!(available_bytes(&ghost).is_some());
    }

    /// The code a phone runs, run here: it has to answer for a real folder
    /// and for one that is not there yet, and free can never exceed total.
    #[cfg(unix)]
    #[test]
    fn the_phone_path_answers_from_the_kernel() {
        let here = Path::new(env!("CARGO_MANIFEST_DIR"));
        let (free, total) = statvfs_free_and_total(here).expect("statvfs answers");
        assert!(free > 0 && total >= free, "free {free}, total {total}");
        let ghost = here.join("no").join("such").join("model.gguf");
        assert_eq!(
            statvfs_free_and_total(&ghost).map(|(_, t)| t),
            Some(total),
            "a path that does not exist yet is measured on its nearest ancestor"
        );
    }

    /// Guard for Android finding A11, which v3.0.5 would have brought back:
    /// `download::available_space_for` asked `sysinfo::Disks` itself.
    ///
    /// A phone build must take the statvfs arm. Read from the source, because
    /// the arm is not compiled in the build this test runs in.
    #[test]
    fn a_phone_never_asks_sysinfo_for_free_space() {
        let src = include_str!("disk.rs");
        let f = &src[src.find("pub fn available_bytes(").expect("available_bytes exists")..];
        let f = &f[..f.find("\n}\n").expect("the function ends")];
        let mobile = &f[f.find("#[cfg(mobile)]").expect("a phone arm exists")
            ..f.find("#[cfg(desktop)]").expect("a desktop arm exists")];
        assert!(mobile.contains("statvfs_free_and_total(path)"), "{mobile}");
        assert!(!mobile.contains("Disks"), "the phone arm must not touch sysinfo's disk list:\n{mobile}");

        // And the download guard really goes through here, on every platform.
        let download = include_str!("commands/download.rs");
        let g = &download[download.find("pub(crate) fn available_space_for(").expect("exists")..];
        let g = &g[..g.find("\n}\n").expect("the function ends")];
        assert!(g.contains("crate::disk::available_bytes(dest)"), "{g}");
        assert!(!g.contains("Disks"), "the download guard must not keep its own copy:\n{g}");

        // The troubleshoot panel shows the same number, so it has the same arm.
        let health = include_str!("commands/health.rs");
        assert!(
            health.contains("crate::disk::available_bytes(&crate::os_paths::data_dir())"),
            "the troubleshoot panel must measure the app's own folder on a phone"
        );
    }
}
