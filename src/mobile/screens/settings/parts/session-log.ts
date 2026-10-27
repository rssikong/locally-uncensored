/**
 * What went wrong since the app was opened, for "Share log" (E19.2).
 *
 * The app log proper is a rolling file the native layer writes; there is no
 * command yet to read it back into the WebView (wish in
 * mobile-docs/geruest-wuensche/settings.md). Until there is, this keeps the
 * uncaught errors of the running session in memory: enough for support to
 * see what broke, never the content of a chat. Nothing is written to disk
 * and nothing leaves the phone unless the user shares the file.
 */

export interface SessionLogEntry {
  at: number
  kind: 'error' | 'rejection'
  message: string
}

export const SESSION_LOG_MAX = 100
const MESSAGE_MAX = 300

const entries: SessionLogEntry[] = []
let armed = false

/** Pure: one line of an error, cut to a safe length, without line breaks. */
export function errorLine(value: unknown): string {
  let text: string
  if (value instanceof Error) text = `${value.name}: ${value.message}`
  else if (typeof value === 'string') text = value
  else {
    try {
      text = JSON.stringify(value) ?? String(value)
    } catch {
      text = String(value)
    }
  }
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MESSAGE_MAX ? `${flat.slice(0, MESSAGE_MAX)}...` : flat
}

export function recordSessionError(kind: SessionLogEntry['kind'], value: unknown, at: number = Date.now()): void {
  entries.push({ at, kind, message: errorLine(value) })
  if (entries.length > SESSION_LOG_MAX) entries.splice(0, entries.length - SESSION_LOG_MAX)
}

export function sessionLog(): readonly SessionLogEntry[] {
  return entries
}

export function armSessionLog(): void {
  if (armed || typeof window === 'undefined') return
  armed = true
  window.addEventListener('error', (event) => recordSessionError('error', event.error ?? event.message))
  window.addEventListener('unhandledrejection', (event) => recordSessionError('rejection', event.reason))
}

/** Only for tests. */
export function __clearSessionLogForTests(): void {
  entries.length = 0
}
