// B7 — system_health Tauri command. Returns a structured probe of every
// local backend LU cares about plus a couple of host facts, so the
// Settings → Troubleshoot panel can render an "everything in one
// glance" diagnostic. Each probe is bounded by a short HTTP timeout and
// classified into one of `ok` / `unreachable` / `timeout` / `not_installed`
// / `error` so the UI can colour-code without re-parsing strings.
//
// This is intentionally a one-shot synchronous probe (PROBE_TIMEOUT per
// backend, run concurrently), since Settings opens infrequently and a
// long-lived background poll would be more code for less value. The
// v2.4.5 "60s actionable ComfyUI panel" stays where it is; this is the
// broader picture.

use crate::state::AppState;
use serde::Serialize;
use std::time::Duration;
use sysinfo::{Disks, System};
use tauri::State;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)] // NotInstalled reserved for future "binary not on PATH" probes
pub enum ProbeStatus {
    Ok,
    Unreachable,
    NotInstalled,
    Error,
    /// The connection went through but nothing answered within the probe
    /// window, meaning a cold-starting or heavily-loaded local server, not a
    /// dead one. Kept separate from `Unreachable` (review T5, 2026-09-18): a
    /// server that would have answered "Not running" is the opposite of
    /// the truth and sent people restarting a backend that was fine. The
    /// UI reads this as "Reachable, slow to answer".
    Timeout,
}

#[derive(Debug, Serialize)]
pub struct BackendProbe {
    pub status: ProbeStatus,
    /// Free-form detail (HTTP status code, error string head). Empty when ok.
    pub detail: String,
    /// Endpoint that was probed. Useful for the "wait, was I looking at
    /// the wrong port?" debugging case.
    pub endpoint: String,
}

#[derive(Debug, Serialize)]
pub struct HostFacts {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub cpu_count: u32,
    /// Total physical memory, in GB rounded to 1 decimal.
    pub ram_gb: f64,
    /// Free disk space on the LU install drive, in GB.
    pub disk_free_gb: f64,
    /// Total VRAM of the (highest-memory) NVIDIA GPU, in GB rounded to 1
    /// decimal. `None` when nvidia-smi is absent / non-NVIDIA GPU / probe
    /// fails — the UI renders "—" in that case. Same soft-fail posture as
    /// the backend probes: a missing GPU never errors the whole report.
    pub vram_total_gb: Option<f64>,
    /// Free VRAM right now, in GB. `None` under the same conditions as
    /// `vram_total_gb`.
    pub vram_free_gb: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct SystemHealthReport {
    pub version: String,
    pub host: HostFacts,
    pub ollama: BackendProbe,
    pub comfyui: BackendProbe,
    pub lm_studio: BackendProbe,
}

/// How long a probe waits for a response before giving up.
///
/// Was 300 ms flat, which folded two very different situations into the same
/// "Not running" verdict (review T5, 2026-09-18): a refused connection
/// (nothing listening, genuinely not running, and 300 ms is already
/// generous for that) and a TCP connect that succeeds against a cold-starting
/// or heavily-loaded local server that just hasn't sent headers yet. Ollama
/// waking a model from disk or a ComfyUI mid-startup routinely takes longer
/// than 300 ms to answer its very first request. 1.5 s is short enough that
/// the one-shot Troubleshoot panel still feels instant, and long enough that
/// a live-but-slow server gets classified as `Timeout`, not `Unreachable`.
const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);

