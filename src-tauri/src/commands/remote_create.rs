//! Create over the desktop (V1): a paired phone asks this computer to make
//! images and videos with its own local engines (MLX on a Mac, ComfyUI on
//! Windows and Linux).
//!
//! The generation itself lives in the window (`executeImageGenerate`,
//! `executeVideoGenerate`, `src/lib/remote-create-runner.ts`), so this file is
//! the bookkeeping around it:
//!
//! * a job table with one job running at a time and a bounded queue behind it,
//! * the event `remote-create-job` that hands a job (or a cancel) to the window,
//! * the commands the window answers with (progress, finish, capabilities),
//! * the HTTP routes under `/remote-api/create/` behind the remote sign in and
//!   behind the permission `create`.
//!
//! What a phone may name is an id, never a path. Results are only files the
//! window reported for that job, and only after they were found inside one of
//! the output folders (`contain_within`, the same rule as
//! `resolve_remote_path`). A phone sees only its own jobs, uploads and results.
//!
//! Progress does not depend on a timer in the window: a WebView in the
//! background is throttled. A job is kept alive by what the window reports
//! and, when that stops, by asking the engine itself (`CreateHost::engine_busy`).
//! A job without either for too long is failed.

use std::collections::HashMap;
use std::future::Future;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use axum::{
    body::{Body, Bytes},
    extract::{rejection::JsonRejection, Path as AxPath, Query, State as AxumState},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::Mutex as TokioMutex;

use super::remote::{CallerDevice, RemotePermissions};
use super::remote_sealed::SealedCaller;

// ─── Limits ───

/// Event name the window listens on.
pub const EVENT: &str = "remote-create-job";
/// Largest input image a phone may upload.
pub const MAX_UPLOAD_BYTES: usize = 20 * 1024 * 1024;
/// Largest upload inside the sealed channel: one inner message with room
/// for its head (PROTOKOLL 8).
pub const MAX_SEALED_UPLOAD_BYTES: usize = crate::remote_seal::MAX_MESSAGE - 64 * 1024;
/// Largest piece of a result per request.
pub const MAX_CHUNK_BYTES: u64 = 4 * 1024 * 1024;
/// Images per job.
pub const MAX_COUNT: u32 = 4;
/// Clips per job. A clip takes minutes to tens of minutes on a desktop.
pub const MAX_VIDEO_COUNT: u32 = 1;
/// Jobs waiting behind the running one.
pub const MAX_WAITING: usize = 4;
/// Waiting jobs one device may have, so one phone cannot fill the queue.
pub const MAX_WAITING_PER_OWNER: usize = 2;
/// One device asks the window for its capabilities at most this often;
/// in between it gets the last answer.
const CAPS_ASK_EVERY_SECS: u64 = 10;
/// Questions to the window at the same time, over all devices.
const MAX_CAPS_WAITERS: usize = 4;
/// Finished jobs kept in the table (their files stay on disk).
const MAX_KEPT_FINISHED: usize = 24;
/// Uploads remembered at once.
const MAX_UPLOADS: usize = 32;
/// Uploads one device may keep, in number and in bytes, and all together.
const MAX_UPLOADS_PER_OWNER: usize = 8;
const MAX_UPLOAD_BYTES_PER_OWNER: u64 = 64 * 1024 * 1024;
const MAX_UPLOAD_BYTES_TOTAL: u64 = 256 * 1024 * 1024;
/// Largest side of an uploaded image, read from its header before it is kept.
pub const MAX_UPLOAD_SIDE: u32 = 4096;
/// The window has this long to take up a job it was handed.
const ACK_SECS: u64 = 30;
/// A running job without any sign of life for this long is failed.
const BEAT_SECS: u64 = 180;
/// How long a capabilities request waits for the window.
const CAPS_WAIT: Duration = Duration::from_secs(4);
const MAX_PROMPT_CHARS: usize = 4000;
const MAX_NEGATIVE_CHARS: usize = 2000;
const MIN_SIDE: u32 = 256;
const MAX_SIDE: u32 = 2048;
const MAX_STEPS: u32 = 100;
const MAX_SEED: u64 = (1u64 << 53) - 1;
const MAX_MODELS: usize = 200;
const MAX_NAME_CHARS: usize = 200;
/// References of one edit (CREATE-V2.md `limits.max_edit_inputs`), whatever
/// the window says its models take.
pub const MAX_EDIT_INPUTS: usize = 5;
const MAX_LYRICS_CHARS: usize = 3000;
/// Track length when the window names no bounds of its own.
const MUSIC_MIN_SECS: u32 = 5;
const MUSIC_MAX_SECS: u32 = 300;
/// Largest side of an enhanced image (lib/local-upscale UPSCALE_MAX_SIDE).
const UPSCALE_MAX_SIDE: u64 = 8192;
const MAX_CHARACTERS: usize = 200;
/// A gallery list from the window is good for this long.
const GALLERY_FRESH_SECS: u64 = 10;
/// Entries of the desktop gallery one list takes.
const MAX_GALLERY_ITEMS: usize = 2000;
const MAX_GALLERY_PAGE: usize = 60;
/// Longest side of a gallery thumbnail.
const THUMB_SIDE: u32 = 320;
/// Thumbnails kept in memory.
const MAX_THUMBS: usize = 256;
/// Largest picture a thumbnail is made from.
const MAX_THUMB_SOURCE_BYTES: u64 = 64 * 1024 * 1024;

// ─── Kinds, tools, states ───

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Image,
    ImageToImage,
    Video,
    ImageToVideo,
    /// Stage 2 (CREATE-V2.md): one or more references, optional mask.
    Edit,
    Upscale,
    RemoveBg,
    Music,
}

impl Kind {
    pub const ALL: [Kind; 8] = [
        Kind::Image,
        Kind::ImageToImage,
        Kind::Video,
        Kind::ImageToVideo,
        Kind::Edit,
        Kind::Upscale,
        Kind::RemoveBg,
        Kind::Music,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Image => "image",
            Kind::ImageToImage => "image-to-image",
            Kind::Video => "video",
            Kind::ImageToVideo => "image-to-video",
            Kind::Edit => "edit",
            Kind::Upscale => "upscale",
            Kind::RemoveBg => "removebg",
            Kind::Music => "music",
        }
    }

    pub fn parse(s: &str) -> Option<Kind> {
        Kind::ALL.into_iter().find(|k| k.as_str() == s)
    }

    pub fn is_video(self) -> bool {
        matches!(self, Kind::Video | Kind::ImageToVideo)
    }

    pub fn needs_input(self) -> bool {
        matches!(self, Kind::ImageToImage | Kind::ImageToVideo | Kind::Edit | Kind::Upscale | Kind::RemoveBg)
    }

    /// Kinds that read a prompt at all.
    fn takes_prompt(self) -> bool {
        !matches!(self, Kind::Upscale | Kind::RemoveBg)
    }

    /// Kinds whose prompt may not be empty.
    fn needs_prompt(self) -> bool {
        matches!(self, Kind::Image | Kind::ImageToImage | Kind::Edit | Kind::Music)
    }

    /// Kinds that may carry a trained character (`character`).
    fn takes_character(self) -> bool {
        matches!(self, Kind::Image | Kind::Video)
    }

    /// Kinds with a size, steps and a negative prompt.
    fn takes_sampling(self) -> bool {
        matches!(self, Kind::Image | Kind::ImageToImage | Kind::Video | Kind::ImageToVideo | Kind::Edit)
    }

    fn max_count(self) -> u32 {
        match self {
            Kind::Image | Kind::ImageToImage => MAX_COUNT,
            _ => 1,
        }
    }

    /// The word `status/full` names for this kind, when it is not one of
    /// stage 1's (PROTOKOLL 11, CREATE-V2.md).
    fn feature(self) -> Option<&'static str> {
        match self {
            Kind::Edit => Some("create-edit"),
            Kind::Upscale => Some("create-upscale"),
            Kind::RemoveBg => Some("create-removebg"),
            Kind::Music => Some("create-music"),
            _ => None,
        }
    }

    /// What the phone reads when the kind cannot run and the window gave no
    /// sentence of its own.
    fn default_reason(self) -> &'static str {
        match self {
            Kind::Image | Kind::ImageToImage => "No image model is installed on your computer. Install one in Create on your computer.",
            Kind::Video | Kind::ImageToVideo => "No video model for this is installed on your computer. Install one in Create on your computer.",
            Kind::Edit => "No model that edits images is installed on your computer. Install one in Create on your computer.",
            Kind::Upscale => "No model that enhances images is installed on your computer. Install one in Create on your computer.",
            Kind::RemoveBg => "Remove Background is not set up on your computer. Set it up in Create on your computer.",
            Kind::Music => "No music model is installed on your computer. Install one in Create on your computer.",
        }
    }
}

/// The engine this desktop makes media with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tool {
    Mlx,
    Comfyui,
}

impl Tool {
    pub fn this_machine() -> Tool {
        if cfg!(target_os = "macos") { Tool::Mlx } else { Tool::Comfyui }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Tool::Mlx => "mlx",
            Tool::Comfyui => "comfyui",
        }
    }

    /// What this engine can be asked for from the phone. Whether a kind runs
    /// today is the window's word (`available` in its capabilities): image to
    /// image on a Mac, for one, goes through an edit pack and needs one.
    pub fn kinds(self) -> &'static [Kind] {
        &Kind::ALL
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobState {
    Queued,
    Running,
    Done,
    Failed,
    Cancelled,
}

impl JobState {
    fn as_str(self) -> &'static str {
        match self {
            JobState::Queued => "queued",
            JobState::Running => "running",
            JobState::Done => "done",
            JobState::Failed => "failed",
            JobState::Cancelled => "cancelled",
        }
    }

    fn terminal(self) -> bool {
        matches!(self, JobState::Done | JobState::Failed | JobState::Cancelled)
    }
}

// ─── Records ───

#[derive(Clone, Debug)]
pub struct ResultFile {
    pub id: String,
    pub path: PathBuf,
    pub mime: String,
    pub bytes: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Audio only, where the header tells it.
    pub duration_ms: Option<u64>,
    pub sha256: String,
    /// Which file it was when it was reported; a read serves only that one.
    pub(crate) ident: FileIdent,
}

/// What makes a file the same file: size and change time, on Unix also the
/// device and inode.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FileIdent {
    len: u64,
    modified: Option<std::time::SystemTime>,
    #[cfg(unix)]
    dev: u64,
    #[cfg(unix)]
    ino: u64,
}

impl FileIdent {
    fn of(meta: &std::fs::Metadata) -> Self {
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        FileIdent {
            len: meta.len(),
            modified: meta.modified().ok(),
            #[cfg(unix)]
            dev: meta.dev(),
            #[cfg(unix)]
            ino: meta.ino(),
        }
    }
}

/// Opens a file for reading, never through a link in its last part: the
/// path must be a plain file before opening, and on Unix the opened file must
/// be that same inode (a link swapped in between opens something else).
fn open_no_follow(path: &Path) -> std::io::Result<std::fs::File> {
    let refused = || std::io::Error::new(std::io::ErrorKind::InvalidInput, "not a plain file");
    let before = std::fs::symlink_metadata(path)?;
    if !before.file_type().is_file() {
        return Err(refused());
    }
    let file = std::fs::File::open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let after = file.metadata()?;
        if (after.dev(), after.ino()) != (before.dev(), before.ino()) {
            return Err(refused());
        }
    }
    Ok(file)
}

impl ResultFile {
    fn view(&self) -> Value {
        if self.mime.starts_with("audio/") {
            return json!({
                "id": self.id,
                "mime": self.mime,
                "bytes": self.bytes,
                "duration_ms": self.duration_ms,
                "sha256": self.sha256,
            });
        }
        json!({
            "id": self.id,
            "mime": self.mime,
            "bytes": self.bytes,
            "width": self.width,
            "height": self.height,
            "sha256": self.sha256,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct JobSpec {
    pub kind: Kind,
    pub prompt: String,
    pub negative: String,
    pub model: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub steps: Option<u32>,
    pub seed: Option<u64>,
    pub count: u32,
    /// Uploads, in order: the source, then the further references of an edit.
    pub input_ids: Vec<String>,
    /// Edit only: white where the first reference may change.
    pub mask_id: Option<String>,
    /// A trained character's id from `characters`.
    pub character: Option<String>,
    /// Upscale only: 2 or 4.
    pub factor: Option<u32>,
    /// Music only, line breaks kept.
    pub lyrics: Option<String>,
    /// Music only, seconds.
    pub duration: Option<u32>,
}

impl JobSpec {
    /// A text to image job with nothing else set: the shape the remote agent
    /// tool starts from.
    pub fn text(kind: Kind, prompt: &str) -> JobSpec {
        JobSpec {
            kind,
            prompt: clean_text(prompt, MAX_PROMPT_CHARS),
            negative: String::new(),
            model: None,
            width: None,
            height: None,
            steps: None,
            seed: None,
            count: 1,
            input_ids: Vec::new(),
            mask_id: None,
            character: None,
            factor: None,
            lyrics: None,
            duration: None,
        }
    }

    /// Every upload the job reads.
    fn uploads(&self) -> impl Iterator<Item = &String> {
        self.input_ids.iter().chain(self.mask_id.iter())
    }
}

#[derive(Clone, Debug)]
struct Job {
    id: String,
    owner: String,
    client_request_id: Option<String>,
    spec: JobSpec,
    /// The files of `spec.input_ids`, same order, with their size.
    inputs: Vec<(PathBuf, u32, u32)>,
    mask_path: Option<PathBuf>,
    state: JobState,
    progress: f64,
    step_text: String,
    error: Option<String>,
    results: Vec<ResultFile>,
    created_at: u64,
    started_at: Option<u64>,
    finished_at: Option<u64>,
    last_beat: u64,
    acked: bool,
    index: u32,
}

impl Job {
    fn reads(&self, path: &Path) -> bool {
        self.inputs.iter().any(|(p, _, _)| p == path) || self.mask_path.as_deref() == Some(path)
    }
}

#[derive(Clone, Debug)]
struct Upload {
    id: String,
    owner: String,
    path: PathBuf,
    mime: &'static str,
    bytes: u64,
    /// 0 for a document.
    width: u32,
    height: u32,
    /// The name the phone gave a document (`x-lu-filename`), for the chat.
    name: Option<String>,
}

impl Upload {
    fn view(&self) -> Value {
        if !self.mime.starts_with("image/") {
            return json!({ "id": self.id, "mime": self.mime, "bytes": self.bytes, "name": self.name });
        }
        json!({ "id": self.id, "mime": self.mime, "bytes": self.bytes, "width": self.width, "height": self.height })
    }
}

/// A document a chat takes as an attachment (CHATS-V1.md): PDF by its first
/// bytes; text only when the phone declares `text/plain` or `text/markdown`
/// and it is UTF-8 without NUL. Anything else stays refused, as before.
fn document_kind(bytes: &[u8], declared: Option<&str>) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"%PDF-") {
        return Some(("pdf", "application/pdf"));
    }
    let declared = declared.and_then(|d| d.split(';').next()).map(|t| t.trim().to_ascii_lowercase())?;
    if bytes.contains(&0) || std::str::from_utf8(bytes).is_err() {
        return None;
    }
    match declared.as_str() {
        "text/markdown" => Some(("md", "text/markdown")),
        "text/plain" => Some(("txt", "text/plain")),
        _ => None,
    }
}

/// A file name from the phone as a label: no folders, no control characters.
fn clean_file_name(raw: &str) -> Option<String> {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("");
    // No direction or format marks: "invoice\u{202E}fdp.exe" would read as
    // "invoiceexe.pdf" in the desktop's chat.
    let plain: String = base.chars().filter(|c| !is_bidi_or_format(*c)).collect();
    Some(clean_text(plain.trim(), 120)).filter(|n| !n.is_empty() && n != "." && n != "..")
}

/// A message for the log with every path cut to its last part: an error from
/// the file system can name folders of this computer.
fn without_paths(msg: &str) -> String {
    msg.split(' ')
        .map(|w| {
            if w.contains('/') || w.contains('\\') {
                let trail: String = w.chars().rev().take_while(|c| matches!(c, ':' | ',' | ')' | '\'' | '"' | '.')).collect::<Vec<_>>().into_iter().rev().collect();
                let core = &w[..w.len() - trail.len()];
                let last = core.rsplit(['/', '\\']).find(|p| !p.is_empty()).unwrap_or("");
                format!("…{}{last}{trail}", std::path::MAIN_SEPARATOR)
            } else {
                w.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Direction overrides and isolates, the direction marks, zero width and
/// other invisible format characters.
fn is_bidi_or_format(c: char) -> bool {
    matches!(c,
        '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{061C}' | '\u{FEFF}' | '\u{00AD}')
}

#[derive(Default)]
struct Book {
    jobs: Vec<Job>,
    uploads: Vec<Upload>,
    caps: Option<Value>,
    /// When `caps` came in.
    caps_at: u64,
    gallery: Option<GalleryList>,
}

/// One entry of the desktop gallery as a phone sees it. `file.id` is the
/// gallery id (`gal_...`), stable for the same entry and file.
#[derive(Clone, Debug)]
struct GalleryEntry {
    file: ResultFile,
    media: &'static str,
    created_at: u64,
    prompt: String,
    model: String,
    from_phone: bool,
}

impl GalleryEntry {
    fn view(&self) -> Value {
        let audio = self.media == "audio";
        let mut v = json!({
            "id": self.file.id,
            "media": self.media,
            "mime": self.file.mime,
            "bytes": self.file.bytes,
            "width": if audio { None } else { self.file.width },
            "height": if audio { None } else { self.file.height },
            "duration_ms": self.file.duration_ms,
            "created_at": self.created_at,
            "prompt": self.prompt,
            "model": self.model,
            "from_phone": self.from_phone,
        });
        if !self.file.sha256.is_empty() {
            v["sha256"] = json!(self.file.sha256);
        }
        v
    }
}

#[derive(Clone, Debug, Default)]
struct GalleryList {
    at: u64,
    entries: Vec<GalleryEntry>,
}

// ─── The desktop side, behind a trait so the tests can stand in for it ───

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

pub trait CreateHost: Send + Sync {
    /// Send `remote-create-job` to the window.
    fn emit(&self, payload: Value);
    /// End a running generation in the engine itself, where that is possible
    /// from here. The window gets a cancel event as well.
    fn abort_engine(&self, kind: Kind);
    /// Is the engine working right now. `None`: cannot tell.
    fn engine_busy(&self, kind: Kind) -> BoxFuture<Option<bool>>;
    /// Step and step count the engine reports, when it reports them.
    fn engine_progress(&self, kind: Kind) -> Option<(u32, u32)>;
    /// The folders a result may come from.
    fn result_roots(&self) -> Vec<PathBuf>;
    /// ComfyUI's output folder, when ComfyUI is known.
    fn comfy_output_dir(&self) -> Option<PathBuf>;
    /// Where uploads from the phone are kept.
    fn uploads_dir(&self) -> PathBuf;
    /// Make an upload readable for the engine; the answer goes to the window.
    fn stage_input(&self, path: &Path) -> Result<Value, String>;
    /// An upload nobody needs any more: remove the stored copy and what
    /// `stage_input` made of it. Only our own temporary files.
    fn discard_upload(&self, path: &Path);
    /// The first frame of a clip as a JPEG of at most `side` a side, where
    /// this computer can read one (commands/video_thumb.rs).
    fn video_frame(&self, _path: &Path, _side: u32) -> Option<Vec<u8>> {
        None
    }
}

/// Removes an upload file, only when it sits right in `dir`.
fn remove_own_upload(dir: &Path, path: &Path) {
    let inside = path.parent().is_some_and(|p| p == dir)
        && path.file_name().and_then(|n| n.to_str()).is_some_and(|n| !n.starts_with('.'));
    if inside {
        if let Err(e) = std::fs::remove_file(path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(error = %without_paths(&crate::os_error::english(&e)), "remote upload not removed");
            }
        }
    }
}

/// Before the server started: nothing to tell, nowhere to read from.
struct NullHost;

impl CreateHost for NullHost {
    fn emit(&self, _payload: Value) {}
    fn abort_engine(&self, _kind: Kind) {}
    fn engine_busy(&self, _kind: Kind) -> BoxFuture<Option<bool>> {
        Box::pin(async { None })
    }
    fn engine_progress(&self, _kind: Kind) -> Option<(u32, u32)> {
        None
    }
    fn result_roots(&self) -> Vec<PathBuf> {
        Vec::new()
    }
    fn comfy_output_dir(&self) -> Option<PathBuf> {
        None
    }
    fn uploads_dir(&self) -> PathBuf {
        default_uploads_dir()
    }
    fn stage_input(&self, path: &Path) -> Result<Value, String> {
        Ok(json!({ "input_path": path.to_string_lossy() }))
    }
    fn discard_upload(&self, path: &Path) {
        remove_own_upload(&default_uploads_dir(), path);
    }
}

fn default_uploads_dir() -> PathBuf {
    crate::os_paths::config_root().join("remote-create").join("uploads")
}

// ─── Errors ───

#[derive(Debug, PartialEq)]
pub enum CreateError {
    Bad(String),
    Busy(String),
    NotFound,
    TooLarge,
    /// The global switch `create` is off.
    Off,
    /// The device was unpaired or lost a right since its request came in.
    Gone,
    /// A kind this desktop does not know (`400 unsupported_kind`).
    UnsupportedKind,
    /// A kind the engine cannot run today (`409 unavailable`), with the
    /// sentence for the phone.
    Unavailable(String),
}

impl CreateError {
    fn into_response(self) -> Response {
        match self {
            CreateError::Bad(m) => error_response(StatusCode::BAD_REQUEST, &m),
            CreateError::Busy(m) => error_response(StatusCode::TOO_MANY_REQUESTS, &m),
            CreateError::NotFound => error_response(StatusCode::NOT_FOUND, "No such job, upload or result on this computer."),
            CreateError::TooLarge => error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                &format!("The image is larger than {} MB.", MAX_UPLOAD_BYTES / (1024 * 1024)),
            ),
            CreateError::Off => forbidden_response(),
            CreateError::Gone => (StatusCode::FORBIDDEN, Json(json!({ "error": "forbidden", "right": "create" }))).into_response(),
            CreateError::UnsupportedKind => (StatusCode::BAD_REQUEST, Json(json!({ "error": "unsupported_kind" }))).into_response(),
            CreateError::Unavailable(reason) => (StatusCode::CONFLICT, Json(json!({ "error": "unavailable", "reason": reason }))).into_response(),
        }
    }
}

fn error_response(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "error": msg }))).into_response()
}

/// Permission `create` is off.
pub(crate) fn forbidden_response() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({
            "error": "Create is off for remote devices on this computer. Turn it on in the LU desktop app under Settings, Voice & Remote, Remote Access, Permissions.",
            "permission": "create",
            "needs_permission": true,
        })),
    )
        .into_response()
}

// ─── The hub ───

enum Effect {
    Emit(Value),
    Abort(Kind),
}

/// Is a device, let in under this generation, still allowed to create?
pub type OwnerCheck = Arc<dyn Fn(&str, u64) -> bool + Send + Sync>;

pub struct CreateHub {
    book: Mutex<Book>,
    host: RwLock<Arc<dyn CreateHost>>,
    tool: Tool,
    caps_wait: Duration,
    waiters: Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>,
    /// When each device last made the window answer.
    caps_asked: Mutex<HashMap<String, u64>>,
    /// Asked under the book lock before anything of a sealed device is
    /// entered, so nothing lands after its unpairing.
    owner_check: RwLock<Option<OwnerCheck>>,
    /// Mirrors the global switch `create`; off ends every job.
    enabled: AtomicBool,
    /// Gallery thumbnails made so far, newest last: (gallery id, JPEG).
    thumbs: Mutex<Vec<(String, Vec<u8>)>>,
    /// At most [`THUMB_SLOTS`] previews are made at once (decoding, ffmpeg).
    thumb_slots: Arc<tokio::sync::Semaphore>,
    /// One maker per preview key: a second ask for the same key waits for the
    /// first and takes its result.
    thumb_flight: Mutex<HashMap<String, Arc<TokioMutex<()>>>>,
    /// One gallery question to the window at a time.
    gallery_asking: TokioMutex<()>,
}

