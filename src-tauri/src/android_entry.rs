//! One `run()` per process on Android, and a process end that does not crash.
//!
//! # What happened
//!
//! tao 0.34.8 calls the app's entry point from every `Activity.onCreate`
//! (`platform_impl/android/ndk_glue.rs`, `create`: a fresh thread that runs
//! `main()`), and it has no notion of "this process already runs the app".
//! Android recreates an activity inside the SAME process whenever a
//! configuration changes that the manifest cannot claim for itself. The one
//! that bit is the resource-overlay change (`Config changes=80000000`): the
//! system applies overlays right after the first boot of a device, and any
//! theme, navigation-mode or font overlay does it later. `configChanges` has
//! no flag for it.
//!
//! Then two things raced in one process:
//!
//!   * the first instance got `Destroyed`, Tauri left its loop, and tao called
//!     `std::process::exit`, which runs the C exit handlers and tears down
//!     static mutexes while every other thread is still alive;
//!   * the second `run()` was already building a second app on those same
//!     statics (wry's main pipe, the WebView, the engine state).
//!
//! Depending on who was faster the process died of
//! `FORTIFY: pthread_mutex_lock called on a destroyed mutex` (SIGABRT, crash
//! dialog; reproduced on 2026-10-08 with
//! `adb shell cmd overlay enable com.android.internal.systemui.navbar.threebutton`
//! while LU was open), or the second instance waited for a WebView that the
//! dying first one never created and wry panicked with `Timeout` after 10 s
//! (seen once, on the very first start after the first boot of an emulator).
//!
//! # What this does
//!
//!   1. [`EntryGate`] lets exactly one `run()` through per process. A second
//!      one builds nothing. It waits for the process to end and, should the
//!      first instance not be on its way out, ends the process itself after
//!      [`SECOND_ENTRY_PATIENCE`].
//!   2. The first instance leaves with [`leave_process`], which is `_exit`:
//!      the process is gone at once, no exit handler runs, no mutex is torn
//!      down under a running thread.
//!
//! The recreated activity belongs to a process that ended cleanly while it
//! was on top, so Android starts it again in a fresh process, and that one
//! runs `run()` once. To the user the app restarts instead of crashing. A
//! chat in flight is lost either way: keeping the Rust side alive across an
//! activity recreation needs support in tao that this version does not have.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// How long a second `run()` waits for the first instance to end the process
/// before it does so itself. The first one needs well under a second.
pub const SECOND_ENTRY_PATIENCE: Duration = Duration::from_secs(3);

/// Lets one caller through, once.
pub struct EntryGate(AtomicBool);

impl EntryGate {
    pub const fn new() -> Self {
        EntryGate(AtomicBool::new(false))
    }

    /// `true` for the first caller of this gate, `false` for every later one,
    /// from any thread.
    pub fn enter(&self) -> bool {
        !self.0.swap(true, Ordering::SeqCst)
    }
}

/// The gate of this process.
#[cfg(target_os = "android")]
static PROCESS_GATE: EntryGate = EntryGate::new();

/// `true` when this is the first `run()` of the process.
#[cfg(target_os = "android")]
pub fn first_run_in_this_process() -> bool {
    PROCESS_GATE.enter()
}

/// End the process now, without running exit handlers.
#[cfg(target_os = "android")]
pub fn leave_process(code: i32) -> ! {
    // SAFETY: `_exit` takes no pointers and does not return.
    unsafe { libc::_exit(code) }
}

/// What a second `run()` does instead of building a second app.
#[cfg(target_os = "android")]
pub fn second_entry() -> ! {
    tracing::warn!(
        "run() was entered a second time in this process: Android recreated the activity. \
         Not starting a second app. The process ends and Android starts the activity again."
    );
    std::thread::sleep(SECOND_ENTRY_PATIENCE);
    tracing::error!(
        "the first instance did not end the process within {} s, ending it here",
        SECOND_ENTRY_PATIENCE.as_secs()
    );
    leave_process(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn the_gate_lets_the_first_caller_through_and_nobody_after() {
        let gate = EntryGate::new();
        assert!(gate.enter());
        assert!(!gate.enter());
        assert!(!gate.enter());
    }

    #[test]
    fn of_many_threads_exactly_one_gets_through() {
        // The second onCreate arrives on the UI thread while the first run()
        // is on its own thread. Whatever the order, one wins.
        let gate = Arc::new(EntryGate::new());
        let handles: Vec<_> = (0..32)
            .map(|_| {
                let g = gate.clone();
                std::thread::spawn(move || g.enter())
            })
            .collect();
        let through = handles.into_iter().map(|h| h.join().unwrap()).filter(|&t| t).count();
        assert_eq!(through, 1);
    }

    #[test]
    fn the_wait_is_longer_than_a_normal_exit_and_shorter_than_wrys_timeout() {
        // wry gives up on its main pipe after 10 s and panics. The second
        // entry must have ended the process well before that.
        assert!(SECOND_ENTRY_PATIENCE >= Duration::from_secs(1));
        assert!(SECOND_ENTRY_PATIENCE < Duration::from_secs(10));
    }

    #[test]
    fn run_asks_the_gate_first_and_the_exit_handler_leaves_without_exit_handlers() {
        let lib = include_str!("lib.rs");
        let run = lib.find("pub fn run() {").expect("run() exists");
        let gate = lib[run..].find("android_entry::first_run_in_this_process()").expect("run() asks the gate");
        let builder = lib[run..].find("tauri::Builder").expect("run() builds the app");
        assert!(gate < builder, "the gate has to come before anything is built");
        let exit = lib.find("if let tauri::RunEvent::Exit = event {").expect("the exit handler exists");
        let leave = lib[exit..].find("android_entry::leave_process(0)").expect("Android leaves through _exit");
        let shutdown = lib[exit..].find("state.shutdown_subprocesses();").expect("the engine is stopped");
        assert!(shutdown < leave, "stop the engine first, then leave");
    }
}
