// Unload the LU Engine's chat model after a while without use.
//
// Discord (21.10.2026): a large model held most of a 32 GB PC's memory from the
// start of the app, also while nobody chatted. The engine keeps the model
// loaded so that answers come at once; this lets the user trade that for the
// memory: after the minutes set in Settings without a request, the engine is
// stopped, and the next message starts it again (the chat's pre-send check,
// api/builtin-ensure.ts, starts an engine that is not running).
//
// "Without a request" is asked of the engine itself, not of the chat: its
// `/slots` answer numbers every task (`id_task`) and says whether a slot is at
// work (`is_processing`), whoever sent the request: the chat, Voice, the
// agent, the local API, the phone. So a model that serves the local API is not
// unloaded under a client that the chat knows nothing about.
//
// Off by default (0 minutes): an engine that unloads by itself is a slower
// first answer the user has to have chosen.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

/// The minutes set in Settings, 0 for never.
static IDLE_MINUTES: AtomicU32 = AtomicU32::new(0);
/// The watch runs once for the life of the app.
static WATCH_STARTED: AtomicBool = AtomicBool::new(false);

/// How often the watch asks the engine. The unit of the setting is minutes, so
/// half a minute is late by at most that.
const IDLE_WATCH_INTERVAL: Duration = Duration::from_secs(30);

/// The event an unload raises. Payload: `{ minutes, model }`.
pub const ENGINE_IDLE_UNLOADED_EVENT: &str = "lu-engine-idle-unloaded";

/// What `/slots` says about use: the highest task number any slot carries,
/// and whether a slot is at work right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SlotActivity {
    pub last_task: u64,
    pub busy: bool,
}

/// Read `/slots`. An answer that is not a list of slots is `None`: then the
/// watch knows nothing and unloads nothing.
pub(crate) fn slot_activity(slots: &serde_json::Value) -> Option<SlotActivity> {
    let list = slots.as_array()?;
    let last_task = list.iter().filter_map(|s| s.get("id_task").and_then(|t| t.as_u64())).max().unwrap_or(0);
    let busy = list.iter().any(|s| s.get("is_processing").and_then(|b| b.as_bool()).unwrap_or(false));
    Some(SlotActivity { last_task, busy })
}

/// The watch's memory of one engine process.
#[derive(Debug)]
pub(crate) struct IdleClock {
    /// Which engine: a new port or model is a new process with its own count.
    engine: Option<(u16, String)>,
    seen: Option<SlotActivity>,
    last_use: Instant,
}

impl IdleClock {
    pub(crate) fn new(now: Instant) -> Self {
        Self { engine: None, seen: None, last_use: now }
    }

    /// One look at the engine. True when it has been idle for `minutes` and is
    /// to be unloaded now.
    ///
    /// A new engine, an engine at work, a new task number, an unreadable
    /// answer and a setting of 0 all count as use: each of them restarts the
    /// clock, so only a long, clearly quiet stretch unloads.
    pub(crate) fn look(&mut self, now: Instant, engine: (u16, String), activity: Option<SlotActivity>, minutes: u32) -> bool {
        let same_engine = self.engine.as_ref() == Some(&engine);
        if !same_engine {
            self.engine = Some(engine);
            self.seen = activity;
            self.last_use = now;
            return false;
        }
        let Some(activity) = activity else {
            self.last_use = now;
            return false;
        };
        if minutes == 0 || activity.busy || self.seen.is_none_or(|s| s.last_task != activity.last_task) {
            self.seen = Some(activity);
            self.last_use = now;
            return false;
        }
        now.duration_since(self.last_use) >= Duration::from_secs(minutes as u64 * 60)
    }

    /// The engine is gone (stopped by the watch or anyone else).
    pub(crate) fn forget(&mut self, now: Instant) {
        *self = Self::new(now);
    }
}

fn read_slots(port: u16) -> Option<SlotActivity> {
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(3)).build().ok()?;
    let res = super::engine_key::authorize_blocking(client.get(format!("http://127.0.0.1:{port}/slots"))).send().ok()?;
    if !res.status().is_success() {
        return None;
    }
    slot_activity(&res.json::<serde_json::Value>().ok()?)
}

