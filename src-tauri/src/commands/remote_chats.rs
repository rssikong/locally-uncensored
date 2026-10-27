//! Shared chats (mobile-docs/remote/CHATS-V1.md): a chat lives and runs on
//! this computer, a paired phone shows it, writes into it, follows the answer
//! live, answers tool approvals and stops it.
//!
//! The chat itself, its messages and its run stay in the window: a message
//! from the phone goes the same way as one typed at the desktop
//! (`src/lib/remote-chats-bridge.ts`). This file is the part in between:
//!
//! * the list of shared chats the window reports (`remote_chats_sync`),
//! * an event buffer per chat (at most [`MAX_EVENTS`]) that the window fills
//!   (`remote_chats_event`) and the phone reads by long poll,
//! * turns from the phone with their `client_id`, one at a time per chat,
//! * the approvals waiting, with the device's rights as the upper bound,
//! * the HTTP routes, only inside the sealed channel and only with the
//!   right `chat`.
//!
//! The event `remote-chats` carries every action to the window: `send`,
//! `stop`, `approve`, and the questions `create_chat` and `messages` (answered
//! through `remote_chats_reply`).

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use axum::{
    extract::{rejection::JsonRejection, Path as AxPath, Query, State as AxumState},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::Mutex as TokioMutex;

use super::remote::{CallerDevice, RemotePermissions};
use super::remote_create::CreateHub;
use super::remote_sealed::SealedCaller;

/// Event name the window listens on.
pub const EVENT: &str = "remote-chats";
/// Events kept per chat.
pub const MAX_EVENTS: usize = 2000;
/// A stream request waits this long for news.
const HOLD: Duration = Duration::from_secs(25);
/// A question to the window waits this long.
const ASK_WAIT: Duration = Duration::from_secs(4);
/// The window has this long to take up a turn from the phone.
const ACK_SECS: u64 = 30;
/// A message, as large as the desktop's own chat takes from the phone
/// (`CHAT_EVENT_MAX_CONTENT` in remote.rs).
pub const MAX_CONTENT_BYTES: usize = 100 * 1024;
const MAX_ATTACHMENTS: usize = 8;
/// All attachments of one message together.
const MAX_ATTACHMENT_BYTES: u64 = 24 * 1024 * 1024;
const MAX_CHATS: usize = 500;
const MAX_TITLE_CHARS: usize = 200;
/// `client_id`s remembered, over all chats.
const MAX_CLIENT_IDS: usize = 1000;
const MAX_PAGE: u64 = 200;
const MAX_EVENT_TEXT: usize = 64 * 1024;

// ─── The window, behind a trait so the tests can stand in for it ───

pub trait ChatsHost: Send + Sync {
    fn emit(&self, payload: Value);
}

struct NullHost;

impl ChatsHost for NullHost {
    fn emit(&self, _payload: Value) {}
}

pub(crate) struct TauriChatsHost {
    app: tauri::AppHandle,
}

impl TauriChatsHost {
    pub(crate) fn new(app: tauri::AppHandle) -> Self {
        TauriChatsHost { app }
    }
}

impl ChatsHost for TauriChatsHost {
    fn emit(&self, payload: Value) {
        use tauri::Emitter;
        let _ = self.app.emit(EVENT, payload);
    }
}

// ─── Book ───

#[derive(Clone, Debug)]
struct Turn {
    id: String,
    started: u64,
    acked: bool,
    /// The device that sent it.
    device: String,
}

struct Chat {
    /// `{id,title,updated_at,mode,model,busy}` as the window reported it.
    meta: Value,
    events: VecDeque<Value>,
    /// The seq the next event gets; seqs start at 1.
    next_seq: u64,
    /// A turn from the phone the window has not finished.
    turn: Option<Turn>,
    unread: u64,
    notify: Arc<tokio::sync::Notify>,
}

impl Chat {
    fn new(meta: Value) -> Self {
        Chat { meta, events: VecDeque::new(), next_seq: 1, turn: None, unread: 0, notify: Arc::new(tokio::sync::Notify::new()) }
    }

    fn busy(&self) -> bool {
        self.turn.is_some() || self.meta.get("busy").and_then(Value::as_bool).unwrap_or(false)
    }

    /// The oldest seq still buffered, or the next one when empty.
    fn oldest(&self) -> u64 {
        self.events.front().and_then(|e| e["seq"].as_u64()).unwrap_or(self.next_seq)
    }

    fn push(&mut self, mut event: Value) {
        event["seq"] = json!(self.next_seq);
        self.next_seq += 1;
        self.events.push_back(event);
        while self.events.len() > MAX_EVENTS {
            self.events.pop_front();
        }
        self.notify.notify_waiters();
    }

    fn view(&self, id: &str) -> Value {
        let m = &self.meta;
        json!({
            "id": id,
            "title": m.get("title").cloned().unwrap_or(json!("")),
            "updated_at": m.get("updated_at").cloned().unwrap_or(json!(0)),
            "mode": m.get("mode").cloned().unwrap_or(json!("chat")),
            "model": m.get("model").cloned().unwrap_or(Value::Null),
            "busy": self.busy(),
            "unread": self.unread,
        })
    }
}

struct Pending {
    chat_id: String,
    /// The tool's category (api/mcp/types.ts ToolCategory).
    category: String,
    /// A phone answered; the window has not resolved it yet.
    deciding: bool,
}

struct Idem {
    owner: String,
    chat_id: String,
    client_id: String,
    turn_id: String,
}

#[derive(Default)]
struct Book {
    chats: HashMap<String, Chat>,
    /// Shared chats in the window's order (newest first).
    order: Vec<String>,
    idem: VecDeque<Idem>,
    approvals: HashMap<String, Pending>,
}

#[derive(Debug, PartialEq)]
pub enum ChatsError {
    Bad(String),
    NotFound,
    Busy,
    Gone,
    Forbidden(&'static str),
    Decided,
    Silent,
    TooMany,
    NotYours,
}

impl ChatsError {
    fn into_response(self) -> Response {
        match self {
            ChatsError::Bad(m) => (StatusCode::BAD_REQUEST, Json(json!({ "error": m }))).into_response(),
            ChatsError::NotFound => (StatusCode::NOT_FOUND, Json(json!({ "error": "No such shared chat or approval on this computer." }))).into_response(),
            ChatsError::Busy => (StatusCode::CONFLICT, Json(json!({ "error": "busy" }))).into_response(),
            ChatsError::Gone => (StatusCode::GONE, Json(json!({ "error": "gone", "reason": "The events since then are no longer kept. Load the chat again." }))).into_response(),
            ChatsError::Forbidden(right) => (StatusCode::FORBIDDEN, Json(json!({ "error": "forbidden", "right": right }))).into_response(),
            ChatsError::Decided => (StatusCode::CONFLICT, Json(json!({ "error": "already_decided" }))).into_response(),
            ChatsError::NotYours => (StatusCode::FORBIDDEN, Json(json!({ "error": "not_your_run", "reason": "Another phone started this run. That phone or the computer answers it." }))).into_response(),
            ChatsError::TooMany => (StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "too_many_streams", "max": MAX_POLLS_PER_DEVICE }))).into_response(),
            ChatsError::Silent => (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": "LU on the computer did not answer. Make sure LU is open on the computer and try again." })),
            )
                .into_response(),
        }
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_secs() -> u64 {
    crate::commands::remote_create::now_secs()
}

fn new_id(prefix: &str) -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("{prefix}_{hex}")
}

