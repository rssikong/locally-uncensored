// Kommandos, die JS direkt als plugin:luharness|<name> aufruft. Sie landen ohne
// Rust-Huelle in Swift. registerListener und remove_listener braucht addPluginListener.
const COMMANDS: &[&str] = &["simulate_memory_warning", "lifecycle_log", "back_gesture", "registerListener", "remove_listener"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