impl Default for CreateHub {
    fn default() -> Self {
        CreateHub::new(Tool::this_machine())
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn new_id(prefix: &str) -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("{prefix}_{hex}")
}

/// One line of text: control characters (newlines included) become spaces,
/// the ends are trimmed, the length is capped in characters.
fn clean_text(raw: &str, max: usize) -> String {
    let flat: String = raw.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    flat.trim().chars().take(max).collect()
}

/// Text over several lines (lyrics): line breaks kept, every other control
/// character a space, lines trimmed at their end, the length capped.
fn clean_lines(raw: &str, max: usize) -> String {
    let unified = raw.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<String> = unified
        .split('\n')
        .map(|l| l.chars().map(|c| if c.is_control() { ' ' } else { c }).collect::<String>().trim_end().to_string())
        .collect();
    lines.join("\n").trim().chars().take(max).collect()
}

/// Ids the phone sends back are ours: a prefix, an underscore, 32 hex digits.
fn is_our_id(id: &str, prefix: &str) -> bool {
    id.strip_prefix(prefix)
        .and_then(|r| r.strip_prefix('_'))
        .map(|hex| hex.len() == 32 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
        .unwrap_or(false)
}

impl CreateHub {
    pub fn new(tool: Tool) -> Self {
        CreateHub {
            book: Mutex::new(Book::default()),
            host: RwLock::new(Arc::new(NullHost)),
            tool,
            caps_wait: CAPS_WAIT,
            waiters: Mutex::new(HashMap::new()),
            caps_asked: Mutex::new(HashMap::new()),
            thumbs: Mutex::new(Vec::new()),
            thumb_slots: Arc::new(tokio::sync::Semaphore::new(THUMB_SLOTS)),
            thumb_flight: Mutex::new(HashMap::new()),
            gallery_asking: TokioMutex::new(()),
            owner_check: RwLock::new(None),
            enabled: AtomicBool::new(true),
        }
    }

    pub fn set_owner_check(&self, check: OwnerCheck) {
        *self.owner_check.write().unwrap_or_else(|e| e.into_inner()) = Some(check);
    }

    /// The global switch `create` changed. Off ends every open job.
    pub fn set_enabled(&self, on: bool, now: u64) {
        let was = self.enabled.swap(on, Ordering::SeqCst);
        if was && !on {
            self.cancel_all(None, now);
        }
    }

    /// May this owner enter something now? Called with the book held.
    fn admit(&self, owner: &str, generation: Option<u64>) -> Result<(), CreateError> {
        if !self.enabled.load(Ordering::SeqCst) {
            return Err(CreateError::Off);
        }
        self.admit_owner(owner, generation)
    }

    fn admit_for(&self, owner: &str, generation: Option<u64>, needs_create: bool) -> Result<(), CreateError> {
        if needs_create { self.admit(owner, generation) } else { self.admit_owner(owner, generation) }
    }

    /// The device is still paired with the rights it had when it asked.
    fn admit_owner(&self, owner: &str, generation: Option<u64>) -> Result<(), CreateError> {
        if let Some(g) = generation {
            let check = self.owner_check.read().unwrap_or_else(|e| e.into_inner()).clone();
            if check.is_some_and(|c| !c(owner, g)) {
                return Err(CreateError::Gone);
            }
        }
        Ok(())
    }

    pub fn set_host(&self, host: Arc<dyn CreateHost>) {
        *self.host.write().unwrap_or_else(|e| e.into_inner()) = host;
    }

    fn host(&self) -> Arc<dyn CreateHost> {
        self.host.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn run_effects(&self, effects: Vec<Effect>) {
        if effects.is_empty() {
            return;
        }
        let host = self.host();
        for effect in effects {
            match effect {
                Effect::Emit(v) => host.emit(v),
                Effect::Abort(kind) => host.abort_engine(kind),
            }
        }
    }

    // ── job views ──

    fn position(book: &Book, job: &Job) -> usize {
        if job.state != JobState::Queued {
            return 0;
        }
        book.jobs
            .iter()
            .filter(|j| j.state == JobState::Queued && j.created_at <= job.created_at)
            .take_while(|j| j.id != job.id)
            .count()
            + 1
    }

    fn job_view(&self, book: &Book, job: &Job) -> Value {
        let mut progress = job.progress;
        if job.state == JobState::Running {
            if let Some((step, steps)) = self.host().engine_progress(job.spec.kind) {
                if steps > 0 {
                    let count = job.spec.count.max(1) as f64;
                    let native = (job.index as f64 + (step.min(steps) as f64 / steps as f64)) / count;
                    progress = progress.max(native);
                }
            }
            progress = progress.clamp(0.0, 0.99);
        } else if job.state == JobState::Done {
            progress = 1.0;
        }
        json!({
            "id": job.id,
            "kind": job.spec.kind.as_str(),
            "state": job.state.as_str(),
            "progress": (progress * 1000.0).round() / 1000.0,
            "step_text": job.step_text,
            "position": Self::position(book, job),
            "count": job.spec.count,
            "error": job.error,
            "results": job.results.iter().map(ResultFile::view).collect::<Vec<_>>(),
            "client_request_id": job.client_request_id,
            "created_at": job.created_at,
            "started_at": job.started_at,
            "finished_at": job.finished_at,
        })
    }

    /// What the desktop bar shows: the running job and how many wait.
    fn state_payload(&self, book: &Book) -> Value {
        let running = book.jobs.iter().find(|j| j.state == JobState::Running).map(|j| {
            let view = self.job_view(book, j);
            json!({
                "id": j.id,
                "kind": j.spec.kind.as_str(),
                "prompt": j.spec.prompt,
                "progress": view["progress"],
                "step_text": j.step_text,
                "count": j.spec.count,
            })
        });
        let queued = book.jobs.iter().filter(|j| j.state == JobState::Queued).count();
        json!({ "action": "state", "running": running, "queued": queued })
    }

    pub fn snapshot(&self) -> Value {
        let book = lock(&self.book);
        self.state_payload(&book)
    }

    pub fn busy(&self) -> (bool, usize) {
        let book = lock(&self.book);
        (
            book.jobs.iter().any(|j| j.state == JobState::Running),
            book.jobs.iter().filter(|j| j.state == JobState::Queued).count(),
        )
    }

    // ── queue ──

    /// Start the next waiting job when nothing runs. Called with the book held.
    fn advance(&self, book: &mut Book, now: u64, effects: &mut Vec<Effect>) {
        loop {
            if book.jobs.iter().any(|j| j.state == JobState::Running) {
                return;
            }
            let Some(idx) = book.jobs.iter().position(|j| j.state == JobState::Queued) else {
                return;
            };
            let staged = match self.stage_job(&book.jobs[idx]) {
                Ok(v) => v,
                Err(reason) => {
                    let job = &mut book.jobs[idx];
                    job.state = JobState::Failed;
                    job.error = Some(reason.to_string());
                    job.finished_at = Some(now);
                    continue;
                }
            };
            let job = &mut book.jobs[idx];
            job.state = JobState::Running;
            job.started_at = Some(now);
            job.last_beat = now;
            job.acked = false;
            job.step_text = "Starting".to_string();
            let mut dispatch = json!({
                "id": job.id,
                "kind": job.spec.kind.as_str(),
                "prompt": job.spec.prompt,
                "negative": job.spec.negative,
                "model": job.spec.model,
                "width": job.spec.width,
                "height": job.spec.height,
                "steps": job.spec.steps,
                "seed": job.spec.seed,
                "count": job.spec.count,
                "character": job.spec.character,
                "factor": job.spec.factor,
                "lyrics": job.spec.lyrics,
                "duration": job.spec.duration,
                "conversation_id": format!("remote-create:{}", job.id),
            });
            if let Some(obj) = dispatch.as_object_mut() {
                let (inputs, mask) = staged;
                // Stage 1's window reads the first input at the top level.
                if let Some(Value::Object(first)) = inputs.first() {
                    for (k, v) in first {
                        if k != "width" && k != "height" {
                            obj.insert(k.clone(), v.clone());
                        }
                    }
                }
                obj.insert("inputs".into(), Value::Array(inputs));
                obj.insert("mask".into(), mask.unwrap_or(Value::Null));
            }
            effects.push(Effect::Emit(json!({ "action": "run", "job": dispatch })));
            return;
        }
    }

    /// Make every upload a job reads ready for the engine: the inputs in
    /// order with their size, and the mask. Or the sentence for the phone.
    fn stage_job(&self, job: &Job) -> Result<(Vec<Value>, Option<Value>), &'static str> {
        let host = self.host();
        let stage = |p: &Path| -> Result<Value, &'static str> {
            if !std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_file()) {
                return Err("The input image is gone on the computer. Upload it again.");
            }
            host.stage_input(p).map_err(|e| {
                // The log names the file, never a folder of this computer.
                let file = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                tracing::warn!(error = %without_paths(&e), file = %file, "remote input image not staged");
                "The input image could not be prepared on the computer."
            })
        };
        let mut inputs = Vec::with_capacity(job.inputs.len());
        for (path, width, height) in &job.inputs {
            let mut v = stage(path)?;
            if let Some(o) = v.as_object_mut() {
                o.insert("width".into(), json!(width));
                o.insert("height".into(), json!(height));
            }
            inputs.push(v);
        }
        let mask = match &job.mask_path {
            Some(p) => Some(stage(p)?),
            None => None,
        };
        Ok((inputs, mask))
    }

    fn trim(book: &mut Book) {
        let finished = book.jobs.iter().filter(|j| j.state.terminal()).count();
        if finished <= MAX_KEPT_FINISHED {
            return;
        }
        let mut drop = finished - MAX_KEPT_FINISHED;
        book.jobs.retain(|j| {
            if drop > 0 && j.state.terminal() {
                drop -= 1;
                false
            } else {
                true
            }
        });
    }