/// One line, control characters out, capped in characters.
fn clean(raw: &str, max: usize) -> String {
    let flat: String = raw.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    flat.trim().chars().take(max).collect()
}

/// Text that keeps its lines (a message, a delta), capped in characters.
fn clean_text(raw: &str, max: usize) -> String {
    raw.chars().filter(|c| !c.is_control() || *c == '\n' || *c == '\t').take(max).collect()
}

/// Chat ids come from the window's store: letters, digits, `-` and `_`.
fn valid_chat_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The right a tool category needs on top of `chat` (PROTOKOLL 12).
pub(crate) fn right_for_category(category: &str) -> &'static str {
    match category {
        "filesystem" => "files",
        "terminal" | "desktop" => "terminal",
        "image" | "video" | "workflow" => "create",
        _ => "agent",
    }
}

// ─── The hub ───

pub struct ChatsHub {
    book: Mutex<Book>,
    host: RwLock<Arc<dyn ChatsHost>>,
    waiters: Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>,
    hold: Duration,
    ask_wait: Duration,
    /// The window has reported its list at least once.
    window_seen: AtomicBool,
    /// Open stream requests per device.
    polls: Mutex<HashMap<String, usize>>,
}

/// Open stream requests a device may hold at once.
pub const MAX_POLLS_PER_DEVICE: usize = 4;

/// One open stream request; counted down when it ends.
pub struct PollSlot<'a> {
    hub: &'a ChatsHub,
    device: String,
}

impl Drop for PollSlot<'_> {
    fn drop(&mut self) {
        let mut polls = lock(&self.hub.polls);
        if let Some(n) = polls.get_mut(&self.device) {
            *n = n.saturating_sub(1);
            if *n == 0 {
                polls.remove(&self.device);
            }
        }
    }
}

impl Default for ChatsHub {
    fn default() -> Self {
        ChatsHub::new()
    }
}

impl ChatsHub {
    pub fn new() -> Self {
        ChatsHub {
            book: Mutex::new(Book::default()),
            host: RwLock::new(Arc::new(NullHost)),
            waiters: Mutex::new(HashMap::new()),
            hold: HOLD,
            ask_wait: ASK_WAIT,
            window_seen: AtomicBool::new(false),
            polls: Mutex::new(HashMap::new()),
        }
    }

