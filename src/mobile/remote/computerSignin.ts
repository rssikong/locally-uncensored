/**
 * "Sign in with my computer" (PROTOKOLL 15, LU 3.0.7).
 *
 * The phone gets its OWN session of the LU account the computer is signed
 * in with. No token of the computer ever comes to the phone:
 *   1. The phone asks the computer through the sealed channel
 *      (`POST /remote-api/signin/request`). The computer asks its user
 *      ("Sign this phone in ...?", up to 2 minutes) and, on yes, fetches a
 *      one time code at lu-labs.ai that is bound to this phone's Ed25519 key.
 *   2. Rust signs that code with the phone's key (`remote_sealed_signin`,
 *      domain `lu-remote-v1/signin`). Rust signs only a code that came out
 *      of the channel, never one this file names.
 *   3. The phone redeems: `POST https://lu-labs.ai/api/device-signin/redeem`
 *      with `{code, time, signature}` and gets `{token_hash, type, plan}`.
 *   4. `verifyOtp({type: 'magiclink', token_hash})` makes the session.
 *
 * Behind the switch `SIGNIN_WITH_COMPUTER_ENABLED`, off until the web part
 * is live and David gives the go. Tested against a stand in of exactly
 * these answers. Every refusal has its own sentence.
 */
import type { DesktopChannel } from './remoteClientStore'
import { RemoteRateLimitedError } from './remoteErrors'
import { sealedErrorPinned } from './sealedChannel'

/** Off until lu-labs.ai has the routes live and David says go. */
export const SIGNIN_WITH_COMPUTER_ENABLED = false

export const FEATURE_SIGNIN = 'signin'
export const SIGNIN_REDEEM_URL = 'https://lu-labs.ai/api/device-signin/redeem'

let forced = false

function devBuild(): boolean {
  try {
    return import.meta.env.DEV === true
  } catch {
    return false
  }
}

/** Is the way switched on. Only a developer build can be talked into it, for tests. */
export function computerSigninEnabled(): boolean {
  return SIGNIN_WITH_COMPUTER_ENABLED || (devBuild() && forced)
}

/** Test seam (developer builds only): `?computer-signin=on` or a test. */
export function setComputerSigninForTests(on: boolean): void {
  if (!devBuild()) return
  forced = on
}

try {
  if (import.meta.env.DEV === true && typeof location !== 'undefined' && new URLSearchParams(location.search).get('computer-signin') === 'on') forced = true
} catch {
  /* no address to read */
}

/** Pure: show the button. */
export function computerSigninOffered(features: readonly string[], enabled: boolean = computerSigninEnabled()): boolean {
  return enabled && features.includes(FEATURE_SIGNIN)
}

export type SigninErrorCode =
  | 'denied'
  | 'desktop-signed-out'
  | 'pending'
  | 'unavailable'
  | 'not-allowed'
  | 'invalid-code'
  | 'clock'
  | 'rate-limited'
  | 'bad-request'
  | 'unreachable'
  | 'server'
  | 'off'

export class ComputerSigninError extends Error {
  readonly code: SigninErrorCode
  /** Only with 'rate-limited': seconds until asking again makes sense. */
  readonly retryAfterSeconds?: number
  constructor(code: SigninErrorCode, message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'ComputerSigninError'
    this.code = code
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds
  }
}

/** Pure: seconds of a `retry-after` (whole seconds only), 60 when missing or not readable, at most a day. */
export function retryAfterSeconds(value: unknown): number {
  const s = typeof value === 'string' && /^\s*\d{1,9}\s*$/.test(value) ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(s) && s > 0 ? Math.min(86_400, Math.ceil(s)) : 60
}

function headerOf(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) if (k.toLowerCase() === name && typeof v === 'string') return v
  return null
}

export const SIGNIN_TEXT = {
  denied: 'Sign in was not allowed on your computer.',
  desktopSignedOut: 'LU on your computer is not signed in. Sign in there first, then try again.',
  pending: 'Your computer is already asking. Answer it there.',
  unavailable: 'Your computer could not get a sign in code right now. Try again in a moment.',
  notAllowed: 'This phone is not allowed to ask your computer for that. Pair it again.',
  invalidCode: 'The sign in code is no longer valid. Try again.',
  clock: 'The clock of this phone is off. Set the date and time automatically, then try again.',
  rateLimited: (s: number) => `Too many tries. Wait ${s > 90 ? `${Math.ceil(s / 60)} minutes` : `${s} seconds`}, then try again.`,
  /** The computer asked its user too often in a short time (3 per phone, 10 in all, per 10 minutes). */
  desktopRateLimited: (s: number) => `Your computer was asked too often. Wait ${s > 90 ? `${Math.ceil(s / 60)} minutes` : `${s} seconds`}, then try again.`,
  badRequest: 'The sign in could not be read. Update LU on this phone and on your computer.',
  unreachable: 'LU Cloud cannot be reached. Check your connection and try again.',
  server: 'LU Cloud did not sign this phone in. Try again in a moment.',
  off: 'Sign in with your computer is not available in this version of the app.',
} as const

interface SigninOutcome {
  answer?: { status?: unknown; bodyBase64?: unknown; headers?: unknown }
  proof?: { code?: unknown; time?: unknown; signature?: unknown } | null
}

