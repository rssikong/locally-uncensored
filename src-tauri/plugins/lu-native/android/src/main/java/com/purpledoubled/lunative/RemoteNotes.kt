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
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

// Notices of the user's computer (A17): "Answer ready", "Render ready",
// "Approval needed". Shown while the app is not on the screen; a tap opens
// the chat or the result through a link of the app's own
// (lu://remote/notice?...), the same way any lu:// link comes in
// (noteLink, deep-link event). The link is checked in Rust before it gets
// here (check_local_notice) and once more below.
object RemoteNotes {
  private const val TAG = "LuNativeRemote"
  const val CHANNEL = "lu_native_remote"
  const val WATCH_CHANNEL = "lu_native_remote_watch"
  private const val BASE_ID = 0x4d00
  const val WATCH_ID = 0x4cff

  /** Pure: only a link back into LU may sit behind a notice. */
  fun linkAllowed(url: String?): Boolean =
    url == null || (url.startsWith("lu://remote/notice?") && url.length <= 300)

  /** Pure: the notification id of a notice id, stable, inside a small range of its own. */
  fun noteId(id: String): Int = BASE_ID + (id.hashCode() and 0xff)

  fun granted(context: Context): Boolean =
    Build.VERSION.SDK_INT < 33 ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  fun createChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL) == null) {
      val channel = NotificationChannel(CHANNEL, "Your computer", NotificationManager.IMPORTANCE_DEFAULT)
      channel.description = "Answers, renders and approvals of the computer this phone is paired with"
      manager.createNotificationChannel(channel)
    }
    if (manager.getNotificationChannel(WATCH_CHANNEL) == null) {
      val channel = NotificationChannel(WATCH_CHANNEL, "Connected to your computer", NotificationManager.IMPORTANCE_LOW)
      channel.description = "Shown while LU waits for an answer or a render of your computer"
      channel.setShowBadge(false)
      manager.createNotificationChannel(channel)
    }
  }

  private fun opener(context: Context, url: String?, requestCode: Int): PendingIntent? {
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
    val intent = if (url != null) {
      Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.packageName)
    } else {
      context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(context, requestCode, intent, flags)
  }

  /** False when it was not shown (no permission, or the system refused). */
  fun post(context: Context, id: String, title: String, body: String, url: String?): Boolean {
    if (!linkAllowed(url) || !granted(context)) return false
    return try {
      createChannels(context)
      val n = NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.lu_native_download)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setAutoCancel(true)
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setContentIntent(opener(context, url, noteId(id)))
        .build()
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(noteId(id), n)
      true
    } catch (e: Exception) {
      Log.w(TAG, "no notice: ${e.javaClass.simpleName}")
      false
    }
  }

  fun watchNotice(context: Context, text: String): Notification {
    createChannels(context)
    return NotificationCompat.Builder(context, WATCH_CHANNEL)
      .setSmallIcon(R.drawable.lu_native_download)
      .setContentTitle("Connected to your computer")
      .setContentText(text.ifBlank { "LU waits for your computer." })
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(opener(context, null, WATCH_ID))
      .build()
  }
}

// Keeps the process of the app alive while the phone waits for an answer,
// a render or an approval of the computer, so the page can keep its
// connection and say "Answer ready" when it comes. Started from the page
// while the app is on the screen (Android 12 and newer refuse a start from
// the background), ended when nothing waits any more.
class RemoteWatchService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
    try {
      val n = RemoteNotes.watchNotice(this, text)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(RemoteNotes.WATCH_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(RemoteNotes.WATCH_ID, n)
      }
    } catch (e: Exception) {
      Log.w(TAG, "waiting without foreground state: ${e.javaClass.simpleName}")
    }
    // Not sticky: after the process died nobody waits for the answer any more.
    return START_NOT_STICKY
  }

  companion object {
    private const val TAG = "LuNativeRemoteWatch"
    const val EXTRA_TEXT = "text"

    fun start(context: Context, text: String): Boolean = try {
      ContextCompat.startForegroundService(context, Intent(context, RemoteWatchService::class.java).putExtra(EXTRA_TEXT, text))
      true
    } catch (e: Exception) {
      Log.w(TAG, "the watch could not be started: ${e.javaClass.simpleName}")
      false
    }

    fun stop(context: Context): Boolean = try {
      context.stopService(Intent(context, RemoteWatchService::class.java))
    } catch (e: Exception) {
      false
    }
  }
}