    /// A slot for one more open stream request of `device`, or `TooMany`.
    pub fn poll_slot(&self, device: &str) -> Result<PollSlot<'_>, ChatsError> {
        let mut polls = lock(&self.polls);
        let n = polls.entry(device.to_string()).or_insert(0);
        if *n >= MAX_POLLS_PER_DEVICE {
            return Err(ChatsError::TooMany);
        }
        *n += 1;
        Ok(PollSlot { hub: self, device: device.to_string() })
    }

    pub fn set_host(&self, host: Arc<dyn ChatsHost>) {
        *self.host.write().unwrap_or_else(|e| e.into_inner()) = host;
    }

    fn emit(&self, payload: Value) {
        let host = self.host.read().unwrap_or_else(|e| e.into_inner()).clone();
        host.emit(payload);
    }

    /// The words of `status/full` (CHATS-V1.md), once the window reported.
    pub fn features(&self) -> Vec<String> {
        if !self.window_seen.load(Ordering::SeqCst) {
            return Vec::new();
        }
        ["chats", "stream", "approvals", "tasks", "chat_models"].iter().map(|s| s.to_string()).collect()
    }

    // ── from the window ──

    /// The window's list of shared chats, newest first. A chat that left
    /// the list is no longer reachable; its buffer goes with it.
    pub fn sync(&self, chats: &[Value]) {
        self.window_seen.store(true, Ordering::SeqCst);
        let mut book = lock(&self.book);
        let mut order = Vec::new();
        for c in chats.iter().take(MAX_CHATS) {
            let Some(id) = c.get("id").and_then(Value::as_str).filter(|id| valid_chat_id(id)) else { continue };
            if order.iter().any(|o| o == id) {
                continue;
            }
            let mode = c.get("mode").and_then(Value::as_str).filter(|m| matches!(*m, "chat" | "agent" | "code")).unwrap_or("chat");
            let meta = json!({
                "title": clean(c.get("title").and_then(Value::as_str).unwrap_or(""), MAX_TITLE_CHARS),
                "updated_at": c.get("updated_at").and_then(Value::as_u64).unwrap_or(0),
                "mode": mode,
                "model": c.get("model").and_then(Value::as_str).map(|m| clean(m, 200)),
                "busy": c.get("busy").and_then(Value::as_bool).unwrap_or(false),
            });
            match book.chats.get_mut(id) {
                Some(chat) => {
                    let was_busy = chat.busy();
                    chat.meta = meta;
                    if was_busy != chat.busy() {
                        chat.notify.notify_waiters();
                    }
                }
                None => {
                    book.chats.insert(id.to_string(), Chat::new(meta));
                }
            }
            order.push(id.to_string());
        }
        book.chats.retain(|id, chat| {
            let keep = order.contains(id);
            if !keep {
                chat.notify.notify_waiters();
            }
            keep
        });
        book.approvals.retain(|_, p| order.contains(&p.chat_id));
        book.order = order;
    }

    /// One event of a shared chat from the window. Unknown types and chats
    /// are dropped.
    pub fn event(&self, chat_id: &str, raw: &Value) -> bool {
        let Some(event) = sanitize_event(raw) else { return false };
        let mut book = lock(&self.book);
        let kind = event["type"].as_str().unwrap_or("").to_string();
        match kind.as_str() {
            "approval" => {
                let id = event["approval_id"].as_str().unwrap_or("").to_string();
                let category = raw.get("category").and_then(Value::as_str).map(|c| clean(c, 40)).unwrap_or_default();
                if !book.chats.contains_key(chat_id) {
                    return false;
                }
                book.approvals.insert(id, Pending { chat_id: chat_id.to_string(), category, deciding: false });
            }
            "approval_resolved" => {
                let id = event["approval_id"].as_str().unwrap_or("");
                book.approvals.remove(id);
            }
            _ => {}
        }
        let Some(chat) = book.chats.get_mut(chat_id) else { return false };
        let turn_id = event.get("turn_id").and_then(Value::as_str).map(str::to_string);
        if let (Some(turn), Some(tid)) = (chat.turn.as_mut(), turn_id.as_deref()) {
            if turn.id == tid {
                turn.acked = true;
                if matches!(kind.as_str(), "done" | "error" | "stopped") {
                    chat.turn = None;
                }
            }
        }
        if kind == "message" && event.pointer("/message/role").and_then(Value::as_str) == Some("assistant") {
            chat.unread += 1;
        }
        chat.push(event);
        true
    }

    /// A question from [`Self::ask`] answered by the window.
    pub fn reply(&self, request_id: &str, value: Value) -> bool {
        match lock(&self.waiters).remove(request_id) {
            Some(tx) => tx.send(value).is_ok(),
            None => false,
        }
    }

    async fn ask(&self, mut payload: Value) -> Option<Value> {
        let rid = new_id("ask");
        let (tx, rx) = tokio::sync::oneshot::channel();
        {
            let mut waiters = lock(&self.waiters);
            if waiters.len() > 64 {
                return None;
            }
            waiters.insert(rid.clone(), tx);
        }
        payload["request_id"] = json!(rid);
        self.emit(payload);
        match tokio::time::timeout(self.ask_wait, rx).await {
            Ok(Ok(v)) => Some(v),
            _ => {
                lock(&self.waiters).remove(&rid);
                None
            }
        }
    }

    /// A turn the window never took up ends with an error.
    pub fn tick(&self, now: u64) {
        let mut book = lock(&self.book);
        for chat in book.chats.values_mut() {
            let stale = chat.turn.as_ref().is_some_and(|t| !t.acked && now.saturating_sub(t.started) > ACK_SECS);
            if stale {
                let turn = chat.turn.take().map(|t| t.id).unwrap_or_default();
                chat.push(json!({
                    "type": "error",
                    "turn_id": turn,
                    "message": "LU on the computer did not start the answer. Make sure LU is open on the computer and try again.",
                }));
            }
        }
    }

    // ── for the routes ──

    pub fn list(&self) -> Value {
        let book = lock(&self.book);
        let chats: Vec<Value> = book.order.iter().filter_map(|id| book.chats.get(id).map(|c| c.view(id))).collect();
        json!({ "chats": chats })
    }

    /// The mode of a shared chat as the window reported it.
    pub fn mode_of(&self, id: &str) -> Option<String> {
        lock(&self.book).chats.get(id).and_then(|c| c.meta.get("mode").and_then(Value::as_str).map(str::to_string))
    }

    fn shared(&self, id: &str) -> Result<(), ChatsError> {
        if lock(&self.book).chats.contains_key(id) { Ok(()) } else { Err(ChatsError::NotFound) }
    }

    fn busy(&self, id: &str) -> bool {
        lock(&self.book).chats.get(id).is_some_and(Chat::busy)
    }

    /// A new chat from the phone: the window makes it, shared.
    pub async fn create_chat(&self, title: Option<String>, mode: &str, model: Option<String>) -> Result<Value, ChatsError> {
        let engine_id = model.as_deref().and_then(crate::commands::remote::engine_model_id_for);
        let answer = self
            .ask(json!({ "action": "create_chat", "title": title, "mode": mode, "model": model, "model_engine_id": engine_id }))
            .await
            .ok_or(ChatsError::Silent)?;
        let id = answer.get("id").and_then(Value::as_str).filter(|id| valid_chat_id(id)).ok_or_else(|| {
            ChatsError::Bad(answer.get("error").and_then(Value::as_str).map(|e| clean(e, 300)).unwrap_or_else(|| "The chat could not be made on the computer.".to_string()))
        })?;
        // In the list at once, before the window's next report, with the
        // model the window gave the chat.
        let model = answer.get("model").and_then(Value::as_str).map(|m| clean(m, 200));
        let mut book = lock(&self.book);
        if !book.chats.contains_key(id) {
            let meta = json!({ "title": title.unwrap_or_default(), "updated_at": now_secs(), "mode": mode, "model": model, "busy": false });
            book.chats.insert(id.to_string(), Chat::new(meta));
            book.order.insert(0, id.to_string());
        }
        Ok(json!({ "id": id }))
    }

    /// The chat models the phone can pick (`GET /remote-api/chat-models`):
    /// the desktop's own list, whatever engine runs them.
    pub async fn models(&self) -> Result<Value, ChatsError> {
        let answer = self.ask(json!({ "action": "models" })).await.ok_or(ChatsError::Silent)?;
        let models: Vec<Value> = answer
            .get("models")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|m| {
                        let name = m.get("name").and_then(Value::as_str).map(|n| clean(n, 200)).filter(|n| !n.is_empty())?;
                        let label = m.get("label").and_then(Value::as_str).map(|l| clean(l, 200)).unwrap_or_else(|| name.clone());
                        Some(json!({ "name": name, "label": label }))
                    })
                    .take(500)
                    .collect()
            })
            .unwrap_or_default();
        let default = answer.get("default").and_then(Value::as_str).map(|d| clean(d, 200));
        Ok(json!({ "models": models, "default": default }))
    }

    pub async fn messages(&self, id: &str, after: Option<u64>, before: Option<u64>, limit: u64) -> Result<Value, ChatsError> {
        self.shared(id)?;
        let mut answer = self
            .ask(json!({ "action": "messages", "chat_id": id, "after": after, "before": before, "limit": limit.clamp(1, MAX_PAGE) }))
            .await
            .ok_or(ChatsError::Silent)?;
        if answer.get("messages").and_then(Value::as_array).is_none() {
            return Err(ChatsError::NotFound);
        }
        answer["busy"] = json!(self.busy(id));
        {
            let book = lock(&self.book);
            let chat = book.chats.get(id);
            // Where the phone's stream goes on from after this load.
            answer["event_seq"] = json!(chat.map(|c| c.next_seq - 1).unwrap_or(0));
            answer["model"] = chat.and_then(|c| c.meta.get("model").cloned()).unwrap_or(Value::Null);
        }
        if answer.get("next").is_none() {
            answer["next"] = Value::Null;
        }
        Ok(answer)
    }

    /// A message from the phone. The same `client_id` from the same device
    /// gets the same turn back.
    pub fn send(&self, owner: &str, chat_id: &str, body: MessageBody, attachments: Vec<Value>, rights: Value, now: u64) -> Result<(Value, bool), ChatsError> {
        let client_id = body.client_id.trim().to_string();
        if client_id.is_empty() || client_id.len() > 128 || !client_id.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.:".contains(&b)) {
            return Err(ChatsError::Bad("client_id must be 1 to 128 letters, digits, - _ . or :.".to_string()));
        }
        let mut book = lock(&self.book);
        if !book.chats.contains_key(chat_id) {
            return Err(ChatsError::NotFound);
        }
        if let Some(i) = book.idem.iter().find(|i| i.owner == owner && i.chat_id == chat_id && i.client_id == client_id) {
            return Ok((json!({ "turn_id": i.turn_id }), true));
        }
        let content = clean_text(&body.content, usize::MAX);
        if content.len() > MAX_CONTENT_BYTES {
            return Err(ChatsError::Bad(format!("The message is larger than {} KB.", MAX_CONTENT_BYTES / 1024)));
        }
        if content.trim().is_empty() && attachments.is_empty() {
            return Err(ChatsError::Bad("The message is empty.".to_string()));
        }
        let chat = book.chats.get_mut(chat_id).ok_or(ChatsError::NotFound)?;
        if chat.busy() {
            return Err(ChatsError::Busy);
        }
        let turn_id = new_id("turn");
        chat.turn = Some(Turn { id: turn_id.clone(), started: now, acked: false, device: owner.to_string() });
        chat.notify.notify_waiters();
        book.idem.push_back(Idem { owner: owner.to_string(), chat_id: chat_id.to_string(), client_id, turn_id: turn_id.clone() });
        while book.idem.len() > MAX_CLIENT_IDS {
            book.idem.pop_front();
        }
        drop(book);
        self.emit(json!({
            "action": "send",
            "chat_id": chat_id,
            "turn_id": turn_id,
            "device_id": owner,
            "content": content,
            "attachments": attachments,
            "model": body.model.as_deref().map(|m| clean(m, 200)),
            "model_engine_id": body.model.as_deref().and_then(crate::commands::remote::engine_model_id_for),
            "rights": rights,
        }));
        Ok((json!({ "turn_id": turn_id }), false))
    }

    /// The events after `after`, waiting up to the hold for news.
    pub async fn stream(&self, chat_id: &str, after: u64) -> Result<Value, ChatsError> {
        let read = |book: &Book| -> Result<(Vec<Value>, u64, bool, Arc<tokio::sync::Notify>), ChatsError> {
            let chat = book.chats.get(chat_id).ok_or(ChatsError::NotFound)?;
            let last = chat.next_seq - 1;
            // Too old, or from before a restart of LU (the seqs start anew):
            // the phone loads the chat again. `after=0` reads what is still
            // buffered, from its start.
            if (after != 0 && after < chat.oldest().saturating_sub(1)) || after > last {
                return Err(ChatsError::Gone);
            }
            let events: Vec<Value> = chat.events.iter().filter(|e| e["seq"].as_u64().unwrap_or(0) > after).cloned().collect();
            Ok((events, last, chat.busy(), chat.notify.clone()))
        };
        let (events, last, busy, notify) = {
            let book = lock(&self.book);
            read(&book)?
        };
        if !events.is_empty() {
            return Ok(json!({ "events": events, "next": last, "busy": busy }));
        }
        let waiting = notify.notified();
        tokio::pin!(waiting);
        // Registered before the second look, so nothing slips in between.
        waiting.as_mut().enable();
        {
            let book = lock(&self.book);
            let (events, last, busy, _) = read(&book)?;
            if !events.is_empty() {
                return Ok(json!({ "events": events, "next": last, "busy": busy }));
            }
        }
        let _ = tokio::time::timeout(self.hold, waiting).await;
        let book = lock(&self.book);
        let (events, last, busy, _) = read(&book)?;
        Ok(json!({ "events": events, "next": last, "busy": busy }))
    }

    /// A device lost rights (`kept`) or was unpaired (`None`): each turn it
    /// started goes on with no more than it keeps, or stops. The window
    /// narrows the turn's caps or stops it (`revoke`).
    pub fn device_changed(&self, device_id: &str, kept: Option<crate::commands::remote_sealed::DeviceRights>) {
        let turns: Vec<(String, String)> = lock(&self.book)
            .chats
            .iter()
            .filter_map(|(id, c)| c.turn.as_ref().filter(|t| t.device == device_id).map(|t| (id.clone(), t.id.clone())))
            .collect();
        for (chat_id, turn_id) in turns {
            let rights = kept.filter(|k| k.chat).map(|k| json!({ "agent": k.agent, "files": k.files, "terminal": k.terminal, "create": k.create }));
            self.emit(json!({ "action": "revoke", "chat_id": chat_id, "turn_id": turn_id, "rights": rights }));
        }
    }

    pub fn stop(&self, chat_id: &str) -> Result<(), ChatsError> {
        self.shared(chat_id)?;
        self.emit(json!({ "action": "stop", "chat_id": chat_id }));
        Ok(())
    }

    pub fn read(&self, chat_id: &str) -> Result<(), ChatsError> {
        let mut book = lock(&self.book);
        let chat = book.chats.get_mut(chat_id).ok_or(ChatsError::NotFound)?;
        chat.unread = 0;
        Ok(())
    }

    /// The phone answers an approval. The device's rights are the upper
    /// bound: a tool it may not use can only be denied.
    /// A run a phone started is answered by that phone (or at the desktop);
    /// a run started at the desktop by any paired device with the right.
    pub fn decide(&self, device: &str, approval_id: &str, decision: &str, allows: &dyn Fn(&str) -> bool) -> Result<(), ChatsError> {
        if !matches!(decision, "once" | "chat" | "deny") {
            return Err(ChatsError::Bad("decision must be once, chat or deny.".to_string()));
        }
        let chat_id = {
            let mut book = lock(&self.book);
            let owner = book
                .approvals
                .get(approval_id)
                .and_then(|p| book.chats.get(&p.chat_id))
                .and_then(|c| c.turn.as_ref())
                .map(|t| t.device.clone());
            if owner.is_some_and(|o| o != device) {
                return Err(ChatsError::NotYours);
            }
            let p = book.approvals.get_mut(approval_id).ok_or(ChatsError::NotFound)?;
            if p.deciding {
                return Err(ChatsError::Decided);
            }
            let right = right_for_category(&p.category);
            if decision != "deny" && !allows(right) {
                return Err(ChatsError::Forbidden(right));
            }
            p.deciding = true;
            p.chat_id.clone()
        };
        self.emit(json!({ "action": "approve", "chat_id": chat_id, "approval_id": approval_id, "decision": decision }));
        Ok(())
    }

    /// Chats that are working right now, as tasks.
    pub fn tasks(&self) -> Vec<Value> {
        let book = lock(&self.book);
        book.order
            .iter()
            .filter_map(|id| {
                let chat = book.chats.get(id)?;
                if !chat.busy() {
                    return None;
                }
                Some(json!({
                    "id": chat.turn.as_ref().map(|t| t.id.clone()).unwrap_or_else(|| format!("chat_{id}")),
                    "kind": "chat",
                    "chat_id": id,
                    "title": chat.meta.get("title").cloned().unwrap_or(json!("")),
                    "state": "running",
                    "started_at": chat.turn.as_ref().map(|t| t.started),
                }))
            })
            .collect()
    }

    #[cfg(test)]
    fn with_waits(mut self, hold: Duration, ask: Duration) -> Self {
        self.hold = hold;
        self.ask_wait = ask;
        self
    }
}

