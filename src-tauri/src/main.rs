// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// The whole app lives in lib.rs (`run`), because the phone builds need a
// library: Android loads it as a cdylib, iOS links it as a staticlib. This
// file is only the desktop executable around the same entry point.
fn main() {
    locally_uncensored_lib::run()
}
