//! The native layer of LU on a phone.
//!
//! One Tauri plugin with a Kotlin part (android/), a Swift part (ios/) and a
//! stub for the desktop. What it carries:
//!
//!   1. secure storage (Android Keystore, iOS Keychain), Rust API only
//!   2. share sheet, photo library, save to files, temp files
//!   3. device facts and the memory warning
//!   4. lifecycle events, background task, the Android back key
//!   5. the deep link an app start came with
//!   6. the Remote transport
//!   7. background downloads
//!   8. reading aloud with the voice of the system
//!   9. the clipboard of the system
//!  10. a model file of the user's own, copied into the model folder
//!  11. photos the webview cannot decode (HEIC on Android), as JPEG
//!  12. notices of the computer and staying alive while the phone waits for it (A17)
//!
//! Every native event takes one way: native code, the channel opened in
//! `attach`, `LuNative::dispatch`, then the Rust listeners and `app.emit`.
//! JavaScript listens with the ordinary `listen()` of Tauri, never on the
//! native side directly. Signatures: mobile-docs/NATIVE-SCHICHT.md.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
#[cfg(mobile)]
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Emitter, Manager, Runtime,
};

mod commands;
#[cfg(desktop)]
mod desktop;
pub mod download;
pub mod error;
pub mod import;
#[cfg(mobile)]
mod mobile;
pub mod net;
pub mod remote;
pub mod temp;
pub mod tts;

#[cfg(desktop)]
use desktop::Native;
#[cfg(mobile)]
use mobile::Native;

pub use download::{BgDownload, BgStart, BgState};
pub use error::{Error, Result};

/// The events this plugin emits. Names are the ones JavaScript listens for.
pub mod events {
    pub const MEMORY_WARNING: &str = "memory-warning";
    pub const APP_BACKGROUND: &str = "app-background";
    pub const APP_FOREGROUND: &str = "app-foreground";
    pub const APP_WILL_TERMINATE: &str = "app-will-terminate";
    pub const BACK: &str = "back";
    pub const DEEP_LINK: &str = "deep-link";
    pub const FONT_SCALE_CHANGED: &str = "font-scale-changed";
    pub const BG_DOWNLOAD_PROGRESS: &str = "bg-download-progress";
    pub const BG_DOWNLOAD_DONE: &str = "bg-download-done";
    pub const BG_DOWNLOAD_ERROR: &str = "bg-download-error";
    pub const TTS_START: &str = "tts-start";
    pub const TTS_END: &str = "tts-end";
    pub const TTS_ERROR: &str = "tts-error";
    pub const MODEL_IMPORT_PROGRESS: &str = "model-import-progress";
    /// iOS: a purchase of credits the store reports while the app runs (Iap.swift).
    pub const IAP_TRANSACTION: &str = "iap-transaction";

    pub const ALL: &[&str] = &[
        MEMORY_WARNING,
        APP_BACKGROUND,
        APP_FOREGROUND,
        APP_WILL_TERMINATE,
        BACK,
        DEEP_LINK,
        FONT_SCALE_CHANGED,
        BG_DOWNLOAD_PROGRESS,
        BG_DOWNLOAD_DONE,
        BG_DOWNLOAD_ERROR,
        TTS_START,
        TTS_END,
        TTS_ERROR,
        MODEL_IMPORT_PROGRESS,
        IAP_TRANSACTION,
    ];
}

/// How long the same link counts as an echo of itself.
#[cfg_attr(not(mobile), allow(dead_code))]
const DEEP_LINK_ECHO: std::time::Duration = std::time::Duration::from_secs(3);

/// True in a build with the cargo feature `abnahme`.
pub const ACCEPTANCE_BUILD: bool = cfg!(feature = "abnahme");

