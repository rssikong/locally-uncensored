package com.purpledoubled.lunative

import android.content.Context

// When the question for notifications is put, and when it is not.
//
// Android 13 and newer show a notification only after the user said yes to
// POST_NOTIFICATIONS. The download service shows its progress in one; without
// the yes the download runs and nothing is to be seen outside the app. Until
// round 16 nobody asked: the command for the question existed and no page
// called it (acceptance android-4gb, F9).
//
// The rule: the question is put once, at the first download, after the page
// said in a sentence what it is for. A no stands. The app does not ask a
// second time; the switch in its settings then leads to the settings of the
// system, the only place where a refused permission can be given.
//
// "Asked before" is kept here and not in the page: the storage of the page
// can be lost (StorageFallback), and a second question after a no is what
// this rule is there to prevent.
object NotifyRule {
  const val FILE = "lu_notify"
  const val KEY = "asked"
  /** From this version on the system asks (Android 13). */
  const val ASKS_FROM_SDK = 33

  enum class Step {
    /** Notifications are shown. Nothing to do. */
    GRANTED,
    /** Not shown, never asked, and the caller wants the question now: put it. */
    ASK,
    /** Not shown and never asked. The caller only wanted to know. */
    OPEN,
    /** Not shown, and the app cannot ask (any more): only the system settings change this. */
    REFUSED,
  }

  /**
   * `shown`: the system shows notifications of this app right now.
   * `askedBefore`: the question was put once on this installation.
   * `ask`: the caller wants the question put, not only the state.
   */
  fun step(sdk: Int, shown: Boolean, askedBefore: Boolean, ask: Boolean): Step {
    if (shown) return Step.GRANTED
    // Before Android 13 there is no question: off means switched off in the system settings.
    if (sdk < ASKS_FROM_SDK) return Step.REFUSED
    if (askedBefore) return Step.REFUSED
    return if (ask) Step.ASK else Step.OPEN
  }

  /** Does this version of Android have the question at all. */
  fun needed(sdk: Int): Boolean = sdk >= ASKS_FROM_SDK

  fun askedBefore(context: Context): Boolean =
    context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(KEY, false)

  /** commit, not apply: the system dialog comes next and the app may be ended behind it. */
  fun noteAsked(context: Context) {
    context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(KEY, true).commit()
  }
}
