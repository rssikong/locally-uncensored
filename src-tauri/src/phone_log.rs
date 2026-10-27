//! How a line of the log file looks on a phone.
//!
//! The desktop keeps the format `tracing` gives it: time, level, the module
//! path of the caller, the message. On a phone that file is what "Share log"
//! hands to another app, and the module path begins with the name of the
//! crate: a log of 15 KB named `locally_uncensored_lib` 18 times, in a
//! package that says "LU" everywhere else (check on the iPhone, round 22,
//! N12). The allow list `scripts/mobile/release/name-im-paket.erlaubt` covers
//! the binary, where the linker needs the name. It does not cover a text the
//! user sends to somebody.
//!
//! So the phone formats its file lines itself: the same parts in the same
//! order, with the crate named `lu`. Everything behind the crate stays, since
//! `lu::os_paths` tells support exactly what the long form did.
//!
//! Compiled into every build, used by the phone only: so the tests below run
//! in the ordinary test run on the desktop.

use tracing::{Event, Subscriber};
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::time::{FormatTime, SystemTime};
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields};
use tracing_subscriber::registry::LookupSpan;

/// What the crate is called in a line of the phone log.
#[cfg_attr(not(mobile), allow(dead_code))]
pub const NEUTRAL: &str = "lu";

/// The name of this crate as `module_path!()` spells it. Taken from the
/// compiler, so a renamed crate cannot leave this file behind.
#[cfg_attr(not(mobile), allow(dead_code))]
fn crate_name() -> &'static str {
    let path = module_path!();
    path.split("::").next().unwrap_or(path)
}

/// The target of a line as the phone writes it: the crate is `lu`, the
/// plugin of the native layer is `lu_native`, every other target stays.
#[cfg_attr(not(mobile), allow(dead_code))]
pub fn phone_target(target: &str) -> String {
    let own = crate_name();
    if target == own {
        return NEUTRAL.to_string();
    }
    if let Some(rest) = target.strip_prefix(own).and_then(|r| r.strip_prefix("::")) {
        return format!("{NEUTRAL}::{rest}");
    }
    if let Some(rest) = target.strip_prefix("tauri_plugin_lu_native") {
        return format!("lu_native{rest}");
    }
    target.to_string()
}

/// `2026-10-10T20:15:01.123456Z  INFO lu::os_paths: app folders data=...`
#[cfg_attr(not(mobile), allow(dead_code))]
pub struct PhoneFormat;