/// Android: keep what Rust sends to the page from getting stuck.
///
/// Everything Rust sends to the webview on Android (the answer of every
/// command, every event) is a message to the event loop of tao. tao 0.34
/// reads those messages only when the loop was woken by a wake-up call, and
/// Android's looper reports one reason per round: when a wake-up call and an
/// activity event (pause, resume, start, stop, a new size, a new
/// configuration) fall into the same round, the activity event wins, the
/// wake-up call is used up and the message stays in the queue until the next
/// wake-up call (tao, platform_impl/android/mod.rs, `poll` and
/// `EventSource::User`). Measured on the emulator: the answer to the
/// notification question did not reach the page in 5 of 26 runs, and
/// `app-foreground` and `deep-link` after a return to the foreground in up to
/// 6 of 12 runs, each until the page called any command.
///
/// So while the app is in front, and for a few seconds after it left, a
/// thread sends an empty task to the loop a few times a second. Each one is
/// a wake-up call, and a wake-up call delivers everything that is waiting.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) mod pump {
    use std::sync::atomic::{AtomicI64, Ordering};
    use std::time::Duration;

    use super::events;

    pub const EVERY: Duration = Duration::from_millis(200);
    /// In front: without end.
    pub const FOREGROUND: i64 = i64::MAX;
    /// After the app left the screen: long enough for `app-background` and
    /// what the page does on it to get through, then the phone is left alone.
    pub const AFTER_BACKGROUND: i64 = 25;

    /// What a lifecycle event does to the number of wake-up calls left.
    pub fn ticks_after(event: &str) -> Option<i64> {
        match event {
            events::APP_BACKGROUND => Some(AFTER_BACKGROUND),
            events::APP_FOREGROUND | events::DEEP_LINK => Some(FOREGROUND),
            _ => None,
        }
    }

    /// True when the pump should wake the loop now. Counts one down.
    pub fn take(ticks: &AtomicI64) -> bool {
        ticks
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |left| match left {
                FOREGROUND => Some(FOREGROUND),
                left if left > 0 => Some(left - 1),
                _ => None,
            })
            .is_ok()
    }
}

type Listener = Arc<dyn Fn(&str, &Value) + Send + Sync + 'static>;

/// The plugin's state and its Rust API. Reach it with `app.lu_native()`.
pub struct LuNative<R: Runtime> {
    app: AppHandle<R>,
    native: Native<R>,
    listeners: Mutex<Vec<Listener>>,
    pending_deep_link: Mutex<Option<String>>,
    #[cfg_attr(not(mobile), allow(dead_code))]
    last_deep_link: Mutex<Option<(String, std::time::Instant)>>,
    attached: std::sync::atomic::AtomicBool,
    /// Android: how many more times the pump wakes the event loop. See `pump`.
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    pump_ticks: std::sync::atomic::AtomicI64,
    models_dir: Mutex<Option<PathBuf>>,
    /// Who is importing a model file right now. One at a time (import.rs).
    pub(crate) import_gate: import::ImportGate,
    pub(crate) cancel_book: remote::CancelBook,
}

pub trait LuNativeExt<R: Runtime> {
    fn lu_native(&self) -> &LuNative<R>;
}

impl<R: Runtime, T: Manager<R>> LuNativeExt<R> for T {
    fn lu_native(&self) -> &LuNative<R> {
        self.state::<LuNative<R>>().inner()
    }
}

impl<R: Runtime> LuNative<R> {
    /// False on a desktop, where every native call answers with an error.
    pub fn available(&self) -> bool {
        Native::<R>::AVAILABLE
    }

    pub(crate) async fn call<T: DeserializeOwned>(&self, command: &str, payload: impl Serialize) -> Result<T> {
        self.native.call(command, payload).await
    }

    /// Like `call`, but a rejection keeps the code native code gave it.
    pub(crate) async fn call_coded<T: DeserializeOwned>(
        &self,
        command: &str,
        payload: impl Serialize,
    ) -> std::result::Result<T, (Option<String>, Error)> {
        self.native.call_coded(command, payload).await
    }

    // ── events ──────────────────────────────────────────────────────────

