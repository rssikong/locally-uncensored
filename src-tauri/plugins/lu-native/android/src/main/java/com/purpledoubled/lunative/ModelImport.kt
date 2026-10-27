package com.purpledoubled.lunative

import android.content.Context
import android.net.Uri
import android.os.StatFs
import android.provider.OpenableColumns
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

// A model file of the user's own, picked in the system's document picker.
//
// The picker hands out a content address, not a path. This object reads what
// Rust needs to judge the file (name, size, the first bytes, free space) and
// then copies it into the model folder, in pieces, with progress and a way
// to stop. Whether the file is copied at all, and under which name, is
// decided in Rust (src/import.rs). The bytes never pass through the webview.

internal object ModelImport {
  private const val TAG = "LuNativeImport"
  private const val HEAD_BYTES = 16
  private const val BUFFER_BYTES = 1024 * 1024
  private const val PROGRESS_EVERY_MS = 250L

  /** The files the user picked, by the token Rust got for them. */
  private val picked = ConcurrentHashMap<String, Uri>()

  /**
   * Set by `importCancel`, read between two pieces of the copy.
   *
   * It is cleared when an import BEGINS (`begin`, called by `importPick`),
   * not when the copy begins. Cleared at the copy, a Cancel that arrived
   * while the file was still being picked and judged was wiped out, and the
   * copy of several gigabytes ran although the user had stopped it (review
   * of round 6, finding 12).
   */
  @Volatile var cancel = false

  /** A new import starts: whatever was cancelled before does not concern it. */
  fun begin() {
    cancel = false
  }

  /** True when a write failed because the disk is full. */
  fun isNoSpace(e: Throwable): Boolean {
    var cause: Throwable? = e
    while (cause != null) {
      val text = cause.message ?: ""
      if (text.contains("ENOSPC") || text.contains("No space left", ignoreCase = true)) return true
      cause = cause.cause
    }
    return false
  }

  /** Name, size, first bytes and free space, as `importPick` answers them. */
  fun describe(context: Context, uri: Uri, dir: String?): JSONObject {
    var name = ""
    var size = -1L
    try {
      context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val nameAt = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          val sizeAt = cursor.getColumnIndex(OpenableColumns.SIZE)
          if (nameAt >= 0 && !cursor.isNull(nameAt)) name = cursor.getString(nameAt) ?: ""
          if (sizeAt >= 0 && !cursor.isNull(sizeAt)) size = cursor.getLong(sizeAt)
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "the provider did not describe the file: ${e.javaClass.simpleName}")
    }
    if (name.isEmpty()) name = uri.lastPathSegment ?: ""
    var head = ByteArray(0)
    try {
      context.contentResolver.openInputStream(uri)?.use { input ->
        val buffer = ByteArray(HEAD_BYTES)
        var have = 0
        while (have < HEAD_BYTES) {
          val n = input.read(buffer, have, HEAD_BYTES - have)
          if (n < 0) break
          have += n
        }
        head = buffer.copyOf(have)
      }
    } catch (e: Exception) {
      Log.w(TAG, "the file could not be opened: ${e.javaClass.simpleName}")
    }
    var free = 0L
    try {
      var probe: File? = File(dir ?: context.filesDir.path)
      while (probe != null && !probe.exists()) probe = probe.parentFile
      free = StatFs((probe ?: context.filesDir).path).availableBytes
    } catch (_: Exception) {}
    val token = UUID.randomUUID().toString()
    picked[token] = uri
    return JSONObject()
      .put("cancelled", false)
      .put("token", token)
      .put("name", name)
      .put("size", size)
      .put("headBase64", Base64.encodeToString(head, Base64.NO_WRAP))
      .put("freeBytes", free)
  }

  fun release(token: String) {
    picked.remove(token)
  }

  /**
   * Copy the picked file to `partial`. Answers `copied`, `cancelled`,
   * `no-space` or `failed` and the bytes written. Whatever is not `copied`
   * leaves no file behind.
   */
  fun copy(context: Context, token: String, partial: String, progress: (Long) -> Unit): Pair<String, Long> {
    val uri = picked.remove(token) ?: return Pair("failed", 0L)
    val target = File(partial)
    val input = try {
      context.contentResolver.openInputStream(uri)
    } catch (e: Exception) {
      warn("the file could not be opened: ${e.javaClass.simpleName}")
      null
    } ?: return Pair("failed", 0L)
    return copyStream(input, target, progress)
  }

  /**
   * The copy itself, from a stream to a file. Apart from `copy` so that it
   * is tested without a device (ModelImportTest). Closes `source`.
   */
  fun copyStream(source: InputStream, target: File, progress: (Long) -> Unit): Pair<String, Long> {
    var written = 0L
    var status = "failed"
    try {
      source.use { input ->
        // Asked before the file is even created: a Cancel that came while the
        // file was picked ends here, with nothing written.
        if (cancel) {
          status = "cancelled"
          return@use
        }
        target.parentFile?.mkdirs()
        FileOutputStream(target).use { out ->
          val buffer = ByteArray(BUFFER_BYTES)
          var lastProgress = 0L
          while (true) {
            if (cancel) {
              status = "cancelled"
              break
            }
            val n = input.read(buffer)
            if (n < 0) {
              status = "copied"
              break
            }
            out.write(buffer, 0, n)
            written += n
            val now = System.currentTimeMillis()
            if (now - lastProgress >= PROGRESS_EVERY_MS) {
              lastProgress = now
              progress(written)
            }
          }
          if (status == "copied") {
            out.flush()
            // On disk before the name changes: a model that is half there after a crash loads as garbage.
            out.fd.sync()
          }
        }
      }
    } catch (e: IOException) {
      status = if (isNoSpace(e)) "no-space" else "failed"
      warn("copy ended after $written bytes: ${e.javaClass.simpleName} ${e.message}")
    } catch (e: Exception) {
      status = "failed"
      warn("copy ended after $written bytes: ${e.javaClass.simpleName}")
    }
    if (status == "copied") progress(written) else target.delete()
    return Pair(status, written)
  }

  /** The system log, and silence where there is none (a test on the build machine). */
  private fun warn(text: String) {
    try {
      Log.w(TAG, text)
    } catch (_: Throwable) {}
  }
}
