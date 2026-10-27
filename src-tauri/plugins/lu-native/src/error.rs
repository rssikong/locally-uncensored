//! One error type for the whole plugin: a sentence in English.
//!
//! The frontend shows these texts or branches on a stable prefix, it never
//! parses a code. Everything that comes from the operating system is turned
//! into a sentence where it happens, so no German system message can end up
//! in front of a user through here.

use serde::{Serialize, Serializer};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error(pub String);

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub fn new(text: impl Into<String>) -> Self {
        Self(text.into())
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

impl From<String> for Error {
    fn from(text: String) -> Self {
        Self(text)
    }
}

impl From<&str> for Error {
    fn from(text: &str) -> Self {
        Self(text.to_string())
    }
}

impl From<Error> for String {
    fn from(error: Error) -> Self {
        error.0
    }
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

/// What every native-only call answers on a desktop.
pub const NOT_ON_DESKTOP: &str = "This function exists on a phone only.";
