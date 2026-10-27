//! What this binary was built for, told to the page.
//!
//! The page has to know whether it is the desktop app or a phone: a phone
//! gets a different interface (src/mobile). It used to read that off the
//! navigator, and the navigator is a guess. An iPad reports exactly what a
//! Mac reports and differs only by its touch points, so a Mac whose webview
//! ever reports a touch screen would have started as a phone, with no way
//! back. The build target is not a guess: this file is compiled for one
//! platform, and it says which.
//!
//! The answer travels as an initialization script, so it stands in every
//! webview before the first line of the page runs, and the page can ask
//! synchronously (src/lib/device-kind.ts, `nativeHost`). The property is
//! neither writable nor configurable: nothing that runs later in the page
//! can turn a desktop into a phone.

/// One of `macos`, `windows`, `linux`, `android`, `ios`. The same words the
/// frontend knows (`NativeHost` in src/lib/device-kind.ts).
pub const HOST_KIND: &str = if cfg!(target_os = "android") {
    "android"
} else if cfg!(target_os = "ios") {
    "ios"
} else if cfg!(target_os = "macos") {
    "macos"
} else if cfg!(target_os = "windows") {
    "windows"
} else {
    "linux"
};

/// The name of the property on `window`. Has to match `NATIVE_HOST_KEY` in
/// src/lib/device-kind.ts, a test below holds the two together.
pub const HOST_KEY: &str = "__LU_HOST__";

/// The script every webview runs first.
pub fn init_script() -> String {
    script_for(HOST_KIND)
}

fn script_for(kind: &str) -> String {
    format!(
        "try {{ Object.defineProperty(window, '{HOST_KEY}', {{ value: '{kind}', writable: false, configurable: false, enumerable: false }}); }} catch (_) {{}}"
    )
}

/// The plugin that carries the script into every webview, the onboarding
/// window included. It has no commands and needs no permission.
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("lu-host-kind")
        .js_init_script(init_script())
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEVICE_KIND_TS: &str = include_str!("../../src/lib/device-kind.ts");

    #[test]
    fn the_answer_follows_the_build_target_and_matches_cfg_mobile() {
        let phone = matches!(HOST_KIND, "android" | "ios");
        assert_eq!(phone, cfg!(mobile), "{HOST_KIND}");
        assert_eq!(!phone, cfg!(desktop), "{HOST_KIND}");
        assert!(["macos", "windows", "linux", "android", "ios"].contains(&HOST_KIND));
    }

    #[test]
    fn the_script_sets_a_property_nobody_can_change() {
        let script = script_for("macos");
        assert!(script.contains("'__LU_HOST__'"), "{script}");
        assert!(script.contains("value: 'macos'"), "{script}");
        assert!(script.contains("writable: false") && script.contains("configurable: false"), "{script}");
        assert_eq!(init_script(), script_for(HOST_KIND));
    }

    #[test]
    fn the_frontend_reads_the_same_name_and_knows_every_answer() {
        assert!(
            DEVICE_KIND_TS.contains(&format!("NATIVE_HOST_KEY = \"{HOST_KEY}\"")),
            "src/lib/device-kind.ts no longer reads window.{HOST_KEY}"
        );
        for kind in ["macos", "windows", "linux", "android", "ios"] {
            assert!(DEVICE_KIND_TS.contains(&format!("\"{kind}\"")), "device-kind.ts does not know '{kind}'");
        }
    }
}