/// How long the CONNECT phase of a probe may take before the backend counts
/// as not running, derived from the probe window so a caller that shortens
/// the window shortens both halves with it.
///
/// Without a connect window of its own, Windows decided the verdict. A
/// connect to a closed port is not refused on the spot there the way it is on
/// Linux and macOS: the stack retransmits the SYN and only reports
/// WSAECONNREFUSED afterwards. Measured on the Windows box for plain
/// `127.0.0.1`, with nothing listening: 2.06 s for `TcpStream::connect`, the
/// same 2.02 s for tokio. That is longer than the whole probe window, so
/// reqwest's overall timeout fired first, the error was a timeout and not a
/// connect error, and every backend that was simply NOT RUNNING was reported
/// to a Windows customer as "Reachable, slow to answer" (the Troubleshoot
/// panel's `Timeout` wording). That is the same lie T5 removed for the
/// opposite case, pointing the other way: the panel told people a backend
/// they had never started was alive.
///
/// A third of the window is generous for what the connect phase does on THIS
/// machine, where a handshake either completes in microseconds or is never
/// going to complete. What remains of the window still belongs to the question
/// the timeout was raised for: a server that ACCEPTED the connection and is
/// slow to answer.
///
/// It is not generous for anything further away, which is why
/// [`connect_window_for`] hands it out only for a loopback target.
fn connect_window(timeout: Duration) -> Duration {
    timeout / 3
}

/// The connect window this URL may use, or `None` when the whole probe window
/// has to stay available for the handshake.
///
/// Ollama's and LM Studio's addresses are customer-configured
/// (`ollama_probe_url`, `lm_studio_probe_url`), so one of the three probes can
/// point at another machine. There the short window is wrong, and not because
/// a handshake needs longer: a SINGLE LOST SYN does. Windows only retransmits
/// after about a second, which is what the two seconds measured for a refused
/// connection are made of, so on a lossy WLAN a 500 ms window would expire
/// before the retransmission even goes out and a RUNNING Ollama would be
/// reported as "Not running". That is a worse answer than the one this whole
/// fix removed, so a remote host keeps the full window, and the verdict for a
/// remote backend that is genuinely off stays `Timeout` as it was before.
///
/// "Loopback" is answered by resolution, not by spelling: `127.0.0.1`, any
/// other `127.0.0.0/8` address, `::1`, and every name that resolves to
/// loopback only, which is the usual case for `localhost` and for a name a
/// customer put in their own hosts file. Anything that cannot be parsed or
/// cannot be resolved counts as remote, because the short window is the one
/// that has to be earned.
async fn connect_window_for(url: &str, timeout: Duration) -> Option<Duration> {
    if targets_loopback(url).await {
        Some(connect_window(timeout))
    } else {
        None
    }
}

/// Does every address behind this URL's host sit on loopback?
async fn targets_loopback(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else { return false };
    let Some(host) = parsed.host_str().map(|h| h.to_string()) else { return false };
    // An IPv6 host is serialized with its brackets; `IpAddr` does not want them.
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = bare.parse::<std::net::IpAddr>() {
        return ip.is_loopback();
    }
    let port = parsed.port_or_known_default().unwrap_or(80);
    match tokio::net::lookup_host((host, port)).await {
        Ok(addrs) => {
            let mut any = false;
            for addr in addrs {
                any = true;
                if !addr.ip().is_loopback() {
                    return false;
                }
            }
            any
        }
        Err(_) => false,
    }
}

