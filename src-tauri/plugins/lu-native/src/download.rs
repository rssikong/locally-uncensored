//! Background downloads: the part that is the same on every platform.
//!
//! The transfer itself is native, because only the operating system can keep
//! one alive while the app is suspended or gone: `URLSession` with a
//! background configuration on iOS (ios/Sources/Downloads.swift), a foreground
//! service of type dataSync on Android (DownloadService.kt). Both write to
//! `<dest minus extension>.download`, check size and SHA-256 when the last
//! byte is in, and rename the file into place, also when no webview and no
//! Rust is running. Both keep their list in a file, so it survives the end of
//! the process.
//!
//! What lives here is what must not differ between the two:
//!
//!   * the states and which command is allowed in which state (`decide`),
//!   * which native fact leads to which state (`next_state`, the table both
//!     native sides implement),
//!   * the checks on what the frontend hands in (`check_start`),
//!   * the naming rule of the partial file (`partial_path`),
//!   * the SHA-256 and size check (`verify_file`), used directly by
//!     `download_to_temp`.

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Where a download stands. The strings are the wire format, shared with
/// Kotlin and Swift and with the file the list is kept in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BgState {
    /// Accepted, no byte yet.
    Queued,
    Running,
    /// Wants to run and cannot: no network. Continues by itself.
    Waiting,
    /// Stopped by the user. The partial file stays.
    Paused,
    /// All bytes are in, size and SHA-256 are being checked.
    Verifying,
    /// Checked and renamed into place.
    Done,
    Error,
    /// Stopped by the user, partial file removed. Only seen in an event, a
    /// cancelled download leaves the list.
    Cancelled,
}

impl BgState {
    /// The transfer owns its partial file in these states.
    pub fn is_live(self) -> bool {
        matches!(self, Self::Queued | Self::Running | Self::Waiting | Self::Verifying)
    }
}

