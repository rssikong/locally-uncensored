package com.purpledoubled.locallyuncensored

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.os.Process
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.purpledoubled.lunative.StartTheme

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Edge-to-edge is enforced on targetSdk 35+; instead of fighting it we
    // pad the content view by the system-bar + IME insets ourselves. That
    // keeps the WebView out from under the status bar on every Android
    // version AND gives native keyboard avoidance (the composer is never
    // covered, the WebView shrinks, CSS dvh units track it).
    //
    // Colour before the page has drawn (round 5, N8): the start screen of the
    // system follows the system (values/ and values-night/). The window and
    // the symbols in the two bars take the theme the app is going to have,
    // which is the system too unless the user chose a fixed theme in the
    // settings (StartTheme, written by the page through lu-native). So
    // nothing changes colour on the way to the first frame, and with a fixed
    // theme against the system there is exactly one change.
    //
    // From Android 12 on the system is told about a fixed theme as well
    // (StartTheme.tellSystem), so the start screen and its bar symbols have
    // the chosen theme too and nothing changes at all (A-06, D3 and D4: the
    // clock kept the colour of the start screen for 0.3 s). The call here
    // only catches up: a choice made before this build, or cleared app data.
    StartTheme.tellSystem(this)
    val dark = StartTheme.isDark(this)
    val canvas = StartTheme.canvas(dark)
    // SystemBarStyle.dark = light symbols, for a dark ground. light = dark
    // symbols. Android 7 cannot darken the symbols of the navigation bar,
    // there the second colour lays a dark veil behind them instead.
    enableEdgeToEdge(
      statusBarStyle = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
      navigationBarStyle = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, 0x801B1B1B.toInt()),
    )
    super.onCreate(savedInstanceState)
    window.setBackgroundDrawable(ColorDrawable(canvas))
    window.decorView.setBackgroundColor(canvas)
    val content = findViewById<ViewGroup>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime()
      )
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }

  // The empty WebView is white until a page has drawn. Called by wry right
  // after the WebView exists and before it loads anything. tauri.android.conf.json
  // sets no backgroundColor on purpose: wry would apply that one fixed colour
  // after this hook.
  override fun onWebViewCreate(webView: WebView) {
    webView.setBackgroundColor(StartTheme.canvas(StartTheme.isDark(this)))
  }

  override fun onDestroy() {
    // Android is about to create this activity again inside the running
    // process, because a configuration changed that the manifest does not
    // claim (android:configChanges). The Rust side cannot follow that: tao
    // 0.34 calls the app's entry point from every onCreate, so a second app
    // would be built next to the first one while the first one exits. That
    // ended in a crash dialog ("FORTIFY: pthread_mutex_lock called on a
    // destroyed mutex", or a wry "Timeout" panic 10 s later). Reproduced on
    // 2026-10-08 with a resource-overlay change, which is what the system
    // does right after the first boot of a device.
    //
    // So the process does not live through a recreation: ask the system for a
    // fresh start of this activity, then end the process here, before
    // super.onDestroy() tells Rust anything. The user sees the app start
    // again instead of a crash. The manifest claims every change it can, so
    // this is the net under it. The last line of defence, should even this
    // be skipped, is src-tauri/src/android_entry.rs.
    if (isChangingConfigurations) {
      startActivity(Intent.makeRestartActivityTask(componentName))
      Process.killProcess(Process.myPid())
    }
    super.onDestroy()
  }
}