    /// Hear every native event on the Rust side, before JavaScript does.
    /// This is how the engine reacts to a memory warning without a webview
    /// in between. The callback runs on whatever thread the event arrives
    /// on and must not block.
    pub fn on_event<F: Fn(&str, &Value) + Send + Sync + 'static>(&self, listener: F) {
        self.listeners.lock().unwrap_or_else(|p| p.into_inner()).push(Arc::new(listener));
    }

    /// One native event: remember what has to be remembered, tell the Rust
    /// listeners, then tell JavaScript.
    #[cfg_attr(not(mobile), allow(dead_code))]
    pub(crate) fn dispatch(&self, event: &str, payload: Value) {
        if !events::ALL.contains(&event) {
            return;
        }
        if event == events::DEEP_LINK {
            match payload.get("url").and_then(Value::as_str) {
                // One link can be reported twice: iOS hands it over in the
                // launch options AND calls the delegate, and tao reports the
                // delegate call a second time as `RunEvent::Opened`.
                Some(url) if !url.is_empty() => {
                    if !self.remember_deep_link(url) {
                        return;
                    }
                }
                _ => return,
            }
        }
        if let Some(ticks) = pump::ticks_after(event) {
            self.pump_ticks.store(ticks, std::sync::atomic::Ordering::Release);
        }
        let listeners: Vec<Listener> = self.listeners.lock().unwrap_or_else(|p| p.into_inner()).clone();
        for listener in listeners {
            listener(event, &payload);
        }
        let _ = self.app.emit(event, payload);
    }

    // ── deep link ───────────────────────────────────────────────────────

    /// False when this is the same link that was reported a moment ago.
    #[cfg_attr(not(mobile), allow(dead_code))]
    fn remember_deep_link(&self, url: &str) -> bool {
        let now = std::time::Instant::now();
        let mut last = self.last_deep_link.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((seen, at)) = last.as_ref() {
            if seen == url && now.duration_since(*at) < DEEP_LINK_ECHO {
                return false;
            }
        }
        *last = Some((url.to_string(), now));
        *self.pending_deep_link.lock().unwrap_or_else(|p| p.into_inner()) = Some(url.to_string());
        true
    }

    /// Wait, briefly, until native code has handed over what it collected
    /// before Rust was listening. A page that asks for the launch link in its
    /// first millisecond must not get "none" because of a race.
    pub(crate) async fn wait_attached(&self) {
        use std::sync::atomic::Ordering;
        for _ in 0..100 {
            if self.attached.load(Ordering::Acquire) {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }

    /// The link the app was opened with, once. The second call answers
    /// `None` until another link arrives.
    pub fn take_deep_link(&self) -> Option<String> {
        self.pending_deep_link.lock().unwrap_or_else(|p| p.into_inner()).take()
    }

    // ── folders ─────────────────────────────────────────────────────────

    /// Tell the plugin where models live. `device_info` reports the free
    /// space of that folder, and downloads may be saved there.
    /// The app names its model folder once, when it starts. That is the
    /// moment to remove what an import left behind that the app was ended
    /// under (import.rs, `sweep_partials_at_start`): off the calling thread,
    /// because a folder on a slow disk must not hold up the start.
    pub fn set_models_dir(&self, dir: PathBuf) {
        *self.models_dir.lock().unwrap_or_else(|p| p.into_inner()) = Some(dir.clone());
        if Native::<R>::AVAILABLE {
            let app = self.app.clone();
            let _ = std::thread::Builder::new().name("lu-import-sweep".into()).spawn(move || {
                import::sweep_partials_at_start(&app.lu_native().import_gate, &dir);
            });
        }
    }

    pub fn models_dir(&self) -> Option<PathBuf> {
        if let Some(dir) = self.models_dir.lock().unwrap_or_else(|p| p.into_inner()).clone() {
            return Some(dir);
        }
        self.app.path().app_data_dir().ok().map(|d| d.join("models"))
    }

    pub fn temp_dir(&self) -> Result<PathBuf> {
        let cache = self
            .app
            .path()
            .app_cache_dir()
            .map_err(|_| Error::new("The app has no cache folder on this device."))?;
        temp::ensure_temp_dir(&cache).map_err(Error::from)
    }

    /// The folders the app owns. A path handed in from JavaScript has to lie
    /// in one of them before it is shared, saved or downloaded to.
    pub fn owned_roots(&self) -> Vec<PathBuf> {
        let path = self.app.path();
        let mut roots: Vec<PathBuf> = [path.app_data_dir(), path.app_cache_dir(), path.document_dir()]
            .into_iter()
            .flatten()
            .collect();
        if let Some(models) = self.models_dir() {
            roots.push(models);
        }
        roots.dedup();
        roots
    }

    // ── Remote transport and small services (Rust API for the app's own commands) ─

    /// One round trip to a desktop LU. Only private addresses and
    /// `*.trycloudflare.com` pass, see `remote::request`.
    pub async fn remote_request(&self, request: remote::RemoteRequest) -> Result<remote::RemoteResponse> {
        remote::request(&self.cancel_book, &self.user_agent(), request).await.map_err(Error::from)
    }

    /// Close the connection of a running `remote_request` with this id.
    pub fn remote_cancel(&self, cancel_id: &str) -> bool {
        self.cancel_book.cancel(cancel_id)
    }

    /// The page of this app in the system settings.
    pub async fn open_system_settings(&self) -> Result<()> {
        if !self.available() {
            return Err(Error::new(error::NOT_ON_DESKTOP));
        }
        let _: Value = self.native.call("openSystemSettings", json!({})).await?;
        Ok(())
    }

    pub fn user_agent(&self) -> String {
        remote::user_agent(&self.app.package_info().version.to_string())
    }

    // ── secure storage (Rust API only, see commands/secret.rs of the app) ─

    /// `None` when nothing is stored under the account.
    pub fn secret_get(&self, account: &str) -> Result<Option<String>> {
        let answer: Value = self.native.call_blocking("secretGet", json!({ "account": account }))?;
        Ok(answer.get("value").and_then(Value::as_str).map(str::to_string))
    }

    pub fn secret_set(&self, account: &str, value: &str) -> Result<()> {
        let _: Value = self.native.call_blocking("secretSet", json!({ "account": account, "value": value }))?;
        Ok(())
    }

    /// Deleting what is not there is not an error.
    pub fn secret_delete(&self, account: &str) -> Result<()> {
        let _: Value = self.native.call_blocking("secretDelete", json!({ "account": account }))?;
        Ok(())
    }

    // ── sharing and saving, for the app's own dialog commands ───────────

    /// Open the system's "save to files" picker for a file inside the app's
    /// folders. `Ok(None)` when the user cancelled, else where it went.
    ///
    /// `mime` may be left out, it is then taken from the ending of the file
    /// name. It matters on Android: the picker appends the ending that
    /// belongs to the type when the name does not have it, so a Markdown
    /// file announced as text/plain is saved as `name.md.txt`.
    pub async fn save_to_files(
        &self,
        path: &std::path::Path,
        file_name: &str,
        mime: Option<&str>,
    ) -> Result<Option<String>> {
        let real = temp::existing_inside(path, &self.owned_roots())?;
        let mime = mime.unwrap_or_else(|| commands::guess_mime(file_name));
        let answer: Value = self
            .call("saveToFiles", json!({ "path": real, "filename": temp::safe_file_name(file_name), "mime": mime }))
            .await?;
        if answer.get("saved").and_then(Value::as_bool).unwrap_or(false) {
            Ok(Some(answer.get("uri").and_then(Value::as_str).unwrap_or(file_name).to_string()))
        } else {
            Ok(None)
        }
    }

    // ── background downloads ────────────────────────────────────────────

    pub async fn bg_list(&self) -> Result<Vec<BgDownload>> {
        #[derive(serde::Deserialize)]
        struct List {
            #[serde(default)]
            downloads: Vec<BgDownload>,
        }
        let list: List = self.call("bgList", json!({})).await?;
        Ok(list.downloads)
    }

    pub async fn bg_find(&self, id: &str) -> Result<Option<BgDownload>> {
        Ok(self.bg_list().await?.into_iter().find(|d| d.id == id))
    }

    /// Start a download, or continue the one that already exists under this
    /// id. Answers the status word: `started`, `resumed`, `already_running`
    /// or `done`.
    pub async fn bg_start(&self, start: BgStart) -> Result<&'static str> {
        let mut roots = self.owned_roots();
        roots.retain(|r| r.is_absolute());
        let start = download::check_start(start, &roots, ACCEPTANCE_BUILD)?;
        if let Some(existing) = self.bg_find(&start.id).await? {
            if existing.dest != start.dest && existing.state.is_live() {
                return Err(Error::new(format!(
                    "Another download is already writing a file called {}. Wait for it to finish, then start this one again.",
                    start.id
                )));
            }
            match existing.state {
                s if s.is_live() => return Ok("already_running"),
                BgState::Done if std::path::Path::new(&existing.dest).exists() && existing.dest == start.dest => {
                    return Ok("done")
                }
                _ => {}
            }
        }
        let dest = PathBuf::from(&start.dest);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|_| Error::new("The folder for this download could not be created."))?;
        }
        self.check_redirects(&start.url, &start.headers).await?;
        let partial = download::partial_path(&dest);
        let mut payload = serde_json::to_value(&start).map_err(|_| Error::new("That download request is not valid."))?;
        payload["partial"] = json!(partial);
        payload["userAgent"] = json!(self.user_agent());
        // Native code holds every redirect of the transfer to the download
        // rule by itself (NetGuard.kt, NetGuard.swift), also when no Rust is
        // loaded. It needs to know which rule: the one of a store build, or
        // the one that lets the test servers of an acceptance build through.
        // The value comes from the build, never from the page.
        payload["allowLocal"] = json!(ACCEPTANCE_BUILD);
        let _: Value = self.call("bgStart", payload).await?;
        Ok("started")
    }

    /// iOS: walk the redirects of a download before the system gets it.
    ///
    /// A background `URLSession` follows redirects without asking the app,
    /// so this is the only place where a hop into a private network can be
    /// refused BEFORE it is requested (`net::walk_redirects`). Android opens
    /// every connection itself and checks each hop there, in Kotlin, so the
    /// extra round trip is not spent on it.
    async fn check_redirects(
        &self,
        url: &str,
        headers: &std::collections::HashMap<String, String>,
    ) -> Result<()> {
        #[cfg(target_os = "ios")]
        {
            let walk = net::walk_redirects(url, headers, &self.user_agent(), ACCEPTANCE_BUILD).await;
            net::redirect_verdict(walk).map_err(Error::new)
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = (url, headers);
            Ok(())
        }
    }

    /// Set (`Some`, 0 for none) or ask (`None`) the speed limit all
    /// background downloads share. Answers the limit that holds now, or
    /// `None` where the platform cannot limit a download: iOS, whose
    /// background `URLSession` has no such setting, and the desktop, which
    /// keeps its own.
    pub async fn bg_limit(&self, bytes_per_second: Option<u64>) -> Result<Option<u64>> {
        #[cfg(target_os = "android")]
        {
            let wanted = bytes_per_second.map(|b| b.min(download::LIMIT_MAX_BPS));
            let answer: Value = self.call("bgLimit", json!({ "bytesPerSecond": wanted })).await?;
            Ok(Some(answer.get("bytesPerSecond").and_then(Value::as_u64).unwrap_or(0)))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = bytes_per_second;
            Ok(None)
        }
    }

    /// Pause, resume, cancel or forget. The table in `download::decide` says
    /// whether the command reaches native code at all.
    pub async fn bg_command(&self, id: &str, command: download::BgCommand) -> Result<&'static str> {
        use download::{BgCommand, Decision};
        download::check_id(id)?;
        let Some(current) = self.bg_find(id).await? else {
            return Ok("not_found");
        };
        match download::decide(current.state, command) {
            Decision::Refuse(why) => Err(Error::new(why)),
            Decision::Noop(status) => Ok(status),
            Decision::Do => {
                if command == BgCommand::Resume {
                    // The headers of the line stay sealed on the native
                    // side. Without them a gated file answers 401 on the
                    // first hop and the walk ends there, which is fine: the
                    // hops that can be seen are checked, and native code
                    // checks where the bytes really come from.
                    self.check_redirects(&current.url, &Default::default()).await?;
                }
                let (native, status) = match command {
                    BgCommand::Pause => ("bgPause", "paused"),
                    BgCommand::Resume => ("bgResume", "resumed"),
                    BgCommand::Cancel => ("bgCancel", "cancelled"),
                    BgCommand::Forget => ("bgForget", "forgotten"),
                };
                let _: Value = self.call(native, json!({ "id": id })).await?;
                Ok(status)
            }
        }
    }
}