/// An event as the phone may see it: only known types and their fields,
/// text capped.
fn sanitize_event(raw: &Value) -> Option<Value> {
    let kind = raw.get("type")?.as_str()?;
    let s = |k: &str, max: usize| raw.get(k).and_then(Value::as_str).map(|v| clean(v, max));
    let t = |k: &str| raw.get(k).and_then(Value::as_str).map(|v| clean_text(v, MAX_EVENT_TEXT));
    let turn = s("turn_id", 100);
    Some(match kind {
        "delta" => json!({ "type": "delta", "turn_id": turn, "text": t("text")? }),
        "message" => json!({ "type": "message", "message": sanitize_message(raw.get("message")?)? }),
        "tool" => {
            let state = match raw.get("state").and_then(Value::as_str) {
                Some(st @ ("running" | "done" | "failed")) => st,
                _ => return None,
            };
            json!({ "type": "tool", "turn_id": turn, "name": s("name", 100)?, "summary": s("summary", 500).unwrap_or_default(), "state": state })
        }
        "approval" => json!({
            "type": "approval",
            "approval_id": s("approval_id", 100).filter(|a| !a.is_empty())?,
            "turn_id": turn,
            "tool": s("tool", 100)?,
            "summary": s("summary", 500).unwrap_or_default(),
            "detail": t("detail").map(|d| d.chars().take(4000).collect::<String>()).unwrap_or_default(),
        }),
        "approval_resolved" => {
            let decision = match raw.get("decision").and_then(Value::as_str) {
                Some(d @ ("once" | "chat" | "deny")) => d,
                _ => return None,
            };
            let by = raw.get("by").and_then(Value::as_str).filter(|b| *b == "phone").unwrap_or("desktop");
            let mut ev = json!({ "type": "approval_resolved", "approval_id": s("approval_id", 100)?, "decision": decision, "by": by });
            // Why it ended without a person's answer (no decision in time).
            if let Some(reason) = s("reason", 300).filter(|r| !r.is_empty()) {
                ev["reason"] = json!(reason);
            }
            ev
        }
        "done" => json!({ "type": "done", "turn_id": turn }),
        // The turn waits until the desktop is free (someone types there in
        // another chat); it runs once they open it or after a quiet minute.
        "waiting" => json!({ "type": "waiting", "turn_id": turn }),
        "stopped" => json!({ "type": "stopped", "turn_id": turn }),
        "error" => json!({ "type": "error", "turn_id": turn, "message": s("message", 1000).unwrap_or_else(|| "The answer failed on the computer.".to_string()) }),
        _ => return None,
    })
}

