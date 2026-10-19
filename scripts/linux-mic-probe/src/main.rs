//! linux-mic-probe <mode> [page]
//!
//! mode:  stock     a web view as wry builds it, nothing of LU's
//!        settings  media stream switched on, but no permission handler
//!        lu        `linux_media::answer_microphone_requests`, the app's code
//! page:  lu        LU's own origin, tauri://localhost/ (default)
//!        foreign   the same page from https://evil.example/
//!
//! Prints one line `RESULT {json}` written by the page and exits 0, or exits 2
//! when the page said nothing within the time limit.

#[path = "../../../src-tauri/src/linux_media.rs"]
mod linux_media;

use gtk::prelude::*;
use std::cell::Cell;
use std::rc::Rc;
use webkit2gtk::{SecurityManagerExt, SettingsExt, URISchemeRequestExt, WebContext, WebContextExt, WebView, WebViewExt};

const PAGE: &str = r#"<!doctype html><html><head><title>wait</title></head><body><script>
function report(o) { document.title = 'RESULT ' + JSON.stringify(o) }
(async () => {
  const base = { origin: location.origin, secure: window.isSecureContext, hasMediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) }
  if (!base.hasMediaDevices) return report({ ...base, outcome: 'no-mediaDevices' })
  try {
    // The constraints src/api/voice-media.ts asks for.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
    const track = stream.getAudioTracks()[0]
    const ctx = new AudioContext()
    const src = ctx.createMediaStreamSource(stream)
    const an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an)
    const buf = new Float32Array(an.fftSize)
    let peak = 0
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 100))
      an.getFloatTimeDomainData(buf)
      for (const v of buf) peak = Math.max(peak, Math.abs(v))
    }
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput').map(d => d.label || '(no label)')
    report({ ...base, outcome: 'stream', state: track && track.readyState, label: track && track.label, peak: Number(peak.toFixed(4)), inputs: devices })
  } catch (e) {
    report({ ...base, outcome: 'error', name: e && e.name, message: String(e && e.message) })
  }
})()
</script></body></html>"#;

fn main() {
    let mut args = std::env::args().skip(1);
    let mode = args.next().unwrap_or_else(|| "lu".into());
    let page = args.next().unwrap_or_else(|| "lu".into());
    gtk::init().expect("gtk init (is DISPLAY set?)");

    let context = WebContext::default().expect("default web context");
    // As wry registers its scheme: custom protocol, marked secure.
    context.register_uri_scheme("tauri", |request| {
        let bytes = gtk::glib::Bytes::from_static(PAGE.as_bytes());
        let stream = gtk::gio::MemoryInputStream::from_bytes(&bytes);
        request.finish(&stream, PAGE.len() as i64, Some("text/html"));
    });
    if let Some(security) = context.security_manager() {
        security.register_uri_scheme_as_secure("tauri");
    }
    let view = WebView::with_context(&context);
    if let Some(settings) = WebViewExt::settings(&view) {
        // What wry sets on every view (webkitgtk/mod.rs).
        settings.set_enable_webgl(true);
        settings.set_enable_webaudio(true);
    }
    match mode.as_str() {
        "stock" => {}
        "settings" => {
            if let Some(settings) = WebViewExt::settings(&view) {
                settings.set_enable_media_stream(true);
            }
        }
        "lu" => linux_media::answer_microphone_requests(&view),
        other => panic!("unknown mode {other}"),
    }

    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_default_size(400, 300);
    window.add(&view);
    window.show_all();

    let done = Rc::new(Cell::new(false));
    let flag = done.clone();
    view.connect_title_notify(move |v| {
        if let Some(title) = v.title() {
            if let Some(json) = title.strip_prefix("RESULT ") {
                println!("RESULT {json}");
                flag.set(true);
                gtk::main_quit();
            }
        }
    });
    match page.as_str() {
        "lu" => view.load_uri("tauri://localhost/"),
        "foreign" => view.load_html(PAGE, Some("https://evil.example/")),
        other => panic!("unknown page {other}"),
    }
    gtk::glib::timeout_add_seconds_local(25, || {
        gtk::main_quit();
        gtk::glib::ControlFlow::Break
    });
    gtk::main();
    if !done.get() {
        println!("RESULT {{\"outcome\":\"timeout\"}}");
        std::process::exit(2);
    }
}