function decodeBody(b64: unknown): Record<string, unknown> | null {
  if (typeof b64 !== 'string' || !b64) return null
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const v: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Pure: the computer said no, as an error with its sentence. `retryAfter`: the
 * header `retry-after` of the inner answer (a 429 of the computer carries it).
 */
export function errorOfDesktopAnswer(status: number, body: Record<string, unknown> | null, retryAfter: string | null = null): ComputerSigninError {
  const code = typeof body?.error === 'string' ? body.error : ''
  if (status === 429 || code === 'rate_limited') {
    const s = retryAfterSeconds(retryAfter)
    return new ComputerSigninError('rate-limited', SIGNIN_TEXT.desktopRateLimited(s), s)
  }
  if (code === 'desktop_signed_out') return new ComputerSigninError('desktop-signed-out', SIGNIN_TEXT.desktopSignedOut)
  if (code === 'signin_pending') return new ComputerSigninError('pending', SIGNIN_TEXT.pending)
  if (code === 'signin_unavailable' || status === 502) return new ComputerSigninError('unavailable', SIGNIN_TEXT.unavailable)
  if (code === 'signin_denied') return new ComputerSigninError('denied', SIGNIN_TEXT.denied)
  if (code === 'pairing_pending' || code === 'pairing_denied' || code === 'forbidden') return new ComputerSigninError('not-allowed', SIGNIN_TEXT.notAllowed)
  if (status === 403) return new ComputerSigninError('denied', SIGNIN_TEXT.denied)
  return new ComputerSigninError('unavailable', SIGNIN_TEXT.unavailable)
}

/** Pure: lu-labs.ai said no to the redeem. */
export function errorOfRedeem(status: number, retryAfter: string | null): ComputerSigninError {
  if (status === 401) return new ComputerSigninError('invalid-code', SIGNIN_TEXT.invalidCode)
  if (status === 422) return new ComputerSigninError('clock', SIGNIN_TEXT.clock)
  if (status === 429) {
    const s = retryAfterSeconds(retryAfter)
    return new ComputerSigninError('rate-limited', SIGNIN_TEXT.rateLimited(s), s)
  }
  if (status === 400) return new ComputerSigninError('bad-request', SIGNIN_TEXT.badRequest)
  return new ComputerSigninError('server', SIGNIN_TEXT.server)
}

export interface ComputerSigninDeps {
  channel: DesktopChannel
  /** fetch of the WebView for lu-labs.ai. */
  fetch: (url: string, init: RequestInit) => Promise<Response>
  /** supabase.auth.verifyOtp of the account client. */
  verifyOtp: (args: { type: 'magiclink'; token_hash: string }) => Promise<{ error: unknown }>
  signal?: AbortSignal
  enabled?: boolean
}

/** The whole way. Resolves when the account client has the new session; throws a ComputerSigninError otherwise. */
export async function signInWithComputer(deps: ComputerSigninDeps): Promise<{ plan: string | null }> {
  if (!(deps.enabled ?? computerSigninEnabled())) throw new ComputerSigninError('off', SIGNIN_TEXT.off)
  const ch = deps.channel
  const callId = `computer-signin-${Date.now().toString(36)}`
  const onAbort = () => void ch.invoke('remote_sealed_cancel', { callId }).catch(() => {})
  deps.signal?.addEventListener('abort', onAbort, { once: true })
  let out: SigninOutcome
  try {
    out = (await ch.invoke('remote_sealed_signin', {
      baseUrl: ch.address,
      desktopId: ch.pin.desktopId,
      x25519: ch.pin.x25519,
      callId,
    })) as SigninOutcome
  } catch (err) {
    const e = sealedErrorPinned(err, (() => { try { return new URL(ch.address).protocol === 'https:' } catch { return false } })())
    if (e instanceof RemoteRateLimitedError) throw new ComputerSigninError('rate-limited', SIGNIN_TEXT.desktopRateLimited(e.retryAfterSeconds), e.retryAfterSeconds)
    throw new ComputerSigninError(e.code === 'aborted' ? 'off' : 'unreachable', e.userMessage)
  } finally {
    deps.signal?.removeEventListener('abort', onAbort)
  }
  const status = Number(out?.answer?.status)
  const proof = out?.proof
  if (status !== 200 || !proof || typeof proof.code !== 'string' || typeof proof.signature !== 'string' || typeof proof.time !== 'number') {
    throw errorOfDesktopAnswer(status, decodeBody(out?.answer?.bodyBase64), headerOf(out?.answer?.headers, 'retry-after'))
  }
  let res: Response
  try {
    res = await deps.fetch(SIGNIN_REDEEM_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: proof.code, time: proof.time, signature: proof.signature }),
      signal: deps.signal,
    })
  } catch {
    throw new ComputerSigninError('unreachable', SIGNIN_TEXT.unreachable)
  }
  if (!res.ok) throw errorOfRedeem(res.status, res.headers.get('retry-after'))
  const data = (await res.json().catch(() => null)) as { token_hash?: unknown; type?: unknown; plan?: unknown } | null
  if (!data || typeof data.token_hash !== 'string' || !data.token_hash || data.type !== 'magiclink') {
    throw new ComputerSigninError('server', SIGNIN_TEXT.server)
  }
  const { error } = await deps.verifyOtp({ type: 'magiclink', token_hash: data.token_hash })
  if (error) throw new ComputerSigninError('server', SIGNIN_TEXT.server)
  return { plan: typeof data.plan === 'string' ? data.plan : null }
}