    /// Check a job request and turn it into a spec. `caps` is what the
    /// window last reported (models, availability, characters), `None` when
    /// it never answered; then only the fixed limits apply.
    fn validate(&self, body: JobBody, caps: Option<&Value>) -> Result<JobSpec, CreateError> {
        let kind = Kind::parse(body.kind.trim()).ok_or(CreateError::UnsupportedKind)?;
        if !self.tool.kinds().contains(&kind) {
            return Err(CreateError::UnsupportedKind);
        }
        if let Some(c) = caps {
            let (available, reason) = availability(c, kind);
            if !available {
                return Err(CreateError::Unavailable(reason));
            }
        }
        let name = kind.as_str();
        let prompt = if kind.takes_prompt() {
            let p = clean_text(body.prompt.as_deref().unwrap_or(""), MAX_PROMPT_CHARS + 1);
            if p.chars().count() > MAX_PROMPT_CHARS {
                return Err(CreateError::Bad(format!("The prompt is longer than {MAX_PROMPT_CHARS} characters.")));
            }
            p
        } else {
            String::new()
        };
        if prompt.is_empty() && kind.needs_prompt() {
            return Err(CreateError::Bad(match kind {
                Kind::Image | Kind::ImageToImage => "An image needs a prompt.".to_string(),
                Kind::Music => "Music needs a prompt that describes the style.".to_string(),
                _ => format!("{name} needs a prompt."),
            }));
        }
        let negative = clean_text(body.negative.as_deref().unwrap_or(""), MAX_NEGATIVE_CHARS + 1);
        if negative.chars().count() > MAX_NEGATIVE_CHARS {
            return Err(CreateError::Bad(format!("The negative prompt is longer than {MAX_NEGATIVE_CHARS} characters.")));
        }
        let negative = if kind.takes_sampling() { negative } else { String::new() };
        let model = body.model.map(|m| clean_text(&m, MAX_NAME_CHARS)).filter(|m| !m.is_empty());
        if let (Some(m), Some(c)) = (&model, caps) {
            let models = models_of(c, kind);
            if !models.is_empty() && !models.iter().any(|(id, _)| id == m) {
                return Err(CreateError::Bad(format!("The model \"{m}\" is not installed on this computer for {name}.")));
            }
        }
        for (field, v) in [("width", body.width), ("height", body.height)] {
            if let Some(v) = v {
                if !kind.takes_sampling() {
                    return Err(CreateError::Bad(format!("{name} takes no {field}.")));
                }
                if !(MIN_SIDE..=MAX_SIDE).contains(&v) || v % 8 != 0 {
                    return Err(CreateError::Bad(format!("{field} must be a multiple of 8 between {MIN_SIDE} and {MAX_SIDE}.")));
                }
            }
        }
        if let Some(st) = body.steps {
            if !kind.takes_sampling() {
                return Err(CreateError::Bad(format!("{name} takes no steps.")));
            }
            if !(1..=MAX_STEPS).contains(&st) {
                return Err(CreateError::Bad(format!("steps must be between 1 and {MAX_STEPS}.")));
            }
        }
        if let Some(sd) = body.seed {
            if sd > MAX_SEED {
                return Err(CreateError::Bad(format!("seed must be between 0 and {MAX_SEED}.")));
            }
        }
        let count = body.count.unwrap_or(1);
        if !(1..=kind.max_count()).contains(&count) {
            return Err(CreateError::Bad(format!("count must be between 1 and {} for {name}.", kind.max_count())));
        }
        // `input_id` is `input_ids: [input_id]` (CREATE-V2.md).
        let mut input_ids: Vec<String> = body.input_ids.unwrap_or_default().into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        if let Some(one) = body.input_id.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
            if input_ids.is_empty() {
                input_ids.push(one);
            } else if input_ids[0] != one {
                return Err(CreateError::Bad("input_id and input_ids name different images. Send one of them.".to_string()));
            }
        }
        let most = if kind == Kind::Edit { max_edit_inputs(caps) } else { 1 };
        match (kind.needs_input(), input_ids.len()) {
            (true, 0) => {
                return Err(CreateError::Bad(if kind == Kind::Edit {
                    "edit needs input_ids from uploads.".to_string()
                } else {
                    format!("{name} needs input_id from an upload.")
                }))
            }
            (false, n) if n > 0 => return Err(CreateError::Bad(format!("{name} takes no input image."))),
            (_, n) if n > most => return Err(CreateError::Bad(format!("{name} takes at most {most} input image(s) on this computer."))),
            _ => {}
        }
        for (i, id) in input_ids.iter().enumerate() {
            if !is_our_id(id, "upl") {
                return Err(CreateError::Bad(if input_ids.len() == 1 { "input_id is not an upload id.".to_string() } else { "input_ids holds something that is not an upload id.".to_string() }));
            }
            if input_ids[..i].contains(id) {
                return Err(CreateError::Bad("input_ids names the same upload twice.".to_string()));
            }
        }
        let mask_id = body.mask_id.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        if let Some(m) = &mask_id {
            if kind != Kind::Edit {
                return Err(CreateError::Bad(format!("{name} takes no mask.")));
            }
            if !is_our_id(m, "upl") {
                return Err(CreateError::Bad("mask_id is not an upload id.".to_string()));
            }
            if input_ids.contains(m) {
                return Err(CreateError::Bad("The mask cannot be one of the input images.".to_string()));
            }
        }
        let character = body.character.map(|c| clean_text(&c, MAX_NAME_CHARS)).filter(|c| !c.is_empty());
        if let Some(ch) = &character {
            if !kind.takes_character() {
                return Err(CreateError::Bad(format!("{name} takes no character.")));
            }
            if let Some(c) = caps {
                if !kind_flag(c, kind, "character") {
                    return Err(CreateError::Unavailable(format!("Characters cannot be used for {name} on your computer.")));
                }
                if !characters_of(c).iter().any(|x| x["id"].as_str() == Some(ch.as_str())) {
                    return Err(CreateError::Bad("No character with that id on this computer.".to_string()));
                }
            }
        }
        let factor = match (kind, body.factor) {
            (Kind::Upscale, None) => Some(2),
            (Kind::Upscale, Some(f)) if f == 2 || f == 4 => Some(f),
            (Kind::Upscale, Some(_)) => return Err(CreateError::Bad("factor must be 2 or 4.".to_string())),
            (_, Some(_)) => return Err(CreateError::Bad(format!("{name} takes no factor."))),
            (_, None) => None,
        };
        let lyrics = match body.lyrics {
            Some(l) if kind != Kind::Music && !l.trim().is_empty() => return Err(CreateError::Bad(format!("{name} takes no lyrics."))),
            Some(l) if kind == Kind::Music => {
                let l = clean_lines(&l, MAX_LYRICS_CHARS + 1);
                if l.chars().count() > MAX_LYRICS_CHARS {
                    return Err(CreateError::Bad(format!("The lyrics are longer than {MAX_LYRICS_CHARS} characters.")));
                }
                Some(l).filter(|l| !l.is_empty())
            }
            _ => None,
        };
        let duration = match body.duration {
            Some(_) if kind != Kind::Music => return Err(CreateError::Bad(format!("{name} takes no duration."))),
            Some(d) => {
                let (lo, hi) = music_bounds(caps);
                if !(lo..=hi).contains(&d) {
                    return Err(CreateError::Bad(format!("duration must be between {lo} and {hi} seconds.")));
                }
                Some(d)
            }
            None => None,
        };
        Ok(JobSpec {
            kind,
            prompt,
            negative,
            model,
            width: body.width,
            height: body.height,
            steps: body.steps,
            seed: body.seed,
            count,
            input_ids,
            mask_id,
            character,
            factor,
            lyrics,
            duration,
        })
    }

    /// What the window last reported, if anything.
    fn cached_caps(&self) -> Option<Value> {
        lock(&self.book).caps.clone()
    }

    /// An upload of this device as a chat attachment: its bytes, type and
    /// name. Only the device's own, only a plain file in the upload folder.
    pub fn upload_bytes(&self, owner: &str, id: &str) -> Option<(Vec<u8>, String, String)> {
        if !is_our_id(id, "upl") {
            return None;
        }
        let u = lock(&self.book).uploads.iter().find(|u| u.id == id && u.owner == owner).cloned()?;
        let mut f = open_no_follow(&u.path).ok()?;
        let mut bytes = Vec::with_capacity(u.bytes as usize);
        f.read_to_end(&mut bytes).ok()?;
        let ext = u.path.extension().and_then(|e| e.to_str()).unwrap_or("bin");
        let name = u.name.clone().unwrap_or_else(|| format!("attachment.{ext}"));
        Some((bytes, u.mime.to_string(), name))
    }

    /// The device's jobs that wait or run, as tasks (CHATS-V1.md `tasks`).
    pub fn open_jobs(&self, owner: &str) -> Vec<Value> {
        let book = lock(&self.book);
        book.jobs
            .iter()
            .filter(|j| j.owner == owner && !j.state.terminal())
            .map(|j| {
                let view = self.job_view(&book, j);
                let title = if j.spec.prompt.is_empty() { j.spec.kind.as_str().to_string() } else { j.spec.prompt.chars().take(80).collect() };
                json!({
                    "id": j.id,
                    "kind": "create",
                    "job_id": j.id,
                    "title": title,
                    "state": j.state.as_str(),
                    "progress": view["progress"],
                    "started_at": j.started_at.unwrap_or(j.created_at),
                })
            })
            .collect()
    }

    /// Queue a job. A repeated `client_request_id` from the same device gets
    /// the job it already has.
    #[cfg(test)]
    pub fn submit(&self, owner: &str, client_request_id: Option<String>, spec: JobSpec, now: u64) -> Result<(Value, bool), CreateError> {
        self.submit_as(owner, None, client_request_id, spec, now)
    }

    /// [`Self::submit`] for a sealed device let in under `generation`.
    pub fn submit_as(&self, owner: &str, generation: Option<u64>, client_request_id: Option<String>, spec: JobSpec, now: u64) -> Result<(Value, bool), CreateError> {
        let mut effects = Vec::new();
        let out = {
            let mut book = lock(&self.book);
            self.admit(owner, generation)?;
            if let Some(crid) = &client_request_id {
                if let Some(job) = book.jobs.iter().find(|j| j.owner == owner && j.client_request_id.as_ref() == Some(crid)) {
                    return Ok((self.job_view(&book, job), true));
                }
            }
            let mine = book.jobs.iter().filter(|j| j.state == JobState::Queued && j.owner == owner).count();
            if mine >= MAX_WAITING_PER_OWNER {
                return Err(CreateError::Busy(format!(
                    "This phone already has {mine} jobs waiting on this computer. Try again when one has started."
                )));
            }
            let waiting = book.jobs.iter().filter(|j| j.state == JobState::Queued).count();
            if waiting >= MAX_WAITING {
                return Err(CreateError::Busy(format!(
                    "{waiting} jobs are already waiting on this computer. Try again when one has finished."
                )));
            }
            let find = |id: &String| {
                book.uploads
                    .iter()
                    .find(|u| &u.id == id && u.owner == owner)
                    .ok_or_else(|| CreateError::Bad("No such upload. Upload the image again.".to_string()))
            };
            let mut inputs = Vec::with_capacity(spec.input_ids.len());
            for id in &spec.input_ids {
                let u = find(id)?;
                if !u.mime.starts_with("image/") {
                    return Err(CreateError::Bad("An input of a job must be an image.".to_string()));
                }
                inputs.push((u.path.clone(), u.width, u.height));
            }
            let mask_path = match &spec.mask_id {
                Some(id) => {
                    let m = find(id)?;
                    if m.mime != "image/png" {
                        return Err(CreateError::Bad("The mask must be a PNG.".to_string()));
                    }
                    if let Some((_, w, h)) = inputs.first() {
                        if (m.width, m.height) != (*w, *h) {
                            return Err(CreateError::Bad(format!(
                                "The mask is {} x {} pixels, the first image {w} x {h}. They must be the same size.",
                                m.width, m.height
                            )));
                        }
                    }
                    Some(m.path.clone())
                }
                None => None,
            };
            if let (Some(f), Some((_, w, h))) = (spec.factor, inputs.first()) {
                if (*w as u64).max(*h as u64) * f as u64 > UPSCALE_MAX_SIDE {
                    return Err(CreateError::Bad(format!(
                        "Enhanced {f}x the image would be larger than {UPSCALE_MAX_SIDE} pixels a side. Pick 2x or a smaller image."
                    )));
                }
            }
            let job = Job {
                id: new_id("job"),
                owner: owner.to_string(),
                client_request_id,
                spec,
                inputs,
                mask_path,
                state: JobState::Queued,
                progress: 0.0,
                step_text: String::new(),
                error: None,
                results: Vec::new(),
                created_at: now,
                started_at: None,
                finished_at: None,
                last_beat: now,
                acked: false,
                index: 0,
            };
            let id = job.id.clone();
            book.jobs.push(job);
            self.advance(&mut book, now, &mut effects);
            Self::trim(&mut book);
            effects.push(Effect::Emit(self.state_payload(&book)));
            let job = book.jobs.iter().find(|j| j.id == id).ok_or(CreateError::NotFound)?;
            self.job_view(&book, job)
        };
        self.run_effects(effects);
        Ok((out, false))
    }

    /// A job as its owner sees it. `owner` None: the desktop, which sees all.
    pub fn view(&self, owner: Option<&str>, id: &str) -> Option<Value> {
        let book = lock(&self.book);
        let job = book.jobs.iter().find(|j| j.id == id && owner.is_none_or(|o| j.owner == o))?;
        Some(self.job_view(&book, job))
    }

    /// Cancel a job. A waiting one leaves the queue, a running one is ended in
    /// the engine and in the window. A finished one stays as it is.
    pub fn cancel(&self, owner: Option<&str>, id: &str, now: u64) -> Option<Value> {
        let mut effects = Vec::new();
        let out = {
            let mut book = lock(&self.book);
            let idx = book.jobs.iter().position(|j| j.id == id && owner.is_none_or(|o| j.owner == o))?;
            self.cancel_at(&mut book, idx, now, &mut effects);
            self.advance(&mut book, now, &mut effects);
            effects.push(Effect::Emit(self.state_payload(&book)));
            self.job_view(&book, &book.jobs[idx])
        };
        self.run_effects(effects);
        Some(out)
    }

    fn cancel_at(&self, book: &mut Book, idx: usize, now: u64, effects: &mut Vec<Effect>) {
        let job = &mut book.jobs[idx];
        match job.state {
            JobState::Queued => {
                job.state = JobState::Cancelled;
                job.finished_at = Some(now);
            }
            JobState::Running => {
                job.state = JobState::Cancelled;
                job.finished_at = Some(now);
                job.step_text = "Cancelled".to_string();
                effects.push(Effect::Emit(json!({ "action": "cancel", "id": job.id, "kind": job.spec.kind.as_str() })));
                effects.push(Effect::Abort(job.spec.kind));
            }
            _ => {}
        }
    }

    /// Cancel every open job, of one device or of all.
    pub fn cancel_all(&self, owner: Option<&str>, now: u64) {
        let mut effects = Vec::new();
        {
            let mut book = lock(&self.book);
            for idx in 0..book.jobs.len() {
                if owner.is_none_or(|o| book.jobs[idx].owner == o) {
                    self.cancel_at(&mut book, idx, now, &mut effects);
                }
            }
            self.advance(&mut book, now, &mut effects);
            effects.push(Effect::Emit(self.state_payload(&book)));
        }
        self.run_effects(effects);
    }

    /// A device is gone (unpaired, disconnected, its right `create` taken):
    /// its open jobs are cancelled like `cancel_all`, then its jobs and
    /// uploads leave the table, so no result or upload of it can be reached
    /// by id any more. The files stay on disk, results in the gallery.
    pub fn forget_owner(&self, owner: &str, now: u64) {
        self.cancel_all(Some(owner), now);
        let gone = {
            let mut book = lock(&self.book);
            book.jobs.retain(|j| j.owner != owner);
            let (mine, rest): (Vec<Upload>, Vec<Upload>) = std::mem::take(&mut book.uploads).into_iter().partition(|u| u.owner == owner);
            book.uploads = rest;
            Self::unneeded(&book, mine)
        };
        self.discard(gone);
    }

    /// Of these removed uploads, the files no other upload and no open job
    /// still needs (uploads are stored by content, so two devices can share
    /// one file).
    fn unneeded(book: &Book, removed: Vec<Upload>) -> Vec<PathBuf> {
        let mut out: Vec<PathBuf> = Vec::new();
        for u in removed {
            let used = book.uploads.iter().any(|o| o.path == u.path)
                || book.jobs.iter().any(|j| !j.state.terminal() && j.reads(&u.path));
            if !used && !out.contains(&u.path) {
                out.push(u.path);
            }
        }
        out
    }

    fn discard(&self, paths: Vec<PathBuf>) {
        if paths.is_empty() {
            return;
        }
        let host = self.host();
        for p in paths {
            host.discard_upload(&p);
        }
    }

    /// The window reports on a job. Answers whether the job still runs, so a
    /// window that missed the cancel stops by itself.
    pub fn progress(&self, id: &str, progress: Option<f64>, step_text: Option<String>, index: Option<u32>, now: u64) -> bool {
        let mut effects = Vec::new();
        let running = {
            let mut book = lock(&self.book);
            let Some(job) = book.jobs.iter_mut().find(|j| j.id == id) else { return false };
            if job.state != JobState::Running {
                return false;
            }
            job.acked = true;
            job.last_beat = now;
            if let Some(p) = progress.filter(|p| p.is_finite()) {
                job.progress = job.progress.max(p.clamp(0.0, 0.99));
            }
            if let Some(t) = step_text {
                job.step_text = clean_text(&t, 120);
            }
            if let Some(i) = index {
                job.index = i.min(job.spec.count.saturating_sub(1));
            }
            effects.push(Effect::Emit(self.state_payload(&book)));
            true
        };
        self.run_effects(effects);
        running
    }

    /// The window is through with a job. Outputs are checked one by one; only
    /// files inside the output folders become results.
    pub fn finish(&self, id: &str, ok: bool, error: Option<String>, outputs: Vec<OutputRef>, now: u64) -> Result<Value, String> {
        // Resolve and hash outside the lock: a clip can be hundreds of MB.
        let host = self.host();
        let roots = host.result_roots();
        let comfy = host.comfy_output_dir();
        let mut results = Vec::new();
        let mut refused = Vec::new();
        for out in outputs.into_iter().take(MAX_COUNT as usize) {
            match resolve_output(&out, &roots, comfy.as_deref()).and_then(|p| describe_file(&p)) {
                Ok(r) => results.push(r),
                Err(e) => refused.push(e),
            }
        }
        let mut effects = Vec::new();
        let view = {
            let mut book = lock(&self.book);
            let idx = book.jobs.iter().position(|j| j.id == id).ok_or_else(|| "No such job.".to_string())?;
            let job = &mut book.jobs[idx];
            if job.state == JobState::Running {
                job.finished_at = Some(now);
                if ok && !results.is_empty() {
                    job.state = JobState::Done;
                    job.progress = 1.0;
                    job.step_text = "Done".to_string();
                    job.results = results;
                } else {
                    job.state = JobState::Failed;
                    job.step_text = "Failed".to_string();
                    // The window's own words can name folders or addresses:
                    // they go to the log, the phone gets a fixed sentence.
                    if let Some(e) = error.as_deref().filter(|e| !e.trim().is_empty()) {
                        tracing::warn!(error = %without_paths(&clean_text(e, 600)), "remote create job failed in the window");
                    }
                    for r in &refused {
                        tracing::warn!(reason = %without_paths(&r.to_string()), "remote create result refused");
                    }
                    let reason = if error.as_deref().is_some_and(|e| !e.trim().is_empty()) {
                        "The generation failed on the computer. Details are in the log of LU on the computer."
                    } else if !refused.is_empty() {
                        "The computer made no result this phone may fetch."
                    } else {
                        "The desktop made no result for this job."
                    };
                    job.error = Some(reason.to_string());
                }
                self.advance(&mut book, now, &mut effects);
                Self::trim(&mut book);
                effects.push(Effect::Emit(self.state_payload(&book)));
            }
            let job = book.jobs.iter().find(|j| j.id == id).ok_or_else(|| "No such job.".to_string())?;
            self.job_view(&book, job)
        };
        self.run_effects(effects);
        Ok(view)
    }

    /// The result file with this id, only from the owner's own jobs.
    pub fn result_file(&self, owner: Option<&str>, id: &str) -> Option<ResultFile> {
        if !is_our_id(id, "res") {
            return None;
        }
        let book = lock(&self.book);
        book.jobs
            .iter()
            .filter(|j| owner.is_none_or(|o| j.owner == o))
            .flat_map(|j| j.results.iter())
            .find(|r| r.id == id)
            .cloned()
    }

    // ── liveness ──

    fn stale_candidate(&self, now: u64) -> Option<(String, Kind, bool)> {
        let book = lock(&self.book);
        book.jobs.iter().find(|j| j.state == JobState::Running).and_then(|j| {
            let quiet = now.saturating_sub(j.last_beat);
            let stale = if j.acked { quiet > BEAT_SECS } else { quiet > ACK_SECS };
            stale.then(|| (j.id.clone(), j.spec.kind, j.acked))
        })
    }

    fn settle_stale(&self, id: &str, engine_busy: bool, now: u64) {
        let mut effects = Vec::new();
        {
            let mut book = lock(&self.book);
            let Some(idx) = book.jobs.iter().position(|j| j.id == id && j.state == JobState::Running) else { return };
            let job = &mut book.jobs[idx];
            if job.acked && engine_busy {
                // The window is quiet, the engine is not: the job lives.
                job.last_beat = now;
                return;
            }
            job.state = JobState::Failed;
            job.finished_at = Some(now);
            job.step_text = "Failed".to_string();
            job.error = Some(if job.acked {
                "The computer stopped reporting on this job. Check LU on the computer and try again.".to_string()
            } else {
                "LU on the computer did not start the job. Make sure LU is open on the computer and try again.".to_string()
            });
            effects.push(Effect::Emit(json!({ "action": "cancel", "id": job.id, "kind": job.spec.kind.as_str() })));
            if job.acked {
                effects.push(Effect::Abort(job.spec.kind));
            }
            self.advance(&mut book, now, &mut effects);
            Self::trim(&mut book);
            effects.push(Effect::Emit(self.state_payload(&book)));
        }
        self.run_effects(effects);
    }

    /// Fail a running job that went quiet, unless the engine says it is still
    /// working. Every route calls this, so a phone polling is what drives it.
    pub async fn tick(&self, now: u64) {
        let Some((id, kind, acked)) = self.stale_candidate(now) else { return };
        let busy = if acked { self.host().engine_busy(kind).await == Some(true) } else { false };
        self.settle_stale(&id, busy, now);
    }

    // ── uploads ──

    #[cfg(test)]
    pub fn add_upload(&self, owner: &str, bytes: &[u8]) -> Result<Value, CreateError> {
        self.add_upload_as(owner, None, bytes)
    }

    /// [`Self::add_upload`] for a sealed device let in under `generation`.
    #[cfg(test)]
    pub fn add_upload_as(&self, owner: &str, generation: Option<u64>, bytes: &[u8]) -> Result<Value, CreateError> {
        self.add_file_with(owner, generation, bytes, None, None, true)
    }

    /// An upload with what the phone said about it: an image, or a PDF or
    /// text for a chat. `declared` is the Content-Type, `name` the file name.
    #[cfg(test)]
    pub fn add_file_as(&self, owner: &str, generation: Option<u64>, bytes: &[u8], declared: Option<&str>, name: Option<&str>) -> Result<Value, CreateError> {
        self.add_file_with(owner, generation, bytes, declared, name, true)
    }

    /// An upload as above. `needs_create` is false for a chat attachment,
    /// which does not need Create to be on.
    pub fn add_file_with(&self, owner: &str, generation: Option<u64>, bytes: &[u8], declared: Option<&str>, name: Option<&str>, needs_create: bool) -> Result<Value, CreateError> {
        if bytes.is_empty() {
            return Err(CreateError::Bad("The upload is empty.".to_string()));
        }
        if bytes.len() > MAX_UPLOAD_BYTES {
            return Err(CreateError::TooLarge);
        }
        let (ext, mime, width, height) = match image_kind(bytes) {
            Some((ext, mime)) => {
                // The header alone gives the size: nothing larger is decoded or kept.
                let (width, height) = image::ImageReader::new(std::io::Cursor::new(bytes))
                    .with_guessed_format()
                    .ok()
                    .and_then(|r| r.into_dimensions().ok())
                    .ok_or_else(|| CreateError::Bad("The image could not be read.".to_string()))?;
                if width > MAX_UPLOAD_SIDE || height > MAX_UPLOAD_SIDE {
                    return Err(CreateError::Bad(format!("The image is larger than {MAX_UPLOAD_SIDE} x {MAX_UPLOAD_SIDE} pixels.")));
                }
                (ext, mime, width, height)
            }
            None => {
                let (ext, mime) = document_kind(bytes, declared).ok_or_else(|| {
                    CreateError::Bad("Only PNG, JPEG and WebP images, PDF and text files can be uploaded.".to_string())
                })?;
                (ext, mime, 0, 0)
            }
        };
        let name = name.and_then(clean_file_name);
        self.admit_for(owner, generation, needs_create)?;
        let dir = self.host().uploads_dir();
        let path = write_by_content(&dir, bytes, ext).map_err(|e| {
            tracing::warn!(error = %without_paths(&e.to_string()), "remote upload not stored");
            CreateError::Bad("The upload could not be stored on the computer.".to_string())
        })?;
        let upload = Upload { id: new_id("upl"), owner: owner.to_string(), path, mime, bytes: bytes.len() as u64, width, height, name };
        let view = upload.view();
        let (result, gone) = {
            let mut book = lock(&self.book);
            let result = self.keep_upload(&mut book, owner, generation, needs_create, upload);
            let gone = match &result {
                Ok(evicted) => Self::unneeded(&book, evicted.clone()),
                Err((_, refused)) => Self::unneeded(&book, vec![refused.clone()]),
            };
            (result, gone)
        };
        self.discard(gone);
        result.map(|_| view).map_err(|(e, _)| e)
    }

    /// Enters an upload within the limits, pushing out the oldest ones no
    /// open job needs: first of this device, then of all. Returns what was
    /// pushed out, or the error with the refused upload.
    #[allow(clippy::result_large_err)]
    fn keep_upload(&self, book: &mut Book, owner: &str, generation: Option<u64>, needs_create: bool, upload: Upload) -> Result<Vec<Upload>, (CreateError, Upload)> {
        if let Err(e) = self.admit_for(owner, generation, needs_create) {
            return Err((e, upload));
        }
        let open: Vec<String> = book.jobs.iter().filter(|j| !j.state.terminal()).flat_map(|j| j.spec.uploads().cloned()).collect();
        let mut evicted = Vec::new();
        let size = upload.bytes;
        // This device.
        loop {
            let mine: Vec<&Upload> = book.uploads.iter().filter(|u| u.owner == owner).collect();
            let bytes: u64 = mine.iter().map(|u| u.bytes).sum();
            if mine.len() < MAX_UPLOADS_PER_OWNER && bytes + size <= MAX_UPLOAD_BYTES_PER_OWNER {
                break;
            }
            match book.uploads.iter().position(|u| u.owner == owner && !open.contains(&u.id)) {
                Some(i) => evicted.push(book.uploads.remove(i)),
                None => {
                    book.uploads.extend(evicted);
                    return Err((CreateError::Busy("This phone has too many images waiting on this computer. Try again when a job has finished.".to_string()), upload));
                }
            }
        }
        // All devices: still only this device's own uploads make room, one
        // phone never pushes out another's.
        loop {
            let bytes: u64 = book.uploads.iter().map(|u| u.bytes).sum();
            if book.uploads.len() < MAX_UPLOADS && bytes + size <= MAX_UPLOAD_BYTES_TOTAL {
                break;
            }
            match book.uploads.iter().position(|u| u.owner == owner && !open.contains(&u.id)) {
                Some(i) => evicted.push(book.uploads.remove(i)),
                None => {
                    book.uploads.extend(evicted);
                    return Err((CreateError::Busy("Too many images are waiting on this computer. Try again in a moment.".to_string()), upload));
                }
            }
        }
        book.uploads.push(upload);
        Ok(evicted)
    }

    // ── capabilities ──

    pub fn capabilities_reply(&self, request_id: &str, caps: Value) -> bool {
        let caps = sanitize_caps(&caps);
        {
            let mut book = lock(&self.book);
            book.caps = Some(caps.clone());
            book.caps_at = now_secs();
        }
        match lock(&self.waiters).remove(request_id) {
            Some(tx) => tx.send(caps).is_ok(),
            None => false,
        }
    }

    /// [`Self::capabilities`] for one device: it makes the window answer at
    /// most every [`CAPS_ASK_EVERY_SECS`], and only while few questions are
    /// open; otherwise it gets the last answer.
    pub async fn capabilities_for(&self, owner: &str, now: u64) -> Option<(Value, bool)> {
        let cached = lock(&self.book).caps.clone();
        let ask = {
            let mut asked = lock(&self.caps_asked);
            if asked.len() > 1024 {
                asked.retain(|_, t| now.saturating_sub(*t) < CAPS_ASK_EVERY_SECS);
            }
            let recent = asked.get(owner).is_some_and(|t| now.saturating_sub(*t) < CAPS_ASK_EVERY_SECS);
            let crowded = lock(&self.waiters).len() >= MAX_CAPS_WAITERS;
            let ask = !crowded && (cached.is_none() || !recent);
            if ask {
                asked.insert(owner.to_string(), now);
            }
            ask
        };
        if ask {
            self.capabilities().await
        } else {
            cached.map(|c| (c, true))
        }
    }

    /// Ask the window what it can make. Falls back to the last answer.
    pub async fn capabilities(&self) -> Option<(Value, bool)> {
        let rid = new_id("cap");
        let (tx, rx) = tokio::sync::oneshot::channel();
        lock(&self.waiters).insert(rid.clone(), tx);
        self.host().emit(json!({ "action": "capabilities", "request_id": rid }));
        match tokio::time::timeout(self.caps_wait, rx).await {
            Ok(Ok(v)) => Some((v, false)),
            _ => {
                lock(&self.waiters).remove(&rid);
                lock(&self.book).caps.clone().map(|c| (c, true))
            }
        }
    }

    #[cfg(test)]
    pub fn capabilities_body(&self, caps: &Value, stale: bool) -> Value {
        self.capabilities_body_for(caps, stale, true)
    }

    /// `stage_two`: false for the plain Wi-Fi way (JWT), which keeps what it
    /// had in 3.0.7: image and video, no characters, pictures only.
    pub fn capabilities_body_for(&self, caps: &Value, stale: bool, stage_two: bool) -> Value {
        let (running, queued) = self.busy();
        let characters = if stage_two { characters_of(caps) } else { Vec::new() };
        let character_ids: Vec<String> = characters.iter().filter_map(|c| c["id"].as_str().map(str::to_string)).collect();
        let kinds: Vec<Value> = self
            .tool
            .kinds()
            .iter()
            .filter(|kind| stage_two || kind.feature().is_none())
            .map(|&kind| {
                let models = models_of(caps, kind);
                let ids: Vec<String> = models.iter().map(|(id, _)| id.clone()).collect();
                let (available, reason) = availability(caps, kind);
                let with_character = stage_two && kind.takes_character() && kind_flag(caps, kind, "character");
                json!({
                    "kind": kind.as_str(),
                    "available": available,
                    "reason": if available { None } else { Some(reason) },
                    "models": model_entries(caps, kind),
                    "schema": kind_schema(kind, &ids, if with_character { &character_ids } else { &[] }, Some(caps)),
                })
            })
            .collect();
        let desktop_busy = caps.get("desktop_busy").and_then(Value::as_bool).unwrap_or(false);
        json!({
            "tool": self.tool.as_str(),
            "busy": running || desktop_busy,
            "desktop_busy": desktop_busy,
            "queued": queued,
            "engine_ready": caps.get("engine_ready").and_then(Value::as_bool),
            "stale": stale,
            "kinds": kinds,
            "characters": characters,
            "limits": {
                "max_upload_bytes": MAX_UPLOAD_BYTES,
                "max_chunk_bytes": MAX_CHUNK_BYTES,
                "max_count": MAX_COUNT,
                "max_video_count": MAX_VIDEO_COUNT,
                "max_waiting": MAX_WAITING,
                "max_waiting_per_device": MAX_WAITING_PER_OWNER,
                "max_edit_inputs": max_edit_inputs(Some(caps)),
                "upload_types": if stage_two { json!(["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain", "text/markdown"]) } else { json!(["image/png", "image/jpeg", "image/webp"]) },
            },
        })
    }

    /// The stage 2 words of `status/full` (CREATE-V2.md), from the window's
    /// last answer: a kind's word only while it can run, `create-character`
    /// while image or video takes a character, `create-gallery` once the
    /// window has answered at all. Asks the window again in the background
    /// when that answer is old, so the next status is current; the status
    /// itself never waits for the window.
    pub fn stage_two_features(self: &Arc<Self>, now: u64) -> Vec<String> {
        let (caps, at) = {
            let book = lock(&self.book);
            (book.caps.clone(), book.caps_at)
        };
        if caps.is_none() || now.saturating_sub(at) >= CAPS_ASK_EVERY_SECS {
            let crowded = lock(&self.waiters).len() >= MAX_CAPS_WAITERS;
            if !crowded {
                if let Ok(rt) = tokio::runtime::Handle::try_current() {
                    let hub = self.clone();
                    rt.spawn(async move {
                        let _ = hub.capabilities().await;
                    });
                }
            }
        }
        let Some(caps) = caps else { return Vec::new() };
        let mut out: Vec<String> = Kind::ALL
            .iter()
            .filter_map(|&k| k.feature().filter(|_| availability(&caps, k).0).map(str::to_string))
            .collect();
        if [Kind::Image, Kind::Video].iter().any(|&k| availability(&caps, k).0 && kind_flag(&caps, k, "character")) {
            out.push("create-character".to_string());
        }
        out.push("create-gallery".to_string());
        out
    }

    // ── gallery ──

    /// The window answers a gallery question.
    pub fn gallery_reply(&self, request_id: &str, items: Value) -> bool {
        match lock(&self.waiters).remove(request_id) {
            Some(tx) => tx.send(items).is_ok(),
            None => false,
        }
    }

    /// The desktop gallery, newest first: the last list while it is fresh,
    /// else the window is asked again. `None` when the window never answered.
    async fn gallery(&self, now: u64, force: bool) -> Option<Vec<GalleryEntry>> {
        let fresh = |book: &Book| book.gallery.as_ref().filter(|g| now.saturating_sub(g.at) < GALLERY_FRESH_SECS).map(|g| g.entries.clone());
        if !force {
            if let Some(list) = fresh(&lock(&self.book)) {
                return Some(list);
            }
        }
        let _one = self.gallery_asking.lock().await;
        // Someone else asked while this one waited.
        if let Some(list) = fresh(&lock(&self.book)).filter(|_| !force) {
            return Some(list);
        }
        let rid = new_id("gal");
        let (tx, rx) = tokio::sync::oneshot::channel();
        lock(&self.waiters).insert(rid.clone(), tx);
        self.host().emit(json!({ "action": "gallery", "request_id": rid }));
        let raw = match tokio::time::timeout(self.caps_wait, rx).await {
            Ok(Ok(v)) => v,
            _ => {
                lock(&self.waiters).remove(&rid);
                return lock(&self.book).gallery.as_ref().map(|g| g.entries.clone());
            }
        };
        let host = self.host();
        let roots = host.result_roots();
        let comfy = host.comfy_output_dir();
        let old: Vec<GalleryEntry> = lock(&self.book).gallery.as_ref().map(|g| g.entries.clone()).unwrap_or_default();
        let entries = tokio::task::spawn_blocking(move || gallery_entries(&raw, &roots, comfy.as_deref(), &old)).await.unwrap_or_default();
        lock(&self.book).gallery = Some(GalleryList { at: now, entries: entries.clone() });
        Some(entries)
    }

    /// One gallery entry by id; a list that does not hold it is asked again
    /// once.
    async fn gallery_entry(&self, id: &str, now: u64) -> Option<GalleryEntry> {
        if !is_our_id(id, "gal") {
            return None;
        }
        if let Some(e) = self.gallery(now, false).await?.into_iter().find(|e| e.file.id == id) {
            return Some(e);
        }
        let stale = lock(&self.book).gallery.as_ref().is_none_or(|g| g.at != now);
        if !stale {
            return None;
        }
        self.gallery(now, true).await?.into_iter().find(|e| e.file.id == id)
    }

    /// Note the hash of a gallery file, so the list names it from now on.
    fn remember_gallery_hash(&self, id: &str, ident: &FileIdent, sha256: &str) {
        let mut book = lock(&self.book);
        if let Some(g) = book.gallery.as_mut() {
            for e in g.entries.iter_mut().filter(|e| e.file.id == id && &e.file.ident == ident) {
                e.file.sha256 = sha256.to_string();
            }
        }
    }

    /// The preview of `key`, made by `make` at most once at a time per key
    /// and with at most [`THUMB_SLOTS`] makers running.
    async fn thumb_for<F>(&self, key: &str, make: F) -> Result<Vec<u8>, StatusCode>
    where
        F: FnOnce() -> Result<Vec<u8>, StatusCode> + Send + 'static,
    {
        if let Some(j) = self.cached_thumb(key) {
            return Ok(j);
        }
        let flight = lock(&self.thumb_flight).entry(key.to_string()).or_insert_with(|| Arc::new(TokioMutex::new(()))).clone();
        let result = {
            let _one = flight.lock().await;
            if let Some(j) = self.cached_thumb(key) {
                Ok(j)
            } else {
                let _slot = self.thumb_slots.clone().acquire_owned().await.map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
                match tokio::task::spawn_blocking(make).await {
                    Ok(Ok(j)) => {
                        self.keep_thumb(key, j.clone());
                        Ok(j)
                    }
                    Ok(Err(code)) => Err(code),
                    Err(_) => Err(StatusCode::NOT_FOUND),
                }
            }
        };
        let mut flights = lock(&self.thumb_flight);
        if flights.get(key).is_some_and(|f| Arc::ptr_eq(f, &flight) && Arc::strong_count(f) <= 2) {
            flights.remove(key);
        }
        result
    }

    fn cached_thumb(&self, id: &str) -> Option<Vec<u8>> {
        lock(&self.thumbs).iter().find(|(k, _)| k == id).map(|(_, v)| v.clone())
    }

    fn keep_thumb(&self, id: &str, jpeg: Vec<u8>) {
        let mut thumbs = lock(&self.thumbs);
        thumbs.retain(|(k, _)| k != id);
        thumbs.push((id.to_string(), jpeg));
        if thumbs.len() > MAX_THUMBS {
            let over = thumbs.len() - MAX_THUMBS;
            thumbs.drain(..over);
        }
    }

    #[cfg(test)]
    fn with_caps_wait(mut self, d: Duration) -> Self {
        self.caps_wait = d;
        self
    }
}

/// `{ "kinds": { "<kind>": { "models": [{id,name}], "available", "reason",
/// "character", "max_inputs", "duration": {min,max,default} } },
/// "characters": [{id,name,model_family,trigger}], "desktop_busy",
/// "engine_ready" }`, bounded and cleaned, whatever the window sent.
fn sanitize_caps(raw: &Value) -> Value {
    let mut kinds = serde_json::Map::new();
    for kind in Kind::ALL {
        let entry = raw.pointer(&format!("/kinds/{}", kind.as_str()));
        let models: Vec<Value> = entry
            .and_then(|e| e.get("models"))
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|m| {
                        let id = m.get("id").and_then(Value::as_str).or_else(|| m.as_str())?;
                        let id = clean_text(id, MAX_NAME_CHARS);
                        if id.is_empty() {
                            return None;
                        }
                        let name = m.get("name").and_then(Value::as_str).map(|n| clean_text(n, MAX_NAME_CHARS)).unwrap_or_else(|| id.clone());
                        let mut out = json!({ "id": id, "name": name });
                        // The size the desktop's Create tab starts this model's
                        // family at, and above which it gets slow (SD 1.5).
                        let side = |k: &str| m.get(k).and_then(Value::as_u64).map(|v| v as u32).filter(|v| (MIN_SIDE..=MAX_SIDE).contains(v) && v % 8 == 0);
                        if let (Some(w), Some(h)) = (side("width"), side("height")) {
                            out["width"] = json!(w);
                            out["height"] = json!(h);
                        }
                        if let Some(max) = side("recommended_max") {
                            out["recommended_max"] = json!(max);
                        }
                        if let Some(note) = m.get("note").and_then(Value::as_str).map(|n| clean_text(n, 300)).filter(|n| !n.is_empty()) {
                            out["note"] = json!(note);
                        }
                        Some(out)
                    })
                    .take(MAX_MODELS)
                    .collect()
            })
            .unwrap_or_default();
        let mut out = json!({ "models": models });
        if let Some(e) = entry {
            if let Some(a) = e.get("available").and_then(Value::as_bool) {
                out["available"] = json!(a);
            }
            if let Some(r) = e.get("reason").and_then(Value::as_str).map(|r| clean_text(r, 300)).filter(|r| !r.is_empty()) {
                out["reason"] = json!(r);
            }
            if e.get("character").and_then(Value::as_bool) == Some(true) {
                out["character"] = json!(true);
            }
            if let Some(n) = e.get("max_inputs").and_then(Value::as_u64) {
                out["max_inputs"] = json!(n.clamp(1, MAX_EDIT_INPUTS as u64));
            }
            if let Some(d) = e.get("duration") {
                let num = |k: &str| d.get(k).and_then(Value::as_u64).map(|v| v.clamp(1, 3600));
                if let (Some(lo), Some(hi)) = (num("min"), num("max")) {
                    if lo <= hi {
                        out["duration"] = json!({ "min": lo, "max": hi, "default": num("default").map(|v| v.clamp(lo, hi)) });
                    }
                }
            }
        }
        kinds.insert(kind.as_str().to_string(), out);
    }
    let characters: Vec<Value> = raw
        .get("characters")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|c| {
                    let id = clean_text(c.get("id")?.as_str()?, MAX_NAME_CHARS);
                    if id.is_empty() {
                        return None;
                    }
                    let text = |k: &str| c.get(k).and_then(Value::as_str).map(|v| clean_text(v, MAX_NAME_CHARS)).unwrap_or_default();
                    let name = Some(text("name")).filter(|n| !n.is_empty()).unwrap_or_else(|| id.clone());
                    Some(json!({ "id": id, "name": name, "model_family": text("model_family"), "trigger": text("trigger") }))
                })
                .take(MAX_CHARACTERS)
                .collect()
        })
        .unwrap_or_default();
    json!({
        "kinds": kinds,
        "characters": characters,
        "desktop_busy": raw.get("desktop_busy").and_then(Value::as_bool).unwrap_or(false),
        "engine_ready": raw.get("engine_ready").and_then(Value::as_bool),
    })
}