/// What native code sends through the channel.
#[cfg(mobile)]
#[derive(serde::Deserialize)]
struct NativeEvent {
    event: String,
    #[serde(default)]
    payload: Value,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("lu-native")
        .invoke_handler(tauri::generate_handler![
            commands::share_file,
            commands::save_to_photos,
            commands::save_to_files,
            commands::write_temp_file,
            commands::download_to_temp,
            commands::delete_temp_file,
            commands::device_info,
            commands::simulate_memory_warning,
            commands::begin_background_task,
            commands::end_background_task,
            commands::back_arm,
            commands::back_ack,
            commands::back_exit,
            commands::pending_deep_link,
            commands::haptic,
            commands::open_external,
            commands::scan_qr,
            commands::open_system_settings,
            commands::set_system_bars,
            commands::remote_client_request,
            commands::remote_client_cancel,
            commands::bg_download_start,
            commands::bg_download_pause,
            commands::bg_download_resume,
            commands::bg_download_cancel,
            commands::bg_download_forget,
            commands::bg_download_list,
            commands::bg_download_network_rule,
            commands::bg_download_allow_metered,
            commands::connection_info,
            commands::request_notification_permission,
            commands::tts_voices,
            commands::tts_speak,
            commands::tts_stop,
            commands::import_model_document,
            commands::import_model_cancel,
            commands::bg_download_limit,
            commands::transcode_image,
            commands::clipboard_read_text,
            commands::clipboard_write_text,
            commands::local_notify,
            commands::remote_watch,
            commands::remote_notify_permission,
            commands::apple_sign_in,
            commands::web_auth,
            commands::pick_documents,
            commands::read_temp_file,
            commands::iap_products,
            commands::iap_purchase,
            commands::iap_finish,
            commands::iap_unfinished,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let native = mobile::init(app, api)?;
            #[cfg(desktop)]
            let native = desktop::init(app, api)?;

            app.manage(LuNative {
                app: app.clone(),
                native,
                listeners: Mutex::new(Vec::new()),
                pending_deep_link: Mutex::new(None),
                last_deep_link: Mutex::new(None),
                attached: std::sync::atomic::AtomicBool::new(!Native::<R>::AVAILABLE),
                pump_ticks: std::sync::atomic::AtomicI64::new(pump::FOREGROUND),
                models_dir: Mutex::new(None),
                import_gate: import::ImportGate::default(),
                cancel_book: remote::CancelBook::default(),
            });

            #[cfg(target_os = "android")]
            {
                let app = app.clone();
                let _ = std::thread::Builder::new().name("lu-native-pump".into()).spawn(move || loop {
                    std::thread::sleep(pump::EVERY);
                    let ticks = &app.lu_native().pump_ticks;
                    if pump::take(ticks) {
                        // An empty task. Sending it is the point: that wakes the loop.
                        let _ = app.run_on_main_thread(|| {});
                    }
                });
            }

            // Leftovers of an earlier run. Off the main thread, a share that
            // was never finished may have left a video here.
            let sweeper = app.clone();
            std::thread::spawn(move || {
                if let Ok(dir) = sweeper.lu_native().temp_dir() {
                    temp::sweep_stale(&dir, std::time::SystemTime::now());
                }
            });

            // The one channel every native event comes through. Opened here,
            // before any webview runs a line of JavaScript, so a download
            // that finished while the app was gone, or the link the app was
            // started with, reaches Rust even if no page ever asks.
            #[cfg(mobile)]
            {
                let target = app.clone();
                let channel: Channel<Value> = Channel::new(move |body| {
                    let parsed = match body {
                        InvokeResponseBody::Json(text) => serde_json::from_str::<NativeEvent>(&text).ok(),
                        InvokeResponseBody::Raw(_) => None,
                    };
                    if let Some(NativeEvent { event, payload }) = parsed {
                        target.lu_native().dispatch(&event, payload);
                    }
                    Ok(())
                });
                // Not awaited here: on Android the call is answered on the
                // UI thread, and setup must not wait for a thread that may
                // be waiting for setup. Native code keeps what happens in
                // between and hands it over the moment the channel is there.
                let caller = app.clone();
                tauri::async_runtime::spawn(async move {
                    let attached: Result<Value> = caller.lu_native().call("attach", json!({ "channel": channel })).await;
                    if let Err(error) = attached {
                        eprintln!("[lu-native] attach failed: {error}");
                    }
                    caller.lu_native().attached.store(true, std::sync::atomic::Ordering::Release);
                });
            }
            Ok(())
        })
        .on_event(|app, event| {
            // iOS hands a custom scheme link to the app delegate, tao turns
            // that into this event. Android never sends it, there the intent
            // is read in Kotlin.
            #[cfg(target_os = "ios")]
            if let tauri::RunEvent::Opened { urls } = event {
                if let Some(state) = app.try_state::<LuNative<R>>() {
                    for url in urls {
                        state.dispatch(events::DEEP_LINK, json!({ "url": url.as_str(), "source": "opened" }));
                    }
                }
            }
            #[cfg(not(target_os = "ios"))]
            let _ = (app, event);
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::events;
    use super::pump;

    #[test]
    fn the_pump_runs_in_front_and_stops_a_while_after_the_app_left() {
        use std::sync::atomic::{AtomicI64, Ordering};
        let ticks = AtomicI64::new(pump::FOREGROUND);
        for _ in 0..1000 {
            assert!(pump::take(&ticks));
        }
        assert_eq!(ticks.load(Ordering::Acquire), pump::FOREGROUND, "in front it never runs out");

        ticks.store(pump::ticks_after(events::APP_BACKGROUND).unwrap(), Ordering::Release);
        let mut woke = 0;
        while pump::take(&ticks) {
            woke += 1;
            assert!(woke <= pump::AFTER_BACKGROUND, "it has to stop");
        }
        assert_eq!(woke, pump::AFTER_BACKGROUND);
        assert!(!pump::take(&ticks), "and it stays stopped");

        ticks.store(pump::ticks_after(events::APP_FOREGROUND).unwrap(), Ordering::Release);
        assert!(pump::take(&ticks));
        assert_eq!(pump::ticks_after(events::DEEP_LINK), Some(pump::FOREGROUND));
        assert_eq!(pump::ticks_after(events::MEMORY_WARNING), None);
    }

    #[test]
    fn event_names_are_unique_and_written_like_tauri_events() {
        let mut seen = std::collections::HashSet::new();
        for name in events::ALL {
            assert!(seen.insert(name), "{name} twice");
            assert!(name.chars().all(|c| c.is_ascii_lowercase() || c == '-'), "{name}");
        }
        assert_eq!(events::ALL.len(), 15);
    }

    /// Every command the plugin registers has a permission line, and every
    /// permission line a command. A command without its line cannot be
    /// called from any webview, and nothing would say why.
    #[test]
    fn commands_permissions_and_handler_agree() {
        let lib = include_str!("lib.rs");
        let build = include_str!("../build.rs");
        let perms = include_str!("../permissions/default.toml");

        let handler = &lib[lib.find("generate_handler![").unwrap()..];
        let handler = &handler[..handler.find("])").unwrap()];
        let registered: Vec<&str> = handler
            .lines()
            .filter_map(|l| l.trim().strip_prefix("commands::"))
            .map(|l| l.trim_end_matches(','))
            .collect();
        assert!(registered.len() >= 20);

        let list = &build[build.find("const COMMANDS").unwrap()..];
        let list = &list[..list.find("];").unwrap()];
        let declared: Vec<&str> = list
            .lines()
            .map(str::trim)
            .filter(|l| l.starts_with('"'))
            .map(|l| l.trim_matches(|c| c == '"' || c == ','))
            .collect();

        let mut a = registered.clone();
        let mut b = declared.clone();
        a.sort_unstable();
        b.sort_unstable();
        assert_eq!(a, b, "generate_handler! and COMMANDS in build.rs differ");

        for name in &declared {
            let line = format!("\"allow-{}\"", name.replace('_', "-"));
            assert!(perms.contains(&line), "{line} is missing in permissions/default.toml");
        }
        assert_eq!(perms.matches("\"allow-").count(), declared.len());
    }
}
