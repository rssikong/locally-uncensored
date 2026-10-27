//! Build script.
//!
//! Besides Tauri's own codegen this assembles the mobile client page from
//! `mobile-client/` into `OUT_DIR`, where `commands/remote.rs` picks it up
//! with `include_str!`.
//!
//! Two properties matter more than the assembly itself, and both are why the
//! step lives here rather than in an npm script somebody has to remember:
//!
//!   * **It cannot be skipped.** `cargo build` needs the file that this
//!     produces; without the step there is nothing to embed and the compile
//!     fails at the `include_str!`.
//!   * **It cannot go stale.** The output is written into `OUT_DIR`, never
//!     into the repository, so there is no older copy to fall back to, and
//!     cargo re-runs this script whenever `mobile-client/` or any file in it
//!     changes. A broken source aborts the build with the reason; it never
//!     leaves the previous page in place and carries on.

#[path = "src/mobile_page.rs"]
mod mobile_page;
#[path = "src/phone_version.rs"]
#[allow(dead_code)]
mod phone_version;

fn main() {
    emit_mobile_client_page();
    emit_android_page_size();
    emit_phone_version();
    if windows_msvc_target() {
        emit_windows_app_manifest();
        build_tauri_without_app_manifest();
    } else {
        tauri_build::build()
    }
}

/// Windows (MSVC): the application manifest goes into every program the crate
/// links, the unit tests included, and not into the app alone.
///
/// The manifest asks for Common Controls v6. `tauri_build` puts it into the
/// resource it compiles, and that resource is linked into the bin target only.
/// Since the code moved from `main.rs` into the library, `cargo test --lib`
/// links a test program from the library without it, and Windows refuses to
/// start that program (0xc0000139, STATUS_ENTRYPOINT_NOT_FOUND): the code
/// reaches `TaskDialogIndirect`, which only the v6 comctl32 exports.
///
/// So `tauri_build` leaves the manifest out of its resource (icon and version
/// stay there), and the linker embeds it into every target instead. Exactly one
/// manifest per program: if both did it, the link of the app would fail with
/// CVT1100 (duplicate resource). `/MANIFESTUAC:NO` keeps the content what
/// `tauri_build` embedded before (it adds no UAC section either).
///
/// Every other target, macOS, Linux, Android and iOS, takes the `else` above,
/// the same `tauri_build::build()` call as before, and prints nothing here.
/// `CARGO_CFG_TARGET_*` describe the target of the build, not the host.
fn windows_msvc_target() -> bool {
    std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
}

/// The default manifest of `tauri_build` (its `windows-app-manifest.xml`).
const WINDOWS_APP_MANIFEST: &str = r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
</assembly>
"#;

fn emit_windows_app_manifest() {
    let out_dir = std::env::var_os("OUT_DIR").expect("cargo did not set OUT_DIR");
    let path = std::path::Path::new(&out_dir).join("windows-app-manifest.xml");
    if let Err(e) = std::fs::write(&path, WINDOWS_APP_MANIFEST) {
        panic!("could not write the Windows app manifest to {}: {e}", path.display());
    }
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", path.display());
    println!("cargo:rustc-link-arg=/MANIFESTUAC:NO");
}

/// `tauri_build::build()` with the manifest left out of its resource; on an
/// error it reports and stops the way `build()` does.
fn build_tauri_without_app_manifest() {
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    if let Err(error) = tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)) {
        println!("{error:#}");
        std::process::exit(1);
    }
}

/// The version of the package, as `LU_PHONE_VERSION` (see `src/phone_version.rs`).
///
/// A phone build reads it from the config of its platform, where
/// `scripts/mobile/release/version-setzen.sh` puts it. A desktop build gets
/// the version of the crate under this name and reads no phone file: nothing
/// a desktop build says or sends changes.
fn emit_phone_version() {
    println!("cargo:rerun-if-changed=tauri.ios.conf.json");
    println!("cargo:rerun-if-changed=tauri.android.conf.json");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let crate_version = std::env::var("CARGO_PKG_VERSION").unwrap_or_default();
    let platform = phone_version::platform_config_name(&target_os).and_then(|name| std::fs::read_to_string(name).ok());
    let main = platform.as_ref().and_then(|_| std::fs::read_to_string("tauri.conf.json").ok());
    let version = phone_version::phone_version(&target_os, platform.as_deref(), main.as_deref(), &crate_version);
    println!("cargo:rustc-env=LU_PHONE_VERSION={version}");
}

/// Android only: link the app library for 16 KB memory pages.
///
/// Google Play requires every app that targets Android 15 or newer to load on
/// a device with 16 KB pages. The NDK in use (r27) still tells the linker to
/// lay the LOAD segments out for 4 KB pages; from r28 on 16 KB is the default.
/// llama.cpp is linked statically into this one library, so this one link
/// decides for the whole package. A library laid out for 16 KB loads on a
/// 4 KB device as before.
///
/// The flag is emitted here and not as `rustflags` in `.cargo/config.toml`,
/// because a `RUSTFLAGS` in the environment replaces that list silently, and
/// because a changed `rustflags` rebuilds every crate of the target.
///
/// `CARGO_CFG_TARGET_OS` is the target of the build, not the host: on every
/// desktop target this function prints nothing.
///
/// Guards: `src/lib/__tests__/mobile-bau-fallen.test.ts` (this flag is present)
/// and `scripts/mobile/release/pruefe-16kb.mjs` (the finished package).
fn emit_android_page_size() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
    }
}

fn emit_mobile_client_page() {
    let dir = mobile_page::client_dir();

    // The directory is on the watch list next to the individual files so that
    // a NEW source — one that `SOURCES` does not know about yet — still
    // triggers a re-run, and the ledger test in `mobile_page` gets to fail.
    println!("cargo:rerun-if-changed={}", dir.display());
    for name in mobile_page::SOURCES {
        println!("cargo:rerun-if-changed={}", dir.join(name).display());
    }

    let page = match mobile_page::assemble(&dir) {
        Ok(page) => page,
        Err(why) => panic!(
            "the mobile client page could not be assembled from {}:\n\n{why}\n\n\
             That page is what a paired phone receives. Building without it \
             would ship whatever the last successful build produced, so the \
             build stops here instead.",
            dir.display()
        ),
    };

    let out_dir = std::env::var_os("OUT_DIR").expect("cargo did not set OUT_DIR");
    let out = std::path::Path::new(&out_dir).join(mobile_page::EMBED_NAME);
    if let Err(e) = std::fs::write(&out, page) {
        panic!("could not write the mobile client page to {}: {e}", out.display());
    }
}
