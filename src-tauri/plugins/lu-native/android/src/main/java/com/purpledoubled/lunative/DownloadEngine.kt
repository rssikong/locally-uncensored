package com.purpledoubled.lunative

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.StatFs
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

// Background downloads on Android: the list, the transfers, the check at the
// end. Plain Kotlin on purpose. When Android restarts the download service
// after the app's process was ended, no activity exists, no webview and no
// Rust library is loaded, and the download still has to finish, be checked
// and be moved into place.
//
// The states and the transitions are the table in src/download.rs
// (`next_state`). `step` below is that table, line for line.
//
// One file is the memory: <no-backup files>/lu-native/bg-downloads.json. It
// is rewritten through a temp file and a rename, so a process that dies in
// the middle leaves the old list, not half a list.

internal class Record(
  val id: String,
  var url: String,
  var dest: String,
  var partial: String,
) {
  var state: String = QUEUED
  var receivedBytes: Long = 0
  var totalBytes: Long = 0
  var expectedBytes: Long = 0
  var expectedBytesExact: Boolean = false
  var sha256: String? = null
  var headers: Map<String, String> = emptyMap()
  var title: String? = null
  var error: String? = null
  var errorCode: String? = null
  var createdAt: Long = 0
  var updatedAt: Long = 0
  /** The validator the server gave for the bytes in the partial file. */
  var validator: String? = null
  /**
   * The rule of an acceptance build: test servers on private addresses may be
   * reached. Set by Rust from the build, kept with the line because the
   * service continues a download without Rust.
   */
  var allowLocal: Boolean = false
  // Not persisted.
  var bytesPerSecond: Double = 0.0

  val isLive: Boolean get() = state == QUEUED || state == RUNNING || state == WAITING || state == VERIFYING
  val resumable: Boolean get() = (state == PAUSED || state == ERROR) && errorCode != "checksum"

  companion object {
    const val QUEUED = "queued"
    const val RUNNING = "running"
    const val WAITING = "waiting"
    const val PAUSED = "paused"
    const val VERIFYING = "verifying"
    const val DONE = "done"
    const val ERROR = "error"
    const val CANCELLED = "cancelled"
  }
}

internal enum class Fact {
  Progress, NetworkLost, NetworkBack, TransferComplete, Verified, VerifyFailed, Failed,
  UserPaused, UserResumed, UserCancelled
}

internal object DownloadEngine {
  private const val TAG = "LuNativeDownload"
  private const val HEADER_SECRET = "bg-download-headers:"
  /** Without a byte for this long a waiting download gives up. Resume continues it. */
  private const val GIVE_UP_AFTER_MS = 10 * 60 * 1000L
  private const val MAX_PARALLEL = 2

  private val lock = Any()
  private val records = LinkedHashMap<String, Record>()
  private val workers = HashMap<String, Worker>()
  private var loaded = false
  private lateinit var app: Context
  private lateinit var secrets: Secrets
  private val lastEmit = HashMap<String, Long>()
  private var lastSave = 0L
  private val networkSignal = Object()
  private var networkGeneration = 0
  private var networkCallback: ConnectivityManager.NetworkCallback? = null
  /**
   * "Download on Wi-Fi only" (Settings). Kept in the list file, because the
   * service continues a download without the page and without Rust: the rule
   * has to hold at every start, every continue and after a restart.
   */
  private var wifiOnly = false
  /** Downloads the user allowed on mobile data by name ("Download anyway"). */
  private val meteredOk = HashSet<String>()
  /**
   * The speed limit of Settings in bytes per second, 0 for none. Kept in the
   * list file like the Wi-Fi rule, for the same reason: the service
   * continues a download without the page. All transfers share it: two
   * downloads under 5 MB/s get 5 MB/s together.
   */
  @Volatile private var limitBps = 0L
  private val throttleLock = Any()
  /** When the shared line is free again, in microseconds of `SystemClock.elapsedRealtimeNanos` (Throttle.kt). */
  private var throttleSlotEnd = 0L

  /** Set by the plugin while an activity exists. Events go nowhere otherwise, the list keeps the result. */
  @Volatile var listener: ((String, JSONObject) -> Unit)? = null
  /** Set by the service: called whenever the set of running transfers or their progress changed. */
  @Volatile var serviceHook: (() -> Unit)? = null
  @Volatile var userAgent: String = "LU-Mobile (Android)"

  fun init(context: Context) {
    synchronized(lock) {
      if (loaded) return
      app = context.applicationContext
      secrets = Secrets(app)
      load()
      loaded = true
    }
  }

  // ── the table of src/download.rs ────────────────────────────────────