/// The models of a kind as the window gave them (cleaned): id, name and,
/// for pictures, the family's size and a note.
fn model_entries(caps: &Value, kind: Kind) -> Vec<Value> {
    caps.pointer(&format!("/kinds/{}/models", kind.as_str()))
        .and_then(Value::as_array)
        .map(|l| l.iter().filter(|m| m.get("id").and_then(Value::as_str).is_some() && m.get("name").and_then(Value::as_str).is_some()).cloned().collect())
        .unwrap_or_default()
}

fn models_of(caps: &Value, kind: Kind) -> Vec<(String, String)> {
    caps.pointer(&format!("/kinds/{}/models", kind.as_str()))
        .and_then(Value::as_array)
        .map(|l| {
            l.iter()
                .filter_map(|m| Some((m.get("id")?.as_str()?.to_string(), m.get("name")?.as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

/// Can the kind run, by the window's word, and if not, why. Without a word
/// of its own a kind runs while it has a model.
fn availability(caps: &Value, kind: Kind) -> (bool, String) {
    let entry = caps.pointer(&format!("/kinds/{}", kind.as_str()));
    // An engine that is not up yet (ComfyUI starting) lists nothing; a job
    // still starts it, as in stage 1. Only the window's own word stops it.
    let engine_down = caps.get("engine_ready").and_then(Value::as_bool) == Some(false);
    let available = entry
        .and_then(|e| e.get("available"))
        .and_then(Value::as_bool)
        .unwrap_or_else(|| engine_down || !models_of(caps, kind).is_empty());
    let reason = entry
        .and_then(|e| e.get("reason"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| kind.default_reason().to_string());
    (available, reason)
}

fn kind_flag(caps: &Value, kind: Kind, flag: &str) -> bool {
    caps.pointer(&format!("/kinds/{}/{flag}", kind.as_str())).and_then(Value::as_bool) == Some(true)
}

fn characters_of_names(caps: &Value) -> Vec<&str> {
    caps.get("characters").and_then(Value::as_array).map(|l| l.iter().filter_map(|c| c["name"].as_str()).collect()).unwrap_or_default()
}

fn characters_of(caps: &Value) -> Vec<Value> {
    caps.get("characters").and_then(Value::as_array).cloned().unwrap_or_default()
}

/// References one edit takes here: what the window says, at most
/// [`MAX_EDIT_INPUTS`].
fn max_edit_inputs(caps: Option<&Value>) -> usize {
    caps.and_then(|c| c.pointer("/kinds/edit/max_inputs"))
        .and_then(Value::as_u64)
        .map(|n| (n as usize).clamp(1, MAX_EDIT_INPUTS))
        .unwrap_or(MAX_EDIT_INPUTS)
}

/// The shortest and longest track, by the window's word or the fixed bounds.
fn music_bounds(caps: Option<&Value>) -> (u32, u32) {
    let d = caps.and_then(|c| c.pointer("/kinds/music/duration"));
    let num = |k: &str| d.and_then(|d| d.get(k)).and_then(Value::as_u64).map(|v| v as u32);
    match (num("min"), num("max")) {
        (Some(lo), Some(hi)) if lo <= hi => (lo, hi),
        _ => (MUSIC_MIN_SECS, MUSIC_MAX_SECS),
    }
}

/// The fields of a kind, in the JSON-Schema shape the phone reads for cloud
/// models (`properties`, `required`, `x-order-properties`). `characters`:
/// the ids the field `character` takes, empty when the kind takes none here.
fn kind_schema(kind: Kind, models: &[String], characters: &[String], caps: Option<&Value>) -> Value {
    let mut props = serde_json::Map::new();
    let mut order: Vec<&str> = Vec::new();
    let mut required: Vec<&str> = Vec::new();
    if kind == Kind::Edit {
        props.insert(
            "input_ids".into(),
            json!({ "type": "array", "items": { "type": "string", "format": "upload-id" }, "minItems": 1, "maxItems": max_edit_inputs(caps), "title": "Images" }),
        );
        order.push("input_ids");
        required.push("input_ids");
        props.insert("mask_id".into(), json!({ "type": "string", "format": "upload-id", "title": "Mask" }));
        order.push("mask_id");
    } else if kind.needs_input() {
        props.insert("input_id".into(), json!({ "type": "string", "format": "upload-id", "title": if kind.is_video() { "Start image" } else { "Source image" } }));
        order.push("input_id");
        required.push("input_id");
    }
    if kind.takes_prompt() {
        props.insert("prompt".into(), json!({ "type": "string", "maxLength": MAX_PROMPT_CHARS, "title": if kind == Kind::Music { "Style" } else { "Prompt" } }));
        order.push("prompt");
        if kind.needs_prompt() {
            required.push("prompt");
        }
    }
    if kind == Kind::Music {
        props.insert("lyrics".into(), json!({ "type": "string", "maxLength": MAX_LYRICS_CHARS, "title": "Lyrics" }));
        order.push("lyrics");
        let (lo, hi) = music_bounds(caps);
        let mut d = json!({ "type": "integer", "minimum": lo, "maximum": hi, "title": "Duration (seconds)" });
        if let Some(def) = caps.and_then(|c| c.pointer("/kinds/music/duration/default")).and_then(Value::as_u64) {
            d["default"] = json!(def);
        }
        props.insert("duration".into(), d);
        order.push("duration");
    }
    if kind == Kind::Upscale {
        props.insert("factor".into(), json!({ "type": "integer", "enum": [2, 4], "default": 2, "title": "Factor" }));
        order.push("factor");
    }
    if kind.takes_sampling() && kind != Kind::Edit {
        props.insert("negative".into(), json!({ "type": "string", "maxLength": MAX_NEGATIVE_CHARS, "title": "Negative prompt" }));
        order.push("negative");
    }
    if kind != Kind::RemoveBg {
        let mut model = json!({ "type": "string", "title": "Model" });
        if !models.is_empty() {
            model["enum"] = json!(models);
            model["default"] = json!(models[0]);
        }
        props.insert("model".into(), model);
        order.push("model");
    }
    if !characters.is_empty() {
        props.insert("character".into(), json!({ "type": "string", "enum": characters, "title": "Character" }));
        order.push("character");
    }
    if kind.takes_sampling() {
        // The size each model's family starts at on the desktop (SD 1.5 at
        // 512, SDXL and Flux at 1024): the default is the first model's, the
        // rest is in `x-model-sizes` by model id, with a `note` where a size
        // above `recommended_max` gets slow.
        let entries = caps.map(|c| model_entries(c, kind)).unwrap_or_default();
        let first = entries.first();
        for side in ["width", "height"] {
            let mut s = json!({ "type": "integer", "minimum": MIN_SIDE, "maximum": MAX_SIDE, "multipleOf": 8, "title": if side == "width" { "Width" } else { "Height" } });
            if let Some(d) = first.and_then(|m| m.get(side)).and_then(Value::as_u64) {
                s["default"] = json!(d);
            } else if kind == Kind::Image {
                s["default"] = json!(1024);
            }
            if let Some(note) = first.and_then(|m| m.get("note")) {
                s["note"] = note.clone();
            }
            props.insert(side.into(), s);
            order.push(side);
        }
        props.insert("steps".into(), json!({ "type": "integer", "minimum": 1, "maximum": MAX_STEPS, "title": "Steps" }));
        order.push("steps");
    }
    if kind != Kind::RemoveBg {
        props.insert("seed".into(), json!({ "type": "integer", "minimum": 0, "maximum": MAX_SEED, "title": "Seed" }));
        order.push("seed");
    }
    if kind.max_count() > 1 || kind.is_video() {
        props.insert("count".into(), json!({ "type": "integer", "minimum": 1, "maximum": kind.max_count(), "default": 1, "title": "Count" }));
        order.push("count");
    }
    let mut schema = json!({ "type": "object", "properties": props, "required": required, "x-order-properties": order });
    if kind.takes_sampling() {
        let sizes: serde_json::Map<String, Value> = caps
            .map(|c| model_entries(c, kind))
            .unwrap_or_default()
            .into_iter()
            .filter_map(|m| {
                let id = m.get("id")?.as_str()?.to_string();
                let mut size = json!({ "width": m.get("width")?, "height": m.get("height")? });
                for k in ["recommended_max", "note"] {
                    if let Some(v) = m.get(k) {
                        size[k] = v.clone();
                    }
                }
                Some((id, size))
            })
            .collect();
        if !sizes.is_empty() {
            schema["x-model-sizes"] = Value::Object(sizes);
        }
    }
    schema
}

// ─── Files ───

/// What an upload is, by its first bytes.
fn image_kind(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("png", "image/png"))
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(("jpg", "image/jpeg"))
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("webp", "image/webp"))
    } else {
        None
    }
}

/// What a result is, by its first bytes. Anything else is not served.
fn media_mime(head: &[u8]) -> Option<&'static str> {
    if let Some((_, mime)) = image_kind(head) {
        return Some(mime);
    }
    if head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if head.len() >= 12 && &head[4..8] == b"ftyp" {
        return Some(if &head[8..10] == b"qt" { "video/quicktime" } else { "video/mp4" });
    }
    if head.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return Some("video/webm");
    }
    // Music (CREATE-V2.md): WAV from the Mac's engine, MP3 from ComfyUI's
    // SaveAudioMP3, FLAC from ComfyUI's SaveAudio.
    if head.len() >= 12 && &head[..4] == b"RIFF" && &head[8..12] == b"WAVE" {
        return Some("audio/wav");
    }
    if head.starts_with(b"fLaC") {
        return Some("audio/flac");
    }
    if head.starts_with(b"ID3") || (head.len() >= 2 && head[0] == 0xFF && head[1] & 0xE0 == 0xE0) {
        return Some("audio/mpeg");
    }
    None
}

/// How long a track plays, from its header: WAV and FLAC exactly, MP3 from
/// its first frame (a Xing/Info frame count, else the constant bit rate).
/// `None` when the header does not tell.
fn audio_duration_ms(mime: &str, file: &mut std::fs::File, len: u64) -> Option<u64> {
    let mut head = vec![0u8; 64 * 1024];
    file.seek(SeekFrom::Start(0)).ok()?;
    let n = file.read(&mut head).ok()?;
    head.truncate(n);
    match mime {
        "audio/wav" => wav_duration_ms(&head, len),
        "audio/flac" => flac_duration_ms(&head),
        "audio/mpeg" => mp3_duration_ms(&head, len),
        _ => None,
    }
}

fn le_u32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn wav_duration_ms(head: &[u8], len: u64) -> Option<u64> {
    let mut at = 12;
    let mut byte_rate = None;
    while at + 8 <= head.len() {
        let id = &head[at..at + 4];
        let size = le_u32(head, at + 4)? as usize;
        if id == b"fmt " {
            byte_rate = le_u32(head, at + 16).filter(|r| *r > 0);
        } else if id == b"data" {
            let data = if size == 0 || size as u64 > len { len.saturating_sub((at + 8) as u64) } else { size as u64 };
            return byte_rate.map(|r| data * 1000 / r as u64);
        }
        at += 8 + size + (size & 1);
    }
    None
}

fn flac_duration_ms(head: &[u8]) -> Option<u64> {
    // STREAMINFO is the first block: 4 bytes marker, 4 bytes block header.
    let info = head.get(8..8 + 18)?;
    let rate = ((info[10] as u64) << 12) | ((info[11] as u64) << 4) | ((info[12] as u64) >> 4);
    let samples = (((info[13] & 0x0F) as u64) << 32) | u32::from_be_bytes(info[14..18].try_into().ok()?) as u64;
    (rate > 0 && samples > 0).then(|| samples * 1000 / rate)
}

fn mp3_duration_ms(head: &[u8], len: u64) -> Option<u64> {
    let mut at = 0usize;
    if head.starts_with(b"ID3") && head.len() >= 10 {
        let size = head[6..10].iter().fold(0usize, |acc, b| (acc << 7) | (*b as usize & 0x7F));
        at = 10 + size;
    }
    while at + 4 <= head.len() && !(head[at] == 0xFF && head[at + 1] & 0xE0 == 0xE0) {
        at += 1;
    }
    let h = head.get(at..at + 4)?;
    let version = (h[1] >> 3) & 0x03; // 3: MPEG 1, 2: MPEG 2, 0: MPEG 2.5
    let layer = (h[1] >> 1) & 0x03; // 1: layer III
    if layer != 1 || version == 1 {
        return None;
    }
    const RATES_V1: [u64; 16] = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
    const RATES_V2: [u64; 16] = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
    let kbps = if version == 3 { RATES_V1 } else { RATES_V2 }[(h[2] >> 4) as usize];
    let base = [44100u64, 48000, 32000, 0][((h[2] >> 2) & 0x03) as usize];
    let sample_rate = match version { 3 => base, 2 => base / 2, _ => base / 4 };
    if kbps == 0 || sample_rate == 0 {
        return None;
    }
    let mono = (h[3] >> 6) == 3;
    let side = match (version == 3, mono) { (true, false) => 32, (true, true) => 17, (false, false) => 17, (false, true) => 9 };
    let samples_per_frame: u64 = if version == 3 { 1152 } else { 576 };
    let xing = at + 4 + side;
    if let Some(tag) = head.get(xing..xing + 12) {
        if (&tag[..4] == b"Xing" || &tag[..4] == b"Info") && tag[7] & 0x01 != 0 {
            let frames = u32::from_be_bytes(tag[8..12].try_into().ok()?) as u64;
            return Some(frames * samples_per_frame * 1000 / sample_rate);
        }
    }
    Some(len.saturating_sub(at as u64) * 8 / kbps)
}

fn write_by_content(dir: &Path, bytes: &[u8], ext: &str) -> Result<PathBuf, String> {
    use sha2::{Digest, Sha256};
    let hash: String = Sha256::digest(bytes).iter().take(16).map(|b| format!("{b:02x}")).collect();
    let path = dir.join(format!("{hash}.{ext}"));
    // Already there: only a plain file counts, never a link.
    if std::fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_file()) {
        return Ok(path);
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create the upload folder: {}", crate::os_error::english(&e)))?;
    // Only this user may look into or write the upload folder.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Could not protect the upload folder: {}", crate::os_error::english(&e)))?;
    }
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|e| format!("Could not store the upload: {}", crate::os_error::english(&e)))?;
    std::io::Write::write_all(&mut tmp, bytes).map_err(|e| format!("Could not store the upload: {}", crate::os_error::english(&e)))?;
    tmp.persist(&path).map_err(|e| format!("Could not store the upload: {}", crate::os_error::english(&e.error)))?;
    Ok(path)
}

/// A result the window reports: an absolute path from a local engine, or a
/// file name in ComfyUI's output folder.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputRef {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub comfy_filename: Option<String>,
    #[serde(default)]
    pub comfy_subfolder: Option<String>,
}

/// Where an output really is, or why it is refused. Only an existing file
/// inside one of `roots` passes, symlinks followed.
fn resolve_output(out: &OutputRef, roots: &[PathBuf], comfy: Option<&Path>) -> Result<PathBuf, String> {
    let candidate = if let Some(p) = out.path.as_deref().filter(|p| !p.is_empty()) {
        let p = PathBuf::from(p);
        if !p.is_absolute() {
            return Err("A result path must be absolute.".to_string());
        }
        p
    } else if let Some(name) = out.comfy_filename.as_deref() {
        let dir = comfy.ok_or_else(|| "ComfyUI's output folder is not known on this computer.".to_string())?;
        #[cfg(desktop)]
        let found = crate::commands::gallery_files::output_file(dir, name, out.comfy_subfolder.as_deref().unwrap_or(""));
        // A phone is never the host of Remote, and has no ComfyUI folder.
        #[cfg(mobile)]
        let found: Option<PathBuf> = {
            let _ = (dir, name);
            None
        };
        found.ok_or_else(|| "That name does not point into ComfyUI's output folder.".to_string())?
    } else {
        return Err("The result names no file.".to_string());
    };
    for root in roots {
        if let Ok(inside) = crate::commands::filesystem::contain_within(root, &candidate) {
            if inside.is_file() {
                return std::fs::canonicalize(&inside).map_err(|e| crate::os_error::english(&e));
            }
        }
    }
    Err("The result is not a file in an output folder of this computer.".to_string())
}

fn describe_file(path: &Path) -> Result<ResultFile, String> {
    describe(path, true, "res")
}

/// What a media file is: its type by its first bytes, size, picture size or
/// track length, and with `hash` its SHA-256 over every byte read once.
/// Without `hash` the size comes from the metadata and `sha256` stays empty
/// (a gallery list hashes a file only when it is fetched).
fn describe(path: &Path, hash: bool, prefix: &str) -> Result<ResultFile, String> {
    use sha2::{Digest, Sha256};
    let mut file = open_no_follow(path).map_err(|e| format!("Could not open the result: {}", crate::os_error::english(&e)))?;
    let ident = FileIdent::of(&file.metadata().map_err(|e| crate::os_error::english(&e))?);
    let mut head = [0u8; 32];
    let n = file.read(&mut head).map_err(|e| crate::os_error::english(&e))?;
    let mime = media_mime(&head[..n]).ok_or_else(|| "The result is not an image, a video or a track.".to_string())?;
    let (bytes, sha256) = if hash {
        file.seek(SeekFrom::Start(0)).map_err(|e| crate::os_error::english(&e))?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 1024 * 1024];
        let mut bytes = 0u64;
        loop {
            let n = file.read(&mut buf).map_err(|e| crate::os_error::english(&e))?;
            if n == 0 {
                break;
            }
            bytes += n as u64;
            hasher.update(&buf[..n]);
        }
        (bytes, hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
    } else {
        (ident.len, String::new())
    };
    let (width, height) = if mime.starts_with("image/") {
        image::ImageReader::open(path)
            .ok()
            .and_then(|r| r.with_guessed_format().ok())
            .and_then(|r| r.into_dimensions().ok())
            .map(|(w, h)| (Some(w), Some(h)))
            .unwrap_or((None, None))
    } else {
        (None, None)
    };
    let duration_ms = if mime.starts_with("audio/") { audio_duration_ms(mime, &mut file, bytes) } else { None };
    if ident.len != bytes {
        return Err("The result changed while it was read.".to_string());
    }
    Ok(ResultFile { id: new_id(prefix), path: path.to_path_buf(), mime: mime.to_string(), bytes, width, height, duration_ms, sha256, ident })
}

/// The SHA-256 of a file that must still be the one `file` describes.
fn hash_same_file(file: &ResultFile) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut f = open_no_follow(&file.path).map_err(|e| crate::os_error::english(&e))?;
    let meta = f.metadata().map_err(|e| crate::os_error::english(&e))?;
    if FileIdent::of(&meta) != file.ident {
        return Err("The file changed on the computer.".to_string());
    }
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    let mut bytes = 0u64;
    loop {
        let n = f.read(&mut buf).map_err(|e| crate::os_error::english(&e))?;
        if n == 0 {
            break;
        }
        bytes += n as u64;
        hasher.update(&buf[..n]);
    }
    if bytes != file.bytes {
        return Err("The file changed on the computer.".to_string());
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// The gallery id of a desktop entry: the same for the same entry and file.
fn gallery_id(key: &str, path: &Path) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(key.as_bytes());
    h.update([0u8]);
    h.update(path.to_string_lossy().as_bytes());
    let hex: String = h.finalize().iter().take(16).map(|b| format!("{b:02x}")).collect();
    format!("gal_{hex}")
}

/// The window's gallery (`[{key, media, path | comfy_filename +
/// comfy_subfolder, prompt, model, created_at, from_phone}]`) as entries a
/// phone may fetch: only files inside the output folders, by the same rule
/// as a result, newest first, one per id. A hash already known for the same
/// file is carried over.
fn gallery_entries(raw: &Value, roots: &[PathBuf], comfy: Option<&Path>, old: &[GalleryEntry]) -> Vec<GalleryEntry> {
    let Some(items) = raw.as_array() else { return Vec::new() };
    let mut out: Vec<GalleryEntry> = Vec::new();
    for item in items.iter().take(MAX_GALLERY_ITEMS) {
        let text = |k: &str| item.get(k).and_then(Value::as_str).unwrap_or("");
        let key = clean_text(text("key"), 200);
        if key.is_empty() {
            continue;
        }
        let out_ref = OutputRef {
            path: Some(text("path").to_string()).filter(|p| !p.is_empty()),
            comfy_filename: Some(text("comfy_filename").to_string()).filter(|p| !p.is_empty()),
            comfy_subfolder: Some(text("comfy_subfolder").to_string()),
        };
        let Ok(path) = resolve_output(&out_ref, roots, comfy) else { continue };
        let id = gallery_id(&key, &path);
        if out.iter().any(|e| e.file.id == id) {
            continue;
        }
        // The same file as last time is not opened again.
        let now_ident = std::fs::symlink_metadata(&path).ok().filter(|m| m.is_file()).map(|m| FileIdent::of(&m));
        let known = old.iter().find(|e| e.file.id == id && Some(&e.file.ident) == now_ident.as_ref()).map(|e| e.file.clone());
        let file = match known {
            Some(f) => f,
            None => match describe(&path, false, "gal") {
                Ok(mut f) => {
                    f.id = id;
                    f
                }
                Err(_) => continue,
            },
        };
        let media = if file.mime.starts_with("audio/") {
            "audio"
        } else if file.mime.starts_with("video/") || text("media") == "video" {
            "video"
        } else {
            "image"
        };
        let created = item.get("created_at").and_then(Value::as_u64).unwrap_or(0);
        // The desktop keeps milliseconds.
        let created_at = if created > 100_000_000_000 { created / 1000 } else { created };
        out.push(GalleryEntry {
            file,
            media,
            created_at,
            prompt: clean_text(text("prompt"), MAX_PROMPT_CHARS),
            model: clean_text(text("model"), MAX_NAME_CHARS),
            from_phone: item.get("from_phone").and_then(Value::as_bool).unwrap_or(false),
        });
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| a.file.id.cmp(&b.file.id)));
    out
}

/// One page of the gallery after `before` (the id of the last entry of the
/// page before), and the cursor of the next page.
fn gallery_page(entries: &[GalleryEntry], before: Option<&str>, limit: usize) -> Result<(Vec<Value>, Option<String>), CreateError> {
    let start = match before.filter(|b| !b.is_empty()) {
        Some(b) => entries
            .iter()
            .position(|e| e.file.id == b)
            .map(|i| i + 1)
            .ok_or_else(|| CreateError::Bad("The gallery changed on the computer. Load it again from the start.".to_string()))?,
        None => 0,
    };
    let limit = limit.clamp(1, MAX_GALLERY_PAGE);
    let page: Vec<&GalleryEntry> = entries.iter().skip(start).take(limit).collect();
    let next = (start + page.len() < entries.len()).then(|| page.last().map(|e| e.file.id.clone())).flatten();
    Ok((page.iter().map(|e| e.view()).collect(), next))
}

/// A JPEG of at most [`THUMB_SIDE`] a side, from a file that is still the one
/// the entry describes: a picture decoded here, a clip's first frame from
/// `host` (ffmpeg or Quick Look, commands/video_thumb.rs). Audio has none,
/// nor a clip on a computer that cannot read it.
/// Previews made at once.
const THUMB_SLOTS: usize = 3;

