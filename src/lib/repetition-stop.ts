/** Bound a broken local decoder's question-mark run across stream chunks.
 * This stops generation; it never rewrites the model's answer or guesses its language.
 */
export class RepetitionStop {
  private run = 0

  push(text: string): boolean {
    for (const char of text) {
      this.run = char === '?' ? this.run + 1 : 0
      if (this.run >= 256) return true
    }
    return false
  }
}

/**
 * Bound a small local model that fell into a loop: the same passage, written
 * again and again until the user presses Stop.
 *
 * Seen on a phone (acceptance Android, re-run, N4): Qwen 3.5 2B in its
 * smallest packing, asked to search the web, invented a list of search
 * results and repeated it for six minutes. The question-mark rule above does
 * not see that, and the loop guard of the agent (lib/agent-loop-guard.ts)
 * only looks at whole rounds: inside ONE answer nothing counted.
 *
 * What counts as a loop: the end of the text is one passage repeated without
 * anything else in between. Whitespace is ignored, so a loop that differs
 * only in line breaks is one. A passage of at least MIN_PERIOD characters has
 * to stand five times in a row and fill MIN_SPAN characters. A shorter
 * pattern ("ha ha ha", a row of dashes) has to fill SHORT_SPAN, because a
 * ruler line or a laugh is ordinary text. A list whose lines differ (a
 * count, a table with different rows) is never periodic and never stopped.
 *
 * Like the rule above this only stops the generation. It never rewrites what
 * the model wrote.
 */
export class LoopStop {
  /** A passage this long or longer counts with MIN_SPAN. */
  static readonly MIN_PERIOD = 12
  /** The longest passage that is looked for. */
  static readonly MAX_PERIOD = 600
  /** How often a passage has to stand in a row. */
  static readonly MIN_REPEATS = 5
  /** Characters a repeated passage has to fill, whitespace not counted. */
  static readonly MIN_SPAN = 1000
  /** The same for a pattern shorter than MIN_PERIOD. */
  static readonly SHORT_SPAN = 2000
  /** Characters kept for the look back. */
  private static readonly KEEP = LoopStop.MAX_PERIOD * LoopStop.MIN_REPEATS + 200
  /** New characters between two looks. */
  private static readonly EVERY = 96

  private tail = ''
  private sinceCheck = 0
  private tripped = false

  /** True once the text that came in so far ends in a loop. Stays true. */
  push(text: string): boolean {
    if (this.tripped) return true
    if (!text) return false
    const dense = text.replace(/\s+/g, '')
    if (!dense) return false
    this.tail = (this.tail + dense).slice(-LoopStop.KEEP)
    this.sinceCheck += dense.length
    if (this.sinceCheck < LoopStop.EVERY || this.tail.length < LoopStop.MIN_SPAN) return false
    this.sinceCheck = 0
    this.tripped = endsInLoop(this.tail)
    return this.tripped
  }
}

/**
 * Pure: does `text` end in one passage repeated back to back. Read from the
 * end with the prefix function: for the last m characters the shortest period
 * is m minus the longest border, in one pass over the text.
 */
export function endsInLoop(text: string): boolean {
  const n = text.length
  if (n < LoopStop.MIN_SPAN) return false
  // The text backwards, so "the end of the text" is "the start of the string".
  const at = (i: number) => text.charCodeAt(n - 1 - i)
  const border = new Int32Array(n)
  for (let i = 1; i < n; i += 1) {
    let k = border[i - 1]
    while (k > 0 && at(i) !== at(k)) k = border[k - 1]
    if (at(i) === at(k)) k += 1
    border[i] = k
    const span = i + 1
    const period = span - k
    if (period > LoopStop.MAX_PERIOD) continue
    const needed = period >= LoopStop.MIN_PERIOD ? Math.max(LoopStop.MIN_SPAN, period * LoopStop.MIN_REPEATS) : LoopStop.SHORT_SPAN
    if (span >= needed && span >= period * LoopStop.MIN_REPEATS) return true
  }
  return false
}
