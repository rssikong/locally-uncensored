use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_luharness);

#[cfg(target_os = "ios")]
struct Griff<R: Runtime>(#[allow(dead_code)] tauri::plugin::PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("luharness")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            {
                use tauri::Manager;
                let griff = _api.register_ios_plugin(init_plugin_luharness)?;
                _app.manage(Griff(griff));
            }
            Ok(())
        })
        .build()
}