/// A message of the transcript, the fields CHATS-V1.md names.
fn sanitize_message(m: &Value) -> Option<Value> {
    let role = match m.get("role").and_then(Value::as_str) {
        Some(r @ ("user" | "assistant" | "tool")) => r,
        _ => return None,
    };
    let from = match m.get("from").and_then(Value::as_str) {
        Some("phone") => "phone",
        _ => "desktop",
    };
    let mut out = json!({
        "seq": m.get("seq").and_then(Value::as_u64),
        "id": clean(m.get("id")?.as_str()?, 100),
        "role": role,
        "content": clean_text(m.get("content").and_then(Value::as_str).unwrap_or(""), MAX_CONTENT_BYTES),
        "created_at": m.get("created_at").and_then(Value::as_u64).unwrap_or(0),
        "attachments": m.get("attachments").and_then(Value::as_array).map(|a| {
            a.iter().take(MAX_ATTACHMENTS).map(|x| json!({
                "id": x.get("id").and_then(Value::as_str).map(|v| clean(v, 100)),
                "mime": x.get("mime").and_then(Value::as_str).map(|v| clean(v, 100)),
                "name": x.get("name").and_then(Value::as_str).map(|v| clean(v, 200)),
                "bytes": x.get("bytes").and_then(Value::as_u64),
            })).collect::<Vec<_>>()
        }).unwrap_or_default(),
        "from": from,
    });
    if let Some(tool) = m.get("tool").filter(|t| t.is_object()) {
        out["tool"] = json!({
            "name": tool.get("name").and_then(Value::as_str).map(|v| clean(v, 100)),
            "summary": tool.get("summary").and_then(Value::as_str).map(|v| clean(v, 500)),
            "state": tool.get("state").and_then(Value::as_str).map(|v| clean(v, 20)),
        });
    }
    Some(out)
}

