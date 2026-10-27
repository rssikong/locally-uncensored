package com.purpledoubled.lunative

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.content.ClipData
import android.content.ComponentCallbacks2
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import android.provider.MediaStore
import android.provider.Settings
import android.util.Log
import android.view.HapticFeedbackConstants
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.roundToInt

// The Android half of the native layer. See src/lib.rs for the whole picture.
//
// Commands arrive on the main thread. Whatever reads or writes a file or
// talks to the Keystore goes to the worker thread, so the interface never
// waits for a disk.

@InvokeArg
class AttachArgs {
  lateinit var channel: Channel
}

@InvokeArg
class AccountArgs {
  lateinit var account: String
  var value: String? = null
}

@InvokeArg
class ShareArgs {
  var path: String? = null
  var text: String? = null
  var filename: String? = null
  var mime: String? = null
  var title: String? = null
  var kind: String? = null
}

@InvokeArg
class DeviceArgs {
  var path: String? = null
}

@InvokeArg
class BackArgs {
  var armed: Boolean = false
}

@InvokeArg
class KindArgs {
  var kind: String? = null
}

@InvokeArg
class NotifyArgs {
  /** Put the question of the system if it was never put. Without it only the state is read. */
  var ask: Boolean = true
}

@InvokeArg
class UrlArgs {
  lateinit var url: String
}

@InvokeArg
class BarsArgs {
  var light: Boolean = false
  var color: String? = null
  /** The theme the user chose in the app: `dark`, `light` or `system`. Kept for the next start. */
  var theme: String? = null
}

@InvokeArg
class IdArgs {
  lateinit var id: String
}

@InvokeArg
class StartArgs {
  lateinit var id: String
  lateinit var url: String
  lateinit var dest: String
  lateinit var partial: String
  var expectedBytes: Long? = null
  var expectedBytesExact: Boolean? = null
  var sha256: String? = null
  var headers: Map<String, String>? = null
  var title: String? = null
  var userAgent: String? = null
  var allowLocal: Boolean? = null
}

@InvokeArg
class TtsSpeakArgs {
  lateinit var id: String
  lateinit var text: String
  var voice: String? = null
  var lang: String? = null
  var rate: Float? = null
}

@InvokeArg
class ImportPickArgs {
  var dir: String? = null
}

@InvokeArg
class ImportTokenArgs {
  lateinit var token: String
}

@InvokeArg
class ImportCopyArgs {
  lateinit var token: String
  lateinit var id: String
  lateinit var partial: String
  var fileName: String? = null
  var totalBytes: Long? = null
}

@InvokeArg
class LimitArgs {
  var bytesPerSecond: Long? = null
}

@InvokeArg
class TranscodeArgs {
  lateinit var path: String
  lateinit var out: String
  var maxSide: Int? = null
  var quality: Int? = null
}

@InvokeArg
class TextArgs {
  lateinit var text: String
}

@InvokeArg
class LocalNotifyArgs {
  lateinit var id: String
  lateinit var title: String
  var body: String? = null
  var url: String? = null
}

@InvokeArg
class RemoteWatchArgs {
  var on: Boolean = false
  var text: String? = null
}

@InvokeArg
class WifiOnlyArgs {
  var wifiOnly: Boolean? = null
}

@InvokeArg
class AllowMeteredArgs {
  lateinit var id: String
  var allow: Boolean? = null
}

@TauriPlugin
class LuNativePlugin(private val activity: Activity) : Plugin(activity) {
  private val main = Handler(Looper.getMainLooper())
  private val worker = Executors.newSingleThreadExecutor()
  private val secrets = Secrets(activity)
  private val lock = Any()
  private var channel: Channel? = null
  /** Events that happened before Rust opened the channel. */
  private val backlog = ArrayList<Pair<String, JSObject>>()
  private var webView: WebView? = null
  private var appliedFontScale = 0f
  /** What the webview was told, in percent. The webview itself may only be asked on the main thread. */
  @Volatile private var appliedTextZoom = 100
  private var stopped = false
  private var lowMemorySeen = false
  /** The app comes back after Android ended the process that draws the page (RenderGuard.kt). */
  private val renderGuard = RenderGuard(activity) { !stopped }

  // ── back key ──────────────────────────────────────────────────────────
  //
  // Two callbacks are registered before this one: wry's (webView.goBack, or
  // leave) and Tauri's own. The dispatcher asks the newest enabled callback
  // first, so while this one is enabled the key belongs to JavaScript, and
  // while it is disabled everything is as if this plugin did not exist.
  private var backWaiting = false
  private val backWatchdog = Runnable {
    if (backWaiting) {
      // The page did not confirm that it got the event: it hangs or it is
      // gone. The key must never be dead, so the system gets it.
      backWaiting = false
      Log.w(TAG, "back: no answer from the page, system behaviour")
      leaveApp()
    }
  }
  private val backCallback = object : OnBackPressedCallback(false) {
    override fun handleOnBackPressed() {
      if (backWaiting) return
      backWaiting = true
      main.postDelayed(backWatchdog, BACK_ANSWER_MS)
      emit("back", JSObject())
    }
  }

  private val memoryCallbacks = object : ComponentCallbacks2 {
    override fun onTrimMemory(level: Int) {
      trimMemory(level, "system")
    }

    override fun onConfigurationChanged(newConfig: Configuration) {}

    @Deprecated("Deprecated in Java")
    override fun onLowMemory() {
      emitMemoryWarning("critical", "system", null)
    }
  }

