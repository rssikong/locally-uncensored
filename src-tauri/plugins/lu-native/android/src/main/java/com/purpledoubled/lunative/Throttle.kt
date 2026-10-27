package com.purpledoubled.lunative

/**
 * The pacing of the speed limit of Settings. Pure, the clock is handed in,
 * so it is tested without a device (ThrottleTest). DownloadEngine keeps the
 * shared slot and does the sleeping.
 *
 * The rule is the one of `throttle_wait` in src/download.rs (every piece
 * books its share of the line behind the last one), with two corrections the
 * acceptance run on Android asked for (re-run, N7: "1 MB/s" delivered 0.76
 * MiB/s):
 *
 * 1. The time a read took is part of the budget, not a pause on top of it.
 *    A transfer that is at most CATCH_UP_US behind the end of its slot books
 *    from that end, not from now. A transfer that is further behind (a
 *    pause, or a line slower than the limit) has paid for this piece by
 *    waiting: it reads on at once, and nothing older is caught up, so a
 *    pause never turns into a burst.
 * 2. The slot is kept in microseconds. A socket hands out pieces of 8 to 16
 *    KiB, and rounding each of them up to a whole millisecond cost up to 9
 *    percent of the limit.
 */
internal object Throttle {
  /** How far a transfer may lag behind its slot and still count as running. Half a second of the limit at most is caught up. */
  const val CATCH_UP_US = 500_000L

  /** What these bytes cost under the limit, in microseconds, rounded up. */
  fun costUs(limit: Long, bytes: Long): Long = (bytes * 1_000_000 + limit - 1) / limit

  /**
   * One piece of `bytes` that arrived at `nowUs`: the new end of the shared
   * slot in microseconds and the wait before the next read in milliseconds
   * (rounded up, the overshoot is caught up by the next piece).
   */
  fun step(slotEndUs: Long, limit: Long, bytes: Long, nowUs: Long): Pair<Long, Long> {
    if (limit <= 0) return Pair(0L, 0L)
    val cost = costUs(limit, bytes)
    val behind = nowUs - slotEndUs
    val slot = when {
      // The line is booked beyond now (another transfer shares it): queue behind.
      behind <= 0L -> slotEndUs + cost
      // Running: the read was part of the budget.
      slotEndUs > 0L && behind <= CATCH_UP_US -> slotEndUs + cost
      // Idle or slower than the limit: paid by the time that passed.
      else -> nowUs
    }
    return Pair(slot, if (slot > nowUs) (slot - nowUs + 999) / 1000 else 0L)
  }
}