/// One line of the list, as both native sides report it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BgDownload {
    pub id: String,
    pub url: String,
    /// Absolute path of the finished file.
    pub dest: String,
    pub state: BgState,
    #[serde(default)]
    pub received_bytes: u64,
    /// What the server states. 0 while unknown.
    #[serde(default)]
    pub total_bytes: u64,
    /// What the caller expected, for the display before the server spoke.
    #[serde(default)]
    pub expected_bytes: u64,
    #[serde(default)]
    pub bytes_per_second: f64,
    #[serde(default)]
    pub sha256: Option<String>,
    /// A sentence in English, set in state `error`.
    #[serde(default)]
    pub error: Option<String>,
    /// Stable: `http-404`, `checksum`, `size`, `disk`, `network`, `io`,
    /// `unknown`.
    #[serde(default)]
    pub error_code: Option<String>,
    /// Whether Resume continues from the bytes on disk.
    #[serde(default)]
    pub resumable: bool,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BgStart {
    pub id: String,
    pub url: String,
    pub dest: String,
    #[serde(default)]
    pub expected_bytes: Option<u64>,
    /// Compare `expected_bytes` with the finished file. Off by default: a
    /// catalog size is an estimate, only the server's own number decides
    /// whether a transfer is complete.
    #[serde(default)]
    pub expected_bytes_exact: bool,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub headers: std::collections::HashMap<String, String>,
    /// Shown in the Android notification.
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BgCommand {
    Pause,
    Resume,
    Cancel,
    Forget,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// Hand the command to the native side.
    Do,
    /// Nothing to do, and that is fine. The text is the `status` answered.
    Noop(&'static str),
    Refuse(&'static str),
}

/// Is this command allowed in this state?
///
/// One table for both platforms, asked before a command reaches native code.
pub fn decide(state: BgState, command: BgCommand) -> Decision {
    use BgCommand::*;
    use BgState::*;
    match (command, state) {
        (Pause, Queued | Running | Waiting) => Decision::Do,
        (Pause, Paused) => Decision::Noop("paused"),
        (Pause, Verifying) => Decision::Refuse("This download has all its bytes and is being checked. It cannot be paused any more."),
        (Pause, Done) => Decision::Refuse("This download is finished."),
        (Pause, Error | Cancelled) => Decision::Refuse("This download is not running."),

        (Resume, Paused | Error) => Decision::Do,
        (Resume, Queued | Running | Waiting | Verifying) => Decision::Noop("already_running"),
        (Resume, Done) => Decision::Noop("done"),
        (Resume, Cancelled) => Decision::Refuse("This download was cancelled. Start it again."),

        // Cancel throws the bytes away, so it never touches a finished file.
        (Cancel, Done) => Decision::Refuse("This download is finished. Delete the file instead."),
        (Cancel, Cancelled) => Decision::Noop("cancelled"),
        (Cancel, _) => Decision::Do,

        // Forget drops the line and leaves the disk alone, so it must not
        // pull the line out from under a running transfer.
        (Forget, Paused | Done | Error | Cancelled) => Decision::Do,
        (Forget, Queued | Running | Waiting | Verifying) => {
            Decision::Refuse("This download is still running. Pause or cancel it first.")
        }
    }
}

/// What a native side can observe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BgFact {
    /// Bytes arrived.
    Progress,
    NetworkLost,
    NetworkBack,
    /// The last byte is on disk.
    TransferComplete,
    Verified,
    VerifyFailed,
    /// The transfer ended with an error.
    Failed,
    UserPaused,
    UserResumed,
    UserCancelled,
}

/// The transition table. Kotlin (`DownloadStore.kt`) and Swift
/// (`Downloads.swift`) implement exactly this, the tests below pin it.
///
/// The rule that matters most: a fact that arrives late never revives a
/// download the user stopped. A progress callback that was already on its
/// way when Pause was pressed must not flip the line back to running.
pub fn next_state(state: BgState, fact: BgFact) -> BgState {
    use BgFact::*;
    use BgState::*;
    match (state, fact) {
        (Done | Cancelled, _) => state,
        (_, UserCancelled) => Cancelled,

        (Paused, UserResumed) => Queued,
        (Error, UserResumed) => Queued,
        (Paused | Error, _) => state,

        (Queued | Running | Waiting, UserPaused) => Paused,
        (Queued | Running | Waiting, Progress) => Running,
        (Queued | Running, NetworkLost) => Waiting,
        (Waiting, NetworkBack) => Queued,
        (Queued | Running | Waiting, TransferComplete) => Verifying,
        (Queued | Running | Waiting, Failed) => Error,

        (Verifying, Verified) => Done,
        (Verifying, VerifyFailed) => Error,
        (Verifying, Failed) => Error,

        _ => state,
    }
}

/// `model.gguf` downloads into `model.download`.
///
/// The extension is REPLACED, not appended. That is the rule the desktop
/// download uses (`Path::with_extension` in commands/download.rs), and the
/// frontend's orphan scan depends on it.
/// The highest speed limit that is taken, 1 GB/s. Above it a limit is none.
pub const LIMIT_MAX_BPS: u64 = 1_000_000_000;

/// How long the transfer that just received `bytes` waits before it reads
/// on, so that all transfers together stay at `limit_bps`. Answers the new
/// end of the shared slot and the wait, both in milliseconds.
///
/// The rule of the desktop download (`throttle_wait` in the app) and of
/// `DownloadEngine.kt`, which is the one that runs on a phone: a line that
/// has been idle starts from now, so a pause never turns into a burst.
pub fn throttle_wait(slot_end_ms: u64, limit_bps: u64, bytes: u64, now_ms: u64) -> (u64, u64) {
    if limit_bps == 0 {
        return (0, 0);
    }
    let start = slot_end_ms.max(now_ms);
    let done = start + (bytes.saturating_mul(1000)).div_ceil(limit_bps);
    (done, done - now_ms)
}

pub fn partial_path(dest: &Path) -> PathBuf {
    dest.with_extension("download")
}

/// 64 hex digits, lower case. Accepts an optional `sha256:` in front.
pub fn normalize_sha256(raw: &str) -> Result<String, String> {
    let v = raw.trim();
    let v = v.strip_prefix("sha256:").unwrap_or(v).to_ascii_lowercase();
    if v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(v)
    } else {
        Err("The SHA-256 of this file is not 64 hex digits.".to_string())
    }
}

/// Ids become part of a file name on the native side and a key in a JSON
/// file. Refuse what could leave a folder or break either.
pub fn check_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 200
        && !id.starts_with('.')
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '+' | '@' | ' ' | '(' | ')'));
    if ok {
        Ok(())
    } else {
        Err("That download id is not valid.".to_string())
    }
}