  // Android 14 and newer no longer send the "running low" levels to an app
  // that is on screen. So while the app is visible the plugin asks: the
  // moment the system's own lowMemory flag turns on counts as a warning.
  private val memoryPoll = object : Runnable {
    override fun run() {
      if (stopped) return
      val info = memoryInfo()
      if (info.lowMemory && !lowMemorySeen) {
        emitMemoryWarning("low", "poll", null)
      }
      lowMemorySeen = info.lowMemory
      main.postDelayed(this, MEMORY_POLL_MS)
    }
  }

  init {
    (activity as? AppCompatActivity)?.onBackPressedDispatcher?.addCallback(activity, backCallback)
    activity.applicationContext.registerComponentCallbacks(memoryCallbacks)
    DownloadEngine.init(activity)
  }

  override fun load(webView: WebView) {
    this.webView = webView
    rememberFontScale(webView)
    // wry sets its client when it builds the WebView, before plugins are
    // told. Posted as well, and tried again on every return to the screen,
    // should that order ever change.
    renderGuard.watch(webView)
    main.post { renderGuard.watch(webView) }
    // The last time the guard closed the app for good: one sentence about it (F14).
    main.post { renderGuard.sayIfEnded() }
    // The link the app was started with. An activity that Android rebuilt
    // from the recents list carries its old intent again, that one is not a
    // new link.
    val intent = activity.intent
    if (intent != null && (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) {
      noteLink(intent, "launch-intent")
    }
    main.postDelayed(memoryPoll, MEMORY_POLL_MS)
  }

  // ── events ────────────────────────────────────────────────────────────

  private fun emit(event: String, payload: JSObject) {
    val target: Channel?
    synchronized(lock) {
      target = channel
      if (target == null) {
        if (backlog.size < 64) backlog.add(Pair(event, payload))
        return
      }
    }
    val message = JSObject()
    message.put("event", event)
    message.put("payload", payload)
    try {
      target!!.send(message)
    } catch (e: Throwable) {
      Log.w(TAG, "event $event was not delivered: ${e.javaClass.simpleName}")
    }
  }

  @Command
  fun attach(invoke: Invoke) {
    val args = invoke.parseArgs(AttachArgs::class.java)
    val waiting: List<Pair<String, JSObject>>
    synchronized(lock) {
      channel = args.channel
      waiting = ArrayList(backlog)
      backlog.clear()
    }
    for ((event, payload) in waiting) emit(event, payload)
    // From here on a finished download has somewhere to report to.
    DownloadEngine.listener = { event, payload -> emit(event, JSObject(payload.toString())) }
    worker.execute { DownloadEngine.reconcile(startService = true) }
    val ret = JSObject()
    ret.put("attached", true)
    invoke.resolve(ret)
  }

  // ── secure storage ────────────────────────────────────────────────────

  @Command
  fun secretGet(invoke: Invoke) {
    val args = invoke.parseArgs(AccountArgs::class.java)
    worker.execute {
      try {
        val ret = JSObject()
        ret.put("value", secrets.get(args.account) ?: JSONObject.NULL)
        invoke.resolve(ret)
      } catch (e: Exception) {
        invoke.reject(e.message ?: "The secure storage reported an error.")
      }
    }
  }

  @Command
  fun secretSet(invoke: Invoke) {
    val args = invoke.parseArgs(AccountArgs::class.java)
    worker.execute {
      try {
        secrets.set(args.account, args.value ?: "")
        invoke.resolve(ok())
      } catch (e: Exception) {
        invoke.reject(e.message ?: "The secure storage reported an error.")
      }
    }
  }

  @Command
  fun secretDelete(invoke: Invoke) {
    val args = invoke.parseArgs(AccountArgs::class.java)
    worker.execute {
      try {
        secrets.delete(args.account)
        invoke.resolve(ok())
      } catch (e: Exception) {
        invoke.reject(e.message ?: "The secure storage reported an error.")
      }
    }
  }

  private fun ok(): JSObject {
    val ret = JSObject()
    ret.put("ok", true)
    return ret
  }

  // ── sharing and saving ────────────────────────────────────────────────

  /**
   * A content address another app may read. The provider only serves the
   * plugin's temp folder, a file from elsewhere in the app is copied there
   * first.
   */
  private fun shareUri(file: File, name: String?): Uri {
    val authority = activity.packageName + ".lunative.files"
    val tempRoot = File(activity.cacheDir, "lu-native-tmp")
    val inside = file.canonicalPath.startsWith(tempRoot.canonicalPath + File.separator)
    if (inside && (name == null || name == file.name)) {
      return FileProvider.getUriForFile(activity, authority, file)
    }
    val folder = File(tempRoot, "share-" + UUID.randomUUID().toString().replace("-", ""))
    folder.mkdirs()
    val copy = File(folder, name ?: file.name)
    file.copyTo(copy, overwrite = true)
    return FileProvider.getUriForFile(activity, authority, copy)
  }

  @Command
  fun shareFile(invoke: Invoke) {
    val args = invoke.parseArgs(ShareArgs::class.java)
    worker.execute {
      try {
        val send = Intent(Intent.ACTION_SEND)
        val path = args.path
        if (path != null) {
          val file = File(path)
          if (!file.isFile) {
            invoke.reject("That file does not exist.")
            return@execute
          }
          val uri = shareUri(file, args.filename)
          send.type = args.mime ?: "application/octet-stream"
          send.putExtra(Intent.EXTRA_STREAM, uri)
          // The preview of the share sheet reads the file through ClipData.
          send.clipData = ClipData.newUri(activity.contentResolver, args.filename ?: file.name, uri)
          send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } else if (args.text != null) {
          send.type = "text/plain"
          send.putExtra(Intent.EXTRA_TEXT, args.text)
        } else {
          invoke.reject("There is nothing to share.")
          return@execute
        }
        if (!args.title.isNullOrEmpty()) send.putExtra(Intent.EXTRA_TITLE, args.title)
        val chooser = Intent.createChooser(send, args.title)
        main.post {
          try {
            activity.startActivity(chooser)
            val ret = JSObject()
            ret.put("presented", true)
            invoke.resolve(ret)
          } catch (e: Exception) {
            invoke.reject("The share sheet could not be shown.")
          }
        }
      } catch (e: Exception) {
        invoke.reject("The file could not be prepared for sharing.")
      }
    }
  }

  @Command
  fun saveToPhotos(invoke: Invoke) {
    val args = invoke.parseArgs(ShareArgs::class.java)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      // Below Android 10 the gallery can only be written with the storage
      // permission, which this app does not ask for.
      invoke.reject("Saving to the gallery needs Android 10 or newer. Use Share instead.", "failed")
      return
    }
    worker.execute {
      val file = File(args.path ?: "")
      if (!file.isFile) {
        invoke.reject("That file does not exist.", "failed")
        return@execute
      }
      val video = args.kind == "video"
      val resolver = activity.contentResolver
      val collection = if (video) {
        MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      } else {
        MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      }
      val values = ContentValues()
      values.put(MediaStore.MediaColumns.DISPLAY_NAME, args.filename ?: file.name)
      values.put(MediaStore.MediaColumns.MIME_TYPE, args.mime ?: if (video) "video/mp4" else "image/png")
      values.put(MediaStore.MediaColumns.RELATIVE_PATH, (if (video) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES) + "/LU")
      values.put(MediaStore.MediaColumns.IS_PENDING, 1)
      var uri: Uri? = null
      try {
        uri = resolver.insert(collection, values)
        if (uri == null) {
          invoke.reject("The gallery did not accept this file.", "failed")
          return@execute
        }
        val out = resolver.openOutputStream(uri)
        if (out == null) {
          resolver.delete(uri, null, null)
          invoke.reject("The gallery did not accept this file.", "failed")
          return@execute
        }
        out.use { o -> FileInputStream(file).use { it.copyTo(o, 256 * 1024) } }
        val done = ContentValues()
        done.put(MediaStore.MediaColumns.IS_PENDING, 0)
        resolver.update(uri, done, null, null)
        val ret = JSObject()
        ret.put("saved", true)
        ret.put("uri", uri.toString())
        invoke.resolve(ret)
      } catch (e: Exception) {
        if (uri != null) {
          try { resolver.delete(uri, null, null) } catch (_: Exception) {}
        }
        // Three fixed codes, see `photos` in src/commands.rs. The sentences are
        // worded so that a reader of the text alone lands on the same answer.
        when {
          ModelImport.isNoSpace(e) ->
            invoke.reject("There is not enough free space on this phone to save this. Free up space, then try again.", "no-space")
          e is SecurityException ->
            invoke.reject("LU is not allowed to add to the gallery of this phone.", "denied")
          else -> {
            // The class of the exception is for the log, never for the screen (acceptance Android, re-run, N10).
            Log.w(TAG, "save to gallery failed: ${e.javaClass.simpleName}")
            invoke.reject("The gallery did not accept this file. The format may not be supported.", "failed")
          }
        }
      }
    }
  }

