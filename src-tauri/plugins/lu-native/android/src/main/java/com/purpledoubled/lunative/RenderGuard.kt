package com.purpledoubled.lunative

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.http.SslError
import android.os.Build
import android.os.Message
import android.os.Process
import android.util.Log
import android.view.KeyEvent
import android.webkit.ClientCertRequest
import android.webkit.HttpAuthHandler
import android.webkit.RenderProcessGoneDetail
import android.webkit.SafeBrowsingResponse
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient

// What happens when the process that draws the page is gone.
//
// A WebView draws its page in a process of its own (the renderer). Android
// ends it when memory is short, or it crashes, and then asks the client of
// the WebView (onRenderProcessGone, from Android 8). A client that does not
// answer costs the whole app: it is ended as after a crash. wry's client
// does not answer. A client that answers "handled" and does nothing keeps
// the app, with a white screen for good, because a WebView without its
// renderer cannot be used again. This is the Android half of finding N3 of
// the iPhone review, where the empty page stayed for 90 minutes.
//
// Nothing in the app can build a second WebView: Tauri builds the one it has
// when the activity is created, and the Rust side does not live through a
// second creation (see MainActivity.onDestroy). So the app starts again, the
// way MainActivity does it for a configuration change. The page then starts
// as it does after a kill: chats from the disk, an answer that was being
// written put back from its record and labelled as interrupted.
//
// An app in the background may not start an activity, so there the restart
// waits for the way back; until then the process, and a download running in
// it, stays alive. And a page that loses its renderer on every start must
// not turn into a loop, so restarts are counted, on the disk because every
// restart is a new process.
object RenderGone {
  const val FILE = "lu_render_guard"
  const val KEY = "restarts"
  const val LIMIT = 3
  const val WINDOW_MS = 60_000L

  enum class Step {
    /** Start the app again now. */
    RESTART,
    /** The app is not on the screen: start it again when it comes back. */
    RESTART_ON_RETURN,
    /** Too many restarts in a row: end the app without starting it again. */
    END,
  }

  /** `earlier`: when the app was started again for this reason before, wall clock in ms. */
  fun step(visible: Boolean, now: Long, earlier: List<Long>): Step {
    if (recent(now, earlier).size >= LIMIT) return Step.END
    return if (visible) Step.RESTART else Step.RESTART_ON_RETURN
  }

  /** The restarts that still count. A clock that was set back leaves none standing in the future. */
  fun recent(now: Long, earlier: List<Long>): List<Long> = earlier.filter { it <= now && now - it < WINDOW_MS }

  fun parse(raw: String?): List<Long> = (raw ?: "").split(',').mapNotNull { it.trim().toLongOrNull() }

  fun format(times: List<Long>): String = times.joinToString(",")

  fun read(context: Context): List<Long> =
    parse(context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY, null))

  /** commit, not apply: the process ends right after this. */
  fun note(context: Context, now: Long) {
    val times = recent(now, read(context)) + now
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY, format(times)).commit()
  }

  // ── the end is not silent ───────────────────────────────────────────
  //
  // END closes the app without a word: the loop has to stop, and a page
  // without a renderer cannot say anything. But the user saw an app that
  // vanished, and the next start said nothing either (acceptance
  // android-4gb, F14). So the end is noted, and the next start says one
  // sentence, in a dialog of the system: it must not depend on the page,
  // which is the thing that kept failing.

  const val ENDED_KEY = "ended"
  const val ENDED_TEXT = "LU closed because the page kept failing. Your chats are saved."
  const val ENDED_BUTTON = "OK"

  /**
   * What a start has to say. `endedAt`: when the guard last ended the app,
   * null or 0 when it never did or when that was said already.
   */
  fun sayAtStart(endedAt: Long?): String? = if (endedAt != null && endedAt > 0L) ENDED_TEXT else null

  /** Does this step end the app for good, so that the next start owes the sentence. */
  fun owesWord(step: Step): Boolean = step == Step.END

  /** commit, not apply: the process ends right after this. */
  fun noteEnded(context: Context, now: Long) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putLong(ENDED_KEY, if (now > 0L) now else 1L).commit()
  }

  /** Read the note and take it away: the sentence is said once. */
  fun takeEnded(context: Context): Long? {
    val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    val at = prefs.getLong(ENDED_KEY, 0L)
    if (at <= 0L) return null
    prefs.edit().remove(ENDED_KEY).commit()
    return at
  }
}

/**
 * Stands in front of the client wry gave the WebView. One call is answered
 * here, the end of the renderer; every other call goes to wry unchanged,
 * with the answer wry gives.
 *
 * Only the calls the system makes are passed on. The older forms of four of
 * them (a String instead of a request, an error code instead of an error)
 * are reached through the newer ones inside the client behind this one, as
 * they always were; passing them on as well would run them twice. The test
 * RenderGuardTest holds this list against android.webkit.WebViewClient.
 */