fn watch(app: AppHandle) {
    let mut clock = IdleClock::new(Instant::now());
    loop {
        std::thread::sleep(IDLE_WATCH_INTERVAL);
        let minutes = IDLE_MINUTES.load(Ordering::SeqCst);
        let state = app.state::<AppState>();
        let live = {
            let mut guard = state.bundled_engine.lock().unwrap_or_else(|e| e.into_inner());
            super::engine::live_sidecar(&mut guard)
        };
        let Some(live) = live else {
            clock.forget(Instant::now());
            continue;
        };
        // Nothing is asked of the engine while the setting is off.
        let activity = if minutes == 0 { None } else { read_slots(live.port) };
        let engine = (live.port, live.model_path.clone());
        if clock.look(Instant::now(), engine, activity, minutes) {
            tracing::info!(target: "engine", model = %live.model_path, minutes, "the LU Engine was idle for the set time and is unloaded; the next message loads it again");
            super::engine::stop_engine_on_request(&state);
            clock.forget(Instant::now());
            let _ = app.emit(ENGINE_IDLE_UNLOADED_EVENT, serde_json::json!({ "minutes": minutes, "model": live.model_path }));
        }
    }
}

/// Set the minutes from Settings (0: never) and start the watch the first time.
#[tauri::command]
pub fn set_engine_idle_unload(app: AppHandle, minutes: u32) {
    IDLE_MINUTES.store(minutes.min(24 * 60), Ordering::SeqCst);
    if !WATCH_STARTED.swap(true, Ordering::SeqCst) {
        std::thread::spawn(move || watch(app));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: Duration = Duration::from_secs(60);

    fn act(last_task: u64, busy: bool) -> Option<SlotActivity> {
        Some(SlotActivity { last_task, busy })
    }

    #[test]
    fn reads_the_task_numbers_and_the_work_of_the_slots() {
        // As the pinned llama-server answers: a slot that never ran has no id_task.
        let fresh = serde_json::json!([{ "id": 0, "is_processing": false }, { "id": 1, "is_processing": false }]);
        assert_eq!(slot_activity(&fresh), act(0, false));
        let used = serde_json::json!([{ "id": 0, "is_processing": false, "id_task": 4 }, { "id": 3, "is_processing": true, "id_task": 9 }]);
        assert_eq!(slot_activity(&used), act(9, true));
        assert_eq!(slot_activity(&serde_json::json!({ "error": "no" })), None);
    }

    #[test]
    fn unloads_after_the_set_minutes_without_a_new_task() {
        let t0 = Instant::now();
        let e = || (8127, "/m/gemma.gguf".to_string());
        let mut clock = IdleClock::new(t0);
        assert!(!clock.look(t0, e(), act(3, false), 10));
        assert!(!clock.look(t0 + 9 * MIN, e(), act(3, false), 10));
        assert!(clock.look(t0 + 10 * MIN, e(), act(3, false), 10));
    }

    #[test]
    fn every_request_and_every_busy_look_starts_the_minutes_again() {
        let t0 = Instant::now();
        let e = || (8127, "/m/gemma.gguf".to_string());
        let mut clock = IdleClock::new(t0);
        clock.look(t0, e(), act(3, false), 10);
        // A message at minute 8 (the local API, Voice or the chat alike).
        assert!(!clock.look(t0 + 8 * MIN, e(), act(4, false), 10));
        assert!(!clock.look(t0 + 17 * MIN, e(), act(4, false), 10));
        // A long answer still running counts as use.
        assert!(!clock.look(t0 + 18 * MIN, e(), act(4, true), 10));
        assert!(!clock.look(t0 + 27 * MIN, e(), act(4, false), 10));
        assert!(clock.look(t0 + 28 * MIN, e(), act(4, false), 10));
    }

    #[test]
    fn a_new_engine_an_unreadable_answer_or_the_setting_off_never_unloads() {
        let t0 = Instant::now();
        let mut clock = IdleClock::new(t0);
        clock.look(t0, (8127, "/m/a.gguf".into()), act(3, false), 10);
        // Another model: its own clock, from now.
        assert!(!clock.look(t0 + 30 * MIN, (8127, "/m/b.gguf".into()), act(0, false), 10));
        assert!(!clock.look(t0 + 39 * MIN, (8127, "/m/b.gguf".into()), act(0, false), 10));
        // The engine did not answer /slots: no verdict, and the clock restarts.
        assert!(!clock.look(t0 + 41 * MIN, (8127, "/m/b.gguf".into()), None, 10));
        assert!(!clock.look(t0 + 50 * MIN, (8127, "/m/b.gguf".into()), act(0, false), 10));
        // Off.
        assert!(!clock.look(t0 + 99 * MIN, (8127, "/m/b.gguf".into()), act(0, false), 0));
    }
}