/// What decoding a picture for a preview may take: the size the window can
/// make, and no more memory than a picture of that size needs.
fn thumb_decode_limits() -> image::Limits {
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_UPLOAD_SIDE.max(8192));
    limits.max_image_height = Some(MAX_UPLOAD_SIDE.max(8192));
    limits.max_alloc = Some(256 * 1024 * 1024);
    limits
}

fn make_thumb(file: &ResultFile, host: &dyn CreateHost) -> Result<Vec<u8>, StatusCode> {
    let video = file.mime.starts_with("video/");
    let picture = file.mime.starts_with("image/");
    if !(picture || video) || (picture && file.bytes > MAX_THUMB_SOURCE_BYTES) {
        return Err(StatusCode::NOT_FOUND);
    }
    let mut f = open_no_follow(&file.path).map_err(|_| StatusCode::GONE)?;
    let meta = f.metadata().map_err(|_| StatusCode::GONE)?;
    if FileIdent::of(&meta) != file.ident {
        return Err(StatusCode::GONE);
    }
    if video {
        let jpeg = host.video_frame(&file.path, THUMB_SIDE).ok_or(StatusCode::NOT_FOUND)?;
        // What came back is checked like a picture: a JPEG, no larger than asked.
        let (w, h) = image::ImageReader::new(std::io::Cursor::new(&jpeg))
            .with_guessed_format()
            .ok()
            .filter(|r| r.format() == Some(image::ImageFormat::Jpeg))
            .and_then(|r| r.into_dimensions().ok())
            .ok_or(StatusCode::NOT_FOUND)?;
        return if w <= THUMB_SIDE && h <= THUMB_SIDE { Ok(jpeg) } else { Err(StatusCode::NOT_FOUND) };
    }
    let mut bytes = Vec::with_capacity(file.bytes as usize);
    f.read_to_end(&mut bytes).map_err(|_| StatusCode::GONE)?;
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().map_err(|_| StatusCode::NOT_FOUND)?;
    reader.limits(thumb_decode_limits());
    let img = reader.decode().map_err(|_| StatusCode::NOT_FOUND)?;
    let small = img.thumbnail(THUMB_SIDE, THUMB_SIDE).to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80)
        .encode_image(&small)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(out)
}

/// Read one piece of a result, after checking it is still the file that was
/// reported: the same canonical place inside an output folder, opened
/// without following a link, and the same file (size, change time, on Unix
/// device and inode) as the one that was hashed.
fn read_piece(file: &ResultFile, offset: u64, length: u64, roots: &[PathBuf]) -> Result<Vec<u8>, StatusCode> {
    let canonical = std::fs::canonicalize(&file.path).map_err(|_| StatusCode::GONE)?;
    if canonical != file.path {
        return Err(StatusCode::GONE);
    }
    let inside = roots.iter().any(|root| {
        std::fs::canonicalize(root)
            .ok()
            .is_some_and(|r| crate::commands::filesystem::contain_within(&r, &canonical).is_ok())
    });
    if !inside {
        return Err(StatusCode::GONE);
    }
    let mut f = open_no_follow(&file.path).map_err(|_| StatusCode::GONE)?;
    let meta = f.metadata().map_err(|_| StatusCode::GONE)?;
    if !meta.is_file() || FileIdent::of(&meta) != file.ident {
        return Err(StatusCode::GONE);
    }
    if offset > file.bytes {
        return Err(StatusCode::RANGE_NOT_SATISFIABLE);
    }
    let take = length.min(file.bytes - offset);
    f.seek(SeekFrom::Start(offset)).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut buf = Vec::with_capacity(take as usize);
    f.take(take).read_to_end(&mut buf).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(buf)
}

// ─── HTTP ───

/// What the create routes need from the server state.
#[derive(Clone)]
pub(crate) struct CreateCtx {
    pub hub: Arc<CreateHub>,
    pub permissions: Arc<TokioMutex<RemotePermissions>>,
}

/// Who asks. `auth_middleware` sets `CallerDevice` for both ways in: the
/// JWT's device id on the plain LAN route, the paired device's id from the
/// request extension inside the sealed channel. The sealed caller carries the
/// device's own rights as well.
pub(crate) struct Caller {
    device: Option<String>,
    sealed: Option<SealedCaller>,
}

impl<S: Send + Sync> axum::extract::FromRequestParts<S> for Caller {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut axum::http::request::Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(Caller {
            device: parts.extensions.get::<CallerDevice>().map(|CallerDevice(id)| id.clone()),
            sealed: parts.extensions.get::<SealedCaller>().cloned(),
        })
    }
}

/// The device's own right (sealed channel), then the global switch, then the
/// caller. All behind `auth_middleware`, which checks the device right for
/// these paths already; this is the second lock on the same door.
#[allow(clippy::result_large_err)]
async fn guard(ctx: &CreateCtx, caller: &Caller) -> Result<String, Response> {
    if let Some(sealed) = &caller.sealed {
        if !sealed.rights.create {
            return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "forbidden", "right": "create" }))).into_response());
        }
    }
    if !ctx.permissions.lock().await.create {
        return Err(forbidden_response());
    }
    let Some(id) = caller.device.clone() else {
        return Err(StatusCode::UNAUTHORIZED.into_response());
    };
    ctx.hub.tick(now_secs()).await;
    Ok(id)
}

#[derive(Deserialize)]
pub(crate) struct JobBody {
    kind: String,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    negative: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    steps: Option<u32>,
    #[serde(default)]
    seed: Option<u64>,
    #[serde(default)]
    count: Option<u32>,
    #[serde(default)]
    input_id: Option<String>,
    #[serde(default)]
    input_ids: Option<Vec<String>>,
    #[serde(default)]
    mask_id: Option<String>,
    #[serde(default)]
    character: Option<String>,
    #[serde(default)]
    factor: Option<u32>,
    #[serde(default)]
    lyrics: Option<String>,
    #[serde(default)]
    duration: Option<u32>,
    #[serde(default)]
    client_request_id: Option<String>,
}

fn clean_request_id(raw: Option<String>) -> Result<Option<String>, CreateError> {
    let Some(raw) = raw.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) else { return Ok(None) };
    if raw.len() > 128 || !raw.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.:".contains(&b)) {
        return Err(CreateError::Bad("client_request_id must be up to 128 letters, digits, - _ . or :.".to_string()));
    }
    Ok(Some(raw))
}

pub(crate) async fn handle_capabilities(AxumState(ctx): AxumState<CreateCtx>, caller: Caller) -> Response {
    let owner = match guard(&ctx, &caller).await {
        Ok(o) => o,
        Err(r) => return r,
    };
    match ctx.hub.capabilities_for(&owner, now_secs()).await {
        Some((caps, stale)) => {
            let mut body = ctx.hub.capabilities_body_for(&caps, stale, caller.sealed.is_some());
            // A sealed message holds at most 8 MiB, the upload has to fit.
            if caller.sealed.is_some() {
                body["limits"]["max_upload_bytes"] = json!(MAX_SEALED_UPLOAD_BYTES);
            }
            Json(body).into_response()
        }
        None => error_response(StatusCode::SERVICE_UNAVAILABLE, "LU on the computer did not answer. Make sure LU is open on the computer and try again."),
    }
}

/// Stage 2 of Create, the gallery and documents are for the sealed channel
/// only (CREATE-V2.md); the plain Wi-Fi way keeps what 3.0.7 had.
fn sealed_only() -> Response {
    (StatusCode::FORBIDDEN, Json(json!({ "error": "sealed_only" }))).into_response()
}

/// A device with the right `chat` but not `create` uploads attachments for
/// its chats: no Create switch is asked, the limits are the same.
fn chat_only(caller: &Caller) -> bool {
    caller.sealed.as_ref().is_some_and(|c| c.rights.chat && !c.rights.create)
}

pub(crate) async fn handle_upload(AxumState(ctx): AxumState<CreateCtx>, caller: Caller, headers: axum::http::HeaderMap, body: Bytes) -> Response {
    let for_chat = chat_only(&caller);
    let owner = if for_chat {
        let Some(id) = caller.device.clone() else {
            return StatusCode::UNAUTHORIZED.into_response();
        };
        ctx.hub.tick(now_secs()).await;
        id
    } else {
        match guard(&ctx, &caller).await {
            Ok(o) => o,
            Err(r) => return r,
        }
    };
    if caller.sealed.is_none() && image_kind(&body).is_none() {
        return sealed_only();
    }
    let hub = ctx.hub.clone();
    let generation = caller.sealed.as_ref().map(|c| c.generation);
    let header = |k: &str| headers.get(k).and_then(|v| v.to_str().ok()).map(str::to_string);
    let (declared, name) = (header("content-type"), header("x-lu-filename"));
    match tokio::task::spawn_blocking(move || hub.add_file_with(&owner, generation, &body, declared.as_deref(), name.as_deref(), !for_chat)).await {
        Ok(Ok(v)) => (StatusCode::CREATED, Json(v)).into_response(),
        Ok(Err(e)) => e.into_response(),
        Err(_) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "The upload failed."),
    }
}

pub(crate) async fn handle_create_job(
    AxumState(ctx): AxumState<CreateCtx>,
    caller: Caller,
    body: Result<Json<JobBody>, JsonRejection>,
) -> Response {
    let owner = match guard(&ctx, &caller).await {
        Ok(o) => o,
        Err(r) => return r,
    };
    let Ok(Json(body)) = body else {
        return error_response(StatusCode::BAD_REQUEST, "The job is not valid JSON or misses `kind`.");
    };
    // Stage 2 (edit, upscale, removebg, music, a character) is for the
    // sealed channel only.
    let stage_two = Kind::parse(body.kind.trim()).is_some_and(|k| k.feature().is_some())
        || body.character.as_deref().is_some_and(|c| !c.trim().is_empty());
    if caller.sealed.is_none() && stage_two {
        return sealed_only();
    }
    let crid = match clean_request_id(body.client_request_id.clone()) {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };
    // The window's last word on what runs; asked once when there is none.
    let caps = match ctx.hub.cached_caps() {
        Some(c) => Some(c),
        None if Kind::parse(body.kind.trim()).is_some() => ctx.hub.capabilities_for(&owner, now_secs()).await.map(|(c, _)| c),
        None => None,
    };
    let spec = match ctx.hub.validate(body, caps.as_ref()) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };

    let generation = caller.sealed.as_ref().map(|c| c.generation);
    match ctx.hub.submit_as(&owner, generation, crid, spec, now_secs()) {
        Ok((view, duplicate)) => (if duplicate { StatusCode::OK } else { StatusCode::ACCEPTED }, Json(view)).into_response(),
        Err(e) => e.into_response(),
    }
}

pub(crate) async fn handle_get_job(AxumState(ctx): AxumState<CreateCtx>, caller: Caller, AxPath(id): AxPath<String>) -> Response {
    let owner = match guard(&ctx, &caller).await {
        Ok(o) => o,
        Err(r) => return r,
    };
    match ctx.hub.view(Some(&owner), &id) {
        Some(v) => Json(v).into_response(),
        None => CreateError::NotFound.into_response(),
    }
}

pub(crate) async fn handle_cancel_job(AxumState(ctx): AxumState<CreateCtx>, caller: Caller, AxPath(id): AxPath<String>) -> Response {
    let owner = match guard(&ctx, &caller).await {
        Ok(o) => o,
        Err(r) => return r,
    };
    match ctx.hub.cancel(Some(&owner), &id, now_secs()) {
        Some(v) => Json(v).into_response(),
        None => CreateError::NotFound.into_response(),
    }
}

#[derive(Deserialize)]
pub(crate) struct PieceQuery {
    #[serde(default)]
    offset: Option<u64>,
    #[serde(default)]
    length: Option<u64>,
}

pub(crate) async fn handle_result(
    AxumState(ctx): AxumState<CreateCtx>,
    caller: Caller,
    AxPath(id): AxPath<String>,
    Query(q): Query<PieceQuery>,
) -> Response {
    let owner = match guard(&ctx, &caller).await {
        Ok(o) => o,
        Err(r) => return r,
    };
    let Some(file) = ctx.hub.result_file(Some(&owner), &id) else {
        return CreateError::NotFound.into_response();
    };
    serve_piece(&ctx, file, q).await
}

/// One piece of a result or gallery file, raw, with its offset, total size
/// and hash in the head.
async fn serve_piece(ctx: &CreateCtx, file: ResultFile, q: PieceQuery) -> Response {
    let offset = q.offset.unwrap_or(0);
    let length = q.length.unwrap_or(MAX_CHUNK_BYTES).clamp(1, MAX_CHUNK_BYTES);
    let reading = file.clone();
    let roots = ctx.hub.host().result_roots();
    let piece = match tokio::task::spawn_blocking(move || read_piece(&reading, offset, length, &roots)).await {
        Ok(p) => p,
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    };
    match piece {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, file.mime.as_str())
            .header("x-lu-offset", offset.to_string())
            .header("x-lu-total-bytes", file.bytes.to_string())
            .header("x-lu-sha256", file.sha256.as_str())
            .body(Body::from(bytes))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
        Err(StatusCode::GONE) => error_response(StatusCode::GONE, "The result file changed or is gone on the computer."),
        Err(StatusCode::RANGE_NOT_SATISFIABLE) => error_response(StatusCode::RANGE_NOT_SATISFIABLE, "offset is past the end of the file."),
        Err(s) => error_response(s, "The result could not be read."),
    }
}

