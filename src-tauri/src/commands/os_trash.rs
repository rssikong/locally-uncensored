//! The one way a file goes to the system's Trash or Recycle Bin.
//!
//! Shared code (a download that cannot resume, the model check, the runtime
//! folder move) calls this, so it is built on every platform. A phone has no
//! Trash and the `trash` crate does not compile there: the call says so and
//! the file stays. Nothing here deletes for good.

use std::path::Path;

/// The system's Trash. On macOS through NSFileManager and not through
/// Finder: asking Finder shows the user a permission prompt for a click on
/// Delete, and fails where the prompt is declined. The LoRA folder takes a
/// file out the same way (`mlx_loras.rs`).
#[cfg(desktop)]
pub(crate) fn system_trash(file: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut ctx = trash::TrashContext::default();
        ctx.set_delete_method(DeleteMethod::NsFileManager);
        ctx.delete(file).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        trash::delete(file).map_err(|e| e.to_string())
    }
}

/// A phone: no Trash to move it to, so nothing is moved and nothing deleted.
/// The commands that would get here are blocked on a phone (mobile_guard.rs).
#[cfg(mobile)]
pub(crate) fn system_trash(file: &Path) -> Result<(), String> {
    let _ = file;
    Err("This phone has no Trash, so the file was left where it is.".to_string())
}
