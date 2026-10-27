//! The commands JavaScript calls as `plugin:lu-native|<name>`.
//!
//! Arguments arrive in camelCase (`bytesBase64` for `bytes_base64`), answers
//! leave in camelCase. Secure storage has no command here on purpose: the app
//! keeps its own `secret_*` commands with their allow-list of account names
//! and calls the Rust API of this plugin behind it, so a script in the
//! webview cannot read an arbitrary entry.

use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{command, AppHandle, Runtime};

use crate::download::{BgCommand, BgDownload, BgStart};
use crate::error::{Error, Result};
use crate::remote::{RemoteRequest, RemoteResponse};
use crate::temp::{self, TempFile};
use crate::{LuNativeExt, ACCEPTANCE_BUILD};

/// Exactly one of the three ways to say what is being shared or saved.
enum Source {
    /// A file in the app's folders, real path.
    File(PathBuf),
    Text(String),
}

fn one_source<R: Runtime>(
    app: &AppHandle<R>,
    path: Option<String>,
    bytes_base64: Option<String>,
    text: Option<String>,
    filename: Option<&str>,
    text_needs_file: bool,
) -> Result<Source> {
    let native = app.lu_native();
    let given = [path.is_some(), bytes_base64.is_some(), text.is_some()].iter().filter(|g| **g).count();
    if given != 1 {
        return Err(Error::new("Give exactly one of path, bytesBase64 or text."));
    }
    if let Some(path) = path {
        return Ok(Source::File(temp::existing_inside(&PathBuf::from(path), &native.owned_roots())?));
    }
    let temp_dir = native.temp_dir()?;
    if let Some(data) = bytes_base64 {
        let file = temp::write_chunk(&temp_dir, None, Some(filename.unwrap_or("file")), &data)?;
        return Ok(Source::File(PathBuf::from(file.path)));
    }
    let text = text.unwrap_or_default();
    match filename {
        Some(name) if !name.trim().is_empty() || text_needs_file => write_text(&temp_dir, name, &text),
        None if text_needs_file => write_text(&temp_dir, "text.txt", &text),
        _ => Ok(Source::Text(text)),
    }
}

fn write_text(temp_dir: &std::path::Path, name: &str, text: &str) -> Result<Source> {
    let target = temp::new_temp_path(temp_dir, if name.trim().is_empty() { "text.txt" } else { name })?;
    std::fs::write(&target, text.as_bytes()).map_err(|_| Error::new("The file could not be written."))?;
    Ok(Source::File(target))
}

fn mime_or_guess(mime: Option<String>, name: &str) -> String {
    if let Some(m) = mime.map(|m| m.trim().to_ascii_lowercase()).filter(|m| m.contains('/')) {
        return m;
    }
    guess_mime(name).to_string()
}