  fun step(state: String, fact: Fact): String {
    if (state == Record.DONE || state == Record.CANCELLED) return state
    if (fact == Fact.UserCancelled) return Record.CANCELLED
    if (state == Record.PAUSED || state == Record.ERROR) {
      return if (fact == Fact.UserResumed) Record.QUEUED else state
    }
    val moving = state == Record.QUEUED || state == Record.RUNNING || state == Record.WAITING
    if (moving) {
      when (fact) {
        Fact.UserPaused -> return Record.PAUSED
        Fact.Progress -> return Record.RUNNING
        Fact.NetworkLost -> return if (state == Record.WAITING) state else Record.WAITING
        Fact.NetworkBack -> return if (state == Record.WAITING) Record.QUEUED else state
        Fact.TransferComplete -> return Record.VERIFYING
        Fact.Failed -> return Record.ERROR
        else -> return state
      }
    }
    if (state == Record.VERIFYING) {
      return when (fact) {
        Fact.Verified -> Record.DONE
        Fact.VerifyFailed, Fact.Failed -> Record.ERROR
        else -> state
      }
    }
    return state
  }

  // ── the file ────────────────────────────────────────────────────────

  private fun storeFile(): File {
    val dir = File(app.noBackupFilesDir, "lu-native")
    dir.mkdirs()
    return File(dir, "bg-downloads.json")
  }

  private fun load() {
    val file = storeFile()
    if (!file.exists()) return
    try {
      val root = JSONObject(file.readText())
      wifiOnly = root.optBoolean("wifiOnly", false)
      limitBps = root.optLong("limitBps", 0L).coerceAtLeast(0L)
      val allowed = root.optJSONArray("meteredOk")
      if (allowed != null) for (i in 0 until allowed.length()) meteredOk.add(allowed.getString(i))
      val array = root.optJSONArray("downloads") ?: JSONArray()
      for (i in 0 until array.length()) {
        val o = array.getJSONObject(i)
        val r = Record(o.getString("id"), o.getString("url"), o.getString("dest"), o.getString("partial"))
        r.state = o.optString("state", Record.ERROR)
        r.receivedBytes = o.optLong("receivedBytes")
        r.totalBytes = o.optLong("totalBytes")
        r.expectedBytes = o.optLong("expectedBytes")
        r.expectedBytesExact = o.optBoolean("expectedBytesExact")
        r.sha256 = if (o.isNull("sha256")) null else o.optString("sha256")
        r.title = if (o.isNull("title")) null else o.optString("title")
        r.error = if (o.isNull("error")) null else o.optString("error")
        r.errorCode = if (o.isNull("errorCode")) null else o.optString("errorCode")
        r.validator = if (o.isNull("validator")) null else o.optString("validator")
        r.allowLocal = o.optBoolean("allowLocal", false)
        r.createdAt = o.optLong("createdAt")
        r.updatedAt = o.optLong("updatedAt")
        if (!o.isNull("headersSealed")) {
          // A Keystore that does not answer right now must not cost the
          // whole list: this download goes on without its headers.
          val plain = try {
            secrets.decrypt(HEADER_SECRET + r.id, o.getString("headersSealed"))
          } catch (e: Secrets.SecretException) {
            Log.w(TAG, "the headers of a download could not be read: ${e.message}")
            null
          }
          if (plain != null) {
            val h = JSONObject(plain)
            val map = HashMap<String, String>()
            for (key in h.keys()) map[key] = h.getString(key)
            r.headers = map
          }
        }
        records[r.id] = r
      }
    } catch (e: Exception) {
      Log.w(TAG, "the download list could not be read, starting with an empty one", e)
    }
  }

  private fun save() {
    val array = JSONArray()
    for (r in records.values) {
      val o = JSONObject()
      o.put("id", r.id).put("url", r.url).put("dest", r.dest).put("partial", r.partial)
      o.put("state", r.state).put("receivedBytes", r.receivedBytes).put("totalBytes", r.totalBytes)
      o.put("expectedBytes", r.expectedBytes).put("expectedBytesExact", r.expectedBytesExact)
      o.put("sha256", r.sha256 ?: JSONObject.NULL).put("title", r.title ?: JSONObject.NULL)
      o.put("error", r.error ?: JSONObject.NULL).put("errorCode", r.errorCode ?: JSONObject.NULL)
      o.put("validator", r.validator ?: JSONObject.NULL)
      if (r.allowLocal) o.put("allowLocal", true)
      o.put("createdAt", r.createdAt).put("updatedAt", r.updatedAt)
      if (r.headers.isNotEmpty()) {
        // A header can carry a Hugging Face token. It goes to disk sealed
        // with the Keystore key, like every other secret of the app.
        try {
          o.put("headersSealed", secrets.encrypt(HEADER_SECRET + r.id, JSONObject(r.headers).toString()))
        } catch (e: Exception) {
          Log.w(TAG, "headers of ${r.id} could not be sealed and are not kept")
        }
      }
      array.put(o)
    }
    val file = storeFile()
    val temp = File(file.parentFile, file.name + ".tmp")
    try {
      val root = JSONObject().put("downloads", array)
      if (wifiOnly) root.put("wifiOnly", true)
      if (limitBps > 0) root.put("limitBps", limitBps)
      if (meteredOk.isNotEmpty()) root.put("meteredOk", JSONArray(meteredOk.toList()))
      temp.writeText(root.toString())
      if (!temp.renameTo(file)) {
        file.delete()
        temp.renameTo(file)
      }
      lastSave = System.currentTimeMillis()
    } catch (e: Exception) {
      Log.w(TAG, "the download list could not be written", e)
    }
  }

