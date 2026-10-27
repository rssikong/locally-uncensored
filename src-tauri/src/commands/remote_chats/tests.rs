//! Shared chats (CHATS-V1.md) without a window: a stand in records what the
//! hub hands over and answers its questions.

use super::*;
use crate::commands::remote_sealed::DeviceRights;
use axum::routing::{get, post};
use axum::Router;

#[derive(Default)]
struct FakeHost {
    events: Mutex<Vec<Value>>,
}

impl ChatsHost for FakeHost {
    fn emit(&self, payload: Value) {
        lock(&self.events).push(payload);
    }
}

impl FakeHost {
    fn actions(&self, action: &str) -> Vec<Value> {
        lock(&self.events).iter().filter(|e| e["action"] == action).cloned().collect()
    }
}

struct Rig {
    hub: Arc<ChatsHub>,
    host: Arc<FakeHost>,
    create: Arc<CreateHub>,
}

fn rig() -> Rig {
    let host = Arc::new(FakeHost::default());
    let hub = Arc::new(ChatsHub::new().with_waits(Duration::from_millis(300), Duration::from_millis(300)));
    hub.set_host(host.clone());
    Rig { hub, host, create: Arc::new(CreateHub::default()) }
}

fn chat(id: &str, title: &str) -> Value {
    json!({ "id": id, "title": title, "updated_at": 1_700_000_000_000u64, "mode": "agent", "model": "qwen", "busy": false })
}

fn body(content: &str, client_id: &str) -> MessageBody {
    serde_json::from_value(json!({ "client_id": client_id, "content": content })).unwrap()
}

fn all() -> Value {
    json!({ "agent": true, "files": true, "terminal": true, "create": true })
}