pub(crate) fn guess_mime(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "heic" => "image/heic",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "json" => "application/json",
        "md" => "text/markdown",
        "txt" | "log" => "text/plain",
        "csv" => "text/csv",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

// ── sharing and saving ──────────────────────────────────────────────────

/// Open the system share sheet.
///
/// Answers `{ presented, completed?, target? }`. `completed` is only known on
/// iOS, Android does not say what the user did with the sheet.
#[command]
pub(crate) async fn share_file<R: Runtime>(
    app: AppHandle<R>,
    path: Option<String>,
    bytes_base64: Option<String>,
    text: Option<String>,
    filename: Option<String>,
    mime: Option<String>,
    title: Option<String>,
) -> Result<Value> {
    let source = one_source(&app, path, bytes_base64, text, filename.as_deref(), false)?;
    let payload = match source {
        Source::Text(text) => json!({ "text": text, "mime": "text/plain", "title": title }),
        Source::File(file) => {
            let name = filename
                .map(|n| temp::safe_file_name(&n))
                .unwrap_or_else(|| file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
            json!({ "path": file, "filename": name, "mime": mime_or_guess(mime, &name), "title": title })
        }
    };
    app.lu_native().call("shareFile", payload).await
}

/// The fixed error codes of `save_to_photos`.
///
/// Every error of that command is `[photos:<code>] <sentence>` with exactly
/// one of three codes, so the page tells "no room" from "not allowed" from
/// everything else without reading the sentence. The bridge
/// (`saveToPhotos` in src/lib/lu-native.ts) takes the tag off again and
/// throws a `PhotoSaveError` with `code` and the plain sentence.
pub(crate) mod photos {
    use crate::error::Error;

    pub const NO_SPACE: &str = "no-space";
    pub const DENIED: &str = "denied";
    pub const FAILED: &str = "failed";

    /// The code native code gave, held to the three that are promised.
    pub fn code_of(native: Option<&str>) -> &'static str {
        match native {
            Some(NO_SPACE) => NO_SPACE,
            Some(DENIED) => DENIED,
            _ => FAILED,
        }
    }

    pub fn error(code: &str, sentence: &str) -> Error {
        Error::new(format!("[photos:{}] {sentence}", code_of(Some(code))))
    }
}

/// Put an image or a video into the photo library. `kind` is `image` or
/// `video`. Answers `{ saved: true, uri? }`. An error carries one of the
/// three codes of `photos`: `no-space`, `denied`, `failed`.
#[command]
pub(crate) async fn save_to_photos<R: Runtime>(app: AppHandle<R>, path: String, kind: Option<String>) -> Result<Value> {
    let native = app.lu_native();
    let file = temp::existing_inside(&PathBuf::from(path), &native.owned_roots())
        .map_err(|e| photos::error(photos::FAILED, &e))?;
    let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let mime = guess_mime(&name);
    let kind = match kind.as_deref().map(str::to_ascii_lowercase).as_deref() {
        Some("image") => "image",
        Some("video") => "video",
        None if mime.starts_with("video/") => "video",
        None if mime.starts_with("image/") => "image",
        _ => return Err(photos::error(photos::FAILED, "Only an image or a video can be saved to the photo library.")),
    };
    let bytes = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    native
        .call_coded("saveToPhotos", json!({ "path": file, "kind": kind, "mime": mime, "filename": name, "bytes": bytes }))
        .await
        .map_err(|(code, error)| photos::error(photos::code_of(code.as_deref()), &error.0))
}

/// Let the user pick where a file is saved (Android: the system's document
/// picker, iOS: the Files export sheet). Answers `{ saved, uri? }`, `saved`
/// is false when the user closed the picker.
#[command]
pub(crate) async fn save_to_files<R: Runtime>(
    app: AppHandle<R>,
    path: Option<String>,
    bytes_base64: Option<String>,
    text: Option<String>,
    filename: Option<String>,
    mime: Option<String>,
) -> Result<Value> {
    let Source::File(file) = one_source(&app, path, bytes_base64, text, filename.as_deref(), true)? else {
        return Err(Error::new("There is nothing to save."));
    };
    let name = filename
        .map(|n| temp::safe_file_name(&n))
        .unwrap_or_else(|| file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    let mime = mime_or_guess(mime, &name);
    app.lu_native()
        .call("saveToFiles", json!({ "path": file, "filename": name, "mime": mime }))
        .await
}

/// Write one base64 piece of a file. The first call (no `path`) creates the
/// file and answers its path, every further call passes that path and
/// appends. At most 8 MB per piece.
#[command]
pub(crate) async fn write_temp_file<R: Runtime>(
    app: AppHandle<R>,
    path: Option<String>,
    filename: Option<String>,
    data_base64: String,
) -> Result<TempFile> {
    let temp_dir = app.lu_native().temp_dir()?;
    tauri::async_runtime::spawn_blocking(move || {
        temp::write_chunk(&temp_dir, path.as_deref(), filename.as_deref(), &data_base64)
    })
    .await
    .map_err(|_| Error::new("The file could not be written."))?
    .map_err(Error::from)
}

/// Load an https address into a temp file and answer `{ path, bytes, mime }`.
/// For results that are too large to pass through the webview, such as a
/// signed address of a Cloud render.
#[command]
pub(crate) async fn download_to_temp<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    filename: Option<String>,
    headers: Option<HashMap<String, String>>,
    max_bytes: Option<u64>,
    sha256: Option<String>,
) -> Result<TempFile> {
    let native = app.lu_native();
    let temp_dir = native.temp_dir()?;
    let headers = headers.unwrap_or_default();
    temp::download_to_temp(
        &temp_dir,
        temp::DownloadToTemp {
            url: &url,
            file_name: filename.as_deref(),
            headers: &headers,
            max_bytes,
            sha256: sha256.as_deref(),
            user_agent: &native.user_agent(),
            allow_test_hosts: ACCEPTANCE_BUILD,
        },
    )
    .await
    .map_err(Error::from)
}

/// Remove a temp file once it has been shared or saved. Answers whether
/// there was one.
#[command]
pub(crate) async fn delete_temp_file<R: Runtime>(app: AppHandle<R>, path: String) -> Result<bool> {
    let temp_dir = app.lu_native().temp_dir()?;
    temp::delete(&temp_dir, &path).map_err(Error::from)
}

// ── device ──────────────────────────────────────────────────────────────

/// Platform, model, memory, free space in the model folder, simulator or
/// not, text size. The keys are listed in mobile-docs/NATIVE-SCHICHT.md.
#[command]
pub(crate) async fn device_info<R: Runtime>(app: AppHandle<R>) -> Result<Value> {
    let native = app.lu_native();
    let models = native.models_dir();
    if let Some(dir) = &models {
        // The free-space question needs a folder that exists.
        let _ = std::fs::create_dir_all(dir);
    }
    let mut info: Value = if native.available() {
        native.call("deviceInfo", json!({ "path": models })).await?
    } else {
        json!({
            "platform": std::env::consts::OS,
            "model": "",
            "isEmulator": false,
            "totalMemoryBytes": 0,
            "availableMemoryBytes": 0,
            "diskFreeBytes": 0,
            "fontScale": 1.0,
        })
    };
    if let Some(map) = info.as_object_mut() {
        map.insert("appVersion".into(), json!(app.package_info().version.to_string()));
        map.insert("modelsDir".into(), json!(models));
        map.insert("acceptanceBuild".into(), json!(ACCEPTANCE_BUILD));
    }
    Ok(info)
}

/// Acceptance builds only (cargo feature `abnahme`): make the system deliver
/// a memory warning, so the reaction to it can be shown without starving a
/// device. Every other build answers with an error.
#[command]
pub(crate) async fn simulate_memory_warning<R: Runtime>(app: AppHandle<R>) -> Result<Value> {
    if !ACCEPTANCE_BUILD {
        return Err(Error::new("A memory warning can only be simulated in an acceptance build."));
    }
    app.lu_native().call("simulateMemoryWarning", json!({})).await
}

// ── lifecycle ───────────────────────────────────────────────────────────

/// Ask iOS for a little more time before the app is suspended, to finish
/// writing state. Answers `{ id }`, hand it to `end_background_task`. On
/// Android nothing needs asking, the id is 0.
#[command]
pub(crate) async fn begin_background_task<R: Runtime>(app: AppHandle<R>, name: Option<String>) -> Result<Value> {
    let native = app.lu_native();
    if !native.available() {
        return Ok(json!({ "id": 0 }));
    }
    native.call("beginBackgroundTask", json!({ "name": name.unwrap_or_else(|| "lu-flush".into()) })).await
}

#[command]
pub(crate) async fn end_background_task<R: Runtime>(app: AppHandle<R>, id: i64) -> Result<()> {
    let native = app.lu_native();
    if !native.available() {
        return Ok(());
    }
    let _: Value = native.call("endBackgroundTask", json!({ "id": id })).await?;
    Ok(())
}

/// Tell the Android side that JavaScript handles the back key from now on
/// (`armed: true`) or not any more. Without it the back key keeps its system
/// behaviour.
#[command]
pub(crate) async fn back_arm<R: Runtime>(app: AppHandle<R>, armed: bool) -> Result<()> {
    let native = app.lu_native();
    if !native.available() {
        return Ok(());
    }
    let _: Value = native.call("backArm", json!({ "armed": armed })).await?;
    Ok(())
}

/// "The `back` event arrived." If this does not come within a moment, the
/// Android side stops waiting for a page that no longer answers and lets the
/// system handle the key.
#[command]
pub(crate) async fn back_ack<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    let native = app.lu_native();
    if !native.available() {
        return Ok(());
    }
    let _: Value = native.call("backAck", json!({})).await?;
    Ok(())
}