  // ── what the plugin asks ────────────────────────────────────────────

  private fun json(r: Record): JSONObject {
    val o = JSONObject()
    o.put("id", r.id).put("url", r.url).put("dest", r.dest).put("state", r.state)
    o.put("receivedBytes", r.receivedBytes).put("totalBytes", r.totalBytes).put("expectedBytes", r.expectedBytes)
    o.put("bytesPerSecond", if (r.state == Record.RUNNING) r.bytesPerSecond else 0.0)
    o.put("sha256", r.sha256 ?: JSONObject.NULL)
    o.put("error", r.error ?: JSONObject.NULL).put("errorCode", r.errorCode ?: JSONObject.NULL)
    o.put("resumable", r.resumable)
    o.put("createdAt", r.createdAt).put("updatedAt", r.updatedAt)
    return o
  }

  fun list(): JSONArray {
    synchronized(lock) {
      val array = JSONArray()
      for (r in records.values) array.put(json(r))
      return array
    }
  }

  /** Titles and progress of what is running, for the notification. */
  fun liveSummary(): List<Triple<String, Long, Long>> {
    synchronized(lock) {
      return records.values.filter { it.isLive }.map {
        Triple(it.title ?: File(it.dest).name, it.receivedBytes, if (it.totalBytes > 0) it.totalBytes else it.expectedBytes)
      }
    }
  }

  fun hasLive(): Boolean = synchronized(lock) { records.values.any { it.isLive } }

  fun start(
    id: String, url: String, dest: String, partial: String, expectedBytes: Long, exact: Boolean,
    sha256: String?, headers: Map<String, String>, title: String?, allowLocal: Boolean = false,
  ): String? {
    synchronized(lock) {
      val old = records[id]
      if (old != null && old.isLive) return null
      val now = System.currentTimeMillis()
      val r = Record(id, url, dest, partial)
      // A new start under an id that had an earlier attempt continues from
      // its bytes, if it is the same address and the server confirms the
      // file is unchanged (If-Range). Another address starts from zero.
      if (old != null && old.url == url && old.partial == partial) {
        r.validator = old.validator
      } else {
        File(partial).delete()
      }
      r.expectedBytes = expectedBytes
      r.expectedBytesExact = exact
      r.sha256 = sha256
      r.headers = headers
      r.title = title
      r.allowLocal = allowLocal
      r.createdAt = now
      r.updatedAt = now
      val file = File(partial)
      r.receivedBytes = if (file.exists() && r.validator != null) file.length() else 0
      records[id] = r
      save()
    }
    pump()
    return null
  }

  fun pause(id: String): String? {
    val worker: Worker?
    synchronized(lock) {
      val r = records[id] ?: return "That download does not exist."
      r.state = step(r.state, Fact.UserPaused)
      r.updatedAt = System.currentTimeMillis()
      worker = workers[id]
      save()
    }
    worker?.halt()
    synchronized(networkSignal) { networkSignal.notifyAll() }
    // The worker may have a piece in its hands that is not counted yet.
    // Once it has let go, the size of the partial file is the truth.
    try { worker?.join(3000) } catch (_: InterruptedException) {}
    synchronized(lock) {
      val r = records[id] ?: return null
      val file = File(r.partial)
      if (r.state == Record.PAUSED) {
        r.receivedBytes = if (file.exists()) file.length() else 0
        save()
      }
      emit("bg-download-progress", r, force = true)
    }
    serviceHook?.invoke()
    return null
  }

