//! The microphone in the Linux web view.
//!
//! GitHub #162 (KDE Wayland, AppImage): every voice session failed at once
//! with "LU is not allowed to use the microphone", while other apps recorded
//! from the same PipeWire source. The web view is WebKitGTK, and WebKitGTK
//! turns down every request for a camera or a microphone that the app does not
//! answer itself (the `permission-request` signal; neither Tauri nor wry
//! answers it). Desktop Linux has no system question for an unsandboxed app,
//! so nobody else ever would.
//!
//! LU answers it here, narrowly: a request for audio alone, from LU's own page.
//! A camera, a screen share or any page that is not LU's is still refused, as
//! WebKitGTK would have done. Windows and macOS ask the user through their own
//! privacy settings and never reach this file.
//!
//! Proven headless, without a microphone, by scripts/linux-mic-probe (Debian
//! 12, WebKitGTK 2.50.6, GStreamer 1.22, Xvfb, a PulseAudio sine source as
//! the default input, 15.10.2026), with the constraints Voice asks for:
//!
//!   * a view as wry builds it: NotAllowedError, the error of the report;
//!   * the same view with media stream switched on but no handler: still
//!     NotAllowedError, so the setting alone is not the fix;
//!   * `answer_microphone_requests`: a live track, the sine wave arrives
//!     (peak 0.5), and enumerateDevices names the input;
//!   * the same handler on a page from https://evil.example/: NotAllowedError.
//!
//! What the probe cannot show: a real PipeWire desktop. The AppImage records
//! through the GStreamer it bundles (pulsesrc, which PipeWire answers through
//! pipewire-pulse, active on the reporter's machine).

use webkit2gtk::{
    PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, UserMediaPermissionRequestExt,
    WebView, WebViewExt,
};
use webkit2gtk::glib::prelude::Cast;

/// Origins of LU's own page in a release and in a dev run (tauri.conf.json).
fn is_lu_page(uri: &str) -> bool {
    let uri = uri.to_ascii_lowercase();
    uri.starts_with("tauri://localhost/")
        || uri == "tauri://localhost"
        || uri.starts_with("http://tauri.localhost/")
        || uri.starts_with("http://localhost:5273/")
}

/// The decision, without GTK: allow a microphone request from LU's own page,
/// refuse anything that also wants a camera.
pub(crate) fn allows(uri: Option<&str>, audio: bool, video: bool) -> bool {
    audio && !video && uri.is_some_and(is_lu_page)
}

/// Switches media capture on in `view` and answers its microphone requests
/// by the rule above.
///
/// Takes the WebKitGTK view itself and nothing of Tauri, so the headless
/// probe in scripts/linux-mic-probe runs exactly this function against a real
/// WebKitGTK (Xvfb, PulseAudio) without building the app.
pub fn answer_microphone_requests(view: &WebView) {
    if let Some(settings) = WebViewExt::settings(view) {
        settings.set_enable_media_stream(true);
    }
    view.connect_permission_request(|view, request| {
        let Some(media) = request.downcast_ref::<UserMediaPermissionRequest>() else {
            // Not ours to decide: WebKitGTK's own answer stands.
            return false;
        };
        let uri = view.uri();
        if allows(uri.as_deref(), media.is_for_audio_device(), media.is_for_video_device()) {
            request.allow();
        } else {
            request.deny();
        }
        true
    });
}

#[cfg(test)]
mod tests {
    use super::allows;

    #[test]
    fn lu_page_gets_the_microphone_and_nothing_else_does() {
        for page in ["tauri://localhost/", "tauri://localhost/voice", "http://tauri.localhost/", "http://localhost:5273/"] {
            assert!(allows(Some(page), true, false), "{page}");
            assert!(!allows(Some(page), true, true), "camera with it: {page}");
            assert!(!allows(Some(page), false, true), "camera alone: {page}");
        }
        for foreign in ["https://evil.example/", "http://localhost:8188/", "tauri://localhost.evil.example/", "file:///tmp/x.html"] {
            assert!(!allows(Some(foreign), true, false), "{foreign}");
        }
        assert!(!allows(None, true, false));
    }
}
