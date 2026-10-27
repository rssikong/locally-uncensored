/**
 * How long a model thought before it answered.
 *
 * A send feeds the clock what has arrived so far, after every chunk. The
 * clock starts with the first thought and stops with the first word of the
 * answer, or with the end of the stream when no answer came. It reports
 * once. A run without thoughts reports nothing.
 */
export interface ThinkingClock {
  /** Call after every chunk with the thoughts and the answer text so far. */
  tick: (thinking: string, content: string) => void
  /** Call when the stream is over. */
  end: () => void
}

export function thinkingClock(report: (ms: number) => void, now: () => number = Date.now): ThinkingClock {
  let startedAt: number | null = null
  let done = false
  const finish = () => {
    if (done || startedAt === null) return
    done = true
    report(Math.max(0, now() - startedAt))
  }
  return {
    tick: (thinking, content) => {
      if (done) return
      if (startedAt === null) {
        if (!thinking) return
        startedAt = now()
      }
      if (content.trim()) finish()
    },
    end: finish,
  }
}

/** "4 s", "1 min 12 s". Whole seconds, never "0 s" for a thought that happened. */
export function formatThinkingTime(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000))
  if (total < 60) return `${total} s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`
}