impl<S, N> FormatEvent<S, N> for PhoneFormat
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(&self, ctx: &FmtContext<'_, S, N>, mut writer: Writer<'_>, event: &Event<'_>) -> std::fmt::Result {
        let meta = event.metadata();
        if SystemTime.format_time(&mut writer).is_err() {
            writer.write_str("<unknown time>")?;
        }
        write!(writer, " {:>5} {}: ", meta.level(), phone_target(meta.target()))?;
        ctx.field_format().format_fields(writer.by_ref(), event)?;
        writeln!(writer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::{Arc, Mutex};

    #[derive(Clone)]
    struct Capture(Arc<Mutex<Vec<u8>>>);

    impl Write for Capture {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Capture {
        type Writer = Capture;
        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    /// The file layer of the phone, as `init_mobile_tracing` builds it.
    fn phone_log(f: impl FnOnce()) -> String {
        let buf = Arc::new(Mutex::new(Vec::new()));
        let subscriber = tracing_subscriber::fmt()
            .with_writer(Capture(buf.clone()))
            .with_ansi(false)
            .event_format(PhoneFormat)
            .fmt_fields(crate::EnglishFields(tracing_subscriber::fmt::format::DefaultFields::new()))
            .finish();
        tracing::subscriber::with_default(subscriber, f);
        let out = buf.lock().unwrap().clone();
        String::from_utf8(out).expect("the log is utf8")
    }

    /// The same lines through the format the desktop has.
    fn desktop_log(f: impl FnOnce()) -> String {
        let buf = Arc::new(Mutex::new(Vec::new()));
        let subscriber = tracing_subscriber::fmt()
            .with_writer(Capture(buf.clone()))
            .with_ansi(false)
            .fmt_fields(crate::EnglishFields(tracing_subscriber::fmt::format::DefaultFields::new()))
            .finish();
        tracing::subscriber::with_default(subscriber, f);
        let out = buf.lock().unwrap().clone();
        String::from_utf8(out).expect("the log is utf8")
    }

    fn some_lines() {
        // These carry the module path of this test as their target, the way
        // every line of the crate carries its own.
        tracing::info!(version = "3.0.7", "LU starting");
        tracing::info!(data = "/var/mobile/Containers/Data/Application/X/Library/Application Support", "app folders");
        tracing::warn!("the engine took long to answer");
        tracing::error!(code = 28, "no space left");
        // What the page mirrors into the file (commands/logging.rs, log_write).
        tracing::warn!(target: "ui", src = %"chat", "a line of the page");
        // A line of a dependency.
        tracing::info!(target: "hyper_util::client", "connected");
    }

    #[test]
    fn the_long_name_is_what_the_desktop_format_writes_and_the_phone_format_does_not() {
        let long = crate_name();
        assert_eq!(long, "locally_uncensored_lib", "the name Cargo.toml gives the library");

        // Control: with the format of the desktop the name is in every line of the crate.
        let desktop = desktop_log(some_lines);
        assert_eq!(desktop.matches(long).count(), 4, "got:\n{desktop}");

        let phone = phone_log(some_lines);
        assert_eq!(phone.matches(long).count(), 0, "the shared log names the crate:\n{phone}");
        for word in ["locally", "uncensored", "Uncensored"] {
            assert!(!phone.contains(word), "'{word}' is in the shared log:\n{phone}");
        }
    }

    #[test]
    fn a_phone_line_keeps_time_level_place_message_and_fields() {
        let phone = phone_log(some_lines);
        let lines: Vec<&str> = phone.lines().collect();
        assert_eq!(lines.len(), 6, "one event, one line:\n{phone}");
        for line in &lines {
            // 2026-10-10T20:15:01.123456Z, then the level in five columns.
            let (time, rest) = line.split_once(' ').expect("a time in front");
            assert!(time.len() >= 20 && time.ends_with('Z') && time.as_bytes()[4] == b'-' && time.as_bytes()[10] == b'T', "time: {line}");
            assert!([" INFO ", " WARN ", "ERROR "].iter().any(|level| rest.starts_with(level)), "level: {line}");
        }
        assert!(lines[0].ends_with("INFO lu::phone_log::tests: LU starting version=\"3.0.7\""), "got: {}", lines[0]);
        assert!(lines[1].contains(" INFO lu::phone_log::tests: app folders data="), "got: {}", lines[1]);
        assert!(lines[2].ends_with(" WARN lu::phone_log::tests: the engine took long to answer"), "got: {}", lines[2]);
        assert!(lines[3].ends_with("ERROR lu::phone_log::tests: no space left code=28"), "got: {}", lines[3]);
        // Lines of the page and of a dependency keep their target.
        assert!(lines[4].ends_with(" WARN ui: a line of the page src=chat"), "got: {}", lines[4]);
        assert!(lines[5].ends_with(" INFO hyper_util::client: connected"), "got: {}", lines[5]);
    }

    #[test]
    fn the_phone_line_is_the_desktop_line_with_the_crate_renamed() {
        // Same parts, same order: whoever reads a desktop log reads this one.
        let strip_time = |log: String| log.lines().map(|l| l.split_once(' ').map(|(_, rest)| rest.to_string()).unwrap_or_default()).collect::<Vec<_>>();
        let desktop = strip_time(desktop_log(some_lines));
        let phone = strip_time(phone_log(some_lines));
        assert_eq!(desktop.len(), phone.len());
        for (d, p) in desktop.iter().zip(&phone) {
            assert_eq!(&d.replace(crate_name(), NEUTRAL), p);
        }
    }

    #[test]
    fn targets() {
        assert_eq!(phone_target("locally_uncensored_lib"), "lu");
        assert_eq!(phone_target("locally_uncensored_lib::os_paths"), "lu::os_paths");
        assert_eq!(phone_target("locally_uncensored_lib::commands::engine"), "lu::commands::engine");
        assert_eq!(phone_target("tauri_plugin_lu_native::download"), "lu_native::download");
        assert_eq!(phone_target("tauri_plugin_lu_native"), "lu_native");
        // Not ours: unchanged, also when it only begins like ours.
        assert_eq!(phone_target("locally_uncensored_library::x"), "locally_uncensored_library::x");
        assert_eq!(phone_target("ui"), "ui");
        assert_eq!(phone_target("reqwest::connect"), "reqwest::connect");
        assert_eq!(phone_target(""), "");
    }

    /// The format is only worth something when the phone uses it, on the file
    /// that is shared, and the desktop does not.
    #[test]
    fn the_phone_file_layer_uses_it_and_the_desktop_layers_do_not() {
        const SRC: &str = include_str!("lib.rs");
        let phone = &SRC[SRC.find("fn init_mobile_tracing()").expect("init_mobile_tracing exists")..];
        let phone = &phone[..phone.find("\n}\n").expect("the function ends")];
        let file_layer = &phone[phone.find("let file_layer").expect("the file layer")..];
        let file_layer = &file_layer[..file_layer.find(';').expect("the statement ends")];
        assert!(file_layer.contains("commands::logging::LateFile"), "the layer that writes the shared file");
        assert!(file_layer.contains(".event_format(phone_log::PhoneFormat)"), "the shared file must use the phone format:\n{file_layer}");
        assert!(file_layer.contains("EnglishFields("), "and still our wording for system errors");

        let desktop = &SRC[SRC.find("fn init_tracing()").expect("init_tracing exists")..];
        let desktop = &desktop[..desktop.find("\n}\n").expect("the function ends")];
        assert!(!desktop.contains("PhoneFormat") && !desktop.contains("event_format"), "the desktop keeps its format");

        // And the first line of the log names the version of the package.
        let run = &SRC[SRC.find("\npub fn run() {").expect("run exists")..];
        let run = &run[..run.find("\"LU starting\"").expect("the first line")];
        assert!(run.ends_with("version = app_identity::APP_VERSION,\n        "), "the first line takes the version from app_identity");
    }
}