/// JavaScript has nothing left to go back to: leave the app.
#[command]
pub(crate) async fn back_exit<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    let native = app.lu_native();
    if !native.available() {
        return Ok(());
    }
    let _: Value = native.call("backExit", json!({})).await?;
    Ok(())
}

// ── small services for the shell ────────────────────────────────────────

/// One tick of the vibration motor: `light`, `success` or `warning`. A phone
/// that has haptics switched off stays still, and that is not an error.
#[command]
pub(crate) async fn haptic<R: Runtime>(app: AppHandle<R>, kind: Option<String>) -> Result<()> {
    let native = app.lu_native();
    if !native.available() {
        return Err(Error::new(crate::error::NOT_ON_DESKTOP));
    }
    let _: Value = native.call("haptic", json!({ "kind": crate::net::haptic_kind(kind.as_deref()) })).await?;
    Ok(())
}

/// Open a web link in the browser, a mail address in the mail app, a phone
/// number in the dialer. Nothing else leaves the app through here.
#[command]
pub(crate) async fn open_external<R: Runtime>(app: AppHandle<R>, url: String) -> Result<()> {
    let checked = crate::net::check_external_url(&url)?;
    let native = app.lu_native();
    if !native.available() {
        return Err(Error::new(crate::error::NOT_ON_DESKTOP));
    }
    let _: Value = native.call("openExternal", json!({ "url": checked.as_str() })).await?;
    Ok(())
}

/// Open the page of this app in the system settings (camera, photos,
/// notifications, local network).
#[command]
pub(crate) async fn open_system_settings<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.lu_native().open_system_settings().await
}

/// Scan one QR code with the camera. `None` when the user closed the
/// scanner. iOS shows its own camera picture; Android hands one photo of the
/// system camera app to a decoder in Kotlin (round 57), so the app needs
/// neither the camera permission nor Google services.
#[command]
pub(crate) async fn scan_qr<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        let answer: Value = app.lu_native().call("scanQr", json!({})).await?;
        Ok(answer.get("text").and_then(Value::as_str).filter(|t| !t.is_empty()).map(str::to_string))
    }
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let _ = app;
        Err(Error::new("This device has no built-in QR scanner in the app."))
    }
}

/// "Sign in with Apple": the sheet of the system. `nonce` is the random text
/// of the page as it is; Swift hands Apple its SHA-256 and the page hands the
/// text itself to the account server. Answers `{ cancelled: true }` when the
/// user closed the sheet, otherwise `{ cancelled: false, identityToken }`.
/// The app asks Apple for the address only, no name. Nothing of it is kept
/// or logged here.
/// iOS only: Android has no such sheet, and the page shows no button there.
#[command]
pub(crate) async fn apple_sign_in<R: Runtime>(app: AppHandle<R>, nonce: String) -> Result<Value> {
    #[cfg(target_os = "ios")]
    {
        app.lu_native().call("appleSignIn", json!({ "nonce": nonce })).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, nonce);
        Err(Error::new("Sign in with Apple is only available on an iPhone or iPad."))
    }
}