// NOTE: this is `async` and uses the ASYNC reqwest client on purpose.
// system_health is a `#[tauri::command] async fn`, so its body runs on a
// tokio worker thread. `reqwest::blocking` builds (and on drop, tears down)
// its own internal runtime; doing that from inside an async context panics
// with "Cannot drop a runtime in a context where blocking is not allowed",
// the command future is aborted, and the IPC response is never sent — the
// Troubleshoot panel then hangs on "Probing…" forever. The async client
// shares the existing runtime and has no such problem.
async fn probe_http(url: &str, timeout: Duration) -> BackendProbe {
    let endpoint = url.to_string();
    let mut builder = reqwest::Client::builder().timeout(timeout);
    if let Some(connect) = connect_window_for(url, timeout).await {
        builder = builder.connect_timeout(connect);
    }
    let client = match builder.build() {
        Ok(c) => c,
        Err(e) => {
            return BackendProbe {
                status: ProbeStatus::Error,
                detail: format!("client build failed: {}", e),
                endpoint,
            };
        }
    };
    match client.get(url).send().await {
        Ok(resp) => {
            let code = resp.status();
            if code.is_success() {
                BackendProbe { status: ProbeStatus::Ok, detail: String::new(), endpoint }
            } else {
                BackendProbe {
                    status: ProbeStatus::Error,
                    detail: format!("HTTP {}", code.as_u16()),
                    endpoint,
                }
            }
        }
        Err(e) => {
            let msg = e.to_string();
            let head = msg.chars().take(160).collect::<String>();
            // `is_connect()` covers connection-refused cross-platform
            // (Windows reports "os error 10061 / actively refused", not the
            // Unix "Connection refused" string) and, since the client carries
            // a `connect_window`, a handshake that never completed either.
            // Both mean the same thing to the person reading the panel:
            // nothing accepted a connection, so nothing is running there.
            // This branch stays FIRST on purpose, because a connect timeout
            // answers true to `is_timeout()` as well.
            let refused = e.is_connect()
                || msg.contains("Connection refused")
                || msg.contains("ConnectFailed")
                || msg.contains("actively refused");
            if refused {
                BackendProbe { status: ProbeStatus::Unreachable, detail: head, endpoint }
            } else if e.is_timeout() {
                // The connection was accepted (or at least not refused) and
                // the server simply hasn't answered yet within `timeout`,
                // the inverse of `refused`, not the same bucket (T5: folding
                // this into Unreachable told a slow-but-alive server's owner
                // it was "Not running", which sent them restarting something
                // that was fine).
                BackendProbe { status: ProbeStatus::Timeout, detail: head, endpoint }
            } else {
                BackendProbe { status: ProbeStatus::Error, detail: head, endpoint }
            }
        }
    }
}

// ── VRAM probe (§17 — "disk/VRAM" host facts) ───────────────────────────────

/// Parse `nvidia-smi --query-gpu=memory.total,memory.free
/// --format=csv,noheader,nounits` output. Each line is one GPU:
/// `"24576, 23000"` (values in MiB, `nounits` strips the " MiB"). Returns
/// `(total_gb, free_gb)` for the GPU with the most total memory — picking the
/// biggest card matches the "what can I fit a model into?" question and
/// mirrors the ComfyUI installer taking the highest compute-cap across GPUs.
///
/// Returns `None` on empty / unparseable output. Conversion uses 1024 MiB =
/// 1 GiB (nvidia-smi reports MiB), rounded to 1 decimal to match ram_gb.
fn parse_nvidia_vram_csv(s: &str) -> Option<(f64, f64)> {
    let mut best: Option<(f64, f64)> = None;
    for line in s.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut parts = trimmed.split(',').map(|p| p.trim());
        let total_mib = parts.next().and_then(|t| t.parse::<f64>().ok());
        let free_mib = parts.next().and_then(|f| f.parse::<f64>().ok());
        let Some(total_mib) = total_mib else { continue };
        // free may be absent if the caller only queried memory.total; default 0.
        let free_mib = free_mib.unwrap_or(0.0);
        let to_gb = |mib: f64| (mib / 1024.0 * 10.0).round() / 10.0;
        let candidate = (to_gb(total_mib), to_gb(free_mib));
        if best.map(|(bt, _)| candidate.0 > bt).unwrap_or(true) {
            best = Some(candidate);
        }
    }
    best
}

