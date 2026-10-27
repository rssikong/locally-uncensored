//! The bridge to Kotlin (android/) and Swift (ios/).

use serde::{de::DeserializeOwned, Serialize};
use tauri::{
    plugin::{mobile::PluginInvokeError, PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::error::{Error, Result};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_lu_native);

pub struct Native<R: Runtime>(PluginHandle<R>);

pub fn init<R: Runtime, C: DeserializeOwned>(_app: &AppHandle<R>, api: PluginApi<R, C>) -> Result<Native<R>> {
    #[cfg(target_os = "android")]
    let handle = api
        .register_android_plugin("com.purpledoubled.lunative", "LuNativePlugin")
        .map_err(to_error)?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_lu_native).map_err(to_error)?;
    Ok(Native(handle))
}

/// A rejection from native code carries its own English sentence. Everything
/// else is a fault of the bridge and gets one neutral sentence: the raw text
/// of a JNI or JSON error is nothing a user can act on.
fn to_error(error: PluginInvokeError) -> Error {
    to_coded(error).1
}

/// The same, with the code native code gave its rejection (`no-space`,
/// `denied`), for the few commands that promise a fixed code.
fn to_coded(error: PluginInvokeError) -> (Option<String>, Error) {
    match error {
        PluginInvokeError::InvokeRejected(response) => (
            response.code,
            Error::new(response.message.unwrap_or_else(|| "The device refused this request.".to_string())),
        ),
        other => {
            eprintln!("[lu-native] bridge error: {other}");
            (None, Error::new("The native part of the app did not answer."))
        }
    }
}

impl<R: Runtime> Native<R> {
    pub const AVAILABLE: bool = true;

    pub async fn call<T: DeserializeOwned>(&self, command: &str, payload: impl Serialize) -> Result<T> {
        self.0.run_mobile_plugin_async(command, payload).await.map_err(to_error)
    }

    pub async fn call_coded<T: DeserializeOwned>(
        &self,
        command: &str,
        payload: impl Serialize,
    ) -> std::result::Result<T, (Option<String>, Error)> {
        self.0.run_mobile_plugin_async(command, payload).await.map_err(to_coded)
    }

    /// For the few callers that are not async (setup, the secret commands on
    /// a blocking thread). Never call this on the main thread for something
    /// that shows UI: the answer comes back through the main thread.
    pub fn call_blocking<T: DeserializeOwned>(&self, command: &str, payload: impl Serialize) -> Result<T> {
        self.0.run_mobile_plugin(command, payload).map_err(to_error)
    }
}