/// The sign-in sheet of the system for a web page (ASWebAuthenticationSession,
/// WebAuth.swift): the page of Google or GitHub opens over the app and the
/// sheet closes by itself when the page ends on a link of `callback_scheme`.
/// Answers `{ cancelled: true }` when the user closed the sheet, otherwise
/// `{ cancelled: false, url }` with that link. Nothing of it is kept or
/// logged here: the link carries the code of the sign-in.
/// iOS only: Android opens the browser (`open_external`) and gets the link
/// back through the system.
#[command]
pub(crate) async fn web_auth<R: Runtime>(app: AppHandle<R>, url: String, callback_scheme: String) -> Result<Value> {
    let (page, scheme) = crate::net::check_web_auth(&url, &callback_scheme)?;
    #[cfg(target_os = "ios")]
    {
        app.lu_native().call("webAuth", json!({ "url": page.as_str(), "callbackScheme": scheme })).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, page, scheme);
        Err(Error::new("The sign-in sheet of the system is only available on an iPhone or iPad."))
    }
}

/// Documents for a message, picked in the Files app (DocumentPick.swift):
/// the picker of the system for files, without the menu "Photo Library,
/// Take Photo, Choose Files" a file field of the webview puts in front of it.
/// The system hands out copies, Swift moves them into the temp folder, and
/// the page reads them from there in pieces (`read_temp_file`) and removes
/// them (`delete_temp_file`). Answers `{ cancelled: true }` or
/// `{ cancelled: false, files: [{ path, name, bytes, mime }] }`.
/// iOS only: the file field of the Android webview opens the picker for
/// files directly.
#[command]
pub(crate) async fn pick_documents<R: Runtime>(app: AppHandle<R>, max_files: Option<u32>) -> Result<Value> {
    let limit = temp::pick_limit(max_files);
    #[cfg(target_os = "ios")]
    {
        let native = app.lu_native();
        let dir = native.temp_dir()?;
        native.call("pickDocuments", json!({ "dir": dir, "maxFiles": limit })).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, limit);
        Err(Error::new("This device picks files in the page itself."))
    }
}

/// One piece of a temp file as base64: `{ dataBase64, bytes, totalBytes, done }`.
/// At most 8 MB at a time. Only files in the temp folder of the app.
#[command]
pub(crate) async fn read_temp_file<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    offset: Option<u64>,
    length: Option<u64>,
) -> Result<temp::TempPiece> {
    let temp_dir = app.lu_native().temp_dir()?;
    tauri::async_runtime::spawn_blocking(move || temp::read_chunk(&temp_dir, &path, offset.unwrap_or(0), length))
        .await
        .map_err(|_| Error::new("The temporary file could not be read."))?
        .map_err(Error::from)
}

/// What every command of the in-app purchase answers outside iOS.
#[cfg(not(target_os = "ios"))]
const IAP_ONLY_IOS: &str = "Adding credits in the app is only available on an iPhone or iPad.";

/// Credits as an in-app purchase (StoreKit 2, consumables; Iap.swift).
/// The products the store knows of `ids`, in that order:
/// `{ products: [{ id, displayName, description, displayPrice }], canPurchase }`.
/// `displayPrice` is the finished text of the store; the app has no price of
/// its own. iOS only, like the three commands below.
#[command]
pub(crate) async fn iap_products<R: Runtime>(app: AppHandle<R>, ids: Vec<String>) -> Result<Value> {
    #[cfg(target_os = "ios")]
    {
        app.lu_native().call("iapProducts", json!({ "ids": ids })).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, ids);
        Err(Error::new(IAP_ONLY_IOS))
    }
}

/// The sheet of the system for one product. `account_token` is the UUID of
/// the signed in account; the store signs it into the transaction. Answers
/// `{ state: "success", transactionId, productId, transaction }` with the
/// signed transaction (JWS), `{ state: "userCancelled" }` or
/// `{ state: "pending" }`. The purchase is NOT finished by this command: the
/// page hands the transaction to the account server and calls `iap_finish`
/// only after the server credited it. Nothing of it is kept or logged here.
#[command]
pub(crate) async fn iap_purchase<R: Runtime>(app: AppHandle<R>, id: String, account_token: String) -> Result<Value> {
    #[cfg(target_os = "ios")]
    {
        app.lu_native().call("iapPurchase", json!({ "id": id, "accountToken": account_token })).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, id, account_token);
        Err(Error::new(IAP_ONLY_IOS))
    }
}

/// End one purchase by its id, after the account server credited it.
/// `{ ok }`, false when no open purchase has that id.
#[command]
pub(crate) async fn iap_finish<R: Runtime>(app: AppHandle<R>, transaction_id: String) -> Result<Value> {
    #[cfg(target_os = "ios")]
    {
        app.lu_native().call("iapFinish", json!({ "transactionId": transaction_id })).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, transaction_id);
        Err(Error::new(IAP_ONLY_IOS))
    }
}

/// Every purchase that is still open, for the start of the app:
/// `{ transactions: [{ transactionId, productId, transaction }] }`.
#[command]
pub(crate) async fn iap_unfinished<R: Runtime>(app: AppHandle<R>) -> Result<Value> {
    #[cfg(target_os = "ios")]
    {
        app.lu_native().call("iapUnfinished", json!({})).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Err(Error::new(IAP_ONLY_IOS))
    }
}

