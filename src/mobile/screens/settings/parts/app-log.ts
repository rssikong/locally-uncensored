/**
 * The log file of the app, for "Share log" (E19.2) and for the row "Last
 * unexpected end".
 *
 * The native layer writes a rolling log file and keeps a record of the last
 * crash. Its bridge (src/lib/lu-native.ts) reads the end of both back:
 * `readLogTail()` and `logTailAsText()`. This file reaches them through the
 * platform seam, which knows whether the bridge is in this build, and turns
 * "no bridge", "no such command" and "the read failed" into one answer:
 * null. A screen then shares what it has without the file and says so.
 */
import { nativeBridge } from '../../../platform'

export interface AppLogTail {
  /** Name of the log file, empty when nothing was logged yet. */
  file: string
  /** The last lines, oldest first. */
  text: string
  lineCount: number
  /** True when the file holds more than `text`. */
  truncated: boolean
  /** The newest record of an unexpected end of the app, or null. */
  lastCrash: string | null
}

/** How many lines of the log go into a shared file. */
export const LOG_TAIL_LINES = 400

/** The two functions of the bridge this file uses. Both optional: an older bridge has neither. */
interface LogBridge {
  readLogTail?: (maxLines?: number) => Promise<unknown>
  logTailAsText?: (tail: AppLogTail) => string
}

/** Pure: what the bridge answered, in the shape above, or null when it is not a log tail. */
export function parseLogTail(raw: unknown): AppLogTail | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.text !== 'string') return null
  const lines = typeof r.lineCount === 'number' && Number.isFinite(r.lineCount) ? r.lineCount : r.text ? r.text.split('\n').length : 0
  return {
    file: typeof r.file === 'string' ? r.file : '',
    text: r.text,
    lineCount: lines,
    truncated: r.truncated === true,
    lastCrash: typeof r.lastCrash === 'string' && r.lastCrash.trim() ? r.lastCrash : null,
  }
}

/** Pure: one text of a log tail, as the bridge words it. Used when the bridge has no wording of its own. */
export function logTailText(tail: AppLogTail): string {
  const parts: string[] = []
  if (tail.lastCrash) parts.push(`Last crash:\n${tail.lastCrash}`)
  parts.push(tail.text ? `Log (${tail.file}, last ${tail.lineCount} lines):\n${tail.text}` : 'The log is empty.')
  return parts.join('\n\n') + '\n'
}

export interface AppLog {
  tail: AppLogTail
  /** The tail as one text: the crash record first, then the log lines. */
  text: string
}

/** Read the end of the app log. Null where it cannot be read (a browser, a build without the command). Never throws. */
export async function readAppLog(maxLines: number = LOG_TAIL_LINES): Promise<AppLog | null> {
  try {
    const bridge = (await nativeBridge()) as LogBridge | null
    if (!bridge || typeof bridge.readLogTail !== 'function') return null
    const tail = parseLogTail(await bridge.readLogTail(maxLines))
    if (!tail) return null
    let text: string
    try {
      text = typeof bridge.logTailAsText === 'function' ? bridge.logTailAsText(tail) : logTailText(tail)
    } catch {
      text = logTailText(tail)
    }
    return { tail, text }
  } catch {
    return null
  }
}

/** Pure: the first line of a crash record, short enough for a row. */
export function crashHeadline(lastCrash: string | null | undefined): string | null {
  const first = (lastCrash ?? '').split('\n').map((l) => l.trim()).find(Boolean)
  if (!first) return null
  return first.length > 120 ? `${first.slice(0, 117)}...` : first
}
