//! The version a phone package carries, read at build time.
//!
//! `Cargo.toml` and `tauri.conf.json` hold the version of the desktop app.
//! A phone package gets its own: `scripts/mobile/release/version-setzen.sh`
//! writes it into `tauri.ios.conf.json` and `tauri.android.conf.json`, and
//! Tauri puts that one into the package (Info.plist, versionName). The Rust
//! side knew nothing of it: the log of a 3.0.7 package began with
//! `LU starting version="3.0.5"`, and the calls of the phone went out as
//! `LU/3.0.5` (check on the iPhone, round 22, N13).
//!
//! `build.rs` includes this file, reads the version of the platform that is
//! being built and hands it to the crate as `LU_PHONE_VERSION`. A desktop
//! build gets the version of the crate under that name, so the phone wording
//! that is compiled into every build (`app_identity::phone_wording`) has a
//! value everywhere and the desktop changes nothing.
//!
//! No JSON crate on purpose: the build script has `tauri-build` as its only
//! dependency, and the one thing read here is a top-level text field.

/// The top-level `"version": "x.y.z"` of a Tauri config, if it has one.
///
/// Top level only: `bundle.android.versionCode` and any nested `version`
/// are not this. The scan counts braces and brackets outside of strings.
pub fn top_level_version(json: &str) -> Option<String> {
    let bytes = json.as_bytes();
    let mut depth = 0usize;
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'{' | b'[' => depth += 1,
            b'}' | b']' => depth = depth.saturating_sub(1),
            b'"' => {
                let (text, after) = read_string(json, i)?;
                i = after;
                if depth == 1 && text == "version" {
                    let mut j = skip_space(bytes, i);
                    if bytes.get(j) == Some(&b':') {
                        j = skip_space(bytes, j + 1);
                        if bytes.get(j) == Some(&b'"') {
                            let (value, _) = read_string(json, j)?;
                            return plausible(&value).then_some(value);
                        }
                        return None;
                    }
                }
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn skip_space(bytes: &[u8], mut i: usize) -> usize {
    while bytes.get(i).is_some_and(|b| b.is_ascii_whitespace()) {
        i += 1;
    }
    i
}

/// The string that starts at the quote at `start`, and the index behind its
/// closing quote. Escapes are skipped, not decoded: a version has none.
fn read_string(json: &str, start: usize) -> Option<(String, usize)> {
    let bytes = json.as_bytes();
    let mut i = start + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'"' => return Some((json.get(start + 1..i)?.to_string(), i + 1)),
            _ => i += 1,
        }
    }
    None
}

/// `3.0.7`, `3.0.7-beta.1`: digits first, then nothing but what a version holds.
fn plausible(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 32
        && version.as_bytes()[0].is_ascii_digit()
        && version.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'+'))
}

/// The version of the package that is being built: the one of the platform
/// config when the target is a phone and that config names one, otherwise
/// the one of the main config (what Tauri itself falls back to), otherwise
/// the one of the crate.
pub fn phone_version(target_os: &str, platform_config: Option<&str>, main_config: Option<&str>, crate_version: &str) -> String {
    if target_os != "ios" && target_os != "android" {
        return crate_version.to_string();
    }
    platform_config
        .and_then(top_level_version)
        .or_else(|| main_config.and_then(top_level_version))
        .unwrap_or_else(|| crate_version.to_string())
}