/// Android: the status bar and the navigation bar take the colour of the
/// page, and their symbols turn dark on a light page (`light: true`). The
/// bridge calls this whenever the theme of the page changes. On iOS the page
/// reaches under the bars itself, there only `theme` matters.
///
/// `theme` is the choice of the user in the app (`dark`, `light`, `system`).
/// Both platforms keep it, so the next start can colour the window before
/// the page runs, and put it on the window now.
#[command]
pub(crate) async fn set_system_bars<R: Runtime>(
    app: AppHandle<R>,
    light: bool,
    color: Option<String>,
    theme: Option<String>,
) -> Result<()> {
    let theme = crate::net::start_theme(theme.as_deref());
    #[cfg(target_os = "android")]
    {
        let payload = json!({ "light": light, "color": crate::net::bar_color(color.as_deref()), "theme": theme });
        let _: Value = app.lu_native().call("setSystemBars", payload).await?;
    }
    #[cfg(target_os = "ios")]
    {
        let _ = (light, color);
        let _: Value = app.lu_native().call("setSystemBars", json!({ "theme": theme })).await?;
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = (app, light, color, theme);
    }
    Ok(())
}

// ── deep link ───────────────────────────────────────────────────────────

/// The link the app was opened with, exactly once. Also set by a link that
/// arrives while the app runs, so a page that was not listening yet does not
/// lose it.
#[command]
pub(crate) async fn pending_deep_link<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>> {
    let native = app.lu_native();
    native.wait_attached().await;
    Ok(native.take_deep_link())
}

// ── Remote transport ────────────────────────────────────────────────────

/// One request to a desktop LU. Private addresses and trycloudflare.com
/// only. Answers `{ status, body, refreshedToken, memoryRevoked, headers,
/// cancelled }`; a status that is not 2xx is an answer, not an error.
#[command]
pub(crate) async fn remote_client_request<R: Runtime>(
    app: AppHandle<R>,
    method: Option<String>,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    cancel_id: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<RemoteResponse> {
    let native = app.lu_native();
    let request = RemoteRequest { method, url, headers: headers.unwrap_or_default(), body, cancel_id, timeout_ms };
    crate::remote::request(&native.cancel_book, &native.user_agent(), request)
        .await
        .map_err(Error::from)
}

/// Close the connection of a running `remote_client_request`. Also works
/// when it arrives before the request did.
#[command]
pub(crate) async fn remote_client_cancel<R: Runtime>(app: AppHandle<R>, cancel_id: String) -> Result<bool> {
    Ok(app.lu_native().cancel_book.cancel(&cancel_id))
}

// ── background downloads ────────────────────────────────────────────────

/// Start a download that survives the app. Answers `{ status, id }` with
/// status `started`, `already_running` or `done`.
#[command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn bg_download_start<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    url: String,
    dest: String,
    expected_bytes: Option<u64>,
    expected_bytes_exact: Option<bool>,
    sha256: Option<String>,
    headers: Option<HashMap<String, String>>,
    title: Option<String>,
) -> Result<Value> {
    let start = BgStart {
        id: id.clone(),
        url,
        dest,
        expected_bytes,
        expected_bytes_exact: expected_bytes_exact.unwrap_or(false),
        sha256,
        headers: headers.unwrap_or_default(),
        title,
    };
    let status = app.lu_native().bg_start(start).await?;
    Ok(json!({ "status": status, "id": id }))
}

async fn bg_simple<R: Runtime>(app: AppHandle<R>, id: String, command: BgCommand) -> Result<Value> {
    let status = app.lu_native().bg_command(&id, command).await?;
    Ok(json!({ "status": status, "id": id }))
}

/// Stop the transfer and keep the bytes.
#[command]
pub(crate) async fn bg_download_pause<R: Runtime>(app: AppHandle<R>, id: String) -> Result<Value> {
    bg_simple(app, id, BgCommand::Pause).await
}

/// Continue a paused or failed download from the bytes on disk.
#[command]
pub(crate) async fn bg_download_resume<R: Runtime>(app: AppHandle<R>, id: String) -> Result<Value> {
    bg_simple(app, id, BgCommand::Resume).await
}

/// Stop the transfer AND delete the partial file.
#[command]
pub(crate) async fn bg_download_cancel<R: Runtime>(app: AppHandle<R>, id: String) -> Result<Value> {
    bg_simple(app, id, BgCommand::Cancel).await
}

/// Take a settled line (done, paused, error) out of the list and leave the
/// disk alone.
#[command]
pub(crate) async fn bg_download_forget<R: Runtime>(app: AppHandle<R>, id: String) -> Result<Value> {
    bg_simple(app, id, BgCommand::Forget).await
}

/// The switch "Download on Wi-Fi only". Native code keeps it and holds every
/// download to it: at the start, at every continue, after a restart and
/// while the page is not running. A desktop has no such rule and answers ok.
#[command]
pub(crate) async fn bg_download_network_rule<R: Runtime>(app: AppHandle<R>, wifi_only: bool) -> Result<Value> {
    let native = app.lu_native();
    if !native.available() {
        return Ok(json!({ "ok": true }));
    }
    native.call::<Value>("bgNetworkRule", json!({ "wifiOnly": wifi_only })).await?;
    Ok(json!({ "ok": true }))
}