/// Run nvidia-smi and return `(total_gb, free_gb)` for the biggest GPU, or
/// `None` on any failure (no nvidia-smi, non-NVIDIA box, non-zero exit,
/// unparseable output). Soft-fail like the HTTP probes — a short window is
/// fine since this is one local subprocess, but we still hide the console
/// window on Windows so it doesn't flash.
fn query_nvidia_vram() -> Option<(f64, f64)> {
    // K14: a foreign vendor CLI, never something LU bundles.
    let mut cmd = crate::process_util::foreign_system_command("nvidia-smi");
    cmd.args([
        "--query-gpu=memory.total,memory.free",
        "--format=csv,noheader,nounits",
    ]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    // Bounded: every OTHER probe in this report has a timeout, but this one
    // used Command::output() and a wedged driver makes nvidia-smi hang for
    // minutes — leaving the Troubleshoot panel spinning on exactly the machine
    // whose owner opened it because something was wrong.
    let s = crate::commands::shell::output_bounded(cmd, Duration::from_secs(3))?;
    parse_nvidia_vram_csv(&s)
}

fn collect_host_facts() -> HostFacts {
    let mut sys = System::new_all();
    sys.refresh_memory();
    let total_kb = sys.total_memory(); // bytes in sysinfo 0.33
    let ram_gb = (total_kb as f64) / 1_073_741_824.0;
    let cpu_count = num_cpus::get() as u32;
    let os = std::env::consts::OS.to_string();
    let os_version = System::os_version().unwrap_or_else(|| "unknown".to_string());
    let arch = std::env::consts::ARCH.to_string();
    // Free space on the drive that holds $HOME (or the closest mount
    // point sysinfo reports for it). Covers the "is the model dir
    // running out?" question without needing a separate probe.
    let disk_free_gb = {
        let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
        let disks = Disks::new_with_refreshed_list();
        // Pick the longest mount-point prefix that matches HOME — that's
        // the drive HOME actually lives on (vs. some unrelated drive
        // sysinfo also enumerated).
        let mut best: Option<(usize, u64)> = None;
        for disk in disks.list() {
            let mp = disk.mount_point();
            if let Some(s) = mp.to_str() {
                if home.starts_with(s) {
                    let len = s.len();
                    if best.map(|(b, _)| len > b).unwrap_or(true) {
                        best = Some((len, disk.available_space()));
                    }
                }
            }
        }
        let bytes = best.map(|(_, b)| b).unwrap_or(0);
        (bytes as f64) / 1_073_741_824.0
    };
    let (vram_total_gb, vram_free_gb) = match query_nvidia_vram() {
        Some((total, free)) => (Some(total), Some(free)),
        None => (None, None),
    };
    HostFacts {
        os,
        os_version,
        arch,
        cpu_count,
        ram_gb: (ram_gb * 10.0).round() / 10.0,
        disk_free_gb: (disk_free_gb * 10.0).round() / 10.0,
        vram_total_gb,
        vram_free_gb,
    }
}

/// The Ollama endpoint to probe: the user's configured base (Settings, or
/// `OLLAMA_HOST`) if it differs from the compiled-in default, else the
/// default itself. Was hardcoded `127.0.0.1:11434` regardless of `_state`
/// (review D1/T5, 2026-09-18), Issue #31 territory: anyone running Ollama
/// on another host or port (`OLLAMA_HOST=192.168.x.x`, a Docker container, a
/// LAN box) got told Ollama was "Not running" while it was answering fine on
/// the address they actually set, because the probe never looked at it.
fn ollama_probe_url(state: &AppState) -> String {
    let base = state
        .ollama_base
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "http://localhost:11434".to_string());
    format!("{}/api/tags", base.trim_end_matches('/'))
}

/// The ComfyUI endpoint to probe, built from the same `comfy_host` /
/// `comfy_port` every other ComfyUI-facing command reads (`v2.3.6` feature,
/// see `state.rs`), instead of the hardcoded `127.0.0.1:8188` this probe used
/// regardless of what the user configured.
fn comfy_probe_url(state: &AppState) -> String {
    let host = state
        .comfy_host
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "localhost".to_string());
    let port = state.comfy_port.lock().map(|g| *g).unwrap_or(8188);
    format!("http://{}:{}/system_stats", host, port)
}

