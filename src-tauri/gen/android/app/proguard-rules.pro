# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
# ── Reached only from Rust, over JNI ────────────────────────────────────────
#
# R8 shrinks against what Java/Kotlin code calls. `commands/android_share.rs`
# calls FileProvider.getUriForFile through JNI, which R8 cannot see, so the
# release build kept the class (the manifest names it) and stripped the method.
# The symptom is a release-only crash at the moment the user taps Export:
#
#   java.lang.NoSuchMethodError: no static method
#   "Landroidx/core/content/FileProvider;.getUriForFile(
#     Landroid/content/Context;Ljava/lang/String;Ljava/io/File;)Landroid/net/Uri;"
#
# Debug builds do not minify, so this can only ever be found by running the
# release APK.
-keep class androidx.core.content.FileProvider { *; }