/// Everything about a start that can be judged without touching the network.
/// Returns the request with `sha256` normalised.
pub fn check_start(mut start: BgStart, allowed_roots: &[PathBuf], allow_test_hosts: bool) -> Result<BgStart, String> {
    check_id(&start.id)?;
    crate::net::check_public_url(&start.url, allow_test_hosts)?;
    let dest = PathBuf::from(&start.dest);
    if !dest.is_absolute() || dest.file_name().is_none() {
        return Err("The destination of a download has to be a full file path.".to_string());
    }
    if dest.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("The destination of a download must not contain \"..\".".to_string());
    }
    if dest.extension().map(|e| e == "download").unwrap_or(false) {
        return Err("A file cannot be downloaded under the ending .download.".to_string());
    }
    // No folder known is a refusal, not a free pass: when the platform names
    // no folder there is nothing a destination could be checked against
    // (review N7).
    if !allowed_roots.iter().any(|root| dest.starts_with(root)) {
        return Err("Downloads can only be saved inside the app's own folders.".to_string());
    }
    if let Some(sha) = start.sha256.as_deref() {
        start.sha256 = Some(normalize_sha256(sha)?);
    }
    for name in start.headers.keys() {
        let lower = name.to_ascii_lowercase();
        if matches!(lower.as_str(), "host" | "content-length" | "range" | "connection" | "transfer-encoding") {
            return Err(format!("The header {name} cannot be set for a download."));
        }
    }
    Ok(start)
}

/// SHA-256 of a file, read in pieces. A model is several gigabytes, it must
/// never be in memory as a whole.
pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex(&hasher.finalize()))
}

pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 0x0f) as usize] as char);
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerifyError {
    Missing,
    /// The file has `actual` bytes and `expected` were promised.
    Size { expected: u64, actual: u64 },
    Checksum { expected: String, actual: String },
    Io(String),
}

impl VerifyError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Missing | Self::Io(_) => "io",
            Self::Size { .. } => "size",
            Self::Checksum { .. } => "checksum",
        }
    }

    /// The same sentences the native sides use.
    pub fn message(&self) -> String {
        match self {
            Self::Missing => "The downloaded file is not there any more.".to_string(),
            Self::Size { expected, actual } => format!(
                "The download ended early: {actual} of {expected} bytes arrived. Start it again to continue."
            ),
            Self::Checksum { .. } => {
                "The downloaded file is damaged: its checksum does not match. It was removed, start the download again."
                    .to_string()
            }
            Self::Io(_) => "The downloaded file could not be read.".to_string(),
        }
    }
}

/// Size first (cheap), then SHA-256 (reads the whole file).
pub fn verify_file(path: &Path, expected_bytes: Option<u64>, sha256: Option<&str>) -> Result<u64, VerifyError> {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(VerifyError::Missing),
        Err(e) => return Err(VerifyError::Io(e.kind().to_string())),
    };
    let actual = meta.len();
    if let Some(expected) = expected_bytes {
        if expected != actual {
            return Err(VerifyError::Size { expected, actual });
        }
    }
    if let Some(expected) = sha256 {
        let got = sha256_file(path).map_err(|e| VerifyError::Io(e.kind().to_string()))?;
        if !got.eq_ignore_ascii_case(expected) {
            return Err(VerifyError::Checksum { expected: expected.to_ascii_lowercase(), actual: got });
        }
    }
    Ok(actual)
}