/// The config file Tauri merges over the main one for this target.
pub fn platform_config_name(target_os: &str) -> Option<&'static str> {
    match target_os {
        "ios" => Some("tauri.ios.conf.json"),
        "android" => Some("tauri.android.conf.json"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_top_level_version_is_found_and_nothing_else_is() {
        assert_eq!(top_level_version(r#"{ "identifier": "x", "version": "3.0.7" }"#).as_deref(), Some("3.0.7"));
        assert_eq!(top_level_version("{\n  \"version\"  :\n \"3.0.7-beta.1\"\n}").as_deref(), Some("3.0.7-beta.1"));
        // What version-setzen.sh writes next to it is not the version.
        let android = r#"{ "identifier": "x", "bundle": { "android": { "versionCode": 20001001, "version": "9.9.9" } }, "version": "3.0.7" }"#;
        assert_eq!(top_level_version(android).as_deref(), Some("3.0.7"));
        // A nested one alone is not taken.
        assert_eq!(top_level_version(r#"{ "bundle": { "version": "9.9.9" } }"#), None);
        assert_eq!(top_level_version(r#"{ "list": [ { "version": "9.9.9" } ] }"#), None);
        // A value that says "version", a number, a broken file, no file.
        assert_eq!(top_level_version(r#"{ "note": "version", "other": "1.2.3" }"#), None);
        assert_eq!(top_level_version(r#"{ "version": 3 }"#), None);
        assert_eq!(top_level_version(r#"{ "version": "" }"#), None);
        assert_eq!(top_level_version(r#"{ "version": "three" }"#), None);
        assert_eq!(top_level_version(r#"{ "version": "3.0.7"#), None);
        assert_eq!(top_level_version(""), None);
        // Braces and quotes inside a string do not move the depth.
        assert_eq!(top_level_version(r#"{ "csp": "a { b \" } [", "version": "3.0.7" }"#).as_deref(), Some("3.0.7"));
    }

    #[test]
    fn a_phone_carries_the_version_of_its_package_and_the_desktop_the_one_of_the_crate() {
        let platform = r#"{ "version": "3.0.7", "bundle": { "iOS": { "bundleVersion": "20001001" } } }"#;
        let main = r#"{ "productName": "x", "version": "3.0.5" }"#;
        assert_eq!(phone_version("ios", Some(platform), Some(main), "3.0.5"), "3.0.7");
        assert_eq!(phone_version("android", Some(platform), Some(main), "3.0.5"), "3.0.7");
        // A platform config without a version: what Tauri puts into the package then.
        assert_eq!(phone_version("ios", Some(r#"{ "identifier": "x" }"#), Some(main), "3.0.4"), "3.0.5");
        assert_eq!(phone_version("ios", None, None, "3.0.4"), "3.0.4");
        // The desktop never reads the phone files.
        for os in ["macos", "windows", "linux"] {
            assert_eq!(phone_version(os, Some(platform), Some(main), "3.0.5"), "3.0.5");
        }
        assert_eq!(platform_config_name("ios"), Some("tauri.ios.conf.json"));
        assert_eq!(platform_config_name("android"), Some("tauri.android.conf.json"));
        assert_eq!(platform_config_name("macos"), None);
    }

    /// The real files of this repository: whatever they say, the phone
    /// version is a version, and the script that sets it writes the field
    /// this module reads.
    #[test]
    fn the_files_of_this_repository_give_a_version() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let main = std::fs::read_to_string(root.join("tauri.conf.json")).expect("tauri.conf.json");
        assert_eq!(top_level_version(&main).as_deref(), Some(env!("CARGO_PKG_VERSION")), "the main config carries the version of the crate");
        for os in ["ios", "android"] {
            let platform = std::fs::read_to_string(root.join(platform_config_name(os).unwrap())).ok();
            let version = phone_version(os, platform.as_deref(), Some(&main), env!("CARGO_PKG_VERSION"));
            assert!(plausible(&version), "{os}: {version}");
        }
        let setter = std::fs::read_to_string(root.join("../scripts/mobile/release/handy-version.mjs")).expect("handy-version.mjs");
        assert!(setter.contains("tauri.ios.conf.json") && setter.contains("tauri.android.conf.json"), "the script sets the version in the two files read here");
        // And build.rs hands it on under the name the crate reads.
        let build = std::fs::read_to_string(root.join("build.rs")).expect("build.rs");
        assert!(build.contains("cargo:rustc-env=LU_PHONE_VERSION="), "build.rs must emit LU_PHONE_VERSION");
        assert!(build.contains("cargo:rerun-if-changed=tauri.ios.conf.json") && build.contains("cargo:rerun-if-changed=tauri.android.conf.json"));
    }
}
