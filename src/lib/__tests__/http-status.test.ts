// The retry guard reads the status off whichever field the transport used.
//
// Morgan, 2026-08-10: an out-of-credits agent run "was still cycling". It was
// not. The guard "never retry a deterministic 4xx" read `statusCode`, which
// only the Ollama path sets, so on the cloud path (ProviderError, `.status`)
// the refusal fell through to the transient branch and was retried twice with
// 1.5 s and 3 s of backoff before anything reached the screen.
import { describe, it, expect } from 'vitest'
import { httpStatusOf, isTerminalModelError } from '../http-status'
import { ProviderError } from '../../api/providers/types'

describe('httpStatusOf', () => {
  it('reads the cloud transport, which carries `status` (ProviderError)', () => {
    expect(httpStatusOf(new ProviderError('out of credits', 'openai', 'credits_exhausted', 429))).toBe(429)
  })

  it('reads the Ollama transport, which carries `statusCode`', () => {
    expect(httpStatusOf(Object.assign(new Error('HTTP 400: nope'), { statusCode: 400 }))).toBe(400)
  })

  it('is 0 for everything that carries no status at all', () => {
    for (const e of [null, undefined, 'boom', new Error('Failed to fetch'), {}, { status: '429' }, { status: Number.NaN }]) {
      expect(httpStatusOf(e)).toBe(0)
    }
  })
})

describe('isTerminalModelError', () => {
  it('an empty wallet is terminal, whatever the status says', () => {
    expect(isTerminalModelError(new ProviderError('out of credits', 'openai', 'credits_exhausted', 429))).toBe(true)
  })

  it('REGRESSION: the same refusal was NOT terminal while the guard read statusCode', () => {
    // The exact object the cloud path threw. Reading `statusCode` alone yields
    // undefined, so the old rule classified it as transient and retried it.
    const err = new ProviderError('out of credits', 'openai', 'credits_exhausted', 429)
    expect((err as unknown as { statusCode?: number }).statusCode).toBeUndefined()
    expect(isTerminalModelError(err)).toBe(true)
  })

  it('a deterministic 4xx is terminal on both transports', () => {
    expect(isTerminalModelError(new ProviderError('context overflow', 'openai', undefined, 400))).toBe(true)
    expect(isTerminalModelError(Object.assign(new Error('x'), { statusCode: 404 }))).toBe(true)
    expect(isTerminalModelError(new ProviderError('bad key', 'openai', 'auth', 401))).toBe(true)
  })

  it('NEGATIVE CONTROL: a throttle is NOT terminal, so a burst still retries', () => {
    // LU Cloud answers 429 for three things. Two of them (the per-user burst
    // guard and an upstream provider throttle) pass retry-after and clear on
    // their own; only the empty wallet is final. Treating every 429 as
    // terminal would turn a two-second wait into a failed run.
    expect(isTerminalModelError(new ProviderError('too many requests', 'openai', 'rate_limit', 429))).toBe(false)
    expect(isTerminalModelError(Object.assign(new Error('rate limited'), { statusCode: 429 }))).toBe(false)
  })

  it('server trouble and network trouble stay retryable', () => {
    expect(isTerminalModelError(new ProviderError('bad gateway', 'openai', undefined, 502))).toBe(false)
    expect(isTerminalModelError(new ProviderError('overloaded', 'anthropic', undefined, 529))).toBe(false)
    expect(isTerminalModelError(new Error('Failed to fetch'))).toBe(false)
  })
})

// ── a lapsed cloud session is not a dead end (review 2026-08-14) ────────────
//
// LU Cloud's bearer is a Supabase access token that lives about an hour, and
// LuCloudProvider.delegate() re-mints it on EVERY call. So a 401 an hour into
// an agent run usually means the token aged out between two steps, and the
// next attempt already carries a fresh one. Ending the run there threw away
// the only thing that would have fixed it, and told a signed-in user either
// "unauthenticated" or "Invalid API key, check Settings > Providers" for a
// provider with no API key field. api/cloud/jobs.ts exempts 401 and 408 on the
// same cloud for the same reason.
describe('401 depends on whose credential it is', () => {
  it('a lapsed LU Cloud token is retried, which is what re-mints it', () => {
    expect(isTerminalModelError(new ProviderError('unauthenticated', 'lu-cloud', 'auth', 401))).toBe(false)
  })

  it('but a wrong API key on a configured provider still stops at once', () => {
    expect(isTerminalModelError(new ProviderError('bad key', 'openai', 'auth', 401))).toBe(true)
    expect(isTerminalModelError(new ProviderError('bad key', 'anthropic', 'auth', 401))).toBe(true)
    expect(isTerminalModelError(Object.assign(new Error('nope'), { statusCode: 401 }))).toBe(true)
  })

  it('really signed out IS terminal, so the dead end costs one backoff, not three', () => {
    // What delegate() throws when getAccessToken() comes back empty: there is
    // no session left to refresh, so retrying only delays the true message.
    expect(isTerminalModelError(
      new ProviderError('Sign in to your LU Cloud account to chat in the cloud.', 'lu-cloud', 'signed_out', 401),
    )).toBe(true)
  })

  it('a 403 from the cloud stays terminal, it is not about a stale token', () => {
    expect(isTerminalModelError(new ProviderError('closed beta', 'lu-cloud', 'auth', 403))).toBe(true)
  })

  it('a request timeout is worth another try on any provider', () => {
    expect(isTerminalModelError(new ProviderError('request timeout', 'openai', undefined, 408))).toBe(false)
    expect(isTerminalModelError(Object.assign(new Error('timeout'), { statusCode: 408 }))).toBe(false)
  })
})

// ── R5-53: a 504 with code 'flash_timeout' is a hard four-minute deadline ───
//
// Without this, `status >= 400 && status < 500` is false for a 504, so
// isTerminalModelError fell through to "not terminal" and the connRetries
// ladder in useAgentChat.ts repeated the same request up to three times.
// The server had already spent its own four-minute deadline once, so three
// attempts meant twelve silent minutes before the run gave up.
describe('R5-53: flash_timeout is terminal like credits_exhausted', () => {
  it('a 504 carrying code: flash_timeout is terminal', () => {
    expect(isTerminalModelError(new ProviderError(
      'The free chat request reached its four-minute limit. Please retry.',
      'lu-cloud', 'flash_timeout', 504,
    ))).toBe(true)
  })

  it('issue 177: a first reply timeout is terminal, another try waits the window again', () => {
    expect(isTerminalModelError(new ProviderError(
      'the backend accepted the request but sent nothing for 30 s.',
      'openai', 'first_reply_timeout', 504,
    ))).toBe(true)
  })

  it('NEGATIVE CONTROL: a 504 WITHOUT that code is still retried', () => {
    expect(isTerminalModelError(new ProviderError('bad gateway', 'lu-cloud', undefined, 504))).toBe(false)
    expect(isTerminalModelError(Object.assign(new Error('gateway timeout'), { statusCode: 504 }))).toBe(false)
  })
})