  @Command
  fun saveToFiles(invoke: Invoke) {
    val args = invoke.parseArgs(ShareArgs::class.java)
    val file = File(args.path ?: "")
    if (!file.isFile) {
      invoke.reject("That file does not exist.")
      return
    }
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
    intent.addCategory(Intent.CATEGORY_OPENABLE)
    intent.type = args.mime ?: "application/octet-stream"
    intent.putExtra(Intent.EXTRA_TITLE, args.filename ?: file.name)
    try {
      startActivityForResult(invoke, intent, "saveToFilesResult")
    } catch (e: Exception) {
      invoke.reject("The save dialog could not be shown.")
    }
  }

  @ActivityCallback
  fun saveToFilesResult(invoke: Invoke, result: ActivityResult) {
    val target = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || target == null) {
      val ret = JSObject()
      ret.put("saved", false)
      invoke.resolve(ret)
      return
    }
    val args = invoke.parseArgs(ShareArgs::class.java)
    worker.execute {
      try {
        val out = activity.contentResolver.openOutputStream(target, "wt")
        if (out == null) {
          invoke.reject("The chosen place could not be written.")
          return@execute
        }
        out.use { o -> FileInputStream(File(args.path ?: "")).use { it.copyTo(o, 256 * 1024) } }
        val ret = JSObject()
        ret.put("saved", true)
        ret.put("uri", target.toString())
        invoke.resolve(ret)
      } catch (e: Exception) {
        // An empty document would be left behind under the name the user chose.
        try { android.provider.DocumentsContract.deleteDocument(activity.contentResolver, target) } catch (_: Exception) {}
        invoke.reject("The file could not be written to the chosen place.")
      }
    }
  }

  // ── device ────────────────────────────────────────────────────────────

  private fun memoryInfo(): ActivityManager.MemoryInfo {
    val manager = activity.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val info = ActivityManager.MemoryInfo()
    manager.getMemoryInfo(info)
    return info
  }

  private fun isEmulator(): Boolean {
    return Build.FINGERPRINT.startsWith("generic") || Build.FINGERPRINT.contains("emulator") ||
      Build.HARDWARE == "ranchu" || Build.HARDWARE == "goldfish" ||
      Build.PRODUCT.startsWith("sdk_") || Build.MODEL.contains("Emulator") || Build.MODEL.startsWith("sdk_gphone")
  }

  @Command
  fun deviceInfo(invoke: Invoke) {
    val args = invoke.parseArgs(DeviceArgs::class.java)
    worker.execute {
      val info = memoryInfo()
      var probe: File? = File(args.path ?: activity.filesDir.path)
      while (probe != null && !probe.exists()) probe = probe.parentFile
      var free = 0L
      var total = 0L
      try {
        val stat = StatFs((probe ?: activity.filesDir).path)
        free = stat.availableBytes
        total = stat.totalBytes
      } catch (_: Exception) {}
      val manager = activity.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val ret = JSObject()
      ret.put("platform", "android")
      ret.put("model", Build.MODEL)
      ret.put("manufacturer", Build.MANUFACTURER)
      ret.put("device", Build.DEVICE)
      ret.put("systemVersion", Build.VERSION.RELEASE)
      ret.put("sdkInt", Build.VERSION.SDK_INT)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        ret.put("socModel", Build.SOC_MODEL)
        ret.put("socManufacturer", Build.SOC_MANUFACTURER)
      }
      ret.put("isEmulator", isEmulator())
      ret.put("totalMemoryBytes", info.totalMem)
      ret.put("availableMemoryBytes", info.availMem)
      ret.put("lowMemory", info.lowMemory)
      ret.put("lowMemoryThresholdBytes", info.threshold)
      ret.put("memoryClassMb", manager.memoryClass)
      ret.put("largeMemoryClassMb", manager.largeMemoryClass)
      ret.put("diskFreeBytes", free)
      ret.put("diskTotalBytes", total)
      ret.put("fontScale", activity.resources.configuration.fontScale.toDouble())
      ret.put("textZoom", appliedTextZoom)
      invoke.resolve(ret)
    }
  }

  private fun emitMemoryWarning(level: String, source: String, trimLevel: Int?) {
    val info = memoryInfo()
    val payload = JSObject()
    payload.put("source", source)
    payload.put("level", level)
    payload.put("availableMemoryBytes", info.availMem)
    payload.put("lowMemory", info.lowMemory)
    if (trimLevel != null) payload.put("trimLevel", trimLevel)
    emit("memory-warning", payload)
  }

  /**
   * From "running low" upwards. Not the two levels that only say the
   * interface is hidden or the app moved to the background list: those are
   * no shortage.
   */
  private fun trimMemory(level: Int, source: String) {
    @Suppress("DEPRECATION")
    when (level) {
      ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW, ComponentCallbacks2.TRIM_MEMORY_MODERATE ->
        emitMemoryWarning("low", source, level)
      ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL, ComponentCallbacks2.TRIM_MEMORY_COMPLETE ->
        emitMemoryWarning("critical", source, level)
      else -> {}
    }
  }

  /** Acceptance builds only, Rust refuses the call otherwise. Goes through the same code as the system's call. */
  @Command
  fun simulateMemoryWarning(invoke: Invoke) {
    @Suppress("DEPRECATION")
    trimMemory(ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL, "simulated")
    val ret = JSObject()
    ret.put("triggered", true)
    ret.put("source", "simulated")
    invoke.resolve(ret)
  }

  // ── text size ─────────────────────────────────────────────────────────
  //
  // A WebView takes the system's font size setting once, when it is
  // created, and never again: an app that is already running keeps the old
  // size until it is restarted (measured: 16 px, 20.8 px and 32 px root size
  // at 1.0, 1.3 and 2.0 after a restart, no change without one). So nothing
  // is set at the start, where a zoom would count twice. Only a change while
  // the app lives is carried over, relative to what the WebView started
  // with: textZoom is its lever for that, in percent.

  /** What the WebView was created under: the system font scale and its own zoom. */
  private var baseFontScale = 1f
  private var baseTextZoom = 100

  private fun rememberFontScale(webView: WebView) {
    val scale = activity.resources.configuration.fontScale
    baseFontScale = if (scale > 0f) scale else 1f
    baseTextZoom = try { webView.settings.textZoom } catch (_: Exception) { 100 }
    appliedFontScale = baseFontScale
    appliedTextZoom = baseTextZoom
  }

  private fun applyFontScale(config: Configuration) {
    val scale = config.fontScale
    if (scale <= 0f || scale == appliedFontScale) return
    appliedFontScale = scale
    val zoom = (baseTextZoom * scale / baseFontScale).roundToInt()
    appliedTextZoom = zoom
    main.post {
      try { webView?.settings?.textZoom = zoom } catch (e: Exception) { Log.w(TAG, "textZoom not applied", e) }
      val payload = JSObject()
      payload.put("fontScale", scale.toDouble())
      payload.put("textZoom", zoom)
      emit("font-scale-changed", payload)
    }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    applyFontScale(newConfig)
  }

  // ── lifecycle ─────────────────────────────────────────────────────────

  override fun onStop() {
    stopped = true
    main.removeCallbacks(memoryPoll)
    val payload = JSObject()
    payload.put("reason", "background")
    emit("app-background", payload)
  }

  override fun onRestart() {
    val payload = JSObject()
    payload.put("reason", "foreground")
    emit("app-foreground", payload)
  }

  override fun onResume() {
    if (stopped) {
      stopped = false
      main.postDelayed(memoryPoll, MEMORY_POLL_MS)
    }
    webView?.let { renderGuard.watch(it) }
    renderGuard.returned()
    // A font size changed while another app was in front arrives here at
    // the latest, should the configuration callback have been skipped.
    applyFontScale(activity.resources.configuration)
  }

  override fun onDestroy() {
    if (activity.isFinishing) {
      emit("app-will-terminate", JSObject())
    }
    main.removeCallbacks(memoryPoll)
    main.removeCallbacks(backWatchdog)
    try { activity.applicationContext.unregisterComponentCallbacks(memoryCallbacks) } catch (_: Exception) {}
    DownloadEngine.listener = null
  }

  /** Android does not suspend an app the way iOS does, there is nothing to ask for. */
  @Command
  fun beginBackgroundTask(invoke: Invoke) {
    val ret = JSObject()
    ret.put("id", 0)
    ret.put("remainingSeconds", -1)
    invoke.resolve(ret)
  }

  @Command
  fun endBackgroundTask(invoke: Invoke) {
    invoke.resolve(ok())
  }

  @Command
  fun backArm(invoke: Invoke) {
    val args = invoke.parseArgs(BackArgs::class.java)
    main.post {
      backCallback.isEnabled = args.armed
      if (!args.armed) {
        backWaiting = false
        main.removeCallbacks(backWatchdog)
      }
      invoke.resolve(ok())
    }
  }

  @Command
  fun backAck(invoke: Invoke) {
    main.post {
      backWaiting = false
      main.removeCallbacks(backWatchdog)
      invoke.resolve(ok())
    }
  }

  /**
   * What the back key does on the first screen of an app since Android 12:
   * the task goes to the background, the activity is not destroyed. A
   * destroyed activity would take the webview and everything in it along.
   */
  // Leaving the app on the back key of its first screen: the task goes to
  // the back, which is what Android itself does for a start activity since
  // Android 12. Not activity.finish(): Tauri ends the process about 1.5 s
  // after a finish, and a start of the app inside that time lands in the
  // dying process and never shows a screen (measured, 6 of 6 starts within
  // 0.8 s; mobile-docs/NATIVE-SCHICHT.md). A running download would lose
  // its process on top of that.
  private fun leaveApp() {
    if (!activity.moveTaskToBack(true)) {
      activity.finish()
    }
  }

  @Command
  fun backExit(invoke: Invoke) {
    main.post {
      backWaiting = false
      main.removeCallbacks(backWatchdog)
      invoke.resolve(ok())
      leaveApp()
    }
  }

  // ── small services for the shell ──────────────────────────────────────

  /** One tick. Needs no permission: it is the view's own feedback, and it respects the system setting. */
  @Command
  fun haptic(invoke: Invoke) {
    val args = invoke.parseArgs(KindArgs::class.java)
    main.post {
      val constant = when (args.kind) {
        "success" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
        "warning" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
        else -> HapticFeedbackConstants.CONTEXT_CLICK
      }
      val view = webView ?: activity.window.decorView
      val performed = try { view.performHapticFeedback(constant) } catch (_: Exception) { false }
      val ret = JSObject()
      ret.put("performed", performed)
      invoke.resolve(ret)
    }
  }

  /** Rust has checked the link already. The scheme is looked at again here, because this is where it leaves the app. */
  @Command
  fun openExternal(invoke: Invoke) {
    val args = invoke.parseArgs(UrlArgs::class.java)
    val uri = Uri.parse(args.url)
    val intent = when (uri.scheme?.lowercase()) {
      "http", "https" -> Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
      "mailto" -> Intent(Intent.ACTION_SENDTO, uri)
      "tel" -> Intent(Intent.ACTION_DIAL, uri)
      else -> null
    }
    if (intent == null) {
      invoke.reject("Only web links, mail addresses and phone numbers can be opened from here.")
      return
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    main.post {
      try {
        activity.startActivity(intent)
        invoke.resolve(ok())
      } catch (e: Exception) {
        invoke.reject("No app on this phone can open this link.")
      }
    }
  }

  // ── QR code (round 57) ────────────────────────────────────────────────

  /** One fixed name: a scan started before the app was stopped leaves no second file behind. */
  private fun scanPhotoFile(): File = File(File(activity.cacheDir, "lu-native-tmp"), "scan-qr.jpg")

  /**
   * "Scan QR code instead" on Android: the camera app of the system takes one
   * photo, this layer reads the code in it. The app declares no camera
   * permission and needs no Google services for it (NATIVE-SCHICHT.md). Answers
   * `{ text }`, an empty text when the user came back without a photo, and
   * rejects with code `no-code` when the photo holds no QR code.
   */
  @Command
  fun scanQr(invoke: Invoke) {
    val file = scanPhotoFile()
    try {
      file.parentFile?.mkdirs()
      file.delete()
      val uri = FileProvider.getUriForFile(activity, activity.packageName + ".lunative.files", file)
      val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
      intent.putExtra(MediaStore.EXTRA_OUTPUT, uri)
      intent.clipData = ClipData.newRawUri("", uri)
      intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
      startActivityForResult(invoke, intent, "scanQrResult")
    } catch (e: android.content.ActivityNotFoundException) {
      invoke.reject("This phone has no camera app to take the picture.", "no-camera")
    } catch (e: Exception) {
      Log.w(TAG, "scan start failed: ${e.javaClass.simpleName}")
      invoke.reject("The camera could not be opened.", "failed")
    }
  }

  @ActivityCallback
  fun scanQrResult(invoke: Invoke, result: ActivityResult) {
    val file = scanPhotoFile()
    if (result.resultCode != Activity.RESULT_OK || !file.isFile || file.length() == 0L) {
      file.delete()
      val ret = JSObject()
      ret.put("text", "")
      invoke.resolve(ret)
      return
    }
    worker.execute {
      val text = try {
        readQrPhoto(file)
      } catch (e: Throwable) {
        Log.w(TAG, "scan read failed: ${e.javaClass.simpleName}")
        null
      } finally {
        file.delete()
      }
      if (text.isNullOrEmpty()) {
        invoke.reject("No QR code was found in the photo.", "no-code")
      } else {
        val ret = JSObject()
        ret.put("text", text)
        invoke.resolve(ret)
      }
    }
  }

  /**
   * A photo of a screen reads best at a few sizes: large for a small code,
   * smaller where the pixels of the screen show up as a pattern.
   */
  private fun readQrPhoto(file: File): String? {
    val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
    android.graphics.BitmapFactory.decodeFile(file.path, bounds)
    val longest = maxOf(bounds.outWidth, bounds.outHeight)
    if (longest <= 0) return null
    for (target in intArrayOf(1600, 1000, 640)) {
      var sample = 1
      while (longest / (sample * 2) >= target) sample *= 2
      val options = android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }
      val decoded = android.graphics.BitmapFactory.decodeFile(file.path, options) ?: continue
      val bitmap = if (maxOf(decoded.width, decoded.height) > target) {
        val scale = target.toFloat() / maxOf(decoded.width, decoded.height)
        android.graphics.Bitmap.createScaledBitmap(decoded, (decoded.width * scale).roundToInt(), (decoded.height * scale).roundToInt(), true)
          .also { if (it !== decoded) decoded.recycle() }
      } else decoded
      val pixels = IntArray(bitmap.width * bitmap.height)
      bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
      val text = QrRead.decode(pixels, bitmap.width, bitmap.height)
      bitmap.recycle()
      if (text != null) return text
    }
    return null
  }

  /** The page of this app in the system settings, where the permissions are. */
  @Command
  fun openSystemSettings(invoke: Invoke) {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", activity.packageName, null))
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    main.post {
      try {
        activity.startActivity(intent)
        invoke.resolve(ok())
      } catch (e: Exception) {
        invoke.reject("The system settings could not be opened.")
      }
    }
  }

  /**
   * The two system bars follow the page. The activity draws edge to edge and
   * pads the WebView, so what shows behind the bars is the window itself:
   * it takes the colour of the page, and the symbols in the bars turn dark
   * on a light page.
   *
   * `theme` is the choice of the user in the app. It is kept (StartTheme) so
   * that the next start can colour the window before the page runs. The
   * empty WebView takes the colour too: it is what shows while a page loads.
   */
  @Command
  fun setSystemBars(invoke: Invoke) {
    val args = invoke.parseArgs(BarsArgs::class.java)
    args.theme?.let { StartTheme.store(activity, it) }
    main.post {
      try {
        val window = activity.window
        args.color?.let {
          val color = Color.parseColor(it)
          window.decorView.setBackgroundColor(color)
          webView?.setBackgroundColor(color)
          // Ignored from Android 15 on, where the bars are always see-through.
          @Suppress("DEPRECATION")
          window.statusBarColor = color
          @Suppress("DEPRECATION")
          window.navigationBarColor = color
        }
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = args.light
        controller.isAppearanceLightNavigationBars = args.light
        invoke.resolve(ok())
      } catch (e: Exception) {
        invoke.reject("The system bars could not be changed.")
      }
    }
  }

  // ── deep link ─────────────────────────────────────────────────────────

  private fun noteLink(intent: Intent, source: String) {
    val action = intent.action
    if (action != Intent.ACTION_VIEW && action != "org.chromium.arc.intent.action.VIEW") return
    val data = intent.data ?: return
    if (!"lu".equals(data.scheme, ignoreCase = true)) return
    // Not kept here. If Rust is not listening yet the event waits in the
    // backlog, and Rust is where the link is remembered until a page asks.
    val payload = JSObject()
    payload.put("url", data.toString())
    payload.put("source", source)
    emit("deep-link", payload)
  }

  override fun onNewIntent(intent: Intent) {
    noteLink(intent, "new-intent")
  }

  // ── background downloads ──────────────────────────────────────────────

  private fun answer(invoke: Invoke, problem: String?) {
    if (problem != null) invoke.reject(problem) else invoke.resolve(ok())
  }

  @Command
  fun bgStart(invoke: Invoke) {
    val args = invoke.parseArgs(StartArgs::class.java)
    worker.execute {
      args.userAgent?.let { DownloadEngine.userAgent = it }
      answer(
        invoke,
        DownloadEngine.start(
          args.id, args.url, args.dest, args.partial, args.expectedBytes ?: 0, args.expectedBytesExact ?: false,
          args.sha256, args.headers ?: emptyMap(), args.title, args.allowLocal ?: false,
        )
      )
    }
  }

  @Command
  fun bgPause(invoke: Invoke) {
    val id = invoke.parseArgs(IdArgs::class.java).id
    worker.execute { answer(invoke, DownloadEngine.pause(id)) }
  }

  @Command
  fun bgResume(invoke: Invoke) {
    val id = invoke.parseArgs(IdArgs::class.java).id
    worker.execute { answer(invoke, DownloadEngine.resume(id)) }
  }

  @Command
  fun bgCancel(invoke: Invoke) {
    val id = invoke.parseArgs(IdArgs::class.java).id
    worker.execute { answer(invoke, DownloadEngine.cancel(id)) }
  }

  @Command
  fun bgForget(invoke: Invoke) {
    val id = invoke.parseArgs(IdArgs::class.java).id
    worker.execute {
      DownloadEngine.forget(id)
      invoke.resolve(ok())
    }
  }

  /** The switch "Download on Wi-Fi only". The engine keeps it, so it holds without the page. */
  @Command
  fun bgNetworkRule(invoke: Invoke) {
    val on = invoke.parseArgs(WifiOnlyArgs::class.java).wifiOnly ?: false
    worker.execute {
      DownloadEngine.setWifiOnly(on)
      invoke.resolve(ok())
    }
  }

  /** "Download anyway" for one download, or taking that back. */
  @Command
  fun bgAllowMetered(invoke: Invoke) {
    val args = invoke.parseArgs(AllowMeteredArgs::class.java)
    worker.execute {
      DownloadEngine.allowMetered(args.id, args.allow ?: true)
      invoke.resolve(ok())
    }
  }

  /** Which kind of network the phone is on. */
  @Command
  fun connectionInfo(invoke: Invoke) {
    worker.execute {
      val info = DownloadEngine.connectionInfo()
      val ret = JSObject()
      ret.put("kind", info.optString("kind", "other"))
      ret.put("metered", info.optBoolean("metered", false))
      ret.put("wifiOnly", info.optBoolean("wifiOnly", false))
      invoke.resolve(ret)
    }
  }

  @Command
  fun bgList(invoke: Invoke) {
    worker.execute {
      val ret = JSObject()
      ret.put("downloads", DownloadEngine.list())
      invoke.resolve(ret)
    }
  }

  // ── reading aloud (Tts.kt) ────────────────────────────────────────────

  private fun ttsEvents() {
    if (Tts.listener == null) Tts.listener = { event, payload -> emit(event, JSObject(payload.toString())) }
  }

  @Command
  fun ttsVoices(invoke: Invoke) {
    ttsEvents()
    Tts.voices(activity) { answer -> invoke.resolve(JSObject(answer.toString())) }
  }

  @Command
  fun ttsSpeak(invoke: Invoke) {
    val args = invoke.parseArgs(TtsSpeakArgs::class.java)
    ttsEvents()
    Tts.speak(activity, args.id, args.text, args.voice, args.lang, args.rate ?: 1.0f) { problem ->
      answer(invoke, problem)
    }
  }

  @Command
  fun ttsStop(invoke: Invoke) {
    Tts.stop()
    invoke.resolve(ok())
  }

  // ── a model file of the user's own (ModelImport.kt) ───────────────────

  /** Open the system's document picker. Answers what Rust needs to judge the file. */
  @Command
  fun importPick(invoke: Invoke) {
    // The first step of every import: a Cancel from before does not concern
    // it, and one that arrives from here on holds until the copy reads it.
    ModelImport.begin()
    // No type filter: there is no registered type for GGUF, and a filter by
    // "octet-stream" hides the file in providers that guess another type.
    // What the file is gets decided by its first bytes.
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
    intent.addCategory(Intent.CATEGORY_OPENABLE)
    intent.type = "*/*"
    try {
      startActivityForResult(invoke, intent, "importPickResult")
    } catch (e: Exception) {
      invoke.reject("The file picker could not be shown.")
    }
  }

  @ActivityCallback
  fun importPickResult(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      val ret = JSObject()
      ret.put("cancelled", true)
      invoke.resolve(ret)
      return
    }
    val dir = invoke.parseArgs(ImportPickArgs::class.java).dir
    worker.execute {
      invoke.resolve(JSObject(ModelImport.describe(activity, uri, dir).toString()))
    }
  }

  @Command
  fun importRelease(invoke: Invoke) {
    ModelImport.release(invoke.parseArgs(ImportTokenArgs::class.java).token)
    invoke.resolve(ok())
  }

  @Command
  fun importCopy(invoke: Invoke) {
    val args = invoke.parseArgs(ImportCopyArgs::class.java)
    // Its own thread: a model takes a minute, and the one worker thread has
    // to stay free for everything else, the cancel of this copy included.
    Thread({
      val total = args.totalBytes ?: 0L
      val (status, bytes) = ModelImport.copy(activity, args.token, args.partial) { received ->
        val payload = JSObject()
        payload.put("id", args.id)
        payload.put("fileName", args.fileName ?: "")
        payload.put("receivedBytes", received)
        payload.put("totalBytes", total)
        emit("model-import-progress", payload)
      }
      val ret = JSObject()
      ret.put("status", status)
      ret.put("bytes", bytes)
      invoke.resolve(ret)
    }, "lu-model-import").start()
  }

  @Command
  fun importCancel(invoke: Invoke) {
    ModelImport.cancel = true
    invoke.resolve(ok())
  }

  // ── the speed limit of the downloads ──────────────────────────────────

  /** Set (`bytesPerSecond`, 0 for none) or ask (nothing) the limit. Answers the one that holds. */
  @Command
  fun bgLimit(invoke: Invoke) {
    val wanted = invoke.parseArgs(LimitArgs::class.java).bytesPerSecond
    worker.execute {
      if (wanted != null) DownloadEngine.setLimit(wanted)
      val ret = JSObject()
      ret.put("bytesPerSecond", DownloadEngine.limit())
      invoke.resolve(ret)
    }
  }

  // ── photos the WebView cannot decode ──────────────────────────────────

  /**
   * Decode a photo with the decoder of the system and write it as JPEG. The
   * WebView cannot read HEIC, `ImageDecoder` can (Android 9 and newer). It
   * applies the rotation note of the camera, so the picture comes out
   * upright. Answers `{ width, height }`.
   */
  @Command
  fun transcodeImage(invoke: Invoke) {
    val args = invoke.parseArgs(TranscodeArgs::class.java)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
      invoke.reject("Converting this photo needs Android 9 or newer.")
      return
    }
    worker.execute {
      try {
        val maxSide = (args.maxSide ?: 4096).coerceIn(64, 8192)
        val source = android.graphics.ImageDecoder.createSource(File(args.path))
        val bitmap = android.graphics.ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
          // Software memory: a hardware bitmap cannot be compressed on every device.
          decoder.allocator = android.graphics.ImageDecoder.ALLOCATOR_SOFTWARE
          val long = maxOf(info.size.width, info.size.height)
          if (long > maxSide) {
            val k = maxSide.toDouble() / long
            decoder.setTargetSize(maxOf(1, (info.size.width * k).roundToInt()), maxOf(1, (info.size.height * k).roundToInt()))
          }
        }
        try {
          java.io.FileOutputStream(File(args.out)).use { out ->
            if (!bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, (args.quality ?: 92).coerceIn(40, 100), out)) {
              throw java.io.IOException("compress")
            }
          }
          val ret = JSObject()
          ret.put("width", bitmap.width)
          ret.put("height", bitmap.height)
          invoke.resolve(ret)
        } finally {
          bitmap.recycle()
        }
      } catch (e: OutOfMemoryError) {
        File(args.out).delete()
        invoke.reject("This photo is too large for the memory of this phone.")
      } catch (e: Exception) {
        File(args.out).delete()
        Log.w(TAG, "transcode: ${e.javaClass.simpleName} ${e.message}")
        invoke.reject("This phone could not read that photo.")
      }
    }
  }

  // ── clipboard ─────────────────────────────────────────────────────────
  //
  // The WebView refuses navigator.clipboard.readText (NotAllowedError), so
  // "Paste" asks the system here. Android lets an app read the clipboard
  // while it has the focus, which it has when the user taps a button in it.
  // The clipboard manager wants the main thread.

  @Command
  fun clipboardReadText(invoke: Invoke) {
    main.post {
      val ret = JSObject()
      try {
        val manager = activity.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        val clip = manager.primaryClip
        var text: String? = null
        if (clip != null && clip.itemCount > 0) {
          text = clip.getItemAt(0).coerceToText(activity)?.toString()
        }
        ret.put("text", if (text.isNullOrEmpty()) JSONObject.NULL else text)
        invoke.resolve(ret)
      } catch (e: Exception) {
        Log.w(TAG, "clipboard read: ${e.javaClass.simpleName}")
        invoke.reject("The clipboard could not be read.")
      }
    }
  }

  @Command
  fun clipboardWriteText(invoke: Invoke) {
    val text = invoke.parseArgs(TextArgs::class.java).text
    main.post {
      try {
        val manager = activity.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        manager.setPrimaryClip(ClipData.newPlainText("LU", text))
        invoke.resolve(ok())
      } catch (e: Exception) {
        // TransactionTooLargeException and its relatives: the text did not fit.
        Log.w(TAG, "clipboard write: ${e.javaClass.simpleName}")
        invoke.reject("The text could not be copied.")
      }
    }
  }

  // ── notifications ─────────────────────────────────────────────────────

  /** Does the system show notifications of this app right now: the permission (Android 13) and the switch of the app. */
  private fun notificationsGranted(): Boolean {
    val permitted = Build.VERSION.SDK_INT < 33 ||
      ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    val enabled = try { NotificationManagerCompat.from(activity).areNotificationsEnabled() } catch (_: Exception) { true }
    return permitted && enabled
  }

  /**
   * The state of the notifications, and with `ask` the question of the system.
   *
   * The download notification needs a yes on Android 13 and newer. The
   * question is put once (NotifyRule): a no stands, and from then on only the
   * settings of the system change it. The download runs either way.
   * Answers `{ granted, needed, asked }`.
   */
  @Command
  fun requestNotificationPermission(invoke: Invoke) {
    val args = try { invoke.parseArgs(NotifyArgs::class.java) } catch (_: Exception) { NotifyArgs() }
    val step = NotifyRule.step(Build.VERSION.SDK_INT, notificationsGranted(), NotifyRule.askedBefore(activity), args.ask)
    if (step != NotifyRule.Step.ASK) {
      notificationPermissionResult(invoke)
      return
    }
    // Written before the question: an app that is ended behind the dialog has still asked.
    NotifyRule.noteAsked(activity)
    try {
      handle!!.requestPermissions(invoke, arrayOf(Manifest.permission.POST_NOTIFICATIONS), "notificationPermissionResult")
    } catch (e: Exception) {
      notificationPermissionResult(invoke)
    }
  }

  // ── notices of the computer (A17) ─────────────────────────────────────

  /** "Answer ready", "Render ready", "Approval needed". `{ shown }`: false without the permission. */
  @Command
  fun localNotify(invoke: Invoke) {
    val args = invoke.parseArgs(LocalNotifyArgs::class.java)
    val ret = JSObject()
    ret.put("shown", RemoteNotes.post(activity, args.id, args.title, args.body ?: "", args.url))
    invoke.resolve(ret)
  }

  /** Keep the app alive while the phone waits for the computer (`on`), or let it go. */
  @Command
  fun remoteWatch(invoke: Invoke) {
    val args = invoke.parseArgs(RemoteWatchArgs::class.java)
    val ok = if (args.on) RemoteWatchService.start(activity, args.text ?: "") else RemoteWatchService.stop(activity)
    val ret = JSObject()
    ret.put("ok", ok)
    invoke.resolve(ret)
  }

  /** The question for notices of the computer: on Android the same as for downloads. */
  @Command
  fun remoteNotifyPermission(invoke: Invoke) {
    requestNotificationPermission(invoke)
  }

  @PermissionCallback
  fun notificationPermissionResult(invoke: Invoke) {
    val ret = JSObject()
    val granted = notificationsGranted()
    ret.put("granted", granted)
    ret.put("needed", NotifyRule.needed(Build.VERSION.SDK_INT))
    ret.put("asked", NotifyRule.askedBefore(activity))
    // A download that is running shows its notification from the yes on, not from its next step.
    if (granted) try { DownloadService.refresh(activity) } catch (_: Exception) {}
    invoke.resolve(ret)
  }

  companion object {
    private const val TAG = "LuNative"
    private const val BACK_ANSWER_MS = 1500L
    private const val MEMORY_POLL_MS = 5000L
  }
}
