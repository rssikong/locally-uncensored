# The plugin class, its commands and its argument classes are kept by the
# rules of tauri-android (@TauriPlugin, @Command, @InvokeArg). What is left
# is what only the manifest names.
-keep class com.purpledoubled.lunative.DownloadService { public <init>(); }
-keep class com.purpledoubled.lunative.LuNativeFileProvider { public <init>(); }
