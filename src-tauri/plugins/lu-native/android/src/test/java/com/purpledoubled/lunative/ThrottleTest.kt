package com.purpledoubled.lunative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// The pacing of the speed limit (Throttle.kt), with a clock of its own, in
// microseconds. Run from src-tauri/gen/android:
//   ./gradlew :tauri-plugin-lu-native:testDebugUnitTest
class ThrottleTest {
  private val mib = 1024.0 * 1024.0
  private val limit = 1_000_000L
  private val start = 5_000_000L

  /** How long a line of `lineBps` takes for one piece, in microseconds. */
  private fun readUs(piece: Long, lineBps: Long): Long = piece * 1_000_000 / lineBps

  /**
   * One transfer as DownloadEngine runs it: read a piece (takes `readUs`),
   * ask for the wait, sleep it (the sleep overshoots by `lateUs`). Returns
   * bytes per second over `seconds` of the clock.
   */
  private fun run(piece: Long, readUs: Long, lateUs: Long = 0L, seconds: Long = 60L): Double {
    var now = start
    var slotEnd = 0L
    var bytes = 0L
    while (now - start < seconds * 1_000_000) {
      now += readUs
      bytes += piece
      val (slot, waitMs) = Throttle.step(slotEnd, limit, piece, now)
      slotEnd = slot
      if (waitMs > 0) now += waitMs * 1000 + lateUs
    }
    // The first piece meets an idle line and is not paced, it is left out of the rate.
    return (bytes - piece) * 1_000_000.0 / (now - start)
  }

  @Test
  fun aLimitOfOneMegabyteDeliversItsName() {
    // Under 1 MB/s DownloadEngine asks for its whole buffer of 128 KiB, a socket usually hands out 8 or 16 KiB.
    for (piece in listOf(128L * 1024, 64L * 1024, 16L * 1024, 8L * 1024, 1460L)) {
      // The line of the acceptance run did 4.4 MB/s. Faster and slower lines next to it, all above the limit.
      for (lineBps in listOf(4_400_000L, 2_000_000L, 20_000_000L, 1_200_000L)) {
        // A sleep on a phone ends late, by a fraction of a millisecond up to a few.
        for (lateUs in listOf(0L, 300L, 1_000L, 3_000L)) {
          val rate = run(piece, readUs(piece, lineBps), lateUs)
          val text = "piece $piece, line $lineBps, late $lateUs: ${rate / mib} MiB/s"
          assertTrue(text, rate / mib >= 0.93)
          assertTrue(text, rate / mib <= 1.0)
          assertTrue("never above the limit, $text", rate <= limit * 1.001)
        }
      }
    }
  }

  @Test
  fun countedFromNowItIsWhatTheAcceptanceRunMeasured() {
    // The pacing before the fix: every piece waits its whole cost after the read. On the line of the
    // acceptance run that is 1 / (1 + 1 / 4.4) of the limit. Kept as the proof that the clock of this
    // test shows the fault the device showed (0.76 MiB/s).
    val piece = 128L * 1024
    val read = readUs(piece, 4_400_000L)
    var now = start
    var bytes = 0L
    while (now - start < 60_000_000L) {
      now += read
      bytes += piece
      now += Throttle.costUs(limit, piece)
    }
    val rate = bytes * 1_000_000.0 / (now - start) / mib
    assertTrue("$rate", rate > 0.74 && rate < 0.80)
  }

  @Test
  fun aLineSlowerThanTheLimitNeverWaits() {
    for (lineBps in listOf(330_000L, 900_000L, 990_000L)) {
      val piece = 16L * 1024
      var now = start
      var slotEnd = 0L
      repeat(5_000) {
        now += readUs(piece, lineBps)
        val (slot, wait) = Throttle.step(slotEnd, limit, piece, now)
        slotEnd = slot
        assertEquals("line $lineBps, piece $it", 0L, wait)
      }
    }
  }

  @Test
  fun aPauseNeverTurnsIntoABurst() {
    val piece = 128L * 1024
    var now = start
    var slotEnd = Throttle.step(0L, limit, piece, now).first
    // Ten seconds of silence (paused, no network). Afterwards the line reads as fast as it can.
    now += 10_000_000
    val from = now
    var bytes = 0L
    while (now - from < 2_000_000) {
      now += 1_000
      bytes += piece
      val (slot, waitMs) = Throttle.step(slotEnd, limit, piece, now)
      slotEnd = slot
      now += waitMs * 1000
    }
    // The first piece after the pause is paid by the pause, everything after it by the limit.
    assertTrue("$bytes bytes in ${now - from} us", (bytes - piece) * 1_000_000.0 / (now - from) <= limit * 1.001)
  }

  @Test
  fun whatIsCaughtUpIsAtMostHalfASecondOfTheLimit() {
    val piece = 128L * 1024
    val cost = Throttle.costUs(limit, piece)
    assertEquals(131_072L, cost)
    val slotEnd = start
    // Exactly at the edge the slot still counts, one microsecond later the line starts from now.
    val edge = slotEnd + Throttle.CATCH_UP_US
    assertEquals(Pair(slotEnd + cost, 0L), Throttle.step(slotEnd, limit, piece, edge))
    assertEquals(Pair(edge + 1, 0L), Throttle.step(slotEnd, limit, piece, edge + 1))
    // A line that stalls for 400 ms and then delivers what piled up: no wait until the slot has caught up.
    var now = slotEnd + 400_000
    var end = slotEnd
    var free = 0
    while (true) {
      val (slot, wait) = Throttle.step(end, limit, piece, now)
      end = slot
      if (wait > 0) break
      free += 1
      now += 1_000
    }
    assertTrue("$free pieces", free in 3..4)
  }

  @Test
  fun twoTransfersShareTheLimit() {
    // Two workers, each reads a piece (15 ms) and waits for the shared slot.
    val piece = 64L * 1024
    val next = longArrayOf(start, start + 10_000)
    var slotEnd = 0L
    var bytes = 0L
    var last = start
    while (last - start < 60_000_000L) {
      val w = if (next[0] <= next[1]) 0 else 1
      val now = next[w] + 15_000
      bytes += piece
      val (slot, waitMs) = Throttle.step(slotEnd, limit, piece, now)
      slotEnd = slot
      next[w] = now + waitMs * 1000
      last = next[w]
    }
    val rate = (bytes - piece) * 1_000_000.0 / (last - start)
    assertTrue("$rate", rate <= limit * 1.001 && rate / mib >= 0.93)
  }

  @Test
  fun theWaitIsRoundedUpToAMillisecond() {
    // 8 KiB under 1 MB/s cost 8192 us. Read in 1 ms, 7192 us are left: 8 ms of sleep, never 7.
    val slotEnd = start
    assertEquals(Pair(slotEnd + 8_192, 8L), Throttle.step(slotEnd, limit, 8_192, slotEnd + 1_000))
  }

  @Test
  fun withoutALimitNothingWaits() {
    assertEquals(Pair(0L, 0L), Throttle.step(123L, 0L, 4096L, 1_000L))
  }
}