/// "Download anyway": this one download may use mobile data although the
/// switch is on (`allow` false takes it back). May be called before the start.
#[command]
pub(crate) async fn bg_download_allow_metered<R: Runtime>(app: AppHandle<R>, id: String, allow: Option<bool>) -> Result<Value> {
    crate::download::check_id(&id)?;
    let native = app.lu_native();
    if !native.available() {
        return Ok(json!({ "ok": true }));
    }
    native.call::<Value>("bgAllowMetered", json!({ "id": id, "allow": allow.unwrap_or(true) })).await?;
    Ok(json!({ "ok": true }))
}

/// Which kind of network the device is on: `{ kind, metered, wifiOnly }` with
/// kind `wifi`, `cellular`, `ethernet`, `other` or `none`. A desktop answers
/// `unknown`, the page then falls back to what the browser knows.
#[command]
pub(crate) async fn connection_info<R: Runtime>(app: AppHandle<R>) -> Result<Value> {
    let native = app.lu_native();
    if !native.available() {
        return Ok(json!({ "kind": "unknown", "metered": false, "wifiOnly": false }));
    }
    native.call::<Value>("connectionInfo", json!({})).await
}

/// Every download the device knows, also the ones that finished while the
/// app was not running.
#[command]
pub(crate) async fn bg_download_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<BgDownload>> {
    let native = app.lu_native();
    if !native.available() {
        return Ok(Vec::new());
    }
    native.bg_list().await
}

/// Android 13 and newer ask before an app may show the download
/// notification. Answers `{ granted, needed, asked }`.
///
/// `ask` false reads the state and never puts the question. With `ask` true
/// (or left out) the question of the system is put if it was never put on
/// this installation; a refusal stands (NotifyRule.kt). Always granted and
/// never needed where the system has no such question.
#[command]
pub(crate) async fn request_notification_permission<R: Runtime>(app: AppHandle<R>, ask: Option<bool>) -> Result<Value> {
    let native = app.lu_native();
    if !native.available() {
        return Ok(json!({ "granted": true, "needed": false, "asked": false }));
    }
    native.call("requestNotificationPermission", json!({ "ask": ask.unwrap_or(true) })).await
}

// ── notices of the computer (A17) ────────────────────────────────────────

/// What a notice of the computer may carry: an id of its own, a short title
/// and text, and a link back into the app that is one of ours.
pub(crate) fn check_local_notice(id: &str, title: &str, body: &str, url: Option<&str>) -> Result<()> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err(Error::new("The notice has no valid id."));
    }
    if title.trim().is_empty() || title.chars().count() > 120 || body.chars().count() > 400 {
        return Err(Error::new("The notice is empty or too long."));
    }
    if let Some(u) = url {
        if !u.starts_with("lu://remote/notice?") || u.len() > 300 {
            return Err(Error::new("The notice can only open LU itself."));
        }
    }
    Ok(())
}

/// A notice of the system: "Answer ready", "Render ready", "Approval needed"
/// (A17). Tapped, it opens `url` in the app (a deep link of the app's own).
/// Answers `{ shown }`: false when the user did not allow notifications.
#[command]
pub(crate) async fn local_notify<R: Runtime>(app: AppHandle<R>, id: String, title: String, body: Option<String>, url: Option<String>) -> Result<Value> {
    let body = body.unwrap_or_default();
    check_local_notice(&id, &title, &body, url.as_deref())?;
    let native = app.lu_native();
    if !native.available() {
        return Ok(json!({ "shown": false }));
    }
    native.call("localNotify", json!({ "id": id, "title": title, "body": body, "url": url })).await
}

/// Keep the app alive while the phone waits for the computer (A17): on
/// Android a foreground service with a quiet notice, on iOS the time the
/// system gives a background task. `on: false` ends it.
#[command]
pub(crate) async fn remote_watch<R: Runtime>(app: AppHandle<R>, on: bool, text: Option<String>) -> Result<Value> {
    let native = app.lu_native();
    if !native.available() {
        return Ok(json!({ "ok": false }));
    }
    let text: String = text.unwrap_or_default().chars().take(120).collect();
    native.call("remoteWatch", json!({ "on": on, "text": text })).await
}

/// The question of the system for notices of the computer. Android: the same
/// question as for downloads (once per installation). iOS: the question for
/// alerts, which local notices need. Answers `{ granted, needed, asked }`.
/// `ask: false` only reads the state and never puts the question.
#[command]
pub(crate) async fn remote_notify_permission<R: Runtime>(app: AppHandle<R>, ask: Option<bool>) -> Result<Value> {
    let native = app.lu_native();
    if !native.available() {
        return Ok(json!({ "granted": false, "needed": false, "asked": false }));
    }
    native.call("remoteNotifyPermission", json!({ "ask": ask.unwrap_or(true) })).await
}

// ── reading aloud ────────────────────────────────────────────────────────

/// The voices of the system: `{ available, voices: [{ id, name, lang, local, default }] }`.
/// On a desktop: not available, no voices.
#[command]
pub(crate) async fn tts_voices<R: Runtime>(app: AppHandle<R>) -> Result<crate::tts::TtsVoices> {
    crate::tts::voices(&app).await
}