class GuardedWebViewClient(
  val inner: WebViewClient,
  private val onGone: (WebView?, RenderProcessGoneDetail?) -> Boolean,
) : WebViewClient() {
  // Every parameter is taken as the system hands it over, null or not, and
  // handed on the same way: this class adds no check of its own.
  override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean =
    inner.shouldOverrideUrlLoading(view, request)

  override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) = inner.onPageStarted(view, url, favicon)

  override fun onPageFinished(view: WebView?, url: String?) = inner.onPageFinished(view, url)

  override fun onLoadResource(view: WebView?, url: String?) = inner.onLoadResource(view, url)

  override fun onPageCommitVisible(view: WebView?, url: String?) = inner.onPageCommitVisible(view, url)

  override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? =
    inner.shouldInterceptRequest(view, request)

  override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) =
    inner.onReceivedError(view, request, error)

  override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, errorResponse: WebResourceResponse?) =
    inner.onReceivedHttpError(view, request, errorResponse)

  override fun onFormResubmission(view: WebView?, dontResend: Message?, resend: Message?) =
    inner.onFormResubmission(view, dontResend, resend)

  override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) =
    inner.doUpdateVisitedHistory(view, url, isReload)

  override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) =
    inner.onReceivedSslError(view, handler, error)

  override fun onReceivedClientCertRequest(view: WebView?, request: ClientCertRequest?) =
    inner.onReceivedClientCertRequest(view, request)

  override fun onReceivedHttpAuthRequest(view: WebView?, handler: HttpAuthHandler?, host: String?, realm: String?) =
    inner.onReceivedHttpAuthRequest(view, handler, host, realm)

  override fun shouldOverrideKeyEvent(view: WebView?, event: KeyEvent?): Boolean = inner.shouldOverrideKeyEvent(view, event)

  override fun onUnhandledKeyEvent(view: WebView?, event: KeyEvent?) = inner.onUnhandledKeyEvent(view, event)

  override fun onScaleChanged(view: WebView?, oldScale: Float, newScale: Float) = inner.onScaleChanged(view, oldScale, newScale)

  override fun onReceivedLoginRequest(view: WebView?, realm: String?, account: String?, args: String?) =
    inner.onReceivedLoginRequest(view, realm, account, args)

  override fun onSafeBrowsingHit(view: WebView?, request: WebResourceRequest?, threatType: Int, callback: SafeBrowsingResponse?) =
    inner.onSafeBrowsingHit(view, request, threatType, callback)

  override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean = onGone(view, detail)
}

/** The part with a screen: puts the client in front and acts on what RenderGone says. */
class RenderGuard(private val activity: Activity, private val visible: () -> Boolean) {
  private var restartOnReturn = false

  /** Safe to call again. Android 7 has neither the question nor a way to read the client. */
  fun watch(webView: WebView) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    try {
      val current = webView.webViewClient
      if (current is GuardedWebViewClient) return
      webView.webViewClient = GuardedWebViewClient(current) { _, detail -> gone(detail) }
    } catch (e: Exception) {
      Log.w(TAG, "render guard not installed", e)
    }
  }

  private fun gone(detail: RenderProcessGoneDetail?): Boolean {
    val crashed = try { detail?.didCrash() ?: false } catch (_: Exception) { false }
    val step = RenderGone.step(visible(), System.currentTimeMillis(), RenderGone.read(activity))
    Log.w(TAG, "renderer gone, crashed=$crashed, step=$step")
    // Before anything ends: the next start says why the app was gone.
    if (RenderGone.owesWord(step)) RenderGone.noteEnded(activity, System.currentTimeMillis())
    when (step) {
      RenderGone.Step.RESTART -> restart()
      RenderGone.Step.RESTART_ON_RETURN -> restartOnReturn = true
      RenderGone.Step.END -> {
        activity.finishAndRemoveTask()
        Process.killProcess(Process.myPid())
      }
    }
    // Handled: the system must not end the app on top of this.
    return true
  }

  /**
   * Once per start of the app: if the guard ended the app the last time, say
   * so. A dialog of the system, not of the page. A restart the guard made
   * itself says nothing: there the app came back by itself.
   */
  fun sayIfEnded() {
    val text = try { RenderGone.sayAtStart(RenderGone.takeEnded(activity)) } catch (_: Exception) { null } ?: return
    try {
      if (activity.isFinishing) return
      AlertDialog.Builder(activity).setMessage(text).setPositiveButton(RenderGone.ENDED_BUTTON, null).show()
      Log.i(TAG, "said that the guard ended the app")
    } catch (e: Exception) {
      Log.w(TAG, "could not say that the guard ended the app", e)
    }
  }

  /** The activity is on its way back to the screen. */
  fun returned() {
    if (!restartOnReturn) return
    restartOnReturn = false
    restart()
  }

  private fun restart() {
    RenderGone.note(activity, System.currentTimeMillis())
    activity.startActivity(Intent.makeRestartActivityTask(activity.componentName))
    Process.killProcess(Process.myPid())
  }

  companion object {
    private const val TAG = "LuNative"
  }
}
