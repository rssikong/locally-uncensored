// The LU Cloud outage line (3.0.8, A28). The server says whether LU Cloud has
// an outage at GET /api/app/status, switched by hand while one lasts. The app
// asks while somebody is signed in to LU Cloud: at start, every three minutes
// and right after a cloud request failed. While the answer says active, a
// line under the header carries the server's sentence, and a cloud request
// that fails reads that sentence instead of the raw error.
//
// Nobody signed in is never asked about, a purely local app does not call
// home for a line it would never show. An answer that does not come, a 404
// (a server without the route) or a body of the wrong shape all mean "no
// outage known": the app stays as it was.

/** How often a signed in app asks. */
export const OUTAGE_POLL_MS = 3 * 60 * 1000

/** After a failure the answer is awaited this long before the error is shown,
 *  so the very first failed request of an outage already reads the sentence. */
export const OUTAGE_WAIT_MS = 2_500

/** Two failures within this gap ask once. The answer is cached for thirty
 *  seconds on the server's side anyway. */
export const OUTAGE_MIN_GAP_MS = 15_000

/** The app prints the text as it comes, a broken value must not fill the window. */
export const OUTAGE_MESSAGE_MAX = 300

/** Said when the server switched the line on but sent no sentence. */
export const OUTAGE_FALLBACK =
  'LU Cloud is having trouble right now. Local models keep working. Your credits are safe, failed cloud requests are not charged. Please try again later.'

export interface CloudOutage {
  active: boolean
  message: string | null
}

/** The desktop half of the answer, or null for anything that is not one. */
export function parseAppStatus(body: unknown): CloudOutage | null {
  if (!body || typeof body !== 'object') return null
  const desktop = (body as { desktop?: unknown }).desktop
  if (!desktop || typeof desktop !== 'object') return null
  const { active, message } = desktop as { active?: unknown; message?: unknown }
  if (typeof active !== 'boolean') return null
  if (!active) return { active: false, message: null }
  // eslint-disable-next-line no-control-regex
  const text = typeof message === 'string' ? message.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : ''
  const clipped = text.length > OUTAGE_MESSAGE_MAX ? `${text.slice(0, OUTAGE_MESSAGE_MAX - 1).trimEnd()}…` : text
  return { active: true, message: clipped || OUTAGE_FALLBACK }
}

// The codes and statuses that already carry their own sentence, or are the
// person's to fix: a session that ended, an empty wallet, a throttle, a price
// that moved, a prompt the server refused. An outage does not change them.
const OWN_SENTENCE_CODES = new Set([
  'signed_out', 'auth', 'credits_exhausted', 'video_budget_exhausted', 'trainings_exhausted',
  'rate_limit', 'quote_changed', 'tools_unsupported', 'flash_timeout', 'stalled_runaway',
])
const OWN_SENTENCE_STATUS = new Set([400, 401, 402, 404, 409, 413, 422, 429])

/** Whether a failed cloud request may read as the outage: the server or the
 *  way to it failed, not the request. A cancelled request never does. */
export function failureMayBeOutage(err: unknown): boolean {
  if (err == null) return false
  const e = err as { name?: unknown; code?: unknown; status?: unknown; message?: unknown }
  if (e.name === 'AbortError') return false
  if (typeof e.message === 'string' && /^(polling aborted|aborted)$/i.test(e.message)) return false
  if (typeof e.code === 'string' && OWN_SENTENCE_CODES.has(e.code)) return false
  if (typeof e.status === 'number' && OWN_SENTENCE_STATUS.has(e.status)) return false
  return true
}
