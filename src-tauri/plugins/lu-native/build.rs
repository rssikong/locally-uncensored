//! Build script of the native layer.
//!
//! `COMMANDS` is the list Tauri generates an `allow-<name>` permission for.
//! A command that is missing here cannot be granted to a webview at all, so
//! every command in `src/commands.rs` has its line. `registerListener` and
//! `remove_listener` are not here on purpose: no JavaScript listens on the
//! native side directly, every event goes native, Rust, `app.emit`.

const COMMANDS: &[&str] = &[
    // sharing and saving
    "share_file",
    "save_to_photos",
    "save_to_files",
    "write_temp_file",
    "download_to_temp",
    "delete_temp_file",
    // device
    "device_info",
    "simulate_memory_warning",
    // lifecycle
    "begin_background_task",
    "end_background_task",
    "back_arm",
    "back_ack",
    "back_exit",
    // deep link
    "pending_deep_link",
    // small services for the shell
    "haptic",
    "open_external",
    "scan_qr",
    "open_system_settings",
    "set_system_bars",
    // Remote transport
    "remote_client_request",
    "remote_client_cancel",
    // background downloads
    "bg_download_start",
    "bg_download_pause",
    "bg_download_resume",
    "bg_download_cancel",
    "bg_download_forget",
    "bg_download_list",
    "bg_download_network_rule",
    "bg_download_allow_metered",
    "connection_info",
    "request_notification_permission",
    // reading aloud
    "tts_voices",
    "tts_speak",
    "tts_stop",
    // a model file of the user's own
    "import_model_document",
    "import_model_cancel",
    // the speed limit of the background downloads
    "bg_download_limit",
    // photos the webview cannot decode
    "transcode_image",
    // clipboard
    "clipboard_read_text",
    "clipboard_write_text",
    // notices of the computer (A17)
    "local_notify",
    "remote_watch",
    "remote_notify_permission",
    // sign in with Apple (iOS)
    "apple_sign_in",
    // the sign-in sheet of the system for Google and GitHub (iOS)
    "web_auth",
    // documents for a message from the Files app (iOS), and reading them back
    "pick_documents",
    "read_temp_file",
    // credits as an in-app purchase (iOS, StoreKit 2)
    "iap_products",
    "iap_purchase",
    "iap_finish",
    "iap_unfinished",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();

    // The usage text iOS asks for before it lets this plugin save to Photos.
    // It is written only when the app has not set its own wording.
    //
    // No default for NSLocalNetworkUsageDescription here: that text belongs
    // only in a build whose store preset has the remote desktop, and the app
    // names it there itself (src-tauri/Info.ios.fernzugriff.plist). A default
    // written here would put the key into the App Store build, which has no
    // remote desktop, and Apple wants every usage text to belong to a feature
    // of the build (src/lib/__tests__/ios-berechtigungstexte-je-preset.test.ts).
    #[cfg(target_os = "macos")]
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        let _ = tauri_plugin::mobile::update_info_plist(|plist| {
            let defaults = [(
                "NSPhotoLibraryAddUsageDescription",
                "LU saves the images and videos you export to your photo library.",
            )];
            for (key, text) in defaults {
                if !plist.contains_key(key) {
                    plist.insert(key.into(), text.into());
                }
            }
        });
    }
}