// ─── HTTP ───

#[derive(Clone)]
pub(crate) struct ChatsCtx {
    pub hub: Arc<ChatsHub>,
    pub create: Arc<CreateHub>,
    pub permissions: Arc<TokioMutex<RemotePermissions>>,
}

/// Who asks: only a paired device inside the sealed channel, with `chat`.
pub(crate) struct Device {
    id: String,
    caller: SealedCaller,
}

async fn guard(ctx: &ChatsCtx, parts: (Option<axum::Extension<SealedCaller>>, Option<axum::Extension<CallerDevice>>)) -> Result<Device, Response> {
    let (sealed, device) = parts;
    let Some(axum::Extension(caller)) = sealed else {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "sealed_only" }))).into_response());
    };
    if !caller.rights.chat {
        return Err(ChatsError::Forbidden("chat").into_response());
    }
    let id = device.map(|axum::Extension(CallerDevice(id))| id).unwrap_or_else(|| caller.device_id.clone());
    ctx.hub.tick(now_secs());
    Ok(Device { id, caller })
}

/// What tools a run for this device may use: its right AND the global switch.
async fn rights_of(ctx: &ChatsCtx, caller: &SealedCaller) -> Value {
    let global = ctx.permissions.lock().await.clone();
    let r = caller.rights;
    json!({
        "agent": r.agent,
        "files": r.files && (global.filesystem || global.downloads),
        "terminal": r.terminal && (global.shell || global.process_control),
        "create": r.create && global.create,
        // The device's generation when the turn was let in (remote_sealed.rs).
        "generation": caller.generation,
    })
}

