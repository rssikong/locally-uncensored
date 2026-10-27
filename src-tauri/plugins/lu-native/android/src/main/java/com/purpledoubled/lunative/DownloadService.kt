package com.purpledoubled.lunative

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.io.File

// The foreground service that keeps model downloads alive.
//
// Why a foreground service and not WorkManager: a model is one transfer of
// several gigabytes that the user started and wants to watch. That is the
// case Android's own guidance gives to a foreground service of type
// dataSync: it starts at once, it is not deferred or batched, it shows its
// progress in a notification the user can see, and it is not ended when the
// app leaves the screen. WorkManager would add a dependency and a second
// scheduler for work that has no conditions to wait for, and its long
// running mode is a foreground service underneath anyway.
//
// The service itself does little: it holds the notification and a wake lock
// and asks DownloadEngine to run. START_STICKY makes Android start it again
// after the process was ended, and the engine then continues from its file.
class DownloadService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var foreground = false
  private var lastUpdate = 0L

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    DownloadEngine.init(this)
    createChannel(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    goForeground()
    DownloadEngine.serviceHook = { update(false) }
    // intent == null: Android restarted the service after the process died.
    DownloadEngine.reconcile(startService = false)
    update(true)
    return START_STICKY
  }

  private fun goForeground() {
    val notification = build(this)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      foreground = true
    } catch (e: Exception) {
      // Android 12 and newer refuse a foreground start while the app is not
      // visible. The transfers still run, as an ordinary service, for as
      // long as the system lets the process live.
      Log.w(TAG, "running without foreground state: ${e.javaClass.simpleName}")
      foreground = false
    }
  }

  private fun update(force: Boolean) {
    if (!DownloadEngine.hasLive()) {
      release()
      if (foreground) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
        foreground = false
      }
      DownloadEngine.serviceHook = null
      stopSelf()
      return
    }
    hold()
    val now = System.currentTimeMillis()
    if (!force && now - lastUpdate < 1000) return
    lastUpdate = now
    if (foreground) {
      try {
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ID, build(this))
      } catch (_: Exception) {}
    }
  }

  private fun hold() {
    if (wakeLock?.isHeld == true) return
    try {
      val power = getSystemService(Context.POWER_SERVICE) as PowerManager
      // The time limit is a safety net: a lock that is never released is
      // worse than a download that slows down with the screen off.
      wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lu-native:download").apply { acquire(6 * 60 * 60 * 1000L) }
    } catch (e: Exception) {
      Log.w(TAG, "no wake lock: ${e.javaClass.simpleName}")
    }
  }

  private fun release() {
    try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) {}
    wakeLock = null
  }

  // Android 15 gives a dataSync service six hours in 24 and then calls
  // this. Not stopping is a crash. The transfers go on in the process while
  // it lives, and the next start of the app continues what is left.
  override fun onTimeout(startId: Int, fgsType: Int) {
    Log.w(TAG, "foreground time is used up, stopping the service")
    release()
    foreground = false
    stopSelf()
  }

  override fun onDestroy() {
    release()
    DownloadEngine.serviceHook = null
    super.onDestroy()
  }

  companion object {
    private const val TAG = "LuNativeDownload"
    private const val CHANNEL = "lu_native_downloads"
    private const val NOTIFICATION_ID = 0x4c55
    private const val DONE_BASE_ID = 0x4c56

    /** False when Android does not allow the service to start right now. */
    fun ensureStarted(context: Context): Boolean {
      return try {
        ContextCompat.startForegroundService(context, Intent(context, DownloadService::class.java))
        true
      } catch (e: Exception) {
        Log.w(TAG, "the download service could not be started: ${e.javaClass.simpleName}")
        false
      }
    }

    private fun createChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL) != null) return
      val channel = NotificationChannel(CHANNEL, "Model downloads", NotificationManager.IMPORTANCE_LOW)
      channel.description = "Progress of the models that are being downloaded"
      channel.setShowBadge(false)
      manager.createNotificationChannel(channel)
    }

    private fun openApp(context: Context): PendingIntent? {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
      launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
      return PendingIntent.getActivity(context, 0, launch, flags)
    }

    private fun build(context: Context): Notification {
      val live = DownloadEngine.liveSummary()
      val received = live.sumOf { it.second }
      val total = live.sumOf { it.third }
      val title = when (live.size) {
        0 -> "Preparing download"
        1 -> "Downloading ${live[0].first}"
        else -> "Downloading ${live.size} models"
      }
      val builder = NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.lu_native_download)
        .setContentTitle(title)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .setContentIntent(openApp(context))
      if (total > 0 && live.all { it.third > 0 }) {
        val percent = (received * 100 / total).toInt().coerceIn(0, 100)
        builder.setProgress(100, percent, false)
        builder.setContentText("$percent % of ${megabytes(total)}")
      } else {
        builder.setProgress(0, 0, true)
        if (received > 0) builder.setContentText(megabytes(received))
      }
      return builder.build()
    }

    private fun megabytes(bytes: Long): String {
      val mb = bytes / (1024.0 * 1024.0)
      return if (mb >= 1024) String.format("%.1f GB", mb / 1024) else String.format("%.0f MB", mb)
    }

    /**
     * Show the progress now. Called when the user has just allowed
     * notifications: a download that is running is then to be seen at once,
     * not at its next step.
     */
    fun refresh(context: Context) {
      if (!DownloadEngine.hasLive()) return
      try {
        createChannel(context)
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ID, build(context))
      } catch (e: Exception) {
        Log.w(TAG, "no progress note: ${e.javaClass.simpleName}")
      }
    }

    /** A note that stays after the progress is gone. Only shown when the user allowed notifications. */
    fun notifyDone(context: Context, title: String) {
      try {
        if (Build.VERSION.SDK_INT >= 33 &&
          ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        createChannel(context)
        val notification = NotificationCompat.Builder(context, CHANNEL)
          .setSmallIcon(R.drawable.lu_native_download)
          .setContentTitle("Download finished")
          .setContentText(File(title).name)
          .setAutoCancel(true)
          .setContentIntent(openApp(context))
          .build()
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(DONE_BASE_ID + (title.hashCode() and 0xfff), notification)
      } catch (e: Exception) {
        Log.w(TAG, "no finished note: ${e.javaClass.simpleName}")
      }
    }
  }
}