// LM Studio has no equivalent configured-base field in `AppState`: unlike
// Ollama/ComfyUI, which Rust itself spawns/manages and therefore owns a
// persisted address for (`set_ollama_host`/`set_comfyui_host`, config.json),
// LM Studio is set up purely as a generic OpenAI-compatible provider slot in
// the frontend's persisted (webview-local) provider store, and Rust has no
// read access to that store. Giving LM Studio a second AppState field plus a
// `set_lm_studio_host` command would create a duplicate, Rust-owned copy of a
// value the frontend already owns and would have to keep both sides in sync
// (review R8 Nachbesserung, 2026-09-18) for no benefit, since Rust never
// spawns LM Studio and has nothing of its own to persist. Instead
// `system_health` takes the resolved base as an optional argument, exactly
// the "Befehlsargument" alternative construction the AppState field is the
// other half of: the caller (SettingsPage.tsx) reads its OWN provider store
// for whichever `openai`-slot entry is named "LM Studio" and passes that
// base along, same one-shot-probe shape as everything else here. Falls back
// to the documented local default when absent or unparsable.
const LM_STUDIO_PROBE_URL: &str = "http://127.0.0.1:1234/v1/models";

/// Turn a user-configured LM Studio base (e.g. `http://192.168.1.20:1234/v1`,
/// as stored by the frontend's provider slot) into a `/models` probe URL.
/// Mirrors `normalize_ollama_base`'s tolerance for a scheme-less host, but
/// soft-fails to the documented local default instead of erroring the whole
/// report: this is a best-effort probe, not a setter, and a bad or absent
/// override must never take the whole Troubleshoot panel down.
fn lm_studio_probe_url(override_base: Option<&str>) -> String {
    if let Some(raw) = override_base {
        let trimmed = raw.trim().trim_end_matches('/');
        if !trimmed.is_empty() {
            let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                trimmed.to_string()
            } else {
                format!("http://{}", trimmed)
            };
            if let Ok(u) = url::Url::parse(&with_scheme) {
                if u.host_str().is_some_and(|h| !h.is_empty()) {
                    return format!("{}/models", with_scheme);
                }
            }
        }
    }
    LM_STUDIO_PROBE_URL.to_string()
}