pub(crate) async fn handle_list(
    AxumState(ctx): AxumState<ChatsCtx>,
    sealed: Option<axum::Extension<SealedCaller>>,
    device: Option<axum::Extension<CallerDevice>>,
) -> Response {
    if let Err(r) = guard(&ctx, (sealed, device)).await {
        return r;
    }
    Json(ctx.hub.list()).into_response()
}

#[derive(Deserialize)]
pub(crate) struct NewChat {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    model: Option<String>,
}

pub(crate) async fn handle_create(
    AxumState(ctx): AxumState<ChatsCtx>,
    sealed: Option<axum::Extension<SealedCaller>>,
    device: Option<axum::Extension<CallerDevice>>,
    body: Result<Json<NewChat>, JsonRejection>,
) -> Response {
    let who = match guard(&ctx, (sealed, device)).await {
        Ok(d) => d,
        Err(r) => return r,
    };
    let Ok(Json(body)) = body else {
        return ChatsError::Bad("The chat is not valid JSON.".to_string()).into_response();
    };
    let mode = body.mode.as_deref().unwrap_or("chat");
    if !matches!(mode, "chat" | "agent" | "code") {
        return ChatsError::Bad("mode must be chat, agent or code.".to_string()).into_response();
    }
    if mode != "chat" && !who.caller.rights.agent {
        return ChatsError::Forbidden("agent").into_response();
    }
    let title = body.title.map(|t| clean(&t, MAX_TITLE_CHARS)).filter(|t| !t.is_empty());
    let model = body.model.map(|m| clean(&m, 200)).filter(|m| !m.is_empty());
    match ctx.hub.create_chat(title, mode, model).await {
        Ok(v) => (StatusCode::CREATED, Json(v)).into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(Deserialize)]
pub(crate) struct PageQuery {
    #[serde(default)]
    after: Option<u64>,
    /// Older messages: those before this seq.
    #[serde(default)]
    before: Option<u64>,
    #[serde(default)]
    limit: Option<u64>,
}

pub(crate) async fn handle_models(
    AxumState(ctx): AxumState<ChatsCtx>,
    sealed: Option<axum::Extension<SealedCaller>>,
    device: Option<axum::Extension<CallerDevice>>,
) -> Response {
    if let Err(r) = guard(&ctx, (sealed, device)).await {
        return r;
    }
    match ctx.hub.models().await {
        Ok(v) => Json(v).into_response(),
        Err(e) => e.into_response(),
    }
}

pub(crate) async fn handle_messages(
    AxumState(ctx): AxumState<ChatsCtx>,
    sealed: Option<axum::Extension<SealedCaller>>,
    device: Option<axum::Extension<CallerDevice>>,
    AxPath(id): AxPath<String>,
    Query(q): Query<PageQuery>,
) -> Response {
    if let Err(r) = guard(&ctx, (sealed, device)).await {
        return r;
    }
    if q.after.is_some() && q.before.is_some() {
        return ChatsError::Bad("after and before cannot be used together.".to_string()).into_response();
    }
    match ctx.hub.messages(&id, q.after, q.before, q.limit.unwrap_or(50)).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(Deserialize)]
pub(crate) struct MessageBody {
    client_id: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    attachments: Vec<String>,
    #[serde(default)]
    model: Option<String>,
}

pub(crate) async fn handle_send(
    AxumState(ctx): AxumState<ChatsCtx>,
    sealed: Option<axum::Extension<SealedCaller>>,
    device: Option<axum::Extension<CallerDevice>>,
    AxPath(id): AxPath<String>,
    body: Result<Json<MessageBody>, JsonRejection>,
) -> Response {
    let who = match guard(&ctx, (sealed, device)).await {
        Ok(d) => d,
        Err(r) => return r,
    };
    let Ok(Json(body)) = body else {
        return ChatsError::Bad("The message is not valid JSON or misses client_id.".to_string()).into_response();
    };
    // An agent or code chat runs tools: it needs the right agent, as for
    // making one.
    if ctx.hub.mode_of(&id).is_some_and(|m| m != "chat") && !who.caller.rights.agent {
        return ChatsError::Forbidden("agent").into_response();
    }
    if body.attachments.len() > MAX_ATTACHMENTS {
        return ChatsError::Bad(format!("At most {MAX_ATTACHMENTS} attachments.")).into_response();
    }
    // Attachments are uploads of this device, read here so the window gets
    // the bytes and never a path the phone named.
    let create = ctx.create.clone();
    let owner = who.id.clone();
    let ids = body.attachments.clone();
    let loaded = tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        let mut total = 0u64;
        for id in ids {
            let (bytes, mime, name) = create.upload_bytes(&owner, &id).ok_or_else(|| "No such upload. Upload the file again.".to_string())?;
            total += bytes.len() as u64;
            if total > MAX_ATTACHMENT_BYTES {
                return Err("The attachments are too large together.".to_string());
            }
            use base64::Engine as _;
            out.push(json!({
                "id": id,
                "mime": mime,
                "name": name,
                "bytes": bytes.len(),
                "data_base64": base64::engine::general_purpose::STANDARD.encode(&bytes),
            }));
        }
        Ok(out)
    })
    .await;
    let attachments = match loaded {
        Ok(Ok(a)) => a,
        Ok(Err(m)) => return ChatsError::Bad(m).into_response(),
        Err(_) => return ChatsError::Bad("The attachments could not be read.".to_string()).into_response(),
    };
    let rights = rights_of(&ctx, &who.caller).await;
    match ctx.hub.send(&who.id, &id, body, attachments, rights, now_secs()) {
        Ok((v, _)) => (StatusCode::ACCEPTED, Json(v)).into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(Deserialize)]