/// Check the partial file and move it into place.
///
/// The rename is the last step and it is atomic inside one folder: a reader
/// sees either no file or the whole checked file, never a half one. A file
/// that fails its checksum is removed, it cannot be resumed into a good one.
/// A file that is too short stays, the transfer continues from it.
pub fn finalize(partial: &Path, dest: &Path, expected_bytes: Option<u64>, sha256: Option<&str>) -> Result<u64, VerifyError> {
    match verify_file(partial, expected_bytes, sha256) {
        Ok(bytes) => {
            std::fs::rename(partial, dest).map_err(|e| VerifyError::Io(e.kind().to_string()))?;
            Ok(bytes)
        }
        Err(e @ VerifyError::Checksum { .. }) => {
            let _ = std::fs::remove_file(partial);
            Err(e)
        }
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_speed_limit_is_shared_and_never_bursts() {
        // 1 MB/s, pieces of 128 kB: each one costs 128 ms.
        let (slot, wait) = throttle_wait(0, 1_000_000, 128_000, 10_000);
        assert_eq!((slot, wait), (10_128, 128));
        // A second transfer in the same moment queues behind the first.
        let (slot, wait) = throttle_wait(slot, 1_000_000, 128_000, 10_000);
        assert_eq!((slot, wait), (10_256, 256));
        // After a pause the line starts from now, not from the old slot.
        assert_eq!(throttle_wait(slot, 1_000_000, 128_000, 60_000), (60_128, 128));
        // No limit: no wait, and the slot is forgotten.
        assert_eq!(throttle_wait(slot, 0, 128_000, 10_000), (0, 0));
        // Ten seconds of pieces at 1 MB/s take ten seconds.
        let mut slot = 0;
        let mut now = 0;
        for _ in 0..100 {
            let (next, wait) = throttle_wait(slot, 1_000_000, 100_000, now);
            slot = next;
            now += wait;
        }
        assert_eq!(now, 10_000);
    }
    use BgCommand::*;
    use BgFact::*;
    use BgState::*;

    const ALL: [BgState; 8] = [Queued, Running, Waiting, Paused, Verifying, Done, Error, Cancelled];

    #[test]
    fn states_travel_as_lower_case_words() {
        assert_eq!(serde_json::to_string(&Waiting).unwrap(), "\"waiting\"");
        assert_eq!(serde_json::from_str::<BgState>("\"verifying\"").unwrap(), Verifying);
    }

    #[test]
    fn a_native_record_parses_with_only_the_required_fields() {
        let d: BgDownload = serde_json::from_str(
            r#"{"id":"m.gguf","url":"https://h/m.gguf","dest":"/data/models/m.gguf","state":"running","receivedBytes":10,"totalBytes":100}"#,
        )
        .unwrap();
        assert_eq!(d.received_bytes, 10);
        assert_eq!(d.error, None);
        assert!(!d.resumable);
    }

    #[test]
    fn the_happy_path() {
        let mut s = Queued;
        for f in [Progress, Progress, TransferComplete, Verified] {
            s = next_state(s, f);
        }
        assert_eq!(s, Done);
    }

    #[test]
    fn pause_and_resume() {
        let s = next_state(Running, UserPaused);
        assert_eq!(s, Paused);
        let s = next_state(s, UserResumed);
        assert_eq!(s, Queued);
        assert_eq!(next_state(s, Progress), Running);
    }

    #[test]
    fn a_late_fact_does_not_revive_a_stopped_download() {
        for f in [Progress, NetworkBack, NetworkLost, TransferComplete, Verified, Failed] {
            assert_eq!(next_state(Paused, f), Paused, "{f:?}");
            assert_eq!(next_state(Cancelled, f), Cancelled, "{f:?}");
            assert_eq!(next_state(Done, f), Done, "{f:?}");
        }
        // An error stays an error until the user asks again.
        assert_eq!(next_state(Error, Progress), Error);
        assert_eq!(next_state(Error, UserResumed), Queued);
    }

    #[test]
    fn the_network_going_away_is_not_an_error() {
        let s = next_state(Running, NetworkLost);
        assert_eq!(s, Waiting);
        let s = next_state(s, NetworkBack);
        assert_eq!(s, Queued);
        // Bytes arriving are proof enough that the network is back.
        assert_eq!(next_state(Waiting, Progress), Running);
    }

    #[test]
    fn a_failed_check_ends_in_error_and_never_in_done() {
        assert_eq!(next_state(Verifying, VerifyFailed), Error);
        assert_eq!(next_state(Verifying, Progress), Verifying);
        // Done is only reachable through Verifying.
        for s in ALL {
            if s != Verifying && s != Done {
                assert_ne!(next_state(s, Verified), Done, "{s:?}");
            }
        }
    }

    #[test]
    fn cancel_wins_from_every_state_that_is_not_finished() {
        for s in ALL {
            let n = next_state(s, UserCancelled);
            if s == Done {
                assert_eq!(n, Done);
            } else {
                assert_eq!(n, Cancelled, "{s:?}");
            }
        }
    }

    #[test]
    fn commands_follow_the_table() {
        assert_eq!(decide(Running, Pause), Decision::Do);
        assert_eq!(decide(Waiting, Pause), Decision::Do);
        assert_eq!(decide(Paused, Pause), Decision::Noop("paused"));
        assert!(matches!(decide(Verifying, Pause), Decision::Refuse(_)));
        assert!(matches!(decide(Done, Pause), Decision::Refuse(_)));

        assert_eq!(decide(Paused, Resume), Decision::Do);
        assert_eq!(decide(Error, Resume), Decision::Do);
        assert_eq!(decide(Running, Resume), Decision::Noop("already_running"));
        assert_eq!(decide(Done, Resume), Decision::Noop("done"));

        assert!(matches!(decide(Done, Cancel), Decision::Refuse(_)));
        for s in [Queued, Running, Waiting, Paused, Verifying, Error] {
            assert_eq!(decide(s, Cancel), Decision::Do, "{s:?}");
        }
    }

    #[test]
    fn forget_never_takes_the_line_of_a_running_transfer() {
        for s in ALL {
            let d = decide(s, Forget);
            assert_eq!(matches!(d, Decision::Refuse(_)), s.is_live(), "{s:?}");
        }
    }

    #[test]
    fn every_do_has_a_transition() {
        // A command the table lets through must change the state, or the
        // native side would be asked to do something that has no effect.
        for s in ALL {
            for (c, f) in [(Pause, UserPaused), (Resume, UserResumed), (Cancel, UserCancelled)] {
                if decide(s, c) == Decision::Do {
                    assert_ne!(next_state(s, f), s, "{s:?} {c:?}");
                }
            }
        }
    }

    #[test]
    fn the_partial_replaces_the_extension() {
        assert_eq!(partial_path(Path::new("/m/qwen.gguf")), PathBuf::from("/m/qwen.download"));
        assert_eq!(partial_path(Path::new("/m/wan_2.1_vae.safetensors")), PathBuf::from("/m/wan_2.1_vae.download"));
        assert_eq!(partial_path(Path::new("/m/noext")), PathBuf::from("/m/noext.download"));
    }

    #[test]
    fn sha256_is_normalised_or_refused() {
        let good = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855";
        assert_eq!(normalize_sha256(good).unwrap(), good.to_ascii_lowercase());
        assert_eq!(normalize_sha256(&format!("sha256:{good}")).unwrap(), good.to_ascii_lowercase());
        assert!(normalize_sha256("abc").is_err());
        assert!(normalize_sha256(&"g".repeat(64)).is_err());
    }

    #[test]
    fn ids_cannot_leave_a_folder() {
        for ok in ["qwen2.5-0.5b-q8_0.gguf", "model (1).gguf", "a+b@c.bin"] {
            assert!(check_id(ok).is_ok(), "{ok}");
        }
        for bad in ["", "../x", "a/b", "a\\b", ".hidden", "x\ny", "a\"b", &"x".repeat(201)] {
            assert!(check_id(bad).is_err(), "{bad:?}");
        }
    }

    fn start(dest: &str, url: &str) -> BgStart {
        BgStart {
            id: "m.gguf".into(),
            url: url.into(),
            dest: dest.into(),
            expected_bytes: None,
            expected_bytes_exact: false,
            sha256: None,
            headers: Default::default(),
            title: None,
        }
    }

    #[test]
    fn a_start_is_checked_before_anything_touches_the_network() {
        let roots = vec![PathBuf::from("/data/app")];
        assert!(check_start(start("/data/app/models/m.gguf", "https://huggingface.co/m.gguf"), &roots, false).is_ok());
        // Outside the app's folders.
        assert!(check_start(start("/sdcard/m.gguf", "https://huggingface.co/m.gguf"), &roots, false).is_err());
        // N7: no folder named by the platform means no destination is allowed.
        let none: Vec<PathBuf> = Vec::new();
        let refused = check_start(start("/data/app/models/m.gguf", "https://huggingface.co/m.gguf"), &none, false).unwrap_err();
        assert!(refused.contains("app's own folders"), "{refused}");
        assert!(check_start(start("/data/app/../other/m.gguf", "https://huggingface.co/m.gguf"), &roots, false).is_err());
        assert!(check_start(start("models/m.gguf", "https://huggingface.co/m.gguf"), &roots, false).is_err());
        // The partial name itself is not a destination.
        assert!(check_start(start("/data/app/models/m.download", "https://huggingface.co/m.gguf"), &roots, false).is_err());
        // Not a public https address.
        assert!(check_start(start("/data/app/models/m.gguf", "http://huggingface.co/m.gguf"), &roots, false).is_err());
        assert!(check_start(start("/data/app/models/m.gguf", "https://192.168.1.2/m.gguf"), &roots, false).is_err());
        // The acceptance switch lets a test server through.
        assert!(check_start(start("/data/app/models/m.gguf", "http://10.0.2.2:8799/m.gguf"), &roots, true).is_ok());

        let mut s = start("/data/app/models/m.gguf", "https://huggingface.co/m.gguf");
        s.sha256 = Some("nope".into());
        assert!(check_start(s, &roots, false).is_err());

        let mut s = start("/data/app/models/m.gguf", "https://huggingface.co/m.gguf");
        s.headers.insert("Range".into(), "bytes=0-1".into());
        assert!(check_start(s, &roots, false).is_err());

        let mut s = start("/data/app/models/m.gguf", "https://huggingface.co/m.gguf");
        s.headers.insert("Authorization".into(), "Bearer hf_x".into());
        s.sha256 = Some("SHA256:E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855".to_ascii_lowercase());
        let checked = check_start(s, &roots, false).unwrap();
        assert_eq!(checked.sha256.unwrap().len(), 64);
    }

    const EMPTY_SHA: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const ABC_SHA: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    #[test]
    fn sha256_of_known_content() {
        let dir = tempfile::tempdir().unwrap();
        let empty = dir.path().join("empty");
        std::fs::write(&empty, b"").unwrap();
        assert_eq!(sha256_file(&empty).unwrap(), EMPTY_SHA);
        let abc = dir.path().join("abc");
        std::fs::write(&abc, b"abc").unwrap();
        assert_eq!(sha256_file(&abc).unwrap(), ABC_SHA);
    }

    #[test]
    fn sha256_reads_a_file_larger_than_its_buffer() {
        // 2.5 buffers of a repeating pattern, compared with the digest of
        // the same bytes hashed in one go.
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("big");
        let data: Vec<u8> = (0..(2 * 1024 * 1024 + 524_288)).map(|i| (i % 251) as u8).collect();
        std::fs::write(&p, &data).unwrap();
        assert_eq!(sha256_file(&p).unwrap(), hex(&Sha256::digest(&data)));
    }

    #[test]
    fn verify_names_what_is_wrong() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f");
        std::fs::write(&p, b"abc").unwrap();
        assert_eq!(verify_file(&p, Some(3), Some(ABC_SHA)), Ok(3));
        assert_eq!(verify_file(&p, None, None), Ok(3));
        assert_eq!(verify_file(&p, Some(4), Some(ABC_SHA)), Err(VerifyError::Size { expected: 4, actual: 3 }));
        assert!(matches!(verify_file(&p, Some(3), Some(EMPTY_SHA)), Err(VerifyError::Checksum { .. })));
        assert_eq!(verify_file(&dir.path().join("gone"), None, None), Err(VerifyError::Missing));
        // Upper case from a catalog is the same digest.
        assert_eq!(verify_file(&p, None, Some(&ABC_SHA.to_ascii_uppercase())), Ok(3));
    }

    #[test]
    fn finalize_moves_a_good_file_and_only_a_good_file() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("m.gguf");
        let partial = partial_path(&dest);

        std::fs::write(&partial, b"abc").unwrap();
        assert_eq!(finalize(&partial, &dest, Some(3), Some(ABC_SHA)), Ok(3));
        assert!(dest.exists());
        assert!(!partial.exists());
        std::fs::remove_file(&dest).unwrap();

        // Wrong checksum: no file under the real name, and the damaged
        // partial is gone, it can never be resumed into a good one.
        std::fs::write(&partial, b"abd").unwrap();
        assert!(matches!(finalize(&partial, &dest, Some(3), Some(ABC_SHA)), Err(VerifyError::Checksum { .. })));
        assert!(!dest.exists());
        assert!(!partial.exists());

        // Too short: no file under the real name, the partial STAYS for a
        // resume.
        std::fs::write(&partial, b"ab").unwrap();
        assert_eq!(finalize(&partial, &dest, Some(3), Some(ABC_SHA)), Err(VerifyError::Size { expected: 3, actual: 2 }));
        assert!(!dest.exists());
        assert!(partial.exists());
    }

    #[test]
    fn error_codes_are_the_stable_ones() {
        assert_eq!(VerifyError::Size { expected: 2, actual: 1 }.code(), "size");
        assert_eq!(VerifyError::Checksum { expected: "a".into(), actual: "b".into() }.code(), "checksum");
        assert_eq!(VerifyError::Missing.code(), "io");
    }
}