#[tauri::command]
pub async fn system_health(
    state: State<'_, AppState>,
    lm_studio_base: Option<String>,
) -> Result<SystemHealthReport, String> {
    let ollama_url = ollama_probe_url(&state);
    let comfy_url = comfy_probe_url(&state);
    let lm_studio_url = lm_studio_probe_url(lm_studio_base.as_deref());

    // Probe all three backends concurrently, each bounded by PROBE_TIMEOUT,
    // instead of 3x serial. review-winfix.md A1: this is no longer
    // "~PROBE_TIMEOUT total" for every target. connect_window_for resolves
    // the hostname BEFORE building the client, i.e. before PROBE_TIMEOUT
    // starts counting, and that resolution carries no timeout of its own; a
    // configured hostname whose DNS server is unreachable hangs for however
    // long the OS resolver takes (several seconds, possibly more on
    // Windows) before the 1.5s window even begins. Only a target that needs
    // no resolution (an IP literal, or a name already sitting on loopback)
    // still bounds at ~PROBE_TIMEOUT. Async client (see probe_http note);
    // never reqwest::blocking here.
    let (ollama, comfyui, lm_studio) = tokio::join!(
        probe_http(&ollama_url, PROBE_TIMEOUT),
        probe_http(&comfy_url, PROBE_TIMEOUT),
        probe_http(&lm_studio_url, PROBE_TIMEOUT),
    );

    // collect_host_facts is blocking (sysinfo refresh + nvidia-smi
    // subprocess). Run it off the async worker so it neither stalls the
    // runtime nor — like reqwest::blocking — panics inside it.
    let host = tokio::task::spawn_blocking(collect_host_facts)
        .await
        .map_err(|e| format!("host facts probe failed: {}", e))?;

    Ok(SystemHealthReport {
        version: crate::app_identity::APP_VERSION.to_string(),
        host,
        ollama,
        comfyui,
        lm_studio,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── D1/T5: the probe reads AppState instead of three hardcoded addresses ──

    #[test]
    fn ollama_probe_url_follows_a_configured_non_default_base() {
        // The default the state constructor seeds is the compiled-in
        // address; the point of the fix is that a DIFFERENT configured
        // address is what actually gets probed.
        let state = AppState::new();
        *state.ollama_base.lock().unwrap() = "http://192.168.1.50:9999".to_string();
        assert_eq!(ollama_probe_url(&state), "http://192.168.1.50:9999/api/tags");
    }

    #[test]
    fn ollama_probe_url_falls_back_to_the_default_when_unconfigured() {
        let state = AppState::new();
        // AppState::new() already seeds the documented default; the probe
        // must still reach it via the same field, not a second hardcoded copy.
        assert_eq!(ollama_probe_url(&state), "http://localhost:11434/api/tags");
    }

    #[test]
    fn ollama_probe_url_does_not_double_the_slash() {
        let state = AppState::new();
        *state.ollama_base.lock().unwrap() = "http://localhost:11434/".to_string();
        assert_eq!(ollama_probe_url(&state), "http://localhost:11434/api/tags");
    }

    #[test]
    fn comfy_probe_url_follows_a_configured_host_and_port() {
        let state = AppState::new();
        *state.comfy_host.lock().unwrap() = "comfy.lan".to_string();
        *state.comfy_port.lock().unwrap() = 8199;
        assert_eq!(comfy_probe_url(&state), "http://comfy.lan:8199/system_stats");
    }

    #[test]
    fn comfy_probe_url_falls_back_to_the_default_when_unconfigured() {
        let state = AppState::new();
        assert_eq!(comfy_probe_url(&state), "http://localhost:8188/system_stats");
    }

    // ── LM Studio: a non-default address passed as a command argument ──────

    #[test]
    fn lm_studio_probe_url_follows_a_non_default_argument() {
        assert_eq!(
            lm_studio_probe_url(Some("http://192.168.1.20:1234/v1")),
            "http://192.168.1.20:1234/v1/models"
        );
    }

    #[test]
    fn lm_studio_probe_url_falls_back_to_the_default_when_absent() {
        assert_eq!(lm_studio_probe_url(None), LM_STUDIO_PROBE_URL);
    }

    #[test]
    fn lm_studio_probe_url_falls_back_to_the_default_when_blank() {
        assert_eq!(lm_studio_probe_url(Some("   ")), LM_STUDIO_PROBE_URL);
    }

    #[test]
    fn lm_studio_probe_url_accepts_a_scheme_less_host() {
        assert_eq!(lm_studio_probe_url(Some("lmstudio.lan:1234/v1")), "http://lmstudio.lan:1234/v1/models");
    }

    #[test]
    fn lm_studio_probe_url_falls_back_when_unparsable() {
        // A space is invalid in a host per RFC 3952 / the WHATWG URL spec,
        // so this reliably fails to parse (unlike e.g. "http://", whose
        // trailing slashes get trimmed down to a bare "http:" that then
        // parses as a technically-valid, if useless, "http" host).
        assert_eq!(lm_studio_probe_url(Some("not a valid host")), LM_STUDIO_PROBE_URL);
    }

    #[test]
    fn lm_studio_probe_url_does_not_double_the_slash() {
        assert_eq!(
            lm_studio_probe_url(Some("http://192.168.1.20:1234/v1/")),
            "http://192.168.1.20:1234/v1/models"
        );
    }

    // ── T5: a slow-but-alive server must read Timeout, not Unreachable ──────

    /// A loopback stub that accepts the connection, reads the request, and
    /// then answers nothing for `hold` before it (eventually) would, the
    /// TCP-connect-succeeds-but-HTTP-never-answers shape a cold-starting
    /// Ollama/ComfyUI has, and also what an outright dead port looks like if
    /// nothing is listening at all (no accept ever happens there).
    async fn hang_stub(hold: Duration) -> u16 {
        use tokio::io::AsyncReadExt;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    let _ = sock.read(&mut buf).await;
                    tokio::time::sleep(hold).await;
                });
            }
        });
        port
    }

    /// Before this fix, `e.is_timeout()` was folded into `Unreachable`
    /// alongside a refused connection, the exact T5 finding: a server that
    /// is up but slow to answer got the same "Not running" verdict as one
    /// that was never started, which sent people restarting something that
    /// was fine. This proves the split: a connection that goes through and
    /// then sits silent past the probe's own (short, test-local) timeout
    /// must classify as `Timeout`, never `Unreachable`.
    #[test]
    fn a_live_but_slow_server_reads_as_timeout_not_unreachable() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // The stub stays silent far longer than any stall of the test
            // machine, so "gave up on its own" and "waited for the server"
            // stay apart without a tight stopwatch. The bound used to be one
            // second for a 600 ms probe, and a loaded machine missed it
            // (Linux, 08.10.2026, a full run that took 27 s instead of 8).
            let hold = Duration::from_secs(60);
            let port = hang_stub(hold).await;
            // Short enough to prove the probe respects its own window, long
            // enough that a slow machine makes the connect window derived
            // from it (a third, so one second). At 600 ms that window was
            // 200 ms, and a first connection under x86_64 emulation took
            // longer and read as Unreachable (09.10.2026).
            let short = Duration::from_secs(3);
            let start = std::time::Instant::now();
            let probe = probe_http(&format!("http://127.0.0.1:{}/api/tags", port), short).await;
            let elapsed = start.elapsed();

            assert!(
                matches!(probe.status, ProbeStatus::Timeout),
                "a connected-but-silent server must read as Timeout, got {:?}",
                probe.status
            );
            assert!(
                elapsed < hold / 4,
                "the probe must respect its own timeout instead of waiting for the server: {elapsed:?}"
            );
        });
    }

    /// The wiring that keeps the split honest on Windows: the connect phase
    /// has to give up well inside the probe window, or the overall timeout
    /// fires first and a refused connection arrives as a timeout error. It
    /// also has to leave most of the window to the phase the timeout exists
    /// for, so neither half may collapse into the other.
    #[test]
    fn the_connect_window_ends_well_inside_the_probe_window() {
        let connect = connect_window(PROBE_TIMEOUT);
        assert!(
            connect < PROBE_TIMEOUT,
            "a connect window that reaches the probe window cannot beat it: {connect:?} vs {PROBE_TIMEOUT:?}"
        );
        assert!(
            PROBE_TIMEOUT - connect >= Duration::from_millis(500),
            "too little of the window is left for a server that answers slowly: {connect:?} of {PROBE_TIMEOUT:?}"
        );
        assert!(
            connect >= Duration::from_millis(250),
            "even a loopback handshake deserves more room than {connect:?}"
        );
    }

    /// Every spelling of "this machine" earns the short window, including a
    /// NAME that resolves to loopback: `localhost` is what `ollama_probe_url`
    /// falls back to, so a check on the text alone would have missed the
    /// default case entirely.
    #[test]
    fn the_short_connect_window_is_given_to_loopback_targets() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            for url in [
                "http://127.0.0.1:11434/api/tags",
                "http://127.99.1.5:1234/v1/models",
                "http://[::1]:8188/system_stats",
                "http://localhost:11434/api/tags",
            ] {
                assert_eq!(
                    connect_window_for(url, PROBE_TIMEOUT).await,
                    Some(connect_window(PROBE_TIMEOUT)),
                    "{url} is this machine and must get the short connect window"
                );
            }
        });
    }

    /// The other side of NB1, and the reason the window is not simply always
    /// short: a configured Ollama on another machine keeps the whole probe
    /// window, so a single lost SYN (Windows retransmits only after about a
    /// second) cannot turn a RUNNING backend into "Not running". Anything
    /// unparseable or unresolvable counts as remote for the same reason.
    #[test]
    fn a_remote_or_unknown_host_keeps_the_whole_probe_window() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            for url in [
                "http://192.0.2.10:11434/api/tags",
                "http://[2001:db8::1]:11434/api/tags",
                "http://no-such-host.invalid:11434/api/tags",
                "not even a url",
            ] {
                assert_eq!(
                    connect_window_for(url, PROBE_TIMEOUT).await,
                    None,
                    "{url} is not this machine and must keep the full window for the handshake"
                );
            }
        });
    }

    /// The other half of the same split: nothing listening at all is still
    /// the genuine "Not running" case and must stay `Unreachable`, not
    /// regress to `Timeout` now that the two are distinguished.
    ///
    /// This is the test the Windows box failed before the connect window
    /// existed, and it is the one that proves the fix: there, a connect to a
    /// closed port is only refused after about two seconds, so without a
    /// connect window of its own the probe gave up as a TIMEOUT and told the
    /// customer a backend that was never started was alive but slow.
    #[test]
    fn nothing_listening_still_reads_as_unreachable() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // Taken but not listening, and held until the probe is back.
            let (dead_port, held) = crate::test_support::refusing_port();
            let probe = probe_http(
                &format!("http://127.0.0.1:{}/api/tags", dead_port),
                Duration::from_millis(500),
            )
            .await;
            drop(held);
            assert!(
                matches!(probe.status, ProbeStatus::Unreachable),
                "a refused connection must stay Unreachable, got {:?} ({})",
                probe.status,
                probe.detail
            );
        });
    }

    /// And the ordinary positive case still reports `Ok` with the longer
    /// timeout in place. The timeout increase must not turn a normal, fast
    /// answer into anything else.
    #[test]
    fn a_server_that_answers_promptly_still_reads_as_ok() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            tokio::spawn(async move {
                if let Ok((mut sock, _)) = listener.accept().await {
                    let mut buf = [0u8; 4096];
                    let _ = sock.read(&mut buf).await;
                    let _ = sock
                        .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
                        .await;
                    let _ = sock.flush().await;
                }
            });
            let probe = probe_http(&format!("http://127.0.0.1:{}/api/tags", port), PROBE_TIMEOUT).await;
            assert!(matches!(probe.status, ProbeStatus::Ok), "got {:?}", probe.status);
        });
    }

    // ── parse_nvidia_vram_csv (§17 — VRAM host fact) ────────────────────────

    #[test]
    fn vram_parses_single_gpu_total_and_free() {
        // 24576 MiB = 24 GiB, 23000 MiB ≈ 22.5 GiB
        assert_eq!(parse_nvidia_vram_csv("24576, 23000\n"), Some((24.0, 22.5)));
    }

    #[test]
    fn vram_parses_without_trailing_newline() {
        assert_eq!(parse_nvidia_vram_csv("8192, 4096"), Some((8.0, 4.0)));
    }

    #[test]
    fn vram_multi_gpu_picks_largest_total() {
        // 8 GiB card then 24 GiB card — biggest (24) wins, with its own free.
        let out = "8192, 1024\n24576, 20480\n";
        assert_eq!(parse_nvidia_vram_csv(out), Some((24.0, 20.0)));
    }

    #[test]
    fn vram_tolerates_total_only_lines() {
        // memory.free omitted → free defaults to 0.
        assert_eq!(parse_nvidia_vram_csv("16384\n"), Some((16.0, 0.0)));
    }

    #[test]
    fn vram_skips_blank_and_unparseable_lines() {
        let out = "\n[N/A]\n12288, 6144\n";
        assert_eq!(parse_nvidia_vram_csv(out), Some((12.0, 6.0)));
    }

    #[test]
    fn vram_returns_none_for_empty_output() {
        assert_eq!(parse_nvidia_vram_csv(""), None);
        assert_eq!(parse_nvidia_vram_csv("\n  \n"), None);
    }

    #[test]
    fn vram_rounds_to_one_decimal() {
        // 11264 MiB = 11.0 GiB exactly; 6000 MiB ≈ 5.859 → 5.9
        assert_eq!(parse_nvidia_vram_csv("11264, 6000"), Some((11.0, 5.9)));
    }
}