#[derive(Deserialize)]
pub(crate) struct GalleryQuery {
    #[serde(default)]
    before: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

const NO_GALLERY: &str = "LU on the computer did not answer. Make sure LU is open on the computer and try again.";

pub(crate) async fn handle_gallery(AxumState(ctx): AxumState<CreateCtx>, caller: Caller, Query(q): Query<GalleryQuery>) -> Response {
    if caller.sealed.is_none() {
        return sealed_only();
    }
    if let Err(r) = guard(&ctx, &caller).await {
        return r;
    }
    let now = now_secs();
    // The first page is always read anew; later pages keep the list the
    // cursor came from while it is fresh.
    let first = q.before.as_deref().is_none_or(str::is_empty);
    let Some(entries) = ctx.hub.gallery(now, first).await else {
        return error_response(StatusCode::SERVICE_UNAVAILABLE, NO_GALLERY);
    };
    match gallery_page(&entries, q.before.as_deref(), q.limit.unwrap_or(30)) {
        Ok((items, next)) => Json(json!({ "items": items, "next": next })).into_response(),
        Err(e) => e.into_response(),
    }
}

/// The entry's hash, made once and then remembered.
#[allow(clippy::result_large_err)]
async fn gallery_hash(ctx: &CreateCtx, entry: &GalleryEntry) -> Result<String, Response> {
    if !entry.file.sha256.is_empty() {
        return Ok(entry.file.sha256.clone());
    }
    let file = entry.file.clone();
    match tokio::task::spawn_blocking(move || hash_same_file(&file)).await {
        Ok(Ok(h)) => {
            ctx.hub.remember_gallery_hash(&entry.file.id, &entry.file.ident, &h);
            Ok(h)
        }
        _ => Err(error_response(StatusCode::GONE, "The file changed or is gone on the computer.")),
    }
}

pub(crate) async fn handle_gallery_item(AxumState(ctx): AxumState<CreateCtx>, caller: Caller, AxPath(id): AxPath<String>) -> Response {
    if caller.sealed.is_none() {
        return sealed_only();
    }
    if let Err(r) = guard(&ctx, &caller).await {
        return r;
    }
    let Some(mut entry) = ctx.hub.gallery_entry(&id, now_secs()).await else {
        return CreateError::NotFound.into_response();
    };
    match gallery_hash(&ctx, &entry).await {
        Ok(h) => entry.file.sha256 = h,
        Err(r) => return r,
    }
    Json(entry.view()).into_response()
}

pub(crate) async fn handle_gallery_thumb(AxumState(ctx): AxumState<CreateCtx>, caller: Caller, AxPath(id): AxPath<String>) -> Response {
    if caller.sealed.is_none() {
        return sealed_only();
    }
    if let Err(r) = guard(&ctx, &caller).await {
        return r;
    }
    let Some(entry) = ctx.hub.gallery_entry(&id, now_secs()).await else {
        return CreateError::NotFound.into_response();
    };
    let key = format!("{}:{}", entry.file.id, entry.file.bytes);
    let file = entry.file.clone();
    let host = ctx.hub.host();
    let jpeg = match ctx.hub.thumb_for(&key, move || make_thumb(&file, host.as_ref())).await {
        Ok(j) => j,
        Err(StatusCode::GONE) => return error_response(StatusCode::GONE, "The file changed or is gone on the computer."),
        Err(_) => return error_response(StatusCode::NOT_FOUND, "There is no preview for this entry."),
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/jpeg")
        .body(Body::from(jpeg))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

pub(crate) async fn handle_gallery_file(
    AxumState(ctx): AxumState<CreateCtx>,
    caller: Caller,
    AxPath(id): AxPath<String>,
    Query(q): Query<PieceQuery>,
) -> Response {
    if caller.sealed.is_none() {
        return sealed_only();
    }
    if let Err(r) = guard(&ctx, &caller).await {
        return r;
    }
    let Some(mut entry) = ctx.hub.gallery_entry(&id, now_secs()).await else {
        return CreateError::NotFound.into_response();
    };
    match gallery_hash(&ctx, &entry).await {
        Ok(h) => entry.file.sha256 = h,
        Err(r) => return r,
    }
    serve_piece(&ctx, entry.file, q).await
}

/// Cancels a job when the call that waits for it is dropped before the job
/// ended (a deferred answer the phone gave up, a device that was unpaired).
struct CancelOnDrop<'a> {
    hub: &'a CreateHub,
    owner: &'a str,
    id: String,
    armed: bool,
}

impl Drop for CancelOnDrop<'_> {
    fn drop(&mut self) {
        if self.armed {
            self.hub.cancel(Some(self.owner), &self.id, now_secs());
        }
    }
}

/// The remote agent's `image_generate` / `video_generate`: the same job as
/// the Create routes, held open until it is through. `cancel_on_drop`: the
/// job ends when this call is dropped before it (the sealed channel, where
/// the call runs as a deferred answer that the phone can give up).
pub(crate) async fn run_for_agent(hub: &CreateHub, owner: &str, generation: Option<u64>, kind: Kind, args: &Value, cancel_on_drop: bool) -> Value {
    let prompt = args.get("prompt").or_else(|| args.get("description")).and_then(Value::as_str).unwrap_or("");
    let settings = args.get("settings");
    let num = |key: &str| args.get(key).or_else(|| settings.and_then(|s| s.get(key))).and_then(Value::as_u64);
    let text = |key: &str| args.get(key).or_else(|| settings.and_then(|s| s.get(key))).and_then(Value::as_str);
    // An input image is an upload of this phone (`POST /remote-api/create/
    // uploads`), named by its id in `input_id` or `inputImage`. A file name
    // or path of the desktop is never taken from a phone.
    let input = ["input_id", "inputImage", "input_image"].iter().find_map(|k| text(k)).map(str::trim).filter(|s| !s.is_empty());
    let kind = match (kind, input) {
        (_, None) => kind,
        (_, Some(id)) if !is_our_id(id, "upl") => {
            return json!({ "error": "The input image must be an upload id (upl_...) from POST /remote-api/create/uploads. Upload the image from the phone first." })
        }
        (Kind::Image, Some(_)) => Kind::ImageToImage,
        (Kind::Video, Some(_)) => Kind::ImageToVideo,
        (k, Some(_)) => k,
    };
    let mut spec = JobSpec::text(kind, prompt);
    if spec.prompt.is_empty() && !kind.is_video() {
        return json!({ "error": "image_generate needs a non-empty `prompt` argument." });
    }
    if let Some(id) = input {
        spec.input_ids = vec![id.to_string()];
    }
    if let Some(c) = text("character").map(|c| clean_text(c, MAX_NAME_CHARS)).filter(|c| !c.is_empty()) {
        if !kind.takes_character() {
            return json!({ "error": "A character works from text only, without an input image." });
        }
        spec.character = Some(c);
    }
    if let Some(caps) = hub.cached_caps() {
        let (available, reason) = availability(&caps, kind);
        if !available {
            return json!({ "error": reason });
        }
        if let Some(c) = &spec.character {
            if !kind_flag(&caps, kind, "character") || !characters_of(&caps).iter().any(|x| x["id"].as_str() == Some(c.as_str()) || x["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(c))) {
                let names: Vec<&str> = characters_of_names(&caps);
                return json!({ "error": if names.is_empty() { "There are no trained characters on this computer.".to_string() } else { format!("No character \"{c}\" on this computer. Available: {}.", names.join(", ")) } });
            }
        }
    }
    spec.model = text("model").map(|m| clean_text(m, MAX_NAME_CHARS)).filter(|m| !m.is_empty());
    spec.negative = text("negativePrompt").map(|n| clean_text(n, MAX_NEGATIVE_CHARS)).unwrap_or_default();
    let side = |v: Option<u64>| v.map(|v| (v.clamp(MIN_SIDE as u64, MAX_SIDE as u64) as u32) / 8 * 8);
    spec.width = side(num("width"));
    spec.height = side(num("height"));
    spec.steps = num("steps").map(|s| s.clamp(1, MAX_STEPS as u64) as u32);
    spec.seed = num("seed").filter(|s| *s <= MAX_SEED);
    let id = match hub.submit_as(owner, generation, None, spec, now_secs()) {
        Ok((v, _)) => v["id"].as_str().unwrap_or_default().to_string(),
        Err(CreateError::Busy(m)) | Err(CreateError::Bad(m)) => return json!({ "error": m }),
        Err(CreateError::Off) | Err(CreateError::Gone) => return json!({ "error": "Create is not allowed for this phone on this computer." }),
        Err(_) => return json!({ "error": "The job could not be started." }),
    };
    let mut held = CancelOnDrop { hub, owner, id: id.clone(), armed: cancel_on_drop };
    let out = wait_for_agent_job(hub, owner, kind, &id).await;
    held.armed = false;
    out
}

async fn wait_for_agent_job(hub: &CreateHub, owner: &str, kind: Kind, id: &str) -> Value {
    let deadline = now_secs() + if kind.is_video() { 70 * 60 } else { 20 * 60 };
    loop {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let now = now_secs();
        hub.tick(now).await;
        let Some(view) = hub.view(Some(owner), id) else {
            return json!({ "error": "The job is gone on the computer." });
        };
        match view["state"].as_str().unwrap_or("") {
            "done" => {
                let results = view["results"].clone();
                let n = results.as_array().map(|a| a.len()).unwrap_or(0);
                let what = if kind.is_video() { "Video" } else { "Image" };
                return json!({
                    "content": format!("{what} generated on the computer: {n} file(s) in job {id}. Fetch them from /remote-api/create/results/<id>."),
                    "job_id": id,
                    "results": results,
                });
            }
            "failed" => return json!({ "error": view["error"].as_str().unwrap_or("The generation failed."), "job_id": id }),
            "cancelled" => return json!({ "error": "The generation was cancelled.", "job_id": id }),
            _ => {}
        }
        if now > deadline {
            hub.cancel(Some(owner), id, now);
            return json!({ "error": "The generation took too long and was stopped.", "job_id": id });
        }
    }
}

// ─── The real desktop ───

pub(crate) struct TauriCreateHost {
    app: tauri::AppHandle,
    tool: Tool,
}

impl TauriCreateHost {
    pub(crate) fn new(app: tauri::AppHandle) -> Self {
        TauriCreateHost { app, tool: Tool::this_machine() }
    }

    fn comfy_base(&self) -> Option<PathBuf> {
        use tauri::Manager;
        let state = self.app.try_state::<crate::state::AppState>()?;
        let mut p = state.comfy_path.lock().ok()?;
        if p.is_none() {
            *p = crate::commands::process::find_comfyui_path();
        }
        p.clone().map(PathBuf::from)
    }
}

impl CreateHost for TauriCreateHost {
    fn emit(&self, payload: Value) {
        use tauri::Emitter;
        let _ = self.app.emit(EVENT, payload);
    }

    fn abort_engine(&self, kind: Kind) {
        use tauri::Manager;
        // ComfyUI: the window ends exactly its own prompt by id
        // (requestGenerationCancel, abandonPrompt). A blanket /interrupt from
        // here would also end a render the desktop user started.
        if self.tool != Tool::Mlx {
            return;
        }
        let Some(state) = self.app.try_state::<crate::state::AppState>() else { return };
        let _ = if kind.is_video() {
            crate::commands::video::video_cancel(&state, &json!({}))
        } else {
            crate::commands::mlx::mlx_generate_cancel(&state, &json!({}))
        };
    }

    fn engine_busy(&self, kind: Kind) -> BoxFuture<Option<bool>> {
        use tauri::Manager;
        let app = self.app.clone();
        let tool = self.tool;
        Box::pin(async move {
            let state = app.try_state::<crate::state::AppState>()?;
            match tool {
                Tool::Mlx => {
                    let v = if kind.is_video() {
                        crate::commands::video::video_progress(&state, &json!({})).ok()?
                    } else {
                        crate::commands::mlx::mlx_generate_progress(&state, &json!({})).ok()?
                    };
                    v.get("running").and_then(Value::as_bool)
                }
                Tool::Comfyui => {
                    let port = state.comfy_port.lock().map(|g| *g).unwrap_or(0);
                    if port == 0 {
                        return None;
                    }
                    let host = state.comfy_host.lock().map(|g| g.clone()).unwrap_or_else(|_| "localhost".to_string());
                    let client = reqwest::Client::builder().timeout(Duration::from_secs(2)).no_proxy().build().ok()?;
                    let q: Value = client.get(format!("http://{host}:{port}/queue")).send().await.ok()?.json().await.ok()?;
                    let len = |k: &str| q.get(k).and_then(Value::as_array).map(|a| a.len()).unwrap_or(0);
                    Some(len("queue_running") + len("queue_pending") > 0)
                }
            }
        })
    }

    fn engine_progress(&self, kind: Kind) -> Option<(u32, u32)> {
        use tauri::Manager;
        if self.tool != Tool::Mlx || kind.is_video() {
            return None;
        }
        let state = self.app.try_state::<crate::state::AppState>()?;
        let v = crate::commands::mlx::mlx_generate_progress(&state, &json!({})).ok()?;
        if v.get("running").and_then(Value::as_bool) != Some(true) {
            return None;
        }
        Some((v.get("step")?.as_u64()? as u32, v.get("steps")?.as_u64()? as u32))
    }

    fn result_roots(&self) -> Vec<PathBuf> {
        let mut roots = vec![crate::commands::mlx::images_root(), crate::commands::video::outputs_root(), crate::commands::music::outputs_root()];
        if let Some(out) = self.comfy_output_dir() {
            roots.push(out);
        }
        roots
    }

    fn comfy_output_dir(&self) -> Option<PathBuf> {
        self.comfy_base().map(|b| b.join("output"))
    }

    fn uploads_dir(&self) -> PathBuf {
        default_uploads_dir()
    }

    fn discard_upload(&self, path: &Path) {
        // The copy in ComfyUI's input folder carries the upload's name.
        if let (Some(base), Some(name)) = (self.comfy_base(), path.file_name().and_then(|n| n.to_str())) {
            let input = base.join("input");
            remove_own_upload(&input, &input.join(format!("lu_remote_{name}")));
        }
        remove_own_upload(&default_uploads_dir(), path);
    }

    fn video_frame(&self, path: &Path, side: u32) -> Option<Vec<u8>> {
        crate::commands::video_thumb::first_frame_jpeg(path, side, self.comfy_base().as_deref())
    }

    fn stage_input(&self, path: &Path) -> Result<Value, String> {
        match self.tool {
            Tool::Mlx => {
                // The Mac's engines read an image only from the folder Create
                // stages in (`video_stage_start_image`): an edit, an enhance
                // and a cutout refuse any other. The upload is named by its
                // content already, the copy keeps that name.
                let name = path.file_name().and_then(|n| n.to_str()).ok_or_else(|| "The upload has no name.".to_string())?;
                let dir = crate::commands::video::outputs_root().join("start-images");
                std::fs::create_dir_all(&dir).map_err(|e| crate::os_error::english(&e))?;
                let target = dir.join(name);
                if !std::fs::symlink_metadata(&target).is_ok_and(|m| m.file_type().is_file()) {
                    let mut tmp = tempfile::NamedTempFile::new_in(&dir).map_err(|e| crate::os_error::english(&e))?;
                    let mut src = open_no_follow(path).map_err(|e| crate::os_error::english(&e))?;
                    std::io::copy(&mut src, &mut tmp).map_err(|e| crate::os_error::english(&e))?;
                    tmp.persist(&target).map_err(|e| crate::os_error::english(&e.error))?;
                }
                Ok(json!({ "input_path": target.to_string_lossy() }))
            }
            Tool::Comfyui => {
                // LoadImage reads ComfyUI's input folder; the window fetches it
                // from there through /view?type=input.
                let base = self.comfy_base().ok_or_else(|| "ComfyUI is not installed on this computer.".to_string())?;
                let name = format!("lu_remote_{}", path.file_name().and_then(|n| n.to_str()).unwrap_or("input.png"));
                let dir = base.join("input");
                std::fs::create_dir_all(&dir).map_err(|e| crate::os_error::english(&e))?;
                let target = dir.join(&name);
                if !target.is_file() {
                    std::fs::copy(path, &target).map_err(|e| crate::os_error::english(&e))?;
                }
                Ok(json!({ "input_comfy_name": name }))
            }
        }
    }
}

// ─── Tauri commands for the window ───

fn hub_of(state: &crate::state::AppState) -> Result<Arc<CreateHub>, String> {
    state.remote.lock().map(|r| r.create.clone()).map_err(|_| "Remote state unavailable".to_string())
}

/// The window reports on a job. `false`: stop, the job no longer runs.
#[tauri::command]
pub fn remote_create_progress(
    state: tauri::State<'_, crate::state::AppState>,
    id: String,
    progress: Option<f64>,
    step_text: Option<String>,
    index: Option<u32>,
) -> Result<bool, String> {
    Ok(hub_of(&state)?.progress(&id, progress, step_text, index, now_secs()))
}

/// The window is through with a job.
#[tauri::command]
pub async fn remote_create_finish(
    state: tauri::State<'_, crate::state::AppState>,
    id: String,
    ok: bool,
    error: Option<String>,
    outputs: Vec<OutputRef>,
) -> Result<Value, String> {
    let hub = hub_of(&state)?;
    tauri::async_runtime::spawn_blocking(move || hub.finish(&id, ok, error, outputs, now_secs()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn remote_create_capabilities_reply(
    state: tauri::State<'_, crate::state::AppState>,
    request_id: String,
    capabilities: Value,
) -> Result<bool, String> {
    Ok(hub_of(&state)?.capabilities_reply(&request_id, capabilities))
}

/// The window answers a gallery question (`action: gallery`).
#[tauri::command]
pub fn remote_create_gallery_reply(
    state: tauri::State<'_, crate::state::AppState>,
    request_id: String,
    items: Value,
) -> Result<bool, String> {
    Ok(hub_of(&state)?.gallery_reply(&request_id, items))
}

/// Cancel from the desktop bar.
#[tauri::command]
pub fn remote_create_cancel(state: tauri::State<'_, crate::state::AppState>, id: String) -> Result<Value, String> {
    hub_of(&state)?.cancel(None, &id, now_secs()).ok_or_else(|| "No such job.".to_string())
}

/// What the desktop bar shows, for a window that mounts while a job runs.
#[tauri::command]
pub fn remote_create_snapshot(state: tauri::State<'_, crate::state::AppState>) -> Result<Value, String> {
    Ok(hub_of(&state)?.snapshot())
}

// ─── Tests ───

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use axum::routing::{get, post};
    use axum::Router;

    /// Stands in for the desktop: records what the hub asks of it.
    #[derive(Default)]
    pub(crate) struct FakeHost {
        pub events: Mutex<Vec<Value>>,
        pub aborts: Mutex<Vec<Kind>>,
        pub roots: Vec<PathBuf>,
        pub uploads: PathBuf,
        pub busy: Option<bool>,
        pub discarded: Mutex<Vec<PathBuf>>,
        /// What `video_frame` answers.
        pub frame: Option<Vec<u8>>,
    }

    impl CreateHost for FakeHost {
        fn emit(&self, payload: Value) {
            lock(&self.events).push(payload);
        }
        fn abort_engine(&self, kind: Kind) {
            lock(&self.aborts).push(kind);
        }
        fn engine_busy(&self, _kind: Kind) -> BoxFuture<Option<bool>> {
            let b = self.busy;
            Box::pin(async move { b })
        }
        fn engine_progress(&self, _kind: Kind) -> Option<(u32, u32)> {
            None
        }
        fn result_roots(&self) -> Vec<PathBuf> {
            self.roots.clone()
        }
        fn comfy_output_dir(&self) -> Option<PathBuf> {
            self.roots.first().cloned()
        }
        fn uploads_dir(&self) -> PathBuf {
            self.uploads.clone()
        }
        fn stage_input(&self, path: &Path) -> Result<Value, String> {
            Ok(json!({ "input_path": path.to_string_lossy() }))
        }
        fn discard_upload(&self, path: &Path) {
            lock(&self.discarded).push(path.to_path_buf());
            remove_own_upload(&self.uploads, path);
        }
        fn video_frame(&self, _path: &Path, _side: u32) -> Option<Vec<u8>> {
            self.frame.clone()
        }
    }

    impl FakeHost {
        fn actions(&self, action: &str) -> Vec<Value> {
            lock(&self.events).iter().filter(|e| e["action"] == action).cloned().collect()
        }
    }

    struct Rig {
        hub: Arc<CreateHub>,
        host: Arc<FakeHost>,
        out: tempfile::TempDir,
        _up: tempfile::TempDir,
    }

    fn rig_with(tool: Tool, busy: Option<bool>) -> Rig {
        let out = tempfile::tempdir().unwrap();
        let up = tempfile::tempdir().unwrap();
        let host = Arc::new(FakeHost { roots: vec![out.path().to_path_buf()], uploads: up.path().to_path_buf(), busy, ..Default::default() });
        let hub = Arc::new(CreateHub::new(tool).with_caps_wait(Duration::from_millis(50)));
        hub.set_host(host.clone());
        Rig { hub, host, out, _up: up }
    }

    fn rig() -> Rig {
        rig_with(Tool::Comfyui, None)
    }

    fn spec(prompt: &str) -> JobSpec {
        JobSpec::text(Kind::Image, prompt)
    }

    const PNG_1X1: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
        0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF,
        0xC0, 0xF0, 0x1F, 0x00, 0x05, 0x00, 0x01, 0xFF, 0x89, 0x99, 0x3D, 0x1D, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60,
        0x82,
    ];

    // ── queue ──

    #[test]
    fn one_job_runs_and_the_next_waits_until_it_is_through() {
        let r = rig();
        let (a, _) = r.hub.submit("dev", None, spec("a"), 100).unwrap();
        let (b, _) = r.hub.submit("dev", None, spec("b"), 100).unwrap();
        assert_eq!(a["state"], "running");
        assert_eq!(b["state"], "queued");
        assert_eq!(b["position"], 1);
        assert_eq!(r.host.actions("run").len(), 1, "only the first job reaches the window");
        let a_id = a["id"].as_str().unwrap();
        let file = r.out.path().join("a.png");
        std::fs::write(&file, PNG_1X1).unwrap();
        r.hub.finish(a_id, true, None, vec![OutputRef { path: Some(file.to_string_lossy().into()), ..Default::default() }], 110).unwrap();
        assert_eq!(r.hub.view(Some("dev"), b["id"].as_str().unwrap()).unwrap()["state"], "running");
        let runs = r.host.actions("run");
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[1]["job"]["id"], b["id"]);
    }

    #[test]
    fn switching_create_off_ends_every_job_and_takes_no_new_one() {
        let r = rig();
        let (a, _) = r.hub.submit("dev", None, spec("a"), 1).unwrap();
        let (b, _) = r.hub.submit("dev-b", None, spec("b"), 1).unwrap();
        r.hub.set_enabled(false, 2);
        for id in [&a["id"], &b["id"]] {
            assert_eq!(r.hub.view(None, id.as_str().unwrap()).unwrap()["state"], "cancelled");
        }
        assert_eq!(r.hub.submit("dev", None, spec("c"), 3).unwrap_err(), CreateError::Off);
        assert_eq!(r.hub.add_upload("dev", PNG_1X1).unwrap_err(), CreateError::Off);
        r.hub.set_enabled(true, 4);
        assert!(r.hub.submit("dev", None, spec("d"), 5).is_ok());
    }

    /// A small PNG of its own content.
    fn png(w: u32, h: u32, shade: u8) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([shade, shade, shade, 255]));
        let mut out = Vec::new();
        image::DynamicImage::ImageRgba8(img).write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png).unwrap();
        out
    }

    #[test]
    fn uploads_have_a_quota_per_device_and_pushed_out_files_are_removed() {
        let r = rig();
        let mut paths = Vec::new();
        for i in 0..MAX_UPLOADS_PER_OWNER as u8 {
            r.hub.add_upload("dev", &png(2, 2, i)).unwrap();
            paths.push(lock(&r.hub.book).uploads.last().unwrap().path.clone());
        }
        assert!(paths.iter().all(|p| p.is_file()));
        // One more pushes the oldest out, and its file goes with it.
        r.hub.add_upload("dev", &png(2, 2, 200)).unwrap();
        assert_eq!(lock(&r.hub.book).uploads.iter().filter(|u| u.owner == "dev").count(), MAX_UPLOADS_PER_OWNER);
        assert!(!paths[0].exists(), "the pushed out upload stayed on disk");
        assert!(paths[1].is_file());
        assert_eq!(lock(&r.host.discarded).as_slice(), &[paths[0].clone()]);
        // Another device is not pushed out by this one.
        r.hub.add_upload("dev-b", &png(2, 2, 201)).unwrap();
        for i in 0..MAX_UPLOADS_PER_OWNER as u8 {
            r.hub.add_upload("dev", &png(2, 2, 100 + i)).unwrap();
        }
        assert_eq!(lock(&r.hub.book).uploads.iter().filter(|u| u.owner == "dev-b").count(), 1);
    }

    #[test]
    fn a_full_computer_never_pushes_out_the_uploads_of_another_phone() {
        let r = rig();
        let phones = MAX_UPLOADS / MAX_UPLOADS_PER_OWNER;
        for d in 0..phones {
            for i in 0..MAX_UPLOADS_PER_OWNER {
                r.hub.add_upload(&format!("dev{d}"), &png(2, 2, (d * MAX_UPLOADS_PER_OWNER + i) as u8)).unwrap();
            }
        }
        assert_eq!(lock(&r.hub.book).uploads.len(), MAX_UPLOADS);
        // A new phone with nothing of its own to give up: busy, nothing pushed out.
        assert!(matches!(r.hub.add_upload("newcomer", &png(2, 2, 250)), Err(CreateError::Busy(_))));
        assert_eq!(lock(&r.hub.book).uploads.len(), MAX_UPLOADS);
        // Only the refused file itself is cleared away.
        let kept: Vec<PathBuf> = lock(&r.hub.book).uploads.iter().map(|u| u.path.clone()).collect();
        assert!(lock(&r.host.discarded).iter().all(|p| !kept.contains(p)));
        // A phone that has uploads makes room with its own.
        r.hub.add_upload("dev0", &png(2, 2, 251)).unwrap();
        for d in 1..phones {
            assert_eq!(lock(&r.hub.book).uploads.iter().filter(|u| u.owner == format!("dev{d}")).count(), MAX_UPLOADS_PER_OWNER);
        }
    }

    #[test]
    fn unpairing_removes_the_uploads_only_that_device_had() {
        let r = rig();
        r.hub.add_upload("dev", &png(2, 2, 1)).unwrap();
        let own = lock(&r.hub.book).uploads.last().unwrap().path.clone();
        r.hub.add_upload("dev", &png(2, 2, 2)).unwrap();
        r.hub.add_upload("dev-b", &png(2, 2, 2)).unwrap();
        let shared = lock(&r.hub.book).uploads.last().unwrap().path.clone();
        r.hub.forget_owner("dev", 1);
        assert!(!own.exists());
        assert!(shared.is_file(), "the other device's copy went too");
    }

    #[test]
    fn an_upload_an_open_job_needs_is_not_pushed_out() {
        let r = rig();
        let first = r.hub.add_upload("dev", &png(2, 2, 1)).unwrap()["id"].as_str().unwrap().to_string();
        let i2i = JobSpec { kind: Kind::ImageToImage, input_ids: vec![first.clone()], ..spec("again") };
        r.hub.submit("dev", None, i2i, 1).unwrap();
        for i in 0..(MAX_UPLOADS_PER_OWNER as u8 + 2) {
            r.hub.add_upload("dev", &png(2, 2, 10 + i)).unwrap();
        }
        assert!(lock(&r.hub.book).uploads.iter().any(|u| u.id == first));
    }

    #[test]
    fn an_image_over_4096_pixels_a_side_is_refused_before_it_is_stored() {
        let r = rig();
        let wide = png(MAX_UPLOAD_SIDE + 1, 1, 7);
        assert!(matches!(r.hub.add_upload("dev", &wide), Err(CreateError::Bad(_))));
        assert_eq!(std::fs::read_dir(r._up.path()).unwrap().count(), 0, "a refused image was written");
        assert!(r.hub.add_upload("dev", &png(MAX_UPLOAD_SIDE, 1, 7)).is_ok());
    }

    #[test]
    fn a_failed_job_tells_the_phone_a_fixed_sentence() {
        let r = rig();
        let (a, _) = r.hub.submit("dev", None, spec("a"), 1).unwrap();
        let id = a["id"].as_str().unwrap().to_string();
        let v = r.hub.finish(&id, false, Some("C:\\Users\\someone\\ComfyUI\\models missing, see http://127.0.0.1:8188/x".into()), Vec::new(), 2).unwrap();
        let e = v["error"].as_str().unwrap();
        assert!(!e.contains("someone") && !e.contains("127.0.0.1") && !e.contains("ComfyUI\\"), "{e}");
        assert!(e.starts_with("The generation failed on the computer."));
        // A result outside the output folders: no path in the answer either.
        let (b, _) = r.hub.submit("dev", None, spec("b"), 3).unwrap();
        let v = r.hub.finish(b["id"].as_str().unwrap(), true, None, vec![OutputRef { path: Some("/Users/someone/secret.png".into()), ..Default::default() }], 4).unwrap();
        assert!(!v["error"].as_str().unwrap().contains("someone"));
    }

    #[test]
    fn the_queue_is_bounded() {
        let r = rig();
        r.hub.submit("dev", None, spec("running"), 1).unwrap();
        for i in 0..MAX_WAITING {
            r.hub.submit(&format!("dev-{i}"), None, spec(&format!("w{i}")), 1).unwrap();
        }
        assert!(matches!(r.hub.submit("dev-x", None, spec("one too many"), 1), Err(CreateError::Busy(_))));
    }

    #[test]
    fn one_device_cannot_fill_the_queue() {
        let r = rig();
        r.hub.submit("dev", None, spec("running"), 1).unwrap();
        for i in 0..MAX_WAITING_PER_OWNER {
            r.hub.submit("dev", None, spec(&format!("w{i}")), 1).unwrap();
        }
        assert!(matches!(r.hub.submit("dev", None, spec("one too many"), 1), Err(CreateError::Busy(_))));
        assert!(r.hub.submit("dev-b", None, spec("another phone"), 1).is_ok());
    }

    #[tokio::test]
    async fn one_device_asks_the_window_at_most_every_few_seconds() {
        let r = rig();
        // The first ask goes to the window (nobody answers here).
        assert!(r.hub.capabilities_for("dev", 100).await.is_none());
        let rid = r.host.actions("capabilities")[0]["request_id"].as_str().unwrap().to_string();
        r.hub.capabilities_reply(&rid, json!({"kinds":{"image":{"models":[{"id":"flux","name":"FLUX"}]}}}));
        // Again at once: the last answer, no new question.
        let (_, stale) = r.hub.capabilities_for("dev", 101).await.unwrap();
        assert!(stale);
        assert_eq!(r.host.actions("capabilities").len(), 1);
        // Another device, or the same one later, asks again.
        r.hub.capabilities_for("dev-b", 101).await;
        assert_eq!(r.host.actions("capabilities").len(), 2);
        r.hub.capabilities_for("dev", 100 + CAPS_ASK_EVERY_SECS).await;
        assert_eq!(r.host.actions("capabilities").len(), 3);
    }

    #[test]
    fn a_repeated_client_request_id_gets_the_same_job() {
        let r = rig();
        let (first, dup1) = r.hub.submit("dev", Some("req-1".into()), spec("x"), 1).unwrap();
        let (second, dup2) = r.hub.submit("dev", Some("req-1".into()), spec("x"), 2).unwrap();
        assert!(!dup1);
        assert!(dup2);
        assert_eq!(first["id"], second["id"]);
        assert_eq!(r.host.actions("run").len(), 1, "the window is not handed the job twice");
        // Another device with the same id is another job.
        let (other, _) = r.hub.submit("dev-b", Some("req-1".into()), spec("x"), 3).unwrap();
        assert_ne!(other["id"], first["id"]);
    }

    // ── cancel ──

    #[test]
    fn cancel_sets_cancelled_and_ends_the_engine_and_the_window_run() {
        let r = rig();
        let (job, _) = r.hub.submit("dev", None, JobSpec::text(Kind::Video, "clip"), 1).unwrap();
        let id = job["id"].as_str().unwrap();
        let v = r.hub.cancel(Some("dev"), id, 2).unwrap();
        assert_eq!(v["state"], "cancelled");
        assert_eq!(*lock(&r.host.aborts), vec![Kind::Video]);
        let cancels = r.host.actions("cancel");
        assert_eq!(cancels.len(), 1);
        assert_eq!(cancels[0]["id"], id);
        // The window's late finish does not resurrect it.
        r.hub.finish(id, true, None, vec![], 3).unwrap();
        assert_eq!(r.hub.view(None, id).unwrap()["state"], "cancelled");
        assert!(!r.hub.progress(id, Some(0.5), None, None, 3), "a cancelled job tells the window to stop");
    }

    #[test]
    fn cancelling_a_waiting_job_touches_no_engine_and_another_device_cannot_cancel() {
        let r = rig();
        r.hub.submit("dev", None, spec("a"), 1).unwrap();
        let (b, _) = r.hub.submit("dev", None, spec("b"), 1).unwrap();
        let id = b["id"].as_str().unwrap();
        assert!(r.hub.cancel(Some("intruder"), id, 2).is_none());
        assert_eq!(r.hub.cancel(Some("dev"), id, 2).unwrap()["state"], "cancelled");
        assert!(lock(&r.host.aborts).is_empty());
    }

    #[test]
    fn stopping_the_server_cancels_every_open_job() {
        let r = rig();
        let (a, _) = r.hub.submit("dev", None, spec("a"), 1).unwrap();
        let (b, _) = r.hub.submit("dev", None, spec("b"), 1).unwrap();
        r.hub.cancel_all(None, 2);
        assert_eq!(r.hub.view(None, a["id"].as_str().unwrap()).unwrap()["state"], "cancelled");
        assert_eq!(r.hub.view(None, b["id"].as_str().unwrap()).unwrap()["state"], "cancelled");
        assert_eq!(r.host.actions("run").len(), 1, "the waiting job never started");
    }

    // ── liveness ──

    #[tokio::test]
    async fn a_job_the_window_never_takes_up_fails() {
        let r = rig();
        let (a, _) = r.hub.submit("dev", None, spec("a"), 100).unwrap();
        let id = a["id"].as_str().unwrap();
        r.hub.tick(100 + ACK_SECS).await;
        assert_eq!(r.hub.view(None, id).unwrap()["state"], "running");
        r.hub.tick(101 + ACK_SECS).await;
        let v = r.hub.view(None, id).unwrap();
        assert_eq!(v["state"], "failed");
        assert!(v["error"].as_str().unwrap().contains("did not start"));
    }

    #[tokio::test]
    async fn a_quiet_window_is_forgiven_while_the_engine_works() {
        let busy = rig_with(Tool::Comfyui, Some(true));
        let (a, _) = busy.hub.submit("dev", None, spec("a"), 100).unwrap();
        let id = a["id"].as_str().unwrap();
        assert!(busy.hub.progress(id, Some(0.1), Some("Generating".into()), None, 100));
        busy.hub.tick(100 + BEAT_SECS + 1).await;
        assert_eq!(busy.hub.view(None, id).unwrap()["state"], "running");

        let idle = rig_with(Tool::Comfyui, Some(false));
        let (b, _) = idle.hub.submit("dev", None, spec("b"), 100).unwrap();
        let id = b["id"].as_str().unwrap();
        idle.hub.progress(id, Some(0.1), None, None, 100);
        idle.hub.tick(100 + BEAT_SECS + 1).await;
        assert_eq!(idle.hub.view(None, id).unwrap()["state"], "failed");
        assert_eq!(*lock(&idle.host.aborts), vec![Kind::Image]);
    }

    // ── results: ids, never paths ──

    #[test]
    fn a_result_outside_the_output_folders_is_refused() {
        let r = rig();
        let elsewhere = tempfile::tempdir().unwrap();
        let secret = elsewhere.path().join("secret.png");
        std::fs::write(&secret, PNG_1X1).unwrap();
        let (a, _) = r.hub.submit("dev", None, spec("a"), 1).unwrap();
        let id = a["id"].as_str().unwrap();
        let escape = r.out.path().join("..").join(elsewhere.path().file_name().unwrap()).join("secret.png");
        let refs = vec![
            OutputRef { path: Some(secret.to_string_lossy().into()), ..Default::default() },
            OutputRef { path: Some(escape.to_string_lossy().into()), ..Default::default() },
            OutputRef { path: Some("relative.png".into()), ..Default::default() },
            OutputRef { comfy_filename: Some("../secret.png".into()), ..Default::default() },
            OutputRef { comfy_filename: Some("x.png".into()), comfy_subfolder: Some("../../etc".into()), ..Default::default() },
        ];
        let v = r.hub.finish(id, true, None, refs, 2).unwrap();
        assert_eq!(v["state"], "failed");
        assert!(v["results"].as_array().unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_output_folder_is_refused() {
        let r = rig();
        let elsewhere = tempfile::tempdir().unwrap();
        let secret = elsewhere.path().join("secret.png");
        std::fs::write(&secret, PNG_1X1).unwrap();
        let link = r.out.path().join("link.png");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        let out = OutputRef { path: Some(link.to_string_lossy().into()), ..Default::default() };
        assert!(resolve_output(&out, &[r.out.path().to_path_buf()], None).is_err());
    }

    #[test]
    fn a_non_media_file_in_the_output_folder_is_refused() {
        let r = rig();
        let txt = r.out.path().join("notes.png");
        std::fs::write(&txt, b"plain text pretending").unwrap();
        let (a, _) = r.hub.submit("dev", None, spec("a"), 1).unwrap();
        let v = r.hub.finish(a["id"].as_str().unwrap(), true, None, vec![OutputRef { path: Some(txt.to_string_lossy().into()), ..Default::default() }], 2).unwrap();
        assert_eq!(v["state"], "failed");
    }

    #[test]
    fn results_are_found_by_id_and_only_by_their_owner() {
        let r = rig();
        let file = r.out.path().join("ok.png");
        std::fs::write(&file, PNG_1X1).unwrap();
        let (a, _) = r.hub.submit("dev", None, spec("a"), 1).unwrap();
        let v = r.hub.finish(a["id"].as_str().unwrap(), true, None, vec![OutputRef { path: Some(file.to_string_lossy().into()), ..Default::default() }], 2).unwrap();
        assert_eq!(v["state"], "done");
        let res = &v["results"][0];
        assert_eq!(res["mime"], "image/png");
        assert_eq!(res["width"], 1);
        let rid = res["id"].as_str().unwrap();
        assert!(r.hub.result_file(Some("dev"), rid).is_some());
        assert!(r.hub.result_file(Some("other"), rid).is_none());
        assert!(r.hub.result_file(Some("dev"), &file.to_string_lossy()).is_none(), "a path is never an id");
        assert!(r.hub.result_file(Some("dev"), "res_../../etc/passwd").is_none());
    }

    #[test]
    fn a_forgotten_device_loses_its_jobs_uploads_and_results_and_no_one_else_does() {
        let r = rig();
        let file = r.out.path().join("ok.png");
        std::fs::write(&file, PNG_1X1).unwrap();
        let (a, _) = r.hub.submit("dev-a", None, spec("a"), 1).unwrap();
        let a_id = a["id"].as_str().unwrap().to_string();
        let v = r.hub.finish(&a_id, true, None, vec![OutputRef { path: Some(file.to_string_lossy().into()), ..Default::default() }], 2).unwrap();
        let rid = v["results"][0]["id"].as_str().unwrap().to_string();
        let up_a = r.hub.add_upload("dev-a", PNG_1X1).unwrap()["id"].as_str().unwrap().to_string();
        let up_b = r.hub.add_upload("dev-b", PNG_1X1).unwrap()["id"].as_str().unwrap().to_string();
        let (run, _) = r.hub.submit("dev-a", None, spec("running"), 3).unwrap();
        let run = run["id"].as_str().unwrap().to_string();
        let (b, _) = r.hub.submit("dev-b", None, spec("b"), 4).unwrap();
        let b = b["id"].as_str().unwrap().to_string();

        r.hub.forget_owner("dev-a", 5);
        assert!(r.host.actions("cancel").iter().any(|e| e["id"] == run.as_str()));
        assert!(r.hub.view(None, &a_id).is_none());
        assert!(r.hub.view(None, &run).is_none());
        assert!(r.hub.result_file(None, &rid).is_none());
        assert!(file.is_file(), "the file itself stays");
        // dev-b uploaded the same image: the shared file stays for it.
        assert!(lock(&r.host.discarded).is_empty());
        let i2i = |input: &str| JobSpec { kind: Kind::ImageToImage, input_ids: vec![input.to_string()], ..spec("again") };
        assert_eq!(r.hub.submit("dev-a", None, i2i(&up_a), 6).unwrap_err(), CreateError::Bad("No such upload. Upload the image again.".to_string()));
        // B is untouched and moved up.
        assert_eq!(r.hub.view(Some("dev-b"), &b).unwrap()["state"], "running");
        assert!(r.hub.submit("dev-b", None, i2i(&up_b), 7).is_ok());
    }

    #[test]
    fn the_pieces_add_up_to_the_file_bit_for_bit() {
        use sha2::{Digest, Sha256};
        let r = rig();
        // A fake mp4: an ftyp box and 9 MB of varying bytes, three pieces.
        let mut data = vec![0, 0, 0, 0x18, b'f', b't', b'y', b'p', b'i', b's', b'o', b'm'];
        data.extend((0..9 * 1024 * 1024 + 123).map(|i| (i * 31 % 251) as u8));
        let file = r.out.path().join("clip.mp4");
        std::fs::write(&file, &data).unwrap();
        let (a, _) = r.hub.submit("dev", None, JobSpec::text(Kind::Video, "clip"), 1).unwrap();
        let v = r.hub.finish(a["id"].as_str().unwrap(), true, None, vec![OutputRef { path: Some(file.to_string_lossy().into()), ..Default::default() }], 2).unwrap();
        let rf = r.hub.result_file(Some("dev"), v["results"][0]["id"].as_str().unwrap()).unwrap();
        assert_eq!(rf.mime, "video/mp4");
        let roots = vec![r.out.path().to_path_buf()];
        let mut joined = Vec::new();
        let mut offset = 0;
        while offset < rf.bytes {
            let piece = read_piece(&rf, offset, MAX_CHUNK_BYTES, &roots).unwrap();
            assert!(piece.len() as u64 <= MAX_CHUNK_BYTES);
            offset += piece.len() as u64;
            joined.extend(piece);
        }
        assert_eq!(joined, data);
        let sha: String = Sha256::digest(&joined).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(sha, rf.sha256);
        assert_eq!(read_piece(&rf, rf.bytes + 1, 10, &roots), Err(StatusCode::RANGE_NOT_SATISFIABLE));
        // A file that changed after it was reported is not served.
        std::fs::write(&file, b"short").unwrap();
        assert_eq!(read_piece(&rf, 0, 10, &roots), Err(StatusCode::GONE));
    }

    fn reported(r: &Rig, name: &str, bytes: &[u8]) -> ResultFile {
        let file = r.out.path().join(name);
        std::fs::write(&file, bytes).unwrap();
        let (a, _) = r.hub.submit("dev", None, spec(name), 1).unwrap();
        let v = r.hub.finish(a["id"].as_str().unwrap(), true, None, vec![OutputRef { path: Some(file.to_string_lossy().into()), ..Default::default() }], 2).unwrap();
        r.hub.result_file(Some("dev"), v["results"][0]["id"].as_str().unwrap()).unwrap()
    }

    #[test]
    fn a_result_swapped_after_it_was_reported_is_not_served() {
        let r = rig();
        let roots = vec![r.out.path().to_path_buf()];
        let rf = reported(&r, "swap.png", PNG_1X1);
        assert!(read_piece(&rf, 0, 10, &roots).is_ok());
        // Another file of the same size renamed over it (a new inode; other
        // systems compare size and change time only).
        #[cfg(unix)]
        {
            let other = r.out.path().join("other.png");
            let mut same_size = PNG_1X1.to_vec();
            let last = same_size.len() - 1;
            same_size[last] ^= 0xff;
            std::fs::write(&other, &same_size).unwrap();
            std::fs::rename(&other, &rf.path).unwrap();
            assert_eq!(read_piece(&rf, 0, 10, &roots), Err(StatusCode::GONE));
        }
        // Outside the output folders it is not served even when unchanged.
        let rf = reported(&r, "kept.png", PNG_1X1);
        let elsewhere = tempfile::tempdir().unwrap();
        assert_eq!(read_piece(&rf, 0, 10, &[elsewhere.path().to_path_buf()]), Err(StatusCode::GONE));
    }

    #[cfg(unix)]
    #[test]
    fn a_result_replaced_by_a_link_is_not_served() {
        let r = rig();
        let roots = vec![r.out.path().to_path_buf()];
        let rf = reported(&r, "link.png", PNG_1X1);
        let secret = tempfile::tempdir().unwrap();
        let target = secret.path().join("secret.png");
        std::fs::write(&target, PNG_1X1).unwrap();
        std::fs::remove_file(&rf.path).unwrap();
        std::os::unix::fs::symlink(&target, &rf.path).unwrap();
        assert_eq!(read_piece(&rf, 0, 10, &roots), Err(StatusCode::GONE));
        assert!(open_no_follow(&rf.path).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn the_upload_folder_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let r = rig();
        r.hub.add_upload("dev", PNG_1X1).unwrap();
        let mode = std::fs::metadata(r._up.path()).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
    }

    // ── uploads ──

    #[test]
    fn uploads_take_only_images_by_their_bytes() {
        let r = rig();
        let up = r.hub.add_upload("dev", PNG_1X1).unwrap();
        assert_eq!(up["mime"], "image/png");
        assert!(is_our_id(up["id"].as_str().unwrap(), "upl"));
        assert!(matches!(r.hub.add_upload("dev", b"GIF89a....."), Err(CreateError::Bad(_))));
        assert!(matches!(r.hub.add_upload("dev", b"#!/bin/sh\nrm -rf /"), Err(CreateError::Bad(_))));
        // Text only when the phone says it is text, PDF by its bytes.
        assert_eq!(r.hub.add_file_as("dev", None, b"notes", Some("text/plain; charset=utf-8"), None).unwrap()["mime"], "text/plain");
        assert!(r.hub.add_file_as("dev", None, b"notes", Some("application/octet-stream"), None).is_err());
        assert_eq!(r.hub.add_file_as("dev", None, b"%PDF-1.4", None, None).unwrap()["mime"], "application/pdf");
        let big = vec![0x89u8; MAX_UPLOAD_BYTES + 1];
        assert_eq!(r.hub.add_upload("dev", &big), Err(CreateError::TooLarge));
    }

    #[test]
    fn an_input_belongs_to_the_device_that_uploaded_it() {
        let r = rig();
        let up = r.hub.add_upload("dev", PNG_1X1).unwrap();
        let mut s = JobSpec::text(Kind::ImageToImage, "restyle");
        s.input_ids = vec![up["id"].as_str().unwrap().to_string()];
        assert!(matches!(r.hub.submit("intruder", None, s.clone(), 1), Err(CreateError::Bad(_))));
        let (job, _) = r.hub.submit("dev", None, s, 1).unwrap();
        assert_eq!(job["state"], "running");
        let run = &r.host.actions("run")[0]["job"];
        assert!(run["input_path"].as_str().unwrap().ends_with(".png"));
    }

    // ── validation ──

    fn body(v: Value) -> JobBody {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn job_requests_are_checked_against_the_limits() {
        let r = rig();
        let ok = r.hub.validate(body(json!({"kind":"image","prompt":"a\ncat","width":1024,"height":768,"count":4})), None).unwrap();
        assert_eq!(ok.prompt, "a cat");
        for bad in [
            json!({"kind":"sound","prompt":"x"}),
            json!({"kind":"image"}),
            json!({"kind":"image","prompt":"x","count":5}),
            json!({"kind":"video","prompt":"x","count":2}),
            json!({"kind":"image","prompt":"x","width":100}),
            json!({"kind":"image","prompt":"x","width":1001}),
            json!({"kind":"image","prompt":"x","steps":0}),
            json!({"kind":"image-to-image","prompt":"x"}),
            json!({"kind":"image","prompt":"x","input_id":"upl_00000000000000000000000000000000"}),
            json!({"kind":"image-to-image","prompt":"x","input_id":"/etc/passwd"}),
        ] {
            assert!(r.hub.validate(body(bad.clone()), None).is_err(), "{bad} passed");
        }
        assert_eq!(r.hub.validate(body(json!({"kind":"sound","prompt":"x"})), None).unwrap_err(), CreateError::UnsupportedKind);
        let flux = sanitize_caps(&json!({"kinds":{"image":{"models":[{"id":"flux"}]}}}));
        assert!(r.hub.validate(body(json!({"kind":"image","prompt":"x","model":"nope"})), Some(&flux)).is_err());
        assert!(r.hub.validate(body(json!({"kind":"image","prompt":"x","model":"flux"})), Some(&flux)).is_ok());
        // A video may go without a prompt.
        assert!(r.hub.validate(body(json!({"kind":"video"})), None).is_ok());
        // A Mac without an edit pack has no image to image: 409 with the reason.
        let mac = rig_with(Tool::Mlx, None);
        let no_edit = sanitize_caps(&json!({"kinds":{"image-to-image":{"models":[],"available":false,"reason":"Install Qwen-Image 2.1."}}}));
        assert_eq!(
            mac.hub.validate(body(json!({"kind":"image-to-image","prompt":"x","input_id":"upl_00000000000000000000000000000000"})), Some(&no_edit)).unwrap_err(),
            CreateError::Unavailable("Install Qwen-Image 2.1.".into())
        );
    }

    #[tokio::test]
    async fn capabilities_come_from_the_window_and_keep_the_last_answer() {
        let r = rig();
        assert!(r.hub.capabilities().await.is_none(), "nothing known, nobody answers");
        let rid = r.host.actions("capabilities")[0]["request_id"].as_str().unwrap().to_string();
        r.hub.capabilities_reply(&rid, json!({"kinds":{"image":{"models":[{"id":"flux","name":"FLUX"}, {"id":"\u{0}"}]}},"desktop_busy":true}));
        let (caps, stale) = r.hub.capabilities().await.unwrap();
        assert!(stale);
        let body = r.hub.capabilities_body(&caps, stale);
        assert_eq!(body["tool"], "comfyui");
        assert_eq!(body["busy"], true);
        let image = body["kinds"].as_array().unwrap().iter().find(|k| k["kind"] == "image").unwrap();
        assert_eq!(image["models"].as_array().unwrap().len(), 1);
        assert_eq!(image["schema"]["properties"]["model"]["enum"], json!(["flux"]));
        assert_eq!(image["schema"]["required"], json!(["prompt"]));
        // Stage 1's four kinds first, in their order, then stage 2's.
        let names: Vec<&str> = body["kinds"].as_array().unwrap().iter().map(|k| k["kind"].as_str().unwrap()).collect();
        assert_eq!(names, ["image", "image-to-image", "video", "image-to-video", "edit", "upscale", "removebg", "music"]);
    }

    // ── HTTP ──

    fn router(r: &Rig, create_on: bool) -> Router {
        let perms = RemotePermissions { create: create_on, ..Default::default() };
        let ctx = CreateCtx { hub: r.hub.clone(), permissions: Arc::new(TokioMutex::new(perms)) };
        Router::new()
            .route("/remote-api/create/capabilities", get(handle_capabilities))
            .route("/remote-api/create/uploads", post(handle_upload))
            .route("/remote-api/create/jobs", post(handle_create_job))
            .route("/remote-api/create/jobs/{id}", get(handle_get_job))
            .route("/remote-api/create/jobs/{id}/cancel", post(handle_cancel_job))
            .route("/remote-api/create/results/{id}", get(handle_result))
            .route("/remote-api/create/gallery", get(handle_gallery))
            .route("/remote-api/create/gallery/{id}", get(handle_gallery_item))
            .route("/remote-api/create/gallery/{id}/thumb", get(handle_gallery_thumb))
            .route("/remote-api/create/gallery/{id}/file", get(handle_gallery_file))
            .layer(axum::middleware::from_fn(|mut req: axum::extract::Request, next: axum::middleware::Next| async move {
                let dev = req.headers().get("x-test-device").and_then(|v| v.to_str().ok()).unwrap_or("dev").to_string();
                // A paired device in the sealed channel, unless the test asks
                // for the plain Wi-Fi way (JWT).
                if req.headers().get("x-test-plain").is_none() {
                    let rights = crate::commands::remote_sealed::DeviceRights { chat: true, agent: true, files: true, terminal: true, create: true };
                    req.extensions_mut().insert(SealedCaller { device_id: dev.clone(), rights, generation: 0 });
                }
                req.extensions_mut().insert(CallerDevice(dev));
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

    #[tokio::test]
    async fn every_create_route_answers_403_without_the_permission() {
        let r = rig();
        let (base, task) = serve(router(&r, false)).await;
        let c = reqwest::Client::builder().no_proxy().build().unwrap();
        let id = "job_00000000000000000000000000000000";
        let calls = vec![
            c.get(format!("{base}/remote-api/create/capabilities")),
            c.post(format!("{base}/remote-api/create/uploads")).body(PNG_1X1.to_vec()),
            c.post(format!("{base}/remote-api/create/jobs")).json(&json!({"kind":"image","prompt":"x"})),
            c.get(format!("{base}/remote-api/create/jobs/{id}")),
            c.post(format!("{base}/remote-api/create/jobs/{id}/cancel")),
            c.get(format!("{base}/remote-api/create/results/res_00000000000000000000000000000000")),
        ];
        for call in calls {
            let resp = call.send().await.unwrap();
            assert_eq!(resp.status(), StatusCode::FORBIDDEN);
            let v: Value = resp.json().await.unwrap();
            assert_eq!(v["permission"], "create");
            assert!(v["error"].as_str().unwrap().contains("Create"));
        }
        assert!(lock(&r.host.events).is_empty(), "nothing reached the window");
        task.abort();
    }

    #[tokio::test]
    async fn a_phone_makes_a_job_follows_it_and_fetches_the_result_in_pieces() {
        use sha2::{Digest, Sha256};
        let r = rig();
        let (base, task) = serve(router(&r, true)).await;
        let c = reqwest::Client::builder().no_proxy().build().unwrap();
        let made: Value = c.post(format!("{base}/remote-api/create/jobs"))
            .json(&json!({"kind":"image","prompt":"a cat","client_request_id":"r1"}))
            .send().await.unwrap().json().await.unwrap();
        let again = c.post(format!("{base}/remote-api/create/jobs"))
            .json(&json!({"kind":"image","prompt":"a cat","client_request_id":"r1"}))
            .send().await.unwrap();
        assert_eq!(again.status(), StatusCode::OK);
        let again: Value = again.json().await.unwrap();
        assert_eq!(made["id"], again["id"]);
        let id = made["id"].as_str().unwrap();
        // Another phone does not see it.
        let foreign = c.get(format!("{base}/remote-api/create/jobs/{id}")).header("x-test-device", "other").send().await.unwrap();
        assert_eq!(foreign.status(), StatusCode::NOT_FOUND);
        // The window makes a picture.
        let file = r.out.path().join("cat.png");
        std::fs::write(&file, PNG_1X1).unwrap();
        r.hub.finish(id, true, None, vec![OutputRef { path: Some(file.to_string_lossy().into()), ..Default::default() }], now_secs()).unwrap();
        let done: Value = c.get(format!("{base}/remote-api/create/jobs/{id}")).send().await.unwrap().json().await.unwrap();
        assert_eq!(done["state"], "done");
        assert_eq!(done["progress"], 1.0);
        let res = &done["results"][0];
        let rid = res["id"].as_str().unwrap();
        let mut joined = Vec::new();
        let total = res["bytes"].as_u64().unwrap();
        while (joined.len() as u64) < total {
            let piece = c.get(format!("{base}/remote-api/create/results/{rid}?offset={}&length=20", joined.len())).send().await.unwrap();
            assert_eq!(piece.status(), StatusCode::OK);
            assert_eq!(piece.headers()["content-type"], "image/png");
            joined.extend(piece.bytes().await.unwrap());
        }
        let sha: String = Sha256::digest(&joined).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(sha, res["sha256"].as_str().unwrap());
        assert_eq!(joined, PNG_1X1);
        // A path in place of an id gets nothing.
        let path_try = c.get(format!("{base}/remote-api/create/results/..%2F..%2Fetc%2Fpasswd")).send().await.unwrap();
        assert_eq!(path_try.status(), StatusCode::NOT_FOUND);
        task.abort();
    }

    #[tokio::test]
    async fn an_upload_over_the_wire_becomes_an_id() {
        let r = rig();
        let (base, task) = serve(router(&r, true)).await;
        let c = reqwest::Client::builder().no_proxy().build().unwrap();
        let up = c.post(format!("{base}/remote-api/create/uploads")).body(PNG_1X1.to_vec()).send().await.unwrap();
        assert_eq!(up.status(), StatusCode::CREATED);
        let v: Value = up.json().await.unwrap();
        assert!(v.get("path").is_none(), "no path leaves the computer");
        assert!(is_our_id(v["id"].as_str().unwrap(), "upl"));
        let bad = c.post(format!("{base}/remote-api/create/uploads")).body(b"not an image".to_vec()).send().await.unwrap();
        assert_eq!(bad.status(), StatusCode::BAD_REQUEST);
        task.abort();
    }

    // ── stage 2 (CREATE-V2.md) ──

    /// What a desktop with every engine says.
    fn full_caps() -> Value {
        sanitize_caps(&json!({
            "engine_ready": true,
            "characters": [{"id":"local:char_mia_zimage.safetensors","name":"mia","model_family":"zimage","trigger":"mia"}],
            "kinds": {
                "image": {"models":[{"id":"flux","name":"FLUX"}], "character": true},
                "image-to-image": {"models":[{"id":"flux","name":"FLUX"}]},
                "video": {"models":[{"id":"wan","name":"Wan"}]},
                "image-to-video": {"models":[]},
                "edit": {"models":[{"id":"qwen","name":"Qwen"}], "max_inputs": 3},
                "upscale": {"models":[{"id":"x4","name":"x4"}], "available": true},
                "removebg": {"models":[], "available": true},
                "music": {"models":[], "available": false, "reason": "No music model is installed on your computer.", "duration": {"min":10,"max":240,"default":60}}
            }
        }))
    }

    #[test]
    fn each_image_model_starts_at_its_familys_size_and_sd15_says_when_it_gets_slow() {
        let note = "SD 1.5 models are made for 512 x 512. Above 768 a picture takes much longer.";
        let caps = sanitize_caps(&json!({
            "kinds": {
                "image": {"models": [
                    {"id":"v1-5-pruned-emaonly-fp16.safetensors","name":"v1-5-pruned-emaonly-fp16","width":512,"height":512,"recommended_max":768,"note":note},
                    {"id":"sdxl.safetensors","name":"SDXL","width":1024,"height":1024},
                    {"id":"odd","name":"Odd","width":513,"height":99999}
                ]}
            }
        }));
        let r = rig();
        let body = r.hub.capabilities_body(&caps, false);
        let image = body["kinds"].as_array().unwrap().iter().find(|k| k["kind"] == "image").unwrap().clone();
        assert_eq!(image["models"][0]["width"], 512);
        assert_eq!(image["models"][0]["recommended_max"], 768);
        assert_eq!(image["models"][0]["note"], note);
        assert!(image["models"][2].get("width").is_none(), "a size that is no size is dropped");
        let schema = &image["schema"];
        assert_eq!(schema["properties"]["width"]["default"], 512, "not a flat 1024");
        assert_eq!(schema["properties"]["width"]["note"], note);
        assert_eq!(schema["x-model-sizes"]["sdxl.safetensors"], json!({"width":1024,"height":1024}));
        assert_eq!(schema["x-model-sizes"]["v1-5-pruned-emaonly-fp16.safetensors"]["recommended_max"], 768);
        // A window that names no sizes: as before.
        let plain = r.hub.capabilities_body(&full_caps(), false);
        let image = plain["kinds"].as_array().unwrap().iter().find(|k| k["kind"] == "image").unwrap().clone();
        assert_eq!(image["schema"]["properties"]["width"]["default"], 1024);
        assert!(image["schema"].get("x-model-sizes").is_none());
    }

    #[test]
    fn stage_two_fields_are_checked_per_kind() {
        let r = rig();
        let caps = full_caps();
        let up = |n: u8| format!("upl_{}", format!("{n:02x}").repeat(16));
        let ok = |v: Value| r.hub.validate(body(v), Some(&caps));
        let e = ok(json!({"kind":"edit","prompt":"snow","input_ids":[up(1), up(2), up(3)],"mask_id":up(4)})).unwrap();
        assert_eq!(e.input_ids.len(), 3);
        assert_eq!(e.mask_id, Some(up(4)));
        // input_id is input_ids of one.
        assert_eq!(ok(json!({"kind":"edit","prompt":"snow","input_id":up(1)})).unwrap().input_ids, vec![up(1)]);
        let u = ok(json!({"kind":"upscale","input_id":up(1)})).unwrap();
        assert_eq!(u.factor, Some(2));
        assert_eq!(ok(json!({"kind":"upscale","input_id":up(1),"factor":4})).unwrap().factor, Some(4));
        assert!(ok(json!({"kind":"removebg","input_id":up(1)})).unwrap().prompt.is_empty());
        let c = ok(json!({"kind":"image","prompt":"x","character":"local:char_mia_zimage.safetensors"})).unwrap();
        assert_eq!(c.character.as_deref(), Some("local:char_mia_zimage.safetensors"));
        for bad in [
            json!({"kind":"edit","prompt":"x","input_ids":[up(1), up(2), up(3), up(5)]}),
            json!({"kind":"edit","prompt":"x","input_ids":[up(1), up(1)]}),
            json!({"kind":"edit","input_ids":[up(1)]}),
            json!({"kind":"edit","prompt":"x","input_ids":[up(1)],"mask_id":up(1)}),
            json!({"kind":"edit","prompt":"x","input_ids":[up(1)],"input_id":up(2)}),
            json!({"kind":"image-to-image","prompt":"x","input_id":up(1),"mask_id":up(2)}),
            json!({"kind":"upscale","input_id":up(1),"factor":3}),
            json!({"kind":"upscale"}),
            json!({"kind":"upscale","input_id":up(1),"width":512}),
            json!({"kind":"image","prompt":"x","factor":2}),
            json!({"kind":"image","prompt":"x","lyrics":"la"}),
            json!({"kind":"image","prompt":"x","character":"local:someone_else"}),
            json!({"kind":"image-to-image","prompt":"x","input_id":up(1),"character":"local:char_mia_zimage.safetensors"}),
        ] {
            assert!(matches!(ok(bad.clone()), Err(CreateError::Bad(_))), "{bad} passed");
        }
        // Music is off on this desktop: 409 with the window's sentence.
        assert_eq!(
            ok(json!({"kind":"music","prompt":"lofi"})).unwrap_err(),
            CreateError::Unavailable("No music model is installed on your computer.".into())
        );
        // A video takes a character only where the window says so.
        assert!(matches!(ok(json!({"kind":"video","character":"local:char_mia_zimage.safetensors"})), Err(CreateError::Unavailable(_))));
        assert_eq!(ok(json!({"kind":"lipsync"})).unwrap_err(), CreateError::UnsupportedKind);
    }

    #[test]
    fn music_keeps_the_lines_of_its_lyrics_and_its_length_within_bounds() {
        let r = rig();
        let caps = sanitize_caps(&json!({"kinds":{"music":{"models":[{"id":"ace"}],"duration":{"min":10,"max":240}}}}));
        let m = r.hub.validate(body(json!({"kind":"music","prompt":"lofi","lyrics":"[verse]\r\nla la\u{0007}\n\nla","duration":30})), Some(&caps)).unwrap();
        assert_eq!(m.lyrics.as_deref(), Some("[verse]\nla la\n\nla"));
        assert_eq!(m.duration, Some(30));
        for d in [5, 241] {
            assert!(r.hub.validate(body(json!({"kind":"music","prompt":"lofi","duration":d})), Some(&caps)).is_err(), "{d}");
        }
        let long = "a".repeat(MAX_LYRICS_CHARS + 1);
        assert!(r.hub.validate(body(json!({"kind":"music","prompt":"lofi","lyrics":long})), Some(&caps)).is_err());
        assert!(r.hub.validate(body(json!({"kind":"music"})), Some(&caps)).is_err(), "music needs a style");
    }

    #[test]
    fn an_edit_reaches_the_window_with_every_input_its_mask_and_the_new_fields() {
        let r = rig();
        let a = r.hub.add_upload("dev", &png(64, 48, 1)).unwrap();
        let b = r.hub.add_upload("dev", &png(32, 32, 2)).unwrap();
        let mask = r.hub.add_upload("dev", &png(64, 48, 255)).unwrap();
        let bad_mask = r.hub.add_upload("dev", &png(32, 48, 255)).unwrap();
        let id = |v: &Value| v["id"].as_str().unwrap().to_string();
        let mut s = JobSpec::text(Kind::Edit, "snow");
        s.input_ids = vec![id(&a), id(&b)];
        s.mask_id = Some(id(&bad_mask));
        assert!(matches!(r.hub.submit("dev", None, s.clone(), 1), Err(CreateError::Bad(m)) if m.contains("same size")));
        s.mask_id = Some(id(&mask));
        // Another phone cannot use these uploads.
        assert!(r.hub.submit("dev-b", None, s.clone(), 1).is_err());
        let (v, _) = r.hub.submit("dev", None, s, 1).unwrap();
        assert_eq!(v["state"], "running");
        let run = &r.host.actions("run")[0]["job"];
        assert_eq!(run["kind"], "edit");
        let inputs = run["inputs"].as_array().unwrap();
        assert_eq!(inputs.len(), 2);
        assert_eq!((inputs[0]["width"].as_u64(), inputs[0]["height"].as_u64()), (Some(64), Some(48)));
        assert!(inputs[1]["input_path"].is_string());
        assert!(run["mask"]["input_path"].is_string());
        // Stage 1's window reads the first input at the top level.
        assert_eq!(run["input_path"], inputs[0]["input_path"]);
        // The uploads of the open job are not pushed out by new ones.
        for n in 0..12u8 {
            let _ = r.hub.add_upload("dev", &png(8, 8, 10 + n));
        }
        let book = lock(&r.hub.book);
        for u in [id(&a), id(&b), id(&mask)] {
            assert!(book.uploads.iter().any(|x| x.id == u), "{u} was pushed out");
        }
    }

    #[test]
    fn an_upscale_larger_than_the_limit_is_refused_before_it_runs() {
        let r = rig();
        let big = r.hub.add_upload("dev", &png(2500, 16, 1)).unwrap();
        let mut s = JobSpec::text(Kind::Upscale, "");
        s.input_ids = vec![big["id"].as_str().unwrap().to_string()];
        s.factor = Some(4);
        assert!(matches!(r.hub.submit("dev", None, s.clone(), 1), Err(CreateError::Bad(m)) if m.contains("8192")));
        s.factor = Some(2);
        assert!(r.hub.submit("dev", None, s, 1).is_ok());
    }

    #[test]
    fn a_log_line_names_no_folder_of_this_computer() {
        let m = without_paths("Permission denied (os error 13): /Users/someone/LU/outputs/start-images/abc.png, while copying C:\\Users\\x\\in.png");
        assert!(!m.contains("someone") && !m.contains("outputs") && !m.contains("Users"), "{m}");
        assert!(m.contains("abc.png,") && m.contains("in.png") && m.contains("Permission denied"), "{m}");
    }

    #[test]
    fn a_file_name_loses_direction_and_format_marks() {
        assert_eq!(clean_file_name("invoice\u{202E}fdp.exe").as_deref(), Some("invoicefdp.exe"));
        assert_eq!(clean_file_name("a\u{2066}b\u{2069}\u{200E}\u{200F}c.txt").as_deref(), Some("abc.txt"));
        assert_eq!(clean_file_name("\u{202D}\u{200B}").as_deref(), None);
        assert_eq!(clean_file_name("../dir/Notizen äöü.md").as_deref(), Some("Notizen äöü.md"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn previews_are_made_three_at_a_time_and_once_per_key() {
        use std::sync::atomic::AtomicUsize;
        let r = rig();
        let now = Arc::new(AtomicUsize::new(0));
        let most = Arc::new(AtomicUsize::new(0));
        let made = Arc::new(AtomicUsize::new(0));
        let maker = |now: Arc<AtomicUsize>, most: Arc<AtomicUsize>, made: Arc<AtomicUsize>| move || {
            let n = now.fetch_add(1, Ordering::SeqCst) + 1;
            most.fetch_max(n, Ordering::SeqCst);
            made.fetch_add(1, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(60));
            now.fetch_sub(1, Ordering::SeqCst);
            Ok(vec![0xFF, 0xD8])
        };
        let mut tasks = Vec::new();
        for i in 0..8 {
            let hub = r.hub.clone();
            let f = maker(now.clone(), most.clone(), made.clone());
            tasks.push(tokio::spawn(async move { hub.thumb_for(&format!("k{i}"), f).await }));
        }
        for t in tasks {
            assert!(t.await.unwrap().is_ok());
        }
        assert!(most.load(Ordering::SeqCst) <= THUMB_SLOTS, "{} at once", most.load(Ordering::SeqCst));
        assert_eq!(made.load(Ordering::SeqCst), 8);
        // The same key asked five times at once: made once.
        made.store(0, Ordering::SeqCst);
        let mut tasks = Vec::new();
        for _ in 0..5 {
            let hub = r.hub.clone();
            let f = maker(now.clone(), most.clone(), made.clone());
            tasks.push(tokio::spawn(async move { hub.thumb_for("same", f).await }));
        }
        for t in tasks {
            assert_eq!(t.await.unwrap().unwrap(), vec![0xFF, 0xD8]);
        }
        assert_eq!(made.load(Ordering::SeqCst), 1);
        assert!(lock(&r.hub.thumb_flight).is_empty(), "nothing left behind");
        let limits = thumb_decode_limits();
        assert_eq!(limits.max_alloc, Some(256 * 1024 * 1024));
        assert_eq!(limits.max_image_width, Some(8192));
    }

    #[test]
    fn the_plain_wifi_way_gets_the_capabilities_of_3_0_7() {
        let r = rig();
        let body = r.hub.capabilities_body_for(&full_caps(), false, false);
        let kinds: Vec<&str> = body["kinds"].as_array().unwrap().iter().map(|k| k["kind"].as_str().unwrap()).collect();
        assert_eq!(kinds, ["image", "image-to-image", "video", "image-to-video"]);
        assert_eq!(body["characters"], json!([]));
        assert!(!body.to_string().contains("char_mia"));
        assert_eq!(body["limits"]["upload_types"], json!(["image/png", "image/jpeg", "image/webp"]));
    }

    #[test]
    fn capabilities_name_availability_reasons_characters_and_the_edit_limit() {
        let r = rig();
        let body = r.hub.capabilities_body(&full_caps(), false);
        let kind = |k: &str| body["kinds"].as_array().unwrap().iter().find(|x| x["kind"] == k).unwrap().clone();
        assert_eq!(kind("music")["available"], false);
        assert_eq!(kind("music")["reason"], "No music model is installed on your computer.");
        assert_eq!(kind("removebg")["available"], true);
        assert!(kind("removebg")["reason"].is_null());
        // No model and no word of the window: unavailable, with the fixed sentence.
        assert_eq!(kind("image-to-video")["available"], false);
        assert_eq!(kind("image-to-video")["reason"], Kind::ImageToVideo.default_reason());
        assert_eq!(body["limits"]["max_edit_inputs"], 3);
        assert_eq!(body["characters"][0]["id"], "local:char_mia_zimage.safetensors");
        assert_eq!(body["characters"][0]["trigger"], "mia");
        let edit = kind("edit")["schema"].clone();
        assert_eq!(edit["properties"]["input_ids"]["maxItems"], 3);
        assert!(edit["properties"]["mask_id"].is_object());
        assert!(edit["required"].as_array().unwrap().contains(&json!("prompt")));
        let up = kind("upscale")["schema"].clone();
        assert_eq!(up["properties"]["factor"]["enum"], json!([2, 4]));
        assert!(up["properties"]["prompt"].is_null());
        let music = kind("music")["schema"].clone();
        assert_eq!(music["properties"]["duration"]["minimum"], 10);
        assert_eq!(music["properties"]["lyrics"]["maxLength"], MAX_LYRICS_CHARS);
        assert_eq!(kind("image")["schema"]["properties"]["character"]["enum"], json!(["local:char_mia_zimage.safetensors"]));
        assert!(kind("video")["schema"]["properties"]["character"].is_null(), "the window said video takes none");
        // Stage 1's fields stay as they were.
        assert_eq!(kind("image")["schema"]["properties"]["count"]["maximum"], MAX_COUNT);
        assert_eq!(kind("video")["schema"]["properties"]["count"]["maximum"], 1);
    }

    #[tokio::test]
    async fn the_status_words_follow_what_the_engine_can_do() {
        let r = rig();
        assert!(r.hub.stage_two_features(now_secs()).is_empty(), "no answer yet, no words");
        r.hub.capabilities_reply("", full_caps());
        let words = r.hub.stage_two_features(now_secs());
        assert_eq!(words, vec!["create-edit", "create-upscale", "create-removebg", "create-character", "create-gallery"]);
        let none = sanitize_caps(&json!({"kinds":{"image":{"models":[{"id":"flux"}]}}}));
        r.hub.capabilities_reply("", none);
        assert_eq!(r.hub.stage_two_features(now_secs()), vec!["create-gallery"]);
        // ComfyUI still starting: stage 1 lets a job start it, stage 2 waits
        // for the window's word.
        let starting = json!({"engine_ready": false, "kinds": {"music": {"models": [], "available": false, "reason": "ComfyUI is not running."}}});
        r.hub.capabilities_reply("", starting.clone());
        assert!(availability(&sanitize_caps(&starting), Kind::Image).0);
        assert!(!availability(&sanitize_caps(&starting), Kind::Music).0);
    }

    fn wav(seconds: u32) -> Vec<u8> {
        let rate = 8000u32;
        let data = rate * 2 * seconds;
        let mut v = Vec::new();
        v.extend_from_slice(b"RIFF");
        v.extend_from_slice(&(36 + data).to_le_bytes());
        v.extend_from_slice(b"WAVEfmt ");
        v.extend_from_slice(&16u32.to_le_bytes());
        v.extend_from_slice(&1u16.to_le_bytes());
        v.extend_from_slice(&1u16.to_le_bytes());
        v.extend_from_slice(&rate.to_le_bytes());
        v.extend_from_slice(&(rate * 2).to_le_bytes());
        v.extend_from_slice(&2u16.to_le_bytes());
        v.extend_from_slice(&16u16.to_le_bytes());
        v.extend_from_slice(b"data");
        v.extend_from_slice(&data.to_le_bytes());
        v.resize(v.len() + data as usize, 0);
        v
    }

    #[test]
    fn a_track_is_a_result_with_its_length_and_without_a_picture_size() {
        let r = rig();
        let (v, _) = r.hub.submit("dev", None, JobSpec::text(Kind::Music, "lofi"), 1).unwrap();
        let file = r.out.path().join("track.wav");
        std::fs::write(&file, wav(3)).unwrap();
        let done = r.hub.finish(v["id"].as_str().unwrap(), true, None, vec![OutputRef { path: Some(file.to_string_lossy().into()), ..Default::default() }], 2).unwrap();
        let res = &done["results"][0];
        assert_eq!(res["mime"], "audio/wav");
        assert_eq!(res["duration_ms"], 3000);
        assert!(res.get("width").is_none() && res.get("height").is_none());
        assert_eq!(media_mime(b"fLaC\0\0\0\x22"), Some("audio/flac"));
        assert_eq!(media_mime(b"ID3\x04\0\0\0\0\0\0"), Some("audio/mpeg"));
        // FLAC: 44100 Hz, 88200 samples.
        let mut flac = b"fLaC\0\0\0\x22".to_vec();
        let mut info = [0u8; 34];
        info[10] = (44100u32 >> 12) as u8;
        info[11] = (44100u32 >> 4) as u8;
        info[12] = ((44100u32 & 0x0F) << 4) as u8;
        info[14..18].copy_from_slice(&88200u32.to_be_bytes());
        flac.extend_from_slice(&info);
        assert_eq!(flac_duration_ms(&flac), Some(2000));
        // MP3, MPEG 1 layer III at 128 kbit/s, 32000 bytes of frames: 2 s.
        let mut mp3 = vec![0xFF, 0xFB, 0x90, 0x00];
        mp3.resize(32000, 0);
        assert_eq!(mp3_duration_ms(&mp3, 32000), Some(2000));
    }

    /// Answers every gallery question of the window with `items`.
    fn answer_gallery(r: &Rig, items: Value) -> tokio::task::JoinHandle<()> {
        let hub = r.hub.clone();
        let host = r.host.clone();
        tokio::spawn(async move {
            let mut answered = 0usize;
            loop {
                let asks = host.actions("gallery");
                for a in asks.iter().skip(answered) {
                    hub.gallery_reply(a["request_id"].as_str().unwrap(), items.clone());
                }
                answered = asks.len();
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
    }

    #[tokio::test]
    async fn the_gallery_lists_pages_previews_and_serves_files_of_the_output_folders_only() {
        use sha2::{Digest, Sha256};
        let r = rig();
        let elsewhere = tempfile::tempdir().unwrap();
        let a = r.out.path().join("a.png");
        std::fs::write(&a, png(640, 480, 9)).unwrap();
        let t = r.out.path().join("t.wav");
        std::fs::write(&t, wav(1)).unwrap();
        let secret = elsewhere.path().join("s.png");
        std::fs::write(&secret, png(4, 4, 1)).unwrap();
        let items = json!([
            {"key":"k-old","media":"image","path":a.to_string_lossy(),"prompt":"old","model":"m","created_at": 1_000_000_000_000u64,"from_phone":true},
            {"key":"k-new","media":"audio","path":t.to_string_lossy(),"prompt":"new","model":"ace","created_at": 2_000_000_000_000u64},
            {"key":"k-out","media":"image","path":secret.to_string_lossy(),"prompt":"no","created_at": 3_000_000_000_000u64},
        ]);
        let answering = answer_gallery(&r, items);
        let (base, task) = serve(router(&r, true)).await;
        let c = reqwest::Client::builder().no_proxy().build().unwrap();
        let page: Value = c.get(format!("{base}/remote-api/create/gallery?limit=1")).send().await.unwrap().json().await.unwrap();
        let first = &page["items"][0];
        assert_eq!(first["media"], "audio", "newest first, and the file outside the folders is not there");
        assert_eq!(first["created_at"], 2_000_000_000u64);
        assert_eq!(first["duration_ms"], 1000);
        assert!(first["width"].is_null());
        let next = page["next"].as_str().unwrap().to_string();
        let page2: Value = c.get(format!("{base}/remote-api/create/gallery?limit=60&before={next}")).send().await.unwrap().json().await.unwrap();
        assert_eq!(page2["items"].as_array().unwrap().len(), 1);
        assert!(page2["next"].is_null());
        let img = page2["items"][0].clone();
        assert_eq!((img["width"].as_u64(), img["from_phone"].as_bool()), (Some(640), Some(true)));
        let id = img["id"].as_str().unwrap();
        // The same entry keeps its id.
        let again: Value = c.get(format!("{base}/remote-api/create/gallery")).send().await.unwrap().json().await.unwrap();
        assert_eq!(again["items"][1]["id"], img["id"]);
        // The entry with its hash, then a preview and the file in pieces.
        let one: Value = c.get(format!("{base}/remote-api/create/gallery/{id}")).send().await.unwrap().json().await.unwrap();
        let want: String = Sha256::digest(std::fs::read(&a).unwrap()).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(one["sha256"], want);
        let thumb = c.get(format!("{base}/remote-api/create/gallery/{id}/thumb")).send().await.unwrap();
        assert_eq!(thumb.headers()["content-type"], "image/jpeg");
        let jpeg = thumb.bytes().await.unwrap();
        let (w, h) = image::ImageReader::new(std::io::Cursor::new(jpeg.to_vec())).with_guessed_format().unwrap().into_dimensions().unwrap();
        assert_eq!((w, h), (320, 240));
        let audio_id = first["id"].as_str().unwrap();
        assert_eq!(c.get(format!("{base}/remote-api/create/gallery/{audio_id}/thumb")).send().await.unwrap().status(), StatusCode::NOT_FOUND);
        let mut whole = Vec::new();
        let total = std::fs::metadata(&a).unwrap().len();
        while (whole.len() as u64) < total {
            let resp = c.get(format!("{base}/remote-api/create/gallery/{id}/file?offset={}&length=100", whole.len())).send().await.unwrap();
            assert_eq!(resp.headers()["x-lu-sha256"], want.as_str());
            whole.extend_from_slice(&resp.bytes().await.unwrap());
        }
        assert_eq!(whole, std::fs::read(&a).unwrap());
        // The list now names the hash too.
        let listed: Value = c.get(format!("{base}/remote-api/create/gallery?limit=60&before={next}")).send().await.unwrap().json().await.unwrap();
        assert_eq!(listed["items"][0]["sha256"], want);
        assert_eq!(c.get(format!("{base}/remote-api/create/gallery/gal_00000000000000000000000000000000")).send().await.unwrap().status(), StatusCode::NOT_FOUND);
        assert_eq!(c.get(format!("{base}/remote-api/create/gallery?before=gal_11111111111111111111111111111111")).send().await.unwrap().status(), StatusCode::BAD_REQUEST);
        answering.abort();
        task.abort();
    }

    #[tokio::test]
    async fn the_gallery_is_behind_the_permission_and_says_when_the_window_is_silent() {
        let r = rig();
        let (base, task) = serve(router(&r, false)).await;
        let c = reqwest::Client::builder().no_proxy().build().unwrap();
        for path in ["gallery", "gallery/gal_00000000000000000000000000000000", "gallery/gal_00000000000000000000000000000000/thumb", "gallery/gal_00000000000000000000000000000000/file"] {
            assert_eq!(c.get(format!("{base}/remote-api/create/{path}")).send().await.unwrap().status(), StatusCode::FORBIDDEN, "{path}");
        }
        task.abort();
        let (base, task) = serve(router(&r, true)).await;
        assert_eq!(c.get(format!("{base}/remote-api/create/gallery")).send().await.unwrap().status(), StatusCode::SERVICE_UNAVAILABLE);
        task.abort();
    }

    #[tokio::test]
    async fn an_unknown_kind_is_400_and_a_kind_that_cannot_run_is_409_over_the_wire() {
        let r = rig();
        r.hub.capabilities_reply("", full_caps());
        let (base, task) = serve(router(&r, true)).await;
        let c = reqwest::Client::builder().no_proxy().build().unwrap();
        let url = format!("{base}/remote-api/create/jobs");
        let resp = c.post(&url).json(&json!({"kind":"hologram","prompt":"x"})).send().await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert_eq!(resp.json::<Value>().await.unwrap(), json!({"error":"unsupported_kind"}));
        let resp = c.post(&url).json(&json!({"kind":"music","prompt":"lofi"})).send().await.unwrap();
        assert_eq!(resp.status(), StatusCode::CONFLICT);
        assert_eq!(resp.json::<Value>().await.unwrap(), json!({"error":"unavailable","reason":"No music model is installed on your computer."}));
        task.abort();
    }

    #[tokio::test]
    async fn the_agent_takes_an_upload_of_its_phone_as_input_image_and_nothing_else() {
        let r = rig();
        let up = r.hub.add_upload("dev", PNG_1X1).unwrap();
        let id = up["id"].as_str().unwrap();
        let refused = run_for_agent(&r.hub, "dev", None, Kind::Image, &json!({"prompt":"x","inputImage":"/etc/passwd"}), false).await;
        assert!(refused["error"].as_str().unwrap().contains("upload id"));
        let hub = r.hub.clone();
        let args = json!({"prompt":"restyle","inputImage": id});
        let agent = tokio::spawn(async move { run_for_agent(&hub, "dev", None, Kind::Image, &args, false).await });
        let run = loop {
            if let Some(run) = r.host.actions("run").first().cloned() {
                break run;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        };
        assert_eq!(run["job"]["kind"], "image-to-image");
        assert!(run["job"]["input_path"].is_string());
        let file = r.out.path().join("i2i.png");
        std::fs::write(&file, PNG_1X1).unwrap();
        r.hub.finish(run["job"]["id"].as_str().unwrap(), true, None, vec![OutputRef { path: Some(file.to_string_lossy().into()), ..Default::default() }], now_secs()).unwrap();
        let out = agent.await.unwrap();
        assert!(out["content"].as_str().unwrap().contains("Image generated"));
        // A video from an upload is image to video; another phone's upload is not found.
        let other = run_for_agent(&r.hub, "dev-b", None, Kind::Video, &json!({"prompt":"x","input_id": id}), false).await;
        assert!(other["error"].as_str().unwrap().contains("upload"));
    }

    fn jpeg(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(w, h, image::Rgb([9, 9, 9]));
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut out).encode_image(&img).unwrap();
        out
    }

    #[test]
    fn a_clip_gets_its_first_frame_as_preview_where_the_computer_can_read_it() {
        let out = tempfile::tempdir().unwrap();
        let clip = out.path().join("c.mp4");
        std::fs::write(&clip, [0, 0, 0, 0x18, b'f', b't', b'y', b'p', b'i', b's', b'o', b'm', 1, 2, 3]).unwrap();
        let file = describe(&clip, false, "gal").unwrap();
        assert_eq!(file.mime, "video/mp4");
        let host = |frame: Option<Vec<u8>>| FakeHost { roots: vec![out.path().to_path_buf()], frame, ..Default::default() };
        assert_eq!(make_thumb(&file, &host(Some(jpeg(320, 180)))).unwrap(), jpeg(320, 180));
        // No ffmpeg and no Quick Look: no preview, the phone shows its icon.
        assert_eq!(make_thumb(&file, &host(None)), Err(StatusCode::NOT_FOUND));
        // Only a JPEG within the size comes back.
        assert_eq!(make_thumb(&file, &host(Some(jpeg(640, 360)))), Err(StatusCode::NOT_FOUND));
        assert_eq!(make_thumb(&file, &host(Some(b"not a picture".to_vec()))), Err(StatusCode::NOT_FOUND));
        // A clip swapped since it was listed is not read.
        std::fs::write(&clip, b"\x00\x00\x00\x18ftypisomother bytes").unwrap();
        assert_eq!(make_thumb(&file, &host(Some(jpeg(320, 180)))), Err(StatusCode::GONE));
    }
}