  fun resume(id: String): String? {
    synchronized(lock) {
      val r = records[id] ?: return "That download does not exist."
      r.state = step(r.state, Fact.UserResumed)
      r.error = null
      r.errorCode = null
      r.updatedAt = System.currentTimeMillis()
      val file = File(r.partial)
      r.receivedBytes = if (file.exists()) file.length() else 0
      save()
      emit("bg-download-progress", r, force = true)
    }
    pump()
    return null
  }

  fun cancel(id: String): String? {
    val worker: Worker?
    val gone: Record
    synchronized(lock) {
      gone = records[id] ?: return "That download does not exist."
      if (gone.state == Record.DONE) return "This download is finished."
      gone.state = step(gone.state, Fact.UserCancelled)
      worker = workers.remove(id)
      records.remove(id)
      meteredOk.remove(id)
      save()
    }
    worker?.halt()
    synchronized(networkSignal) { networkSignal.notifyAll() }
    // The worker may be in the middle of a write. Wait for it, then the
    // partial file can go without being recreated behind our back.
    try { worker?.join(3000) } catch (_: InterruptedException) {}
    File(gone.partial).delete()
    synchronized(lock) { emit("bg-download-progress", gone, force = true) }
    serviceHook?.invoke()
    return null
  }

  fun forget(id: String) {
    synchronized(lock) {
      val r = records[id] ?: return
      if (r.isLive) return
      records.remove(id)
      meteredOk.remove(id)
      save()
    }
  }

  /**
   * Called when the app starts and when the service is started: whatever
   * was running when the process ended is queued again, with the size of
   * its partial file as the number of bytes it has.
   */
  fun reconcile(startService: Boolean) {
    synchronized(lock) {
      var changed = false
      for (r in records.values) {
        if (!r.isLive || workers.containsKey(r.id)) continue
        val partial = File(r.partial)
        val dest = File(r.dest)
        if (r.state == Record.VERIFYING && !partial.exists() && dest.exists()) {
          // Renamed, and the process ended before the line was written.
          r.state = Record.DONE
          r.receivedBytes = dest.length()
          r.headers = emptyMap()
        } else {
          // Also for "verifying" with the partial file still there: the
          // transfer asks the server, hears that nothing is missing, and
          // the check runs again from the start.
          r.state = Record.QUEUED
          r.receivedBytes = if (partial.exists()) partial.length() else 0
        }
        changed = true
      }
      if (changed) save()
    }
    if (startService) pump() else startWorkers()
  }

  /** Start the service if something wants to run. The service starts the workers. */
  private fun pump() {
    if (!hasLive()) return
    if (!DownloadService.ensureStarted(app)) {
      // Android refused the foreground service (the app is not visible).
      // The transfers run in this process as long as it lives, and the next
      // start of the app picks up what is left.
      startWorkers()
    }
  }

  fun startWorkers() {
    val fresh = ArrayList<Worker>()
    synchronized(lock) {
      for (r in records.values) {
        if (workers.size >= MAX_PARALLEL) break
        if (r.isLive && !workers.containsKey(r.id)) {
          val w = Worker(r.id)
          workers[r.id] = w
          fresh.add(w)
        }
      }
    }
    if (fresh.isNotEmpty()) watchNetwork()
    for (w in fresh) w.start()
  }

  private fun workerEnded(id: String, worker: Worker) {
    synchronized(lock) {
      if (workers[id] === worker) workers.remove(id)
    }
    startWorkers()
    serviceHook?.invoke()
  }

  // ── events ──────────────────────────────────────────────────────────

  /** Call with the lock held. */
  private fun emit(event: String, r: Record, force: Boolean = false) {
    val now = System.currentTimeMillis()
    if (!force) {
      val last = lastEmit[r.id] ?: 0
      if (now - last < 400) return
    }
    lastEmit[r.id] = now
    val payload = json(r)
    val target = listener ?: return
    try { target(event, payload) } catch (e: Exception) { Log.w(TAG, "event $event was not delivered", e) }
  }

  // ── network ─────────────────────────────────────────────────────────

  private fun connectivity(): ConnectivityManager = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

  private fun online(): Boolean {
    val cm = connectivity()
    val network = cm.activeNetwork ?: return false
    val caps = cm.getNetworkCapabilities(network) ?: return false
    return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
  }

  /** Mobile data and nothing better: the case "Download on Wi-Fi only" holds a download back. */
  private fun onCellular(): Boolean {
    val cm = connectivity()
    val network = cm.activeNetwork ?: return false
    val caps = cm.getNetworkCapabilities(network) ?: return false
    if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return false
    return caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
  }

  /** True while the rule of the user keeps this download off the network that is there. */
  private fun heldForWifi(id: String): Boolean {
    val ruled = synchronized(lock) { wifiOnly && !meteredOk.contains(id) }
    return ruled && onCellular()
  }