#[test]
fn only_the_shared_chats_are_listed_and_a_chat_that_leaves_the_list_is_gone() {
    let r = rig();
    assert!(r.hub.features().is_empty(), "no words before the window reported");
    r.hub.sync(&[chat("a", "First"), chat("b\u{0}bad/id", "x"), chat("c", "Second")]);
    assert_eq!(r.hub.features(), ["chats", "stream", "approvals", "tasks", "chat_models"]);
    let list = r.hub.list();
    let ids: Vec<&str> = list["chats"].as_array().unwrap().iter().map(|c| c["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["a", "c"]);
    assert_eq!(list["chats"][0]["mode"], "agent");
    assert_eq!(list["chats"][0]["unread"], 0);
    r.hub.sync(&[chat("c", "Second")]);
    assert_eq!(r.hub.send("dev", "a", body("hi", "1"), vec![], all(), 1), Err(ChatsError::NotFound));
}

#[test]
fn a_message_from_the_phone_reaches_the_window_once_per_client_id_and_a_busy_chat_says_so() {
    let r = rig();
    r.hub.sync(&[chat("a", "A")]);
    let (first, again) = r.hub.send("dev", "a", body("hello", "c-1"), vec![], all(), 10).unwrap();
    assert!(!again);
    let turn = first["turn_id"].as_str().unwrap().to_string();
    // The offline buffer sends it again: same turn, nothing new for the window.
    let (second, again) = r.hub.send("dev", "a", body("hello", "c-1"), vec![], all(), 11).unwrap();
    assert!(again);
    assert_eq!(second["turn_id"], turn.as_str());
    let sends = r.host.actions("send");
    assert_eq!(sends.len(), 1);
    assert_eq!(sends[0]["content"], "hello");
    assert_eq!(sends[0]["rights"]["terminal"], true);
    // While the turn runs, another message is 409 busy.
    assert_eq!(r.hub.send("dev", "a", body("more", "c-2"), vec![], all(), 12), Err(ChatsError::Busy));
    assert_eq!(r.hub.tasks().len(), 1);
    // The window ends the turn: the chat takes messages again.
    assert!(r.hub.event("a", &json!({ "type": "done", "turn_id": turn })));
    assert!(r.hub.send("dev", "a", body("more", "c-2"), vec![], all(), 13).is_ok());
    // Another device's client_id is its own.
    r.hub.event("a", &json!({ "type": "done", "turn_id": r.host.actions("send")[1]["turn_id"] }));
    let (other, again) = r.hub.send("dev-b", "a", body("x", "c-1"), vec![], all(), 14).unwrap();
    assert!(!again);
    assert_ne!(other["turn_id"], turn.as_str());
    // A chat the desktop is working on is busy too.
    r.hub.sync(&[json!({ "id": "a", "title": "A", "busy": true })]);
    r.hub.event("a", &json!({ "type": "done", "turn_id": other["turn_id"] }));
    assert_eq!(r.hub.send("dev", "a", body("y", "c-3"), vec![], all(), 15), Err(ChatsError::Busy));
}

#[test]
fn messages_are_checked_before_they_go_anywhere() {
    let r = rig();
    r.hub.sync(&[chat("a", "A")]);
    for (content, client) in [("x", ""), ("x", "has space"), ("", "c"), ("   ", "c")] {
        assert!(matches!(r.hub.send("dev", "a", body(content, client), vec![], all(), 1), Err(ChatsError::Bad(_))), "{content:?} {client:?}");
    }
    let huge = "a".repeat(MAX_CONTENT_BYTES + 1);
    assert!(matches!(r.hub.send("dev", "a", body(&huge, "c"), vec![], all(), 1), Err(ChatsError::Bad(_))));
    assert!(r.host.actions("send").is_empty());
}

#[test]
fn a_turn_the_window_never_takes_up_ends_with_an_error() {
    let r = rig();
    r.hub.sync(&[chat("a", "A")]);
    r.hub.send("dev", "a", body("hello", "c-1"), vec![], all(), 100).unwrap();
    r.hub.tick(100 + ACK_SECS + 1);
    let book = lock(&r.hub.book);
    let chat = &book.chats["a"];
    assert!(chat.turn.is_none());
    assert_eq!(chat.events.back().unwrap()["type"], "error");
}

#[test]
fn a_turn_that_waits_for_the_desktop_is_taken_up_and_the_phone_hears_it() {
    let r = rig();
    r.hub.sync(&[chat("a", "A")]);
    let (first, _) = r.hub.send("dev", "a", body("hello", "c-1"), vec![], all(), 100).unwrap();
    let turn = first["turn_id"].as_str().unwrap().to_string();
    assert!(r.hub.event("a", &json!({ "type": "waiting", "turn_id": turn, "extra": "dropped" })));
    // Someone types at the desktop for a while: the turn is not given up.
    r.hub.tick(100 + ACK_SECS + 50);
    let book = lock(&r.hub.book);
    let chat = &book.chats["a"];
    assert_eq!(chat.turn.as_ref().map(|t| t.id.as_str()), Some(turn.as_str()));
    assert_eq!(chat.events.back().unwrap(), &json!({ "seq": 1, "type": "waiting", "turn_id": turn }));
}

#[test]
fn the_buffer_keeps_2000_events_and_an_older_cursor_is_410() {
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    rt.block_on(async {
        let r = rig();
        r.hub.sync(&[chat("a", "A")]);
        for n in 0..(MAX_EVENTS + 5) {
            r.hub.event("a", &json!({ "type": "delta", "turn_id": "t", "text": format!("{n} ") }));
        }
        assert_eq!(lock(&r.hub.book).chats["a"].events.len(), MAX_EVENTS);
        assert_eq!(r.hub.stream("a", 2).await, Err(ChatsError::Gone));
        let last = (MAX_EVENTS + 5) as u64;
        let tail = r.hub.stream("a", last - 3).await.unwrap();
        assert_eq!(tail["events"].as_array().unwrap().len(), 3);
        assert_eq!(tail["next"], last);
        // A cursor from before a restart of LU (past the end) is 410 too.
        assert_eq!(r.hub.stream("a", last + 10).await, Err(ChatsError::Gone));
    });
}

#[tokio::test]
async fn the_stream_waits_for_news_and_answers_when_it_comes() {
    let r = rig();
    r.hub.sync(&[chat("a", "A")]);
    let hub = r.hub.clone();
    let waiting = tokio::spawn(async move { hub.stream("a", 0).await });
    tokio::time::sleep(Duration::from_millis(50)).await;
    r.hub.event("a", &json!({ "type": "delta", "turn_id": "t1", "text": "Hel" }));
    let got = waiting.await.unwrap().unwrap();
    assert_eq!(got["events"][0]["text"], "Hel");
    assert_eq!(got["events"][0]["seq"], 1);
    assert_eq!(got["next"], 1);
    // Nothing new: the hold ends empty with the same cursor.
    let empty = r.hub.stream("a", 1).await.unwrap();
    assert_eq!(empty["events"], json!([]));
    assert_eq!(empty["next"], 1);
}

#[test]
fn events_are_cleaned_and_unknown_ones_dropped() {
    let r = rig();
    r.hub.sync(&[chat("a", "A")]);
    assert!(!r.hub.event("a", &json!({ "type": "secret", "path": "/x" })));
    assert!(!r.hub.event("a", &json!({ "type": "tool", "name": "x", "state": "weird" })));
    assert!(!r.hub.event("zzz", &json!({ "type": "done" })));
    assert!(r.hub.event("a", &json!({
        "type": "message", "extra": 1,
        "message": { "id": "m1", "role": "assistant", "content": "Hi\nthere", "created_at": 5, "from": "desktop", "seq": 3, "internal": "x" }
    })));
    let book = lock(&r.hub.book);
    let e = book.chats["a"].events.back().unwrap();
    assert!(e.get("extra").is_none());
    assert!(e["message"].get("internal").is_none());
    assert_eq!(e["message"]["content"], "Hi\nthere");
    assert_eq!(book.chats["a"].unread, 1, "an answer counts as unread");
}

#[test]
fn approvals_respect_the_device_rights_and_the_first_answer_wins() {
    let r = rig();
    r.hub.sync(&[chat("a", "A")]);
    r.hub.event("a", &json!({ "type": "approval", "approval_id": "ap1", "turn_id": "t", "tool": "shell_execute", "summary": "ls", "detail": "ls -la", "category": "terminal" }));
    let no_terminal = |right: &str| right != "terminal";
    // Without `terminal` a shell tool can only be denied.
    assert_eq!(r.hub.decide("dev", "ap1", "once", &no_terminal), Err(ChatsError::Forbidden("terminal")));
    assert_eq!(r.hub.decide("dev", "ap1", "chat", &no_terminal), Err(ChatsError::Forbidden("terminal")));
    assert!(matches!(r.hub.decide("dev", "ap1", "maybe", &no_terminal), Err(ChatsError::Bad(_))));
    r.hub.decide("dev", "ap1", "deny", &no_terminal).unwrap();
    // A second answer before the window resolved it: already decided.
    assert_eq!(r.hub.decide("dev", "ap1", "once", &|_: &str| true), Err(ChatsError::Decided));
    let approve = r.host.actions("approve");
    assert_eq!(approve.len(), 1);
    assert_eq!((approve[0]["approval_id"].as_str(), approve[0]["decision"].as_str()), (Some("ap1"), Some("deny")));
    // The desktop answered first on another one: the phone's answer finds nothing.
    r.hub.event("a", &json!({ "type": "approval", "approval_id": "ap2", "tool": "file_write", "category": "filesystem" }));
    r.hub.event("a", &json!({ "type": "approval_resolved", "approval_id": "ap2", "decision": "once", "by": "desktop" }));
    assert_eq!(r.hub.decide("dev", "ap2", "once", &|_: &str| true), Err(ChatsError::NotFound));
    assert_eq!(right_for_category("filesystem"), "files");
    assert_eq!(right_for_category("desktop"), "terminal");
    assert_eq!(right_for_category("image"), "create");
    assert_eq!(right_for_category("web"), "agent");
}

// ── HTTP ──

fn router(r: &Rig) -> Router {
    let ctx = ChatsCtx { hub: r.hub.clone(), create: r.create.clone(), permissions: Arc::new(TokioMutex::new(RemotePermissions { filesystem: true, shell: true, create: true, ..Default::default() })) };
    Router::new()
        .route("/remote-api/chats", get(handle_list).post(handle_create))
        .route("/remote-api/chats/{id}", get(handle_messages))
        .route("/remote-api/chat-models", get(handle_models))
        .route("/remote-api/chats/{id}/messages", post(handle_send))
        .route("/remote-api/chats/{id}/stream", get(handle_stream))
        .route("/remote-api/chats/{id}/stop", post(handle_stop))
        .route("/remote-api/chats/{id}/read", post(handle_read))
        .route("/remote-api/approvals/{id}", post(handle_approval))
        .route("/remote-api/tasks", get(handle_tasks))
        .layer(axum::middleware::from_fn(|mut req: axum::extract::Request, next: axum::middleware::Next| async move {
            let (device, rights) = {
                let h = |k: &str| req.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_string);
                (h("x-test-device"), h("x-test-rights"))
            };
            if let Some(dev) = device {
                let rights: Vec<String> = rights.unwrap_or_default().split(',').map(str::to_string).collect();
                let has = |r: &str| rights.iter().any(|x| x == r);
                let caller = SealedCaller {
                    device_id: dev.clone(),
                    rights: DeviceRights { chat: has("chat"), agent: has("agent"), files: has("files"), terminal: has("terminal"), create: has("create") },
                    generation: 0,
                };
                req.extensions_mut().insert(caller);
                req.extensions_mut().insert(CallerDevice(dev));
            }
            next.run(req).await
        }))
        .with_state(ctx)
}

async fn serve(router: Router) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (base, task)
}