pub(crate) struct StreamQuery {
    #[serde(default)]
    after: Option<u64>,
}

pub(crate) async fn handle_stream(
    AxumState(ctx): AxumState<ChatsCtx>,
    sealed: Option<axum::Extension<SealedCaller>>,
    device: Option<axum::Extension<CallerDevice>>,
    AxPath(id): AxPath<String>,
    Query(q): Query<StreamQuery>,
) -> Response {
    let who = match guard(&ctx, (sealed, device)).await {
        Ok(d) => d,
        Err(r) => return r,
    };
    let _slot = match ctx.hub.poll_slot(&who.id) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    match ctx.hub.stream(&id, q.after.unwrap_or(0)).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => e.into_response(),
    }
}

pub(crate) async fn handle_stop(
    AxumState(ctx): AxumState<ChatsCtx>,
    sealed: Option<axum::Extension<SealedCaller>>,
    device: Option<axum::Extension<CallerDevice>>,
    AxPath(id): AxPath<String>,
) -> Response {
    if let Err(r) = guard(&ctx, (sealed, device)).await {
        return r;
    }
    match ctx.hub.stop(&id) {
        Ok(()) => (StatusCode::ACCEPTED, Json(json!({ "stopping": true }))).into_response(),
        Err(e) => e.into_response(),
    }
}

pub(crate) async fn handle_read(
    AxumState(ctx): AxumState<ChatsCtx>,
    sealed: Option<axum::Extension<SealedCaller>>,
    device: Option<axum::Extension<CallerDevice>>,
    AxPath(id): AxPath<String>,
) -> Response {
    if let Err(r) = guard(&ctx, (sealed, device)).await {
        return r;
    }
    match ctx.hub.read(&id) {
        Ok(()) => Json(json!({ "unread": 0 })).into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(Deserialize)]
pub(crate) struct Decision {
    decision: String,
}

pub(crate) async fn handle_approval(
    AxumState(ctx): AxumState<ChatsCtx>,
    sealed: Option<axum::Extension<SealedCaller>>,
    device: Option<axum::Extension<CallerDevice>>,
    AxPath(id): AxPath<String>,
    body: Result<Json<Decision>, JsonRejection>,
) -> Response {
    let who = match guard(&ctx, (sealed, device)).await {
        Ok(d) => d,
        Err(r) => return r,
    };
    let Ok(Json(body)) = body else {
        return ChatsError::Bad("decision must be once, chat or deny.".to_string()).into_response();
    };
    let rights = rights_of(&ctx, &who.caller).await;
    let allows = |right: &str| rights.get(right).and_then(Value::as_bool).unwrap_or(false);
    match ctx.hub.decide(&who.id, &id, body.decision.trim(), &allows) {
        Ok(()) => Json(json!({ "accepted": true })).into_response(),
        Err(e) => e.into_response(),
    }
}

pub(crate) async fn handle_tasks(
    AxumState(ctx): AxumState<ChatsCtx>,
    sealed: Option<axum::Extension<SealedCaller>>,
    device: Option<axum::Extension<CallerDevice>>,
) -> Response {
    let who = match guard(&ctx, (sealed, device)).await {
        Ok(d) => d,
        Err(r) => return r,
    };
    let mut tasks = ctx.hub.tasks();
    if who.caller.rights.create {
        tasks.extend(ctx.create.open_jobs(&who.id));
    }
    Json(json!({ "tasks": tasks })).into_response()
}

// ─── Tauri commands for the window ───

fn hub_of(state: &crate::state::AppState) -> Result<Arc<ChatsHub>, String> {
    state.remote.lock().map(|r| r.chats.clone()).map_err(|_| "Remote state unavailable".to_string())
}

/// The window's list of shared chats.
#[tauri::command]
pub fn remote_chats_sync(state: tauri::State<'_, crate::state::AppState>, chats: Vec<Value>) -> Result<(), String> {
    hub_of(&state)?.sync(&chats);
    Ok(())
}

/// One event of a shared chat.
#[tauri::command]
pub fn remote_chats_event(state: tauri::State<'_, crate::state::AppState>, chat_id: String, event: Value) -> Result<bool, String> {
    Ok(hub_of(&state)?.event(&chat_id, &event))
}

/// The window answers a question (`create_chat`, `messages`).
#[tauri::command]
pub fn remote_chats_reply(state: tauri::State<'_, crate::state::AppState>, request_id: String, value: Value) -> Result<bool, String> {
    Ok(hub_of(&state)?.reply(&request_id, value))
}

#[cfg(test)]
#[path = "remote_chats/tests.rs"]
mod tests;