  /** The switch "Download on Wi-Fi only". Holds from the next piece of every transfer on. */
  fun setWifiOnly(on: Boolean) {
    synchronized(lock) {
      if (wifiOnly == on) return
      wifiOnly = on
      save()
    }
    wakeWaiting()
  }

  /** The user said "Download anyway" for this one (or took it back). May be called before the start. */
  fun allowMetered(id: String, allow: Boolean) {
    synchronized(lock) {
      val changed = if (allow) meteredOk.add(id) else meteredOk.remove(id)
      if (!changed) return
      save()
    }
    wakeWaiting()
  }

  /** The speed limit, 0 for none. Holds from the next piece of every transfer on. */
  fun setLimit(bytesPerSecond: Long) {
    val wanted = bytesPerSecond.coerceAtLeast(0L)
    synchronized(lock) {
      if (limitBps == wanted) return
      limitBps = wanted
      save()
    }
    synchronized(throttleLock) { throttleSlotEnd = 0L }
  }

  fun limit(): Long = limitBps

  /** Wait out the share of the limit these bytes cost. Returns early when the worker is told to stop. */
  private fun throttle(worker: Worker, bytes: Int) {
    val limit = limitBps
    if (limit <= 0) return
    var wait: Long
    synchronized(throttleLock) {
      val (slot, pause) = Throttle.step(throttleSlotEnd, limit, bytes.toLong(), android.os.SystemClock.elapsedRealtimeNanos() / 1000)
      throttleSlotEnd = slot
      wait = pause
    }
    while (wait > 0 && !worker.stop) {
      // In slices: Pause and Cancel must not wait for a slow line, and a limit that was taken away ends the wait.
      if (limitBps <= 0) return
      val slice = if (wait > 200) 200 else wait
      try { Thread.sleep(slice) } catch (_: InterruptedException) { return }
      wait -= slice
    }
  }

  private fun wakeWaiting() {
    synchronized(networkSignal) {
      networkGeneration += 1
      networkSignal.notifyAll()
    }
  }

  /** What the page shows and asks about: `wifi`, `cellular`, `ethernet`, `other` or `none`. */
  fun connectionInfo(): JSONObject {
    val o = JSONObject()
    var kind = "none"
    var metered = false
    try {
      val cm = connectivity()
      val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
      if (caps != null) {
        kind = when {
          caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
          caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
          caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
          else -> "other"
        }
        metered = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
      }
    } catch (e: Exception) {
      kind = "other"
    }
    o.put("kind", kind).put("metered", metered)
    synchronized(lock) { o.put("wifiOnly", wifiOnly) }
    return o
  }

