//! The desktop stub.
//!
//! A desktop build compiles this plugin so that the app has one code path,
//! but nothing here reaches an operating system service: the desktop keeps
//! its own keychain, its own dialogs and its own downloads. Every native call
//! answers with one sentence. The pure Rust commands (Remote transport, temp
//! files) work on a desktop as well, which is what the tests use.

use serde::{de::DeserializeOwned, Serialize};
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::error::{Error, Result, NOT_ON_DESKTOP};

pub struct Native<R: Runtime>(std::marker::PhantomData<fn() -> R>);

pub fn init<R: Runtime, C: DeserializeOwned>(_app: &AppHandle<R>, _api: PluginApi<R, C>) -> Result<Native<R>> {
    Ok(Native(std::marker::PhantomData))
}

impl<R: Runtime> Native<R> {
    pub const AVAILABLE: bool = false;

    pub async fn call<T: DeserializeOwned>(&self, _command: &str, _payload: impl Serialize) -> Result<T> {
        Err(Error::new(NOT_ON_DESKTOP))
    }

    pub async fn call_coded<T: DeserializeOwned>(
        &self,
        _command: &str,
        _payload: impl Serialize,
    ) -> std::result::Result<T, (Option<String>, Error)> {
        Err((None, Error::new(NOT_ON_DESKTOP)))
    }

    pub fn call_blocking<T: DeserializeOwned>(&self, _command: &str, _payload: impl Serialize) -> Result<T> {
        Err(Error::new(NOT_ON_DESKTOP))
    }
}
