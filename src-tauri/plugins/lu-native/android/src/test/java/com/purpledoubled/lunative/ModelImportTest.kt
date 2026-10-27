package com.purpledoubled.lunative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files

// The copy of a model file the user picked (ModelImport.kt), without a
// device. Run from src-tauri/gen/android:
//   ./gradlew :tauri-plugin-lu-native:testDebugUnitTest
//
// Finding 12 of the review of round 6 was a guess: "a Cancel that arrives
// between the pick and the start of the copy is lost". The first test is the
// proof. Before the fix the copy cleared the flag as its first step, so this
// very sequence copied the whole file and answered "copied".
class ModelImportTest {
  private fun folder(): File = Files.createTempDirectory("lu-import-test").toFile()

  private fun model(bytes: Int): ByteArray {
    val body = ByteArray(bytes) { 7 }
    "GGUF".toByteArray().copyInto(body)
    return body
  }

  @Test
  fun aCancelThatArrivesBeforeTheCopyBeginsIsNotLost() {
    val dir = folder()
    val target = File(dir, "m.import")
    // importPick: the import begins.
    ModelImport.begin()
    // The user taps Cancel while the file is still being judged.
    ModelImport.cancel = true
    // importCopy starts.
    var progressed = false
    val (status, bytes) = ModelImport.copyStream(ByteArrayInputStream(model(3 * 1024 * 1024)), target) { progressed = true }
    assertEquals("cancelled", status)
    assertEquals(0L, bytes)
    assertFalse("nothing may be left behind", target.exists())
    assertFalse(progressed)
    dir.deleteRecursively()
  }

  @Test
  fun aCancelFromAnEarlierImportDoesNotStopTheNextOne() {
    val dir = folder()
    val target = File(dir, "m.import")
    // Cancel was tapped after the last import had ended already.
    ModelImport.cancel = true
    // The next import begins with the picker.
    ModelImport.begin()
    val body = model(2 * 1024 * 1024 + 17)
    var last = 0L
    val (status, bytes) = ModelImport.copyStream(ByteArrayInputStream(body), target) { last = it }
    assertEquals("copied", status)
    assertEquals(body.size.toLong(), bytes)
    assertEquals(body.size.toLong(), last)
    assertTrue(target.readBytes().contentEquals(body))
    dir.deleteRecursively()
  }

  @Test
  fun aCancelInTheMiddleEndsTheCopyAndRemovesTheHalfFile() {
    val dir = folder()
    val target = File(dir, "m.import")
    ModelImport.begin()
    // A source that hands out one megabyte at a time and cancels after the second.
    val source = object : InputStream() {
      var reads = 0
      override fun read(): Int = throw IOException("not used")
      override fun read(b: ByteArray, off: Int, len: Int): Int {
        reads += 1
        if (reads == 3) ModelImport.cancel = true
        if (reads > 50) return -1
        b.fill(1, off, off + len)
        return len
      }
    }
    val (status, bytes) = ModelImport.copyStream(source, target) {}
    assertEquals("cancelled", status)
    assertTrue("stopped between two pieces: $bytes", bytes in 1 until 50L * 1024 * 1024)
    assertFalse(target.exists())
    ModelImport.begin()
    dir.deleteRecursively()
  }

  @Test
  fun aSourceThatBreaksLeavesNoFileAndAFullDiskIsNamed() {
    val dir = folder()
    val target = File(dir, "m.import")
    ModelImport.begin()
    val broken = object : InputStream() {
      var reads = 0
      override fun read(): Int = throw IOException("not used")
      override fun read(b: ByteArray, off: Int, len: Int): Int {
        reads += 1
        if (reads > 1) throw IOException("the provider went away")
        return len
      }
    }
    assertEquals("failed", ModelImport.copyStream(broken, target) {}.first)
    assertFalse(target.exists())
    val full = object : InputStream() {
      override fun read(): Int = throw IOException("not used")
      override fun read(b: ByteArray, off: Int, len: Int): Int = throw IOException("write failed: ENOSPC (No space left on device)")
    }
    assertEquals("no-space", ModelImport.copyStream(full, target) {}.first)
    assertFalse(target.exists())
    dir.deleteRecursively()
  }
}
