/**
 * Retry for the one class of failure a second attempt actually fixes: the
 * server said "not now".
 *
 * Today a 429 or a 503 reaches the user as the raw status line, even though
 * nothing is wrong with the request — a burst limiter is holding the door for
 * a second or a gateway is between upstreams. Retrying that is free; retrying
 * anything else is not, so the rules are narrow on purpose:
 *
 *  - Only the transient statuses below. A 4xx that describes the request is
 *    deterministic and must surface immediately.
 *  - Only around the REQUEST, never around a body loop. Once bytes are
 *    flowing a retry would replay half an answer, so this wraps the call that
 *    produces the Response and hands the untouched Response straight back the
 *    moment the status is not retryable. The stream is consumed by the caller,
 *    after this returns.
 *  - Abortable. Stop during a backoff ends the wait and the walk.
 *
 * Deliberately capped short: the agent loop already has its own retry ladder
 * (lib/http-status retryDelayMs + useAgentChat's announceWait) which can sit
 * out a full minute BECAUSE it tells the user it is waiting. Nothing here can
 * say anything, so a wait longer than MAX_SILENT_RETRY_WAIT_MS is worse than
 * the honest error — we return the refusal and let the layer that can speak
 * decide.
 */

import { parseRetryAfter } from '../../lib/http-status'
import { FIRST_REPLY_TIMEOUT } from '../../lib/chat-reply-timeout'

/** Throttles and gateway hiccups. Everything else is the server's verdict on
 *  the request itself and gets exactly one attempt. */
const TRANSIENT_STATUS = new Set([429, 502, 503, 504])

/** Total attempts, i.e. the first try plus two retries. */
export const MAX_TRANSIENT_ATTEMPTS = 3

/** Longest backoff a single send may sit through without being able to say so. */
export const MAX_SILENT_RETRY_WAIT_MS = 10_000

/** Backoff when the server named no `Retry-After`: 500 ms, then 1 s. */
function backoffMs(attempt: number): number {
  return 500 * 2 ** (attempt - 1)
}

/** Sleep that ends early when the caller aborts, so Stop is never queued
 *  behind a backoff. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) { resolve(); return }
    let onAbort: (() => void) | null = null
    const timer = setTimeout(() => { finish() }, ms)
    const finish = () => {
      clearTimeout(timer)
      if (signal && onAbort) signal.removeEventListener('abort', onAbort)
      resolve()
    }
    if (signal) {
      onAbort = () => finish()
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/**
 * An empty wallet also answers 429, and no amount of waiting refills it. The
 * body says which one it is (`credits_exhausted`, see lib/http-status), and
 * getting that wrong is what once made a dead run look like four more seconds
 * of work. Peeked on a clone so the caller still gets an unread body.
 */
async function isPermanent429(res: Response): Promise<boolean> {
  if (res.status !== 429) return false
  try {
    return /credits_exhausted/.test(await res.clone().text())
  } catch {
    return false
  }
}

/**
 * R5-53: a 504 carrying `code: 'flash_timeout'` means the free-tier request
 * already sat out its own four-minute hard deadline (see the server's
 * `abortedResponse` in app/api/inference/v1/chat/completions/route.ts).
 * Retrying reruns the same request against the same deadline and produces
 * the identical timeout every time. This is the 504 twin of
 * `isPermanent429` above, not a transient gateway hiccup a second attempt
 * could fix.
 */
async function isPermanentFlashTimeout(res: Response): Promise<boolean> {
  if (res.status !== 504) return false
  try {
    // Issue 177: the first reply window of a local server is the same kind
    // of spent deadline. api/backend.ts answers it with a 504 and this code.
    const body = await res.clone().text()
    return /flash_timeout/.test(body) || body.includes(FIRST_REPLY_TIMEOUT)
  } catch {
    return false
  }
}

export interface TransientRetryOptions {
  signal?: AbortSignal
  /** Total attempts including the first. Defaults to MAX_TRANSIENT_ATTEMPTS. */
  attempts?: number
  /** Seam for tests — swapped for a fake clock so a retry test does not
   *  actually sleep. */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/**
 * Run `send` and retry it while the answer is a transient refusal.
 *
 * `send` must be idempotent — it is, for every call site: a chat completion
 * that was refused produced nothing, so re-posting the identical body is the
 * same request, not a second one.
 */
export async function sendWithTransientRetry(
  send: () => Promise<Response>,
  opts?: TransientRetryOptions,
): Promise<Response> {
  const attempts = opts?.attempts ?? MAX_TRANSIENT_ATTEMPTS
  const wait = opts?.wait ?? sleep

  let res = await send()

  for (let attempt = 1; attempt < attempts; attempt++) {
    if (!TRANSIENT_STATUS.has(res.status)) return res
    if (opts?.signal?.aborted) return res
    if (await isPermanent429(res)) return res
    if (await isPermanentFlashTimeout(res)) return res

    // The server's own number wins — a fixed-window limiter refuses again for
    // the whole window, so guessing shorter just burns an attempt inside it.
    const asked = parseRetryAfter(res)
    const delay = asked ?? backoffMs(attempt)
    if (delay > MAX_SILENT_RETRY_WAIT_MS) return res

    await wait(delay, opts?.signal)
    if (opts?.signal?.aborted) return res

    res = await send()
  }

  return res
}