/// Read a text aloud. Answers `{ id }` at once; `tts-start`, `tts-end` and
/// `tts-error` carry that id. A text that is being read is stopped first.
#[command]
pub(crate) async fn tts_speak<R: Runtime>(
    app: AppHandle<R>,
    text: String,
    voice: Option<String>,
    rate: Option<f32>,
    lang: Option<String>,
) -> Result<Value> {
    let id = crate::tts::speak(&app, &text, voice, rate, lang).await?;
    Ok(json!({ "id": id }))
}

/// Stop reading aloud. Nothing running is not an error.
#[command]
pub(crate) async fn tts_stop<R: Runtime>(app: AppHandle<R>) -> Result<Value> {
    crate::tts::stop(&app).await?;
    Ok(json!({ "ok": true }))
}

// ── a model file of the user's own ──────────────────────────────────────

/// Let the user pick a GGUF file in the system's document picker and copy it
/// into the model folder of the app. The bytes never pass through the
/// webview.
///
/// Answers `{ status, fileName?, path?, bytes, message? }` with status
/// `imported`, `cancelled`, `not-gguf`, `no-space`, `exists` or `failed`.
/// While the copy runs, `model-import-progress` carries `{ id, fileName,
/// receivedBytes, totalBytes }`; `id` is the one passed in here.
/// `import_model_cancel` stops the copy.
#[command]
pub(crate) async fn import_model_document<R: Runtime>(
    app: AppHandle<R>,
    id: Option<String>,
) -> Result<crate::import::ImportOutcome> {
    let id = id.map(|i| i.trim().to_string()).filter(|i| !i.is_empty()).unwrap_or_else(|| "import".to_string());
    crate::download::check_id(&id)?;
    app.lu_native().import_model(&id).await
}

/// Stop the copy of `import_model_document`. The half file is removed and
/// that command answers `cancelled`. Nothing running is not an error.
#[command]
pub(crate) async fn import_model_cancel<R: Runtime>(app: AppHandle<R>) -> Result<Value> {
    app.lu_native().import_cancel().await?;
    Ok(json!({ "ok": true }))
}

// ── the speed limit of the background downloads ─────────────────────────

/// Set (`bytesPerSecond`, 0 for none) or ask (no argument) the speed limit
/// all background downloads share. Answers `{ supported, bytesPerSecond }`.
///
/// Android only. The transfer there is a loop of the plugin, so it can wait
/// between two pieces. On iOS the system carries the download in a
/// background `URLSession`, which has no limit to set and does not let the
/// app see the bytes while they arrive: `supported` is false there and the
/// page does not offer the control. A desktop keeps its own limit
/// (`set_download_limit`) and answers false here as well.
#[command]
pub(crate) async fn bg_download_limit<R: Runtime>(app: AppHandle<R>, bytes_per_second: Option<u64>) -> Result<Value> {
    match app.lu_native().bg_limit(bytes_per_second).await? {
        Some(now) => Ok(json!({ "supported": true, "bytesPerSecond": now })),
        None => Ok(json!({ "supported": false, "bytesPerSecond": 0 })),
    }
}

// ── photos the webview cannot decode ────────────────────────────────────

/// Longest side a transcoded picture may have.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) const TRANSCODE_MAX_SIDE: u32 = 8192;

/// The longest side and the JPEG quality a request ends up with.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) fn transcode_settings(max_side: Option<u32>, quality: Option<u32>) -> (u32, u32) {
    (max_side.unwrap_or(4096).clamp(64, TRANSCODE_MAX_SIDE), quality.unwrap_or(92).clamp(40, 100))
}

/// Decode a photo with the decoder of the system and answer it as JPEG:
/// `{ dataBase64, mime, width, height, bytes }`.
///
/// For HEIC on Android: the WebView there cannot decode it, the system can
/// (`ImageDecoder`, Android 9 and newer). The picture comes back upright
/// (the rotation note of the camera is applied) and scaled down so that its
/// longer side is at most `maxSide` (4096 unless said otherwise). `path` is
/// a file in the app's folders, usually one written with `write_temp_file`.
/// iOS does not need this, its webview reads HEIC itself.
#[command]
pub(crate) async fn transcode_image<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    max_side: Option<u32>,
    quality: Option<u32>,
) -> Result<Value> {
    #[cfg(target_os = "android")]
    {
        use base64::Engine as _;
        let native = app.lu_native();
        let source = temp::existing_inside(&PathBuf::from(path), &native.owned_roots())?;
        let temp_dir = native.temp_dir()?;
        let out = temp::new_temp_path(&temp_dir, "transcoded.jpg")?;
        let (max_side, quality) = transcode_settings(max_side, quality);
        let answer: Result<Value> = native
            .call("transcodeImage", json!({ "path": source, "out": out, "maxSide": max_side, "quality": quality }))
            .await;
        let read = out.clone();
        let bytes = tauri::async_runtime::spawn_blocking(move || {
            let bytes = std::fs::read(&read);
            let _ = std::fs::remove_file(&read);
            bytes
        })
        .await
        .map_err(|_| Error::new("The converted photo could not be read."))?;
        let answer = answer?;
        let bytes = bytes.map_err(|_| Error::new("The converted photo could not be read."))?;
        Ok(json!({
            "dataBase64": base64::engine::general_purpose::STANDARD.encode(&bytes),
            "mime": "image/jpeg",
            "width": answer.get("width").and_then(Value::as_u64).unwrap_or(0),
            "height": answer.get("height").and_then(Value::as_u64).unwrap_or(0),
            "bytes": bytes.len(),
        }))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, path, max_side, quality);
        Err(Error::new("This device reads the photo itself, nothing has to be converted."))
    }
}