/// Answers the window's questions the way the bridge does.
fn answer_window(r: &Rig) -> tokio::task::JoinHandle<()> {
    let hub = r.hub.clone();
    let host = r.host.clone();
    tokio::spawn(async move {
        let mut seen = 0usize;
        loop {
            let all: Vec<Value> = lock(&host.events).clone();
            for e in all.iter().skip(seen) {
                let rid = e["request_id"].as_str().unwrap_or("");
                match e["action"].as_str() {
                    Some("create_chat") => {
                        hub.reply(rid, json!({ "id": "new-chat", "model": e["model"].as_str().unwrap_or("qwen3:8b") }));
                    }
                    Some("models") => {
                        hub.reply(rid, json!({ "models": [{ "name": "qwen3:8b", "label": "qwen3:8b" }, { "name": "lmstudio::gemma-3", "label": "gemma-3" }, { "label": "no name" }], "default": "qwen3:8b" }));
                    }
                    Some("messages") if !e["before"].is_null() => {
                        hub.reply(rid, json!({ "messages": [{ "seq": 1, "id": "m0", "role": "user", "content": "older", "created_at": 1, "attachments": [], "from": "desktop" }], "next": null, "before": e["before"] }));
                    }
                    Some("messages") => {
                        hub.reply(rid, json!({ "messages": [{ "seq": 1, "id": "m1", "role": "user", "content": "hi", "created_at": 1, "attachments": [], "from": "desktop" }], "next": null }));
                    }
                    _ => {}
                }
            }
            seen = all.len();
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
}

#[tokio::test]
async fn the_routes_are_sealed_only_and_need_the_right_chat() {
    let r = rig();
    r.hub.sync(&[chat("a", "A")]);
    let (base, task) = serve(router(&r)).await;
    let c = reqwest::Client::builder().no_proxy().build().unwrap();
    let plain = c.get(format!("{base}/remote-api/chats")).send().await.unwrap();
    assert_eq!(plain.status(), StatusCode::FORBIDDEN);
    assert_eq!(plain.json::<Value>().await.unwrap()["error"], "sealed_only");
    let without = c.get(format!("{base}/remote-api/chats")).header("x-test-device", "d").header("x-test-rights", "agent").send().await.unwrap();
    assert_eq!(without.status(), StatusCode::FORBIDDEN);
    assert_eq!(without.json::<Value>().await.unwrap()["right"], "chat");
    let ok: Value = c.get(format!("{base}/remote-api/chats")).header("x-test-device", "d").header("x-test-rights", "chat").send().await.unwrap().json().await.unwrap();
    assert_eq!(ok["chats"][0]["id"], "a");
    task.abort();
}

#[tokio::test]
async fn the_phone_learns_the_chat_models_pages_back_and_sees_each_chats_model() {
    let r = rig();
    r.hub.sync(&[chat("a", "A")]);
    let answering = answer_window(&r);
    let (base, task) = serve(router(&r)).await;
    let c = reqwest::Client::builder().no_proxy().build().unwrap();
    let dev = |rb: reqwest::RequestBuilder| rb.header("x-test-device", "d").header("x-test-rights", "chat,agent");
    let models: Value = dev(c.get(format!("{base}/remote-api/chat-models"))).send().await.unwrap().json().await.unwrap();
    assert_eq!(models, json!({ "models": [{ "name": "qwen3:8b", "label": "qwen3:8b" }, { "name": "lmstudio::gemma-3", "label": "gemma-3" }], "default": "qwen3:8b" }));
    // The chat's model on its page; older messages with before.
    let page: Value = dev(c.get(format!("{base}/remote-api/chats/a"))).send().await.unwrap().json().await.unwrap();
    assert_eq!(page["model"], "qwen");
    let older: Value = dev(c.get(format!("{base}/remote-api/chats/a?before=5&limit=10"))).send().await.unwrap().json().await.unwrap();
    assert_eq!(older["messages"][0]["content"], "older");
    assert_eq!(r.host.actions("messages").last().unwrap()["before"], 5);
    let both = dev(c.get(format!("{base}/remote-api/chats/a?before=5&after=1"))).send().await.unwrap();
    assert_eq!(both.status(), StatusCode::BAD_REQUEST);
    // A new chat is listed with the model the window gave it; a message names its model to the window.
    let made: Value = dev(c.post(format!("{base}/remote-api/chats"))).json(&json!({ "model": "lmstudio::gemma-3" })).send().await.unwrap().json().await.unwrap();
    assert_eq!(made["id"], "new-chat");
    let list: Value = dev(c.get(format!("{base}/remote-api/chats"))).send().await.unwrap().json().await.unwrap();
    assert_eq!(list["chats"][0]["model"], "lmstudio::gemma-3");
    assert!(list["chats"][0]["updated_at"].as_u64().unwrap() < 10_000_000_000, "seconds");
    dev(c.post(format!("{base}/remote-api/chats/a/messages"))).json(&json!({ "client_id": "m1", "content": "hi", "model": "qwen3:8b" })).send().await.unwrap();
    assert_eq!(r.host.actions("send").last().unwrap()["model"], "qwen3:8b");
    answering.abort();
    task.abort();
}

#[test]
fn a_stream_from_zero_reads_the_buffer_even_after_it_was_trimmed() {
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    rt.block_on(async {
        let r = rig();
        r.hub.sync(&[chat("a", "A")]);
        for n in 0..(MAX_EVENTS + 3) {
            r.hub.event("a", &json!({ "type": "delta", "turn_id": "t", "text": format!("{n} ") }));
        }
        let s = r.hub.stream("a", 0).await.unwrap();
        let events = s["events"].as_array().unwrap();
        assert_eq!(events.len(), MAX_EVENTS);
        // Every event carries its seq, `next` is the last one.
        assert!(events.windows(2).all(|w| w[1]["seq"].as_u64().unwrap() == w[0]["seq"].as_u64().unwrap() + 1));
        assert_eq!(s["next"], events.last().unwrap()["seq"]);
        assert_eq!(s["next"], (MAX_EVENTS + 3) as u64);
        // An old cursor other than 0 is still 410.
        assert_eq!(r.hub.stream("a", 1).await, Err(ChatsError::Gone));
    });
}

#[tokio::test]
async fn a_phone_makes_a_chat_reads_it_writes_follows_the_answer_and_stops() {
    let r = rig();
    r.hub.sync(&[chat("a", "A")]);
    let answering = answer_window(&r);
    let (base, task) = serve(router(&r)).await;
    let c = reqwest::Client::builder().no_proxy().build().unwrap();
    let dev = |rb: reqwest::RequestBuilder| rb.header("x-test-device", "d").header("x-test-rights", "chat,agent,files");
    // An agent chat needs the right agent.
    let refused = c.post(format!("{base}/remote-api/chats")).header("x-test-device", "d").header("x-test-rights", "chat").json(&json!({ "mode": "agent" })).send().await.unwrap();
    assert_eq!(refused.status(), StatusCode::FORBIDDEN);
    let made = dev(c.post(format!("{base}/remote-api/chats"))).json(&json!({ "title": "From the phone", "mode": "agent" })).send().await.unwrap();
    assert_eq!(made.status(), StatusCode::CREATED);
    assert_eq!(made.json::<Value>().await.unwrap()["id"], "new-chat");
    let list: Value = dev(c.get(format!("{base}/remote-api/chats"))).send().await.unwrap().json().await.unwrap();
    assert_eq!(list["chats"][0]["id"], "new-chat", "the new chat is listed at once");
    let page: Value = dev(c.get(format!("{base}/remote-api/chats/a?limit=10"))).send().await.unwrap().json().await.unwrap();
    assert_eq!(page["messages"][0]["content"], "hi");
    assert_eq!(page["busy"], false);
    assert_eq!(page["event_seq"], 0);
    // A text upload goes along as an attachment, with its bytes.
    let up = r.create.add_file_as("d", None, b"# notes\nline", Some("text/markdown"), Some("../notes.md")).unwrap();
    assert_eq!(up["mime"], "text/markdown");
    assert_eq!(up["name"], "notes.md");
    let sent = dev(c.post(format!("{base}/remote-api/chats/a/messages")))
        .json(&json!({ "client_id": "k1", "content": "summarise", "attachments": [up["id"]] }))
        .send().await.unwrap();
    assert_eq!(sent.status(), StatusCode::ACCEPTED);
    let turn = sent.json::<Value>().await.unwrap()["turn_id"].as_str().unwrap().to_string();
    let send = r.host.actions("send").pop().unwrap();
    assert_eq!(send["attachments"][0]["name"], "notes.md");
    assert_eq!(send["attachments"][0]["data_base64"], "IyBub3RlcwpsaW5l");
    // Rights the run may use: the device's AND the global switches.
    assert_eq!(send["rights"], json!({ "agent": true, "files": true, "terminal": false, "create": false, "generation": 0 }));
    // Someone else's upload is not found.
    let foreign = c.post(format!("{base}/remote-api/chats/a/messages")).header("x-test-device", "other").header("x-test-rights", "chat,agent")
        .json(&json!({ "client_id": "k9", "content": "x", "attachments": [up["id"]] })).send().await.unwrap();
    assert_eq!(foreign.status(), StatusCode::BAD_REQUEST);
    // Busy while it runs; the same client_id is the same turn.
    let busy = dev(c.post(format!("{base}/remote-api/chats/a/messages"))).json(&json!({ "client_id": "k2", "content": "x" })).send().await.unwrap();
    assert_eq!(busy.status(), StatusCode::CONFLICT);
    let again = dev(c.post(format!("{base}/remote-api/chats/a/messages"))).json(&json!({ "client_id": "k1", "content": "summarise" })).send().await.unwrap();
    assert_eq!(again.json::<Value>().await.unwrap()["turn_id"], turn.as_str());
    let tasks: Value = dev(c.get(format!("{base}/remote-api/tasks"))).send().await.unwrap().json().await.unwrap();
    assert_eq!(tasks["tasks"][0]["chat_id"], "a");
    // The answer comes in pieces.
    r.hub.event("a", &json!({ "type": "delta", "turn_id": turn, "text": "Sum" }));
    r.hub.event("a", &json!({ "type": "approval", "approval_id": "ap", "turn_id": turn, "tool": "shell_execute", "category": "terminal" }));
    let s: Value = dev(c.get(format!("{base}/remote-api/chats/a/stream?after=0"))).send().await.unwrap().json().await.unwrap();
    assert_eq!(s["events"][0]["text"], "Sum");
    assert_eq!(s["events"][1]["type"], "approval");
    assert_eq!(s["busy"], true);
    // This device has no terminal: once is refused, deny goes through.
    let once = dev(c.post(format!("{base}/remote-api/approvals/ap"))).json(&json!({ "decision": "once" })).send().await.unwrap();
    assert_eq!(once.status(), StatusCode::FORBIDDEN);
    let deny = dev(c.post(format!("{base}/remote-api/approvals/ap"))).json(&json!({ "decision": "deny" })).send().await.unwrap();
    assert_eq!(deny.status(), StatusCode::OK);
    let stop = dev(c.post(format!("{base}/remote-api/chats/a/stop"))).send().await.unwrap();
    assert_eq!(stop.status(), StatusCode::ACCEPTED);
    assert_eq!(r.host.actions("stop")[0]["chat_id"], "a");
    r.hub.event("a", &json!({ "type": "stopped", "turn_id": turn }));
    r.hub.event("a", &json!({ "type": "message", "message": { "id": "m2", "role": "assistant", "content": "Sum", "from": "desktop" } }));
    let list: Value = dev(c.get(format!("{base}/remote-api/chats"))).send().await.unwrap().json().await.unwrap();
    let a = list["chats"].as_array().unwrap().iter().find(|x| x["id"] == "a").unwrap().clone();
    assert_eq!((a["busy"].as_bool(), a["unread"].as_u64()), (Some(false), Some(1)));
    assert_eq!(dev(c.post(format!("{base}/remote-api/chats/a/read"))).send().await.unwrap().status(), StatusCode::OK);
    let list: Value = dev(c.get(format!("{base}/remote-api/chats"))).send().await.unwrap().json().await.unwrap();
    assert_eq!(list["chats"].as_array().unwrap().iter().find(|x| x["id"] == "a").unwrap()["unread"], 0);
    let gone = dev(c.get(format!("{base}/remote-api/chats/a/stream?after=999"))).send().await.unwrap();
    assert_eq!(gone.status(), StatusCode::GONE);
    assert_eq!(dev(c.get(format!("{base}/remote-api/chats/nope"))).send().await.unwrap().status(), StatusCode::NOT_FOUND);
    answering.abort();
    task.abort();
}

#[test]
fn documents_are_uploads_for_chats_and_never_inputs_of_a_job() {
    let create = CreateHub::default();
    let dir = tempfile::tempdir().unwrap();
    struct Host(PathBuf);
    impl crate::commands::remote_create::CreateHost for Host {
        fn emit(&self, _payload: Value) {}
        fn abort_engine(&self, _kind: crate::commands::remote_create::Kind) {}
        fn engine_busy(&self, _kind: crate::commands::remote_create::Kind) -> crate::commands::remote_create::BoxFuture<Option<bool>> {
            Box::pin(async { None })
        }
        fn engine_progress(&self, _kind: crate::commands::remote_create::Kind) -> Option<(u32, u32)> {
            None
        }
        fn result_roots(&self) -> Vec<PathBuf> {
            Vec::new()
        }
        fn comfy_output_dir(&self) -> Option<PathBuf> {
            None
        }
        fn uploads_dir(&self) -> PathBuf {
            self.0.clone()
        }
        fn stage_input(&self, path: &std::path::Path) -> Result<Value, String> {
            Ok(json!({ "input_path": path.to_string_lossy() }))
        }
        fn discard_upload(&self, _path: &std::path::Path) {}
    }
    use std::path::PathBuf;
    create.set_host(Arc::new(Host(dir.path().to_path_buf())));
    let pdf = create.add_file_as("d", None, b"%PDF-1.7\n...", None, Some("report.pdf")).unwrap();
    assert_eq!(pdf["mime"], "application/pdf");
    let txt = create.add_file_as("d", None, "Grüße".as_bytes(), Some("text/plain"), None).unwrap();
    assert_eq!(txt["mime"], "text/plain");
    assert!(create.add_file_as("d", None, &[0u8, 1, 2, 0xff], Some("text/plain"), None).is_err(), "binary is refused");
    let (bytes, mime, name) = create.upload_bytes("d", pdf["id"].as_str().unwrap()).unwrap();
    assert_eq!((bytes.len(), mime.as_str(), name.as_str()), (12, "application/pdf", "report.pdf"));
    assert!(create.upload_bytes("other", pdf["id"].as_str().unwrap()).is_none());
    let mut spec = crate::commands::remote_create::JobSpec::text(crate::commands::remote_create::Kind::ImageToImage, "x");
    spec.input_ids = vec![pdf["id"].as_str().unwrap().to_string()];
    assert!(create.submit_as("d", None, None, spec, 1).is_err());
}

#[test]
fn a_device_that_loses_rights_or_is_unpaired_narrows_or_stops_its_turns() {
    let r = rig();
    r.hub.sync(&[chat("a", "A"), chat("b", "B")]);
    let (ta, _) = r.hub.send("dev-a", "a", body("x", "c1"), vec![], all(), 1).unwrap();
    r.hub.send("dev-b", "b", body("y", "c2"), vec![], all(), 1).unwrap();
    assert_eq!(r.host.actions("send")[0]["device_id"], "dev-a");
    let kept = DeviceRights { chat: true, agent: true, files: false, terminal: true, create: false };
    r.hub.device_changed("dev-a", Some(kept));
    let revoke = r.host.actions("revoke");
    assert_eq!(revoke.len(), 1, "only the turn of that device");
    assert_eq!(revoke[0]["chat_id"], "a");
    assert_eq!(revoke[0]["turn_id"], ta["turn_id"]);
    assert_eq!(revoke[0]["rights"], json!({ "agent": true, "files": false, "terminal": true, "create": false }));
    // Without chat, or unpaired: stop.
    r.hub.device_changed("dev-a", Some(DeviceRights { chat: false, ..kept }));
    r.hub.device_changed("dev-a", None);
    let revoke = r.host.actions("revoke");
    assert!(revoke[1]["rights"].is_null() && revoke[2]["rights"].is_null());
    // A finished turn is not touched.
    r.hub.event("a", &json!({ "type": "done", "turn_id": ta["turn_id"] }));
    r.hub.device_changed("dev-a", None);
    assert_eq!(r.host.actions("revoke").len(), 3);
}

#[test]
fn an_approval_that_timed_out_says_why() {
    let r = rig();
    r.hub.sync(&[chat("a", "A")]);
    r.hub.event("a", &json!({ "type": "approval", "approval_id": "ap", "tool": "shell_execute", "category": "terminal" }));
    r.hub.event("a", &json!({ "type": "approval_resolved", "approval_id": "ap", "decision": "deny", "by": "desktop", "reason": "No decision within 15 minutes, the step was skipped." }));
    let book = lock(&r.hub.book);
    let last = book.chats["a"].events.back().unwrap().clone();
    assert_eq!(last["reason"], "No decision within 15 minutes, the step was skipped.");
    assert_eq!(last["decision"], "deny");
}

#[test]
fn a_device_holds_at_most_four_open_streams() {
    let r = rig();
    let slots: Vec<_> = (0..MAX_POLLS_PER_DEVICE).map(|_| r.hub.poll_slot("dev").ok().unwrap()).collect();
    assert!(matches!(r.hub.poll_slot("dev"), Err(ChatsError::TooMany)));
    assert!(r.hub.poll_slot("other").is_ok(), "per device");
    drop(slots);
    assert!(r.hub.poll_slot("dev").is_ok());
    assert!(lock(&r.hub.polls).is_empty(), "nothing left counted");
}

#[tokio::test]
async fn the_fifth_open_stream_of_a_device_is_429() {
    let r = rig();
    r.hub.sync(&[chat("a", "A")]);
    let (base, task) = serve(router(&r)).await;
    let c = reqwest::Client::builder().no_proxy().build().unwrap();
    let open: Vec<_> = (0..MAX_POLLS_PER_DEVICE).map(|_| r.hub.poll_slot("d").ok().unwrap()).collect();
    let refused = c.get(format!("{base}/remote-api/chats/a/stream?after=0")).header("x-test-device", "d").header("x-test-rights", "chat").send().await.unwrap();
    assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);
    drop(open);
    task.abort();
}

#[tokio::test]
async fn writing_into_an_agent_or_code_chat_needs_the_right_agent() {
    let r = rig();
    r.hub.sync(&[
        json!({ "id": "plain", "title": "P", "mode": "chat" }),
        json!({ "id": "ag", "title": "A", "mode": "agent" }),
        json!({ "id": "co", "title": "C", "mode": "code" }),
    ]);
    let (base, task) = serve(router(&r)).await;
    let c = reqwest::Client::builder().no_proxy().build().unwrap();
    let send = |chat: &str, rights: &str, k: &str| {
        c.post(format!("{base}/remote-api/chats/{chat}/messages")).header("x-test-device", "d").header("x-test-rights", rights.to_string())
            .json(&json!({ "client_id": k, "content": "hi" })).send()
    };
    for chat in ["ag", "co"] {
        let r = send(chat, "chat", &format!("k-{chat}")).await.unwrap();
        assert_eq!(r.status(), StatusCode::FORBIDDEN, "{chat}");
        assert_eq!(r.json::<Value>().await.unwrap()["right"], "agent");
    }
    assert_eq!(send("plain", "chat", "k1").await.unwrap().status(), StatusCode::ACCEPTED);
    assert_eq!(send("ag", "chat,agent", "k2").await.unwrap().status(), StatusCode::ACCEPTED);
    task.abort();
}

#[test]
fn a_phone_run_is_answered_by_that_phone_or_the_desktop_a_desktop_run_by_any() {
    let r = rig();
    r.hub.sync(&[chat("a", "A"), chat("b", "B")]);
    let (turn, _) = r.hub.send("dev-a", "a", body("x", "c1"), vec![], all(), 1).unwrap();
    r.hub.event("a", &json!({ "type": "approval", "approval_id": "ap", "turn_id": turn["turn_id"], "tool": "web_search", "category": "web" }));
    assert_eq!(r.hub.decide("dev-b", "ap", "once", &|_: &str| true), Err(ChatsError::NotYours));
    assert!(r.hub.decide("dev-a", "ap", "once", &|_: &str| true).is_ok());
    // A run typed at the desktop: any paired device with the right.
    r.hub.event("b", &json!({ "type": "approval", "approval_id": "ap2", "turn_id": "desk_1", "tool": "web_search", "category": "web" }));
    assert!(r.hub.decide("dev-b", "ap2", "once", &|_: &str| true).is_ok());
}
