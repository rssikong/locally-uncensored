// Testbett fuer den iOS-Treiber. Die App tut selbst nichts, sie stellt nur eine
// inspizierbare WKWebView, einen Deeplink-Empfaenger und das Plugin luharness.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_luharness::init())
        .run(tauri::generate_context!())
        .expect("Testbett startet nicht");
}