  private fun watchNetwork() {
    synchronized(lock) {
      if (networkCallback != null) return
      val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
          synchronized(networkSignal) {
            networkGeneration += 1
            networkSignal.notifyAll()
          }
        }
      }
      try {
        connectivity().registerDefaultNetworkCallback(callback)
        networkCallback = callback
      } catch (e: Exception) {
        Log.w(TAG, "no network callback, waiting downloads poll instead", e)
      }
    }
  }

  // ── one transfer ────────────────────────────────────────────────────

  private class HttpFailure(val status: Int) : Exception("HTTP $status")
  /** An address the transfer must not connect to. Final: asking again changes nothing. */
  private class Refused(val text: String) : Exception(text)
  private class DiskFull : Exception("disk full")
  private class Restart(message: String) : IOException(message)

  class Worker(val id: String) : Thread("lu-download") {
    @Volatile var stop = false
    @Volatile var connection: HttpURLConnection? = null

    fun halt() {
      stop = true
      val c = connection
      if (c != null) {
        // Off this thread: disconnect can block on a socket that is being read.
        Thread { try { c.disconnect() } catch (_: Exception) {} }.start()
      }
      interrupt()
    }

    override fun run() {
      try {
        transfer(this)
      } catch (e: Exception) {
        Log.e(TAG, "download $id ended with an unexpected error", e)
        fail(id, "unknown", "The download stopped with an unexpected error.")
      } finally {
        workerEnded(id, this)
      }
    }
  }

  /** Bytes per second over windows of a second. `add` answers the rate when a window closes. */
  private class Meter {
    private var windowStart = System.currentTimeMillis()
    private var windowBytes = 0L

    fun add(bytes: Int, now: Long): Double? {
      windowBytes += bytes
      val span = now - windowStart
      if (span < 1000) return null
      val rate = windowBytes * 1000.0 / span
      windowStart = now
      windowBytes = 0
      return rate
    }
  }

  private fun snapshot(id: String): Record? = synchronized(lock) { records[id] }

  private fun fact(id: String, fact: Fact, event: String? = "bg-download-progress"): String? {
    synchronized(lock) {
      val r = records[id] ?: return null
      val next = step(r.state, fact)
      if (next != r.state) {
        r.state = next
        r.updatedAt = System.currentTimeMillis()
        save()
        if (event != null) emit(event, r, force = true)
      }
      return r.state
    }
  }

  private fun fail(id: String, code: String, message: String, dropPartial: Boolean = false) {
    synchronized(lock) {
      val r = records[id] ?: return
      val next = step(r.state, Fact.Failed)
      if (next != Record.ERROR) return
      r.state = next
      r.error = message
      r.errorCode = code
      r.updatedAt = System.currentTimeMillis()
      if (dropPartial) {
        File(r.partial).delete()
        r.receivedBytes = 0
        r.validator = null
      }
      save()
      emit("bg-download-error", r, force = true)
    }
  }

  private fun transfer(worker: Worker) {
    val id = worker.id
    var lastByteAt = System.currentTimeMillis()
    var failures = 0
    while (true) {
      val r = snapshot(id) ?: return
      if (worker.stop) return
      if (r.state != Record.QUEUED && r.state != Record.RUNNING && r.state != Record.WAITING) return
      if (!online()) {
        fact(id, Fact.NetworkLost)
        if (!waitForNetwork(worker, 30_000)) return
        if (System.currentTimeMillis() - lastByteAt > GIVE_UP_AFTER_MS) {
          fail(id, "network", "There was no connection for a long time. Resume continues the download.")
          return
        }
        continue
      }
      if (heldForWifi(id)) {
        // "Download on Wi-Fi only" and the phone is on mobile data: wait, at
        // the start, at every continue and in the middle of a transfer. The
        // rule is the user's, not a dead line, so it never counts as failed.
        fact(id, Fact.NetworkLost)
        if (!waitForNetwork(worker, 30_000)) return
        lastByteAt = System.currentTimeMillis()
        continue
      }
      fact(id, Fact.NetworkBack)
      val before = r.receivedBytes
      try {
        if (!transferOnce(worker, r)) return
        break
      } catch (e: HttpFailure) {
        if (worker.stop) return
        fail(id, "http-${e.status}", httpMessage(e.status))
        return
      } catch (e: Refused) {
        if (worker.stop) return
        Log.w(TAG, "download $id refused: ${e.text}")
        fail(id, "blocked", e.text, dropPartial = true)
        return
      } catch (e: DiskFull) {
        fail(id, "disk", "There is not enough free space on this device for the download.")
        return
      } catch (e: IOException) {
        if (worker.stop) return
        val now = System.currentTimeMillis()
        if ((snapshot(id)?.receivedBytes ?: 0) > before) {
          lastByteAt = now
          failures = 0
        }
        failures += 1
        Log.i(TAG, "download $id interrupted (${e.javaClass.simpleName}: ${e.message}), attempt $failures")
        if (now - lastByteAt > GIVE_UP_AFTER_MS) {
          fail(id, "network", "The server could not be reached for a long time. Resume continues the download.")
          return
        }
        if (e !is Restart) {
          // The network is there and the server is not, or the connection
          // broke. Both read as waiting, and both end by themselves.
          fact(id, Fact.NetworkLost)
          val pause = minOf(15_000L, 1000L shl minOf(failures, 4))
          if (!waitForNetwork(worker, pause)) return
        }
      }
    }
    verify(id)
  }

  /**
   * Sleep until the time is up, a network became available, or the worker
   * was told to stop. False in the last case.
   */
  private fun waitForNetwork(worker: Worker, maxMs: Long): Boolean {
    val until = System.currentTimeMillis() + maxMs
    synchronized(networkSignal) {
      val seen = networkGeneration
      while (!worker.stop && networkGeneration == seen) {
        val left = until - System.currentTimeMillis()
        if (left <= 0) break
        try { networkSignal.wait(minOf(left, 2000)) } catch (_: InterruptedException) {}
      }
    }
    return !worker.stop
  }

  private fun httpMessage(status: Int): String = when (status) {
    401, 403 -> "The server refused this download ($status). The model may need a Hugging Face token or an accepted licence."
    404 -> "The file was not found on the server (404)."
    in 500..599 -> "The server reported an error ($status). Try again later."
    else -> "The server answered with status $status."
  }

  /** True when the last byte is on disk, false when stopped by the user. */
  private fun transferOnce(worker: Worker, r: Record): Boolean {
    val id = r.id
    val partial = File(r.partial)
    partial.parentFile?.mkdirs()
    var have = if (partial.exists()) partial.length() else 0L
    val validator = synchronized(lock) { r.validator }
    if (have > 0 && validator == null) {
      // Nothing proves that the bytes on disk belong to what the server has now.
      partial.delete()
      have = 0
    }
    val origin = URL(r.url)
    var url = origin
    var connection: HttpURLConnection? = null
    var status = 0
    for (hop in 0..5) {
      // Every address is held to the download rule BEFORE a connection to
      // it is opened: the one the download was started with, and each one
      // a redirect names. A name is also judged by what it resolves to.
      // A name that cannot be looked up throws an IOException here and is
      // waited out like any other missing network.
      NetGuard.refuse(url, r.allowLocal)?.let { throw Refused(if (hop == 0) it else NetGuard.REDIRECT_REFUSED) }
      val c = url.openConnection() as HttpURLConnection
      c.instanceFollowRedirects = false
      c.connectTimeout = 20_000
      c.readTimeout = 30_000
      c.setRequestProperty("User-Agent", userAgent)
      c.setRequestProperty("Accept-Encoding", "identity")
      // The caller's headers (a token) stay with the host they were meant for.
      if (url.host.equals(origin.host, ignoreCase = true) && url.protocol == origin.protocol && url.port == origin.port) {
        for ((k, v) in r.headers) c.setRequestProperty(k, v)
      }
      if (have > 0 && validator != null) {
        c.setRequestProperty("Range", "bytes=$have-")
        c.setRequestProperty("If-Range", validator)
      }
      worker.connection = c
      if (worker.stop) { c.disconnect(); return false }
      status = c.responseCode
      if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
        val location = c.getHeaderField("Location")
        c.disconnect()
        if (location.isNullOrEmpty() || hop == 5) throw HttpFailure(status)
        val next = try { URL(url, location) } catch (_: Exception) { throw Refused(NetGuard.REDIRECT_REFUSED) }
        // A redirect may go to another host (Hugging Face sends the bytes
        // from a storage host), but never down from https, and never to an
        // address the rule refuses. The check at the top of the loop does
        // the second half before anything is sent there.
        if (next.protocol != "https" && next.protocol != url.protocol) throw Refused(NetGuard.REDIRECT_REFUSED)
        url = next
        continue
      }
      connection = c
      break
    }
    val c = connection ?: throw HttpFailure(status)
    try {
      var total: Long
      when (status) {
        200 -> {
          have = 0
          total = headerLong(c, "Content-Length")
          val fresh = strongValidator(c)
          synchronized(lock) { r.validator = fresh }
        }
        206 -> {
          val range = c.getHeaderField("Content-Range") ?: ""
          val match = Regex("""bytes (\d+)-(\d+)/(\d+|\*)""").find(range)
          val from = match?.groupValues?.get(1)?.toLongOrNull()
          if (from == null || from != have) {
            partial.delete()
            synchronized(lock) { r.validator = null; r.receivedBytes = 0 }
            throw Restart("the server answered with another range than asked for")
          }
          total = match.groupValues[3].toLongOrNull() ?: 0
        }
        416 -> {
          val size = Regex("""bytes \*/(\d+)""").find(c.getHeaderField("Content-Range") ?: "")?.groupValues?.get(1)?.toLongOrNull()
          if (size != null && size == have && have > 0) {
            synchronized(lock) { r.totalBytes = size; r.receivedBytes = have }
            return true
          }
          partial.delete()
          synchronized(lock) { r.validator = null; r.receivedBytes = 0 }
          throw Restart("the server refused the range")
        }
        else -> throw HttpFailure(status)
      }
      if (total > 0) {
        val missing = total - have
        val free = try { StatFs(partial.parentFile!!.path).availableBytes } catch (_: Exception) { Long.MAX_VALUE }
        if (free < missing + 8L * 1024 * 1024) throw DiskFull()
      }
      synchronized(lock) {
        r.totalBytes = total
        r.receivedBytes = have
        save()
      }
      RandomAccessFile(partial, "rw").use { out ->
        out.setLength(have)
        out.seek(have)
        c.inputStream.use { input ->
          val buffer = ByteArray(128 * 1024)
          val meter = Meter()
          while (true) {
            if (worker.stop) return false
            // Under a limit the pieces are smaller, so the line runs evenly instead of in bursts with long waits between.
            val cap = limitBps
            val want = if (cap in 1 until 4L * buffer.size) (cap / 4).toInt().coerceIn(8 * 1024, buffer.size) else buffer.size
            val n = input.read(buffer, 0, want)
            if (n < 0) break
            try {
              out.write(buffer, 0, n)
            } catch (e: IOException) {
              if ((e.message ?: "").contains("ENOSPC")) throw DiskFull()
              throw e
            }
            have += n
            val now = System.currentTimeMillis()
            val rate = meter.add(n, now)
            synchronized(lock) {
              if (records[id] !== r) return false
              val next = step(r.state, Fact.Progress)
              if (next != Record.RUNNING) return false
              r.state = next
              r.receivedBytes = have
              r.updatedAt = now
              if (rate != null) {
                r.bytesPerSecond = if (r.bytesPerSecond <= 0) rate else r.bytesPerSecond * 0.5 + rate * 0.5
              }
              if (now - lastSave > 2000) save()
              emit("bg-download-progress", r)
            }
            throttle(worker, n)
            if (rate != null) {
              serviceHook?.invoke()
              // Once a second: the phone may have left the Wi-Fi with the socket still alive.
              if (heldForWifi(id)) throw IOException("held until Wi-Fi is back")
            }
          }
        }
      }
      if (worker.stop) return false
      if (total > 0 && have < total) throw IOException("the connection ended after $have of $total bytes")
      return true
    } finally {
      worker.connection = null
      try { c.disconnect() } catch (_: Exception) {}
    }
  }

  private fun headerLong(c: HttpURLConnection, name: String): Long = c.getHeaderField(name)?.trim()?.toLongOrNull() ?: 0

  /** An ETag that may be used in If-Range, or the date of the last change. A weak ETag may not. */
  private fun strongValidator(c: HttpURLConnection): String? {
    val etag = c.getHeaderField("ETag")?.trim()
    if (!etag.isNullOrEmpty() && !etag.startsWith("W/")) return etag
    return c.getHeaderField("Last-Modified")?.trim()?.takeIf { it.isNotEmpty() }
  }

  // ── the check at the end ────────────────────────────────────────────

  private fun verify(id: String) {
    if (fact(id, Fact.TransferComplete) != Record.VERIFYING) return
    val r = snapshot(id) ?: return
    val partial = File(r.partial)
    val dest = File(r.dest)
    val size = if (partial.exists()) partial.length() else -1
    if (size < 0) {
      failVerify(id, "io", "The downloaded file is not there any more.", drop = true)
      return
    }
    if (r.totalBytes > 0 && size != r.totalBytes) {
      failVerify(id, "size", "The download is incomplete: $size of ${r.totalBytes} bytes arrived.", drop = true)
      return
    }
    if (r.expectedBytesExact && r.expectedBytes > 0 && size != r.expectedBytes) {
      failVerify(id, "size", "The file has $size bytes, ${r.expectedBytes} were expected.", drop = true)
      return
    }
    val wanted = r.sha256
    if (!wanted.isNullOrEmpty()) {
      val actual = try { sha256(partial) } catch (e: Exception) { null }
      if (actual == null) {
        failVerify(id, "io", "The downloaded file could not be read.", drop = false)
        return
      }
      if (!actual.equals(wanted, ignoreCase = true)) {
        failVerify(id, "checksum", "The downloaded file is damaged: its SHA-256 does not match. It was deleted, start the download again.", drop = true)
        return
      }
    }
    // Same folder, so the rename is one step for the file system: the
    // finished name either has the whole checked file or does not exist.
    dest.parentFile?.mkdirs()
    var moved = partial.renameTo(dest)
    if (!moved && dest.exists()) {
      dest.delete()
      moved = partial.renameTo(dest)
    }
    if (!moved) {
      failVerify(id, "io", "The finished download could not be moved into place.", drop = false)
      return
    }
    synchronized(lock) {
      val current = records[id] ?: return
      current.state = step(current.state, Fact.Verified)
      current.receivedBytes = size
      if (current.totalBytes <= 0) current.totalBytes = size
      current.error = null
      current.errorCode = null
      current.headers = emptyMap()
      current.updatedAt = System.currentTimeMillis()
      save()
      emit("bg-download-done", current, force = true)
    }
    DownloadService.notifyDone(app, r.title ?: dest.name)
  }

  private fun failVerify(id: String, code: String, message: String, drop: Boolean) {
    synchronized(lock) {
      val r = records[id] ?: return
      r.state = step(r.state, Fact.VerifyFailed)
      r.error = message
      r.errorCode = code
      r.updatedAt = System.currentTimeMillis()
      if (drop) {
        File(r.partial).delete()
        r.receivedBytes = 0
        r.validator = null
      }
      save()
      emit("bg-download-error", r, force = true)
    }
  }

  fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(1024 * 1024)
      while (true) {
        val n = input.read(buffer)
        if (n < 0) break
        digest.update(buffer, 0, n)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
}