// ── clipboard ───────────────────────────────────────────────────────────

/// Longer texts are refused: the clipboard of a phone travels through a
/// binder message, and one that is too large takes the app down with it.
pub(crate) const CLIPBOARD_MAX_BYTES: usize = 512 * 1024;

/// What may go on the clipboard: something, and not more than the limit.
pub(crate) fn check_clipboard_text(text: &str) -> Result<()> {
    if text.is_empty() {
        return Err(Error::new("There is nothing to copy."));
    }
    if text.len() > CLIPBOARD_MAX_BYTES {
        return Err(Error::new("That text is too long for the clipboard. Share it as a file instead."));
    }
    Ok(())
}

/// The text on the clipboard of the system: `{ text }`, `text` is null when
/// the clipboard is empty or holds something that is not text.
///
/// The webview cannot do this on a phone: `navigator.clipboard.readText()`
/// is refused in the Android WebView (NotAllowedError, seen on the
/// emulator), so every "Paste" button was dead there.
#[command]
pub(crate) async fn clipboard_read_text<R: Runtime>(app: AppHandle<R>) -> Result<Value> {
    let native = app.lu_native();
    if !native.available() {
        return Err(Error::new(crate::error::NOT_ON_DESKTOP));
    }
    let answer: Value = native.call("clipboardReadText", json!({})).await?;
    let text = answer.get("text").and_then(Value::as_str).filter(|t| !t.is_empty());
    Ok(json!({ "text": text }))
}

/// Put a text on the clipboard of the system. Answers `{ ok: true }` once
/// the system has taken it.
#[command]
pub(crate) async fn clipboard_write_text<R: Runtime>(app: AppHandle<R>, text: String) -> Result<Value> {
    check_clipboard_text(&text)?;
    let native = app.lu_native();
    if !native.available() {
        return Err(Error::new(crate::error::NOT_ON_DESKTOP));
    }
    native.call::<Value>("clipboardWriteText", json!({ "text": text })).await?;
    Ok(json!({ "ok": true }))
}

#[cfg(test)]
mod notice_tests {
    use super::check_local_notice;

    #[test]
    fn a_notice_opens_only_lu_and_stays_short() {
        assert!(check_local_notice("answer_chat1", "Answer ready", "Sure.", Some("lu://remote/notice?chat=chat_1")).is_ok());
        assert!(check_local_notice("render_1", "Render ready", "", None).is_ok());
        assert!(check_local_notice("", "Answer ready", "", None).is_err());
        assert!(check_local_notice("a b", "Answer ready", "", None).is_err());
        assert!(check_local_notice("a", " ", "", None).is_err());
        assert!(check_local_notice("a", "Answer ready", &"x".repeat(401), None).is_err());
        assert!(check_local_notice("a", "Answer ready", "", Some("https://example.com")).is_err());
        assert!(check_local_notice("a", "Answer ready", "", Some("lu://oauth/callback?code=x")).is_err());
    }
}

#[cfg(test)]
mod tests {
    use super::guess_mime;

    #[test]
    fn the_clipboard_takes_a_text_and_refuses_nothing_and_too_much() {
        use super::{check_clipboard_text, CLIPBOARD_MAX_BYTES};
        assert!(check_clipboard_text("hf_abc").is_ok());
        assert!(check_clipboard_text("").is_err());
        assert!(check_clipboard_text(&"a".repeat(CLIPBOARD_MAX_BYTES)).is_ok());
        assert!(check_clipboard_text(&"a".repeat(CLIPBOARD_MAX_BYTES + 1)).is_err());
    }

    #[test]
    fn a_photo_error_carries_one_of_three_codes() {
        use super::photos::{code_of, error, DENIED, FAILED, NO_SPACE};
        assert_eq!(code_of(Some("no-space")), NO_SPACE);
        assert_eq!(code_of(Some("denied")), DENIED);
        assert_eq!(code_of(Some("something-new")), FAILED);
        assert_eq!(code_of(None), FAILED);
        assert_eq!(error(NO_SPACE, "No room.").0, "[photos:no-space] No room.");
        assert_eq!(error("made-up", "Odd.").0, "[photos:failed] Odd.");
    }

    #[test]
    fn a_transcode_request_stays_inside_its_bounds() {
        use super::transcode_settings;
        assert_eq!(transcode_settings(None, None), (4096, 92));
        assert_eq!(transcode_settings(Some(1), Some(1)), (64, 40));
        assert_eq!(transcode_settings(Some(100_000), Some(500)), (8192, 100));
    }

    #[test]
    fn the_extension_names_the_type() {
        assert_eq!(guess_mime("Bild.PNG"), "image/png");
        assert_eq!(guess_mime("clip.mp4"), "video/mp4");
        assert_eq!(guess_mime("chats.json"), "application/json");
        assert_eq!(guess_mime("noext"), "application/octet-stream");
    }
}
