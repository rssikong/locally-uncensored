package com.purpledoubled.lunative

import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.os.Build

// The colour of the app before the page has drawn anything.
//
// Three things are on the screen before the first frame of the page: the
// start screen of the system, the window of the activity and the empty
// WebView. All three have to show the ground colour the page is going to
// have, or the start flickers (acceptance round 5, N8: a short black screen
// in light mode).
//
// The start screen of the system can only follow the system (values/ and
// values-night/ of the app). The phone shell follows the system too, unless
// the user chose a fixed theme in the settings. That choice lives in the
// storage of the page, which cannot be read before the page runs, so the
// page hands it over once (setSystemBars) and it is kept here. With a fixed
// theme against the system the start is then exactly one change: start
// screen of the system, after that the theme of the app.
//
// From Android 12 on the choice is also handed to the system
// (UiModeManager.setApplicationNightMode). The start screen is a window of
// the system, built from the theme of the app before any code of the app
// runs, and it owns the symbols of the status bar until it has left the
// screen. With a fixed theme against the system that left the clock in the
// colour of the start screen on the ground of the app for about a third of a
// second after the change (re-check Android 8 GB, A-06, runs D3 and D4: 0.30 s
// and 0.26 s). Told about the choice, the system builds the start screen, its
// bar symbols and the resources of the app (values/ and values-night/) in the
// chosen theme, so there is no change left at all. Android 7 to 11 have no
// such call and keep the one change described above.
//
// The two colours are --m-canvas of src/mobile/styles/tokens.css. The guard
// src/mobile/platform/__tests__/start-colours.test.ts keeps them equal.
object StartTheme {
  const val FILE = "lu_start_theme"
  const val KEY = "theme"
  const val CANVAS_LIGHT: Int = 0xFFF3F4F6.toInt()
  const val CANVAS_DARK: Int = 0xFF141414.toInt()

  /** `dark`, `light` or `system`. Anything else is `system`. */
  fun parse(raw: String?): String = if (raw == "dark" || raw == "light") raw else "system"

  /** A fixed choice wins, otherwise the system decides. */
  fun isDark(pref: String?, systemDark: Boolean): Boolean = when (parse(pref)) {
    "dark" -> true
    "light" -> false
    else -> systemDark
  }

  fun canvas(dark: Boolean): Int = if (dark) CANVAS_DARK else CANVAS_LIGHT

  fun stored(context: Context): String = try {
    parse(context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY, null))
  } catch (e: Exception) {
    "system"
  }

  fun store(context: Context, pref: String?) {
    try {
      context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY, parse(pref)).apply()
    } catch (e: Exception) {
      // The next start follows the system. The page sets its theme either way.
    }
    tellSystem(context)
  }

  /** Which choice the system was told last. Missing after a fresh install and after "clear data". */
  const val APPLIED_KEY = "applied"

  /** The night mode of the app for a choice: yes, no, or follow the system (which also takes a fixed mode back). */
  fun nightMode(pref: String?): Int = when (parse(pref)) {
    "dark" -> UiModeManager.MODE_NIGHT_YES
    "light" -> UiModeManager.MODE_NIGHT_NO
    else -> UiModeManager.MODE_NIGHT_AUTO
  }

  /**
   * Does the system have to be told. `applied` is what it was told last, null
   * when nothing is known: then it is told once, because the system keeps the
   * night mode of an app longer than the app keeps its own data.
   */
  fun mustTellSystem(pref: String?, applied: String?): Boolean = applied == null || parse(pref) != parse(applied)

  /**
   * Hand the stored choice to the system, once per change. The system answers
   * with a change of the configuration (uiMode), which the activity takes
   * without being created again (android:configChanges).
   */
  fun tellSystem(context: Context) {
    // Only Android 12 and newer can be told.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    try {
      val app = context.applicationContext
      val prefs = app.getSharedPreferences(FILE, Context.MODE_PRIVATE)
      val pref = parse(prefs.getString(KEY, null))
      if (!mustTellSystem(pref, prefs.getString(APPLIED_KEY, null))) return
      val manager = app.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager ?: return
      manager.setApplicationNightMode(nightMode(pref))
      prefs.edit().putString(APPLIED_KEY, pref).apply()
    } catch (e: Exception) {
      // The start then shows one change of colour, as before.
    }
  }

  fun systemIsDark(context: Context): Boolean =
    (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

  /** What the app is going to look like, asked before anything is drawn. */
  fun isDark(context: Context): Boolean = isDark(stored(context), systemIsDark(context))
}
