// Supabase auth client for the LU Cloud tier. Desktop authenticates directly
// against Supabase — email+password in-app, Google/GitHub via the system
// browser (PKCE + 127.0.0.1 loopback, see loginWithProvider) — and the
// resulting access token is sent as `Authorization: Bearer` to lu-labs.ai.
//
// Session storage: OS keychain via the existing Rust `secret_*` commands
// (Windows Credential Manager / macOS Keychain) — survives the NSIS-update
// WebView2 wipe and keeps refresh tokens out of localStorage. Linux and the
// browser dev build have no vault to use (secret.rs is a stub there) and fall
// back to localStorage under the same obfuscation providerStore gives API
// keys — see FALLBACK_MARKER for what that is and is not worth.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { secretGet, secretSet, secretDelete, oauthStart, oauthWait, openExternal } from '../backend'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config'
import { isMobile } from '../../lib/device-kind'
import { showPhoneOAuthPage, type PhoneOAuthPage } from '../../lib/phone-oauth-page'
import { MOBILE_OAUTH_REDIRECT, parseOAuthCallbackUrl } from '../../lib/oauth-callback-url'

const SESSION_ACCOUNT = 'lu-cloud-session'
const LOCAL_KEY = 'lu-cloud-session'

// Keychain-first async storage adapter. Only a *permanent* keychain absence
// (web build, Linux stub) latches the adapter to localStorage — a transient
// failure (keychain locked at wake, dismissed unlock prompt, Credential
// Manager hiccup) falls back for that call only and retries the keychain on
// the next operation. Latching on a transient error would strand rotated
// refresh tokens in localStorage while the keychain keeps the rotated-out
// session, which kills the sign-in on the next launch.
let keychainBroken = false

function keychainMissing(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('keychain unavailable') || msg.includes('keychain unsupported')
}

// The PKCE flow stores TWO keys through this adapter: the session under the
// storageKey and the code verifier under `${storageKey}-code-verifier`. Map
// each supabase key to its own keychain account (suffix-preserving, so the
// pre-2.5.7 session account stays exactly SESSION_ACCOUNT) — a single fixed
// account would let the verifier write clobber the session.
function keychainAccount(key: string): string {
  return key.startsWith(LOCAL_KEY) ? SESSION_ACCOUNT + key.slice(LOCAL_KEY.length) : key
}

// Written over a keychain entry whose delete failed: the entry survives
// physically, but must never sign anyone back in. getItem reports it as absent.
const TOMBSTONE = '__lu_signed_out__'

// ── localStorage fallback encoding ──────────────────────────────────────
// Everything the keychain path does not take ends up here: Linux and the
// browser dev build have no OS vault at all (commands/secret.rs compiles to an
// "unsupported" stub there), and any keychain write that fails falls back for
// that one call. What lands is the Supabase session — a refresh token that is
// a full account bearer until it is revoked — and it used to be written
// verbatim, so on Linux it sat greppable in WebKitGTK's profile directory
// while providerStore's API keys on the very same platforms never do (those
// are stored reversed + base64). This closes that gap: same platforms, same
// treatment.
//
// It is obfuscation, NOT encryption. There is no key this app could hold that
// a reader of the profile directory could not take as well, so it only stops
// the token from being legible at a glance — a backup, a synced profile
// folder, a support screenshot, another process grepping for `eyJ`. The real
// store remains the OS vault, and a secret store for Linux is a Rust-side
// change, not one this adapter can make.
const FALLBACK_MARKER = 'lu.obf.1:'

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// btoa/atob without the platform. `encodeURIComponent` already reduced the
// value to ASCII, so this is base64 over char codes 0..127 and produces byte
// for byte what btoa produces — the stored format does not change, and a
// session written on one path still reads back on the other.
//
// It exists so packFallback has somewhere to go when btoa does not: the old
// catch wrote the RAW value to localStorage, i.e. the plaintext refresh token
// this encoding was added to remove, silently and with no marker to find it by
// afterwards. There is no failure mode left that needs that.
function b64Encode(ascii: string): string {
  let out = ''
  for (let i = 0; i < ascii.length; i += 3) {
    const a = ascii.charCodeAt(i)
    const b = i + 1 < ascii.length ? ascii.charCodeAt(i + 1) : -1
    const c = i + 2 < ascii.length ? ascii.charCodeAt(i + 2) : -1
    out += B64_ALPHABET[a >> 2]
    out += B64_ALPHABET[((a & 3) << 4) | (b < 0 ? 0 : b >> 4)]
    out += b < 0 ? '=' : B64_ALPHABET[((b & 15) << 2) | (c < 0 ? 0 : c >> 6)]
    out += c < 0 ? '=' : B64_ALPHABET[c & 63]
  }
  return out
}

function b64Decode(encoded: string): string {
  const clean = encoded.replace(/=+$/, '')
  let bits = 0
  let acc = 0
  let out = ''
  for (const ch of clean) {
    const v = B64_ALPHABET.indexOf(ch)
    if (v < 0) throw new Error('not base64')
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out += String.fromCharCode((acc >> bits) & 0xff)
    }
  }
  return out
}

function packFallback(value: string): string {
  const ascii = encodeURIComponent(value)
  try {
    return FALLBACK_MARKER + btoa(ascii)
  } catch {
    // No btoa on this engine (or it refused). Encode it here instead — writing
    // the plaintext token was never an acceptable third option: it is exactly
    // the state this whole block exists to remove, and it left no trace.
    return FALLBACK_MARKER + b64Encode(ascii)
  }
}

function unpackFallback(stored: string): string {
  // No marker = written by a build before this encoding existed. Those must
  // keep working, or an update signs every Linux user out.
  if (!stored.startsWith(FALLBACK_MARKER)) return stored
  const payload = stored.slice(FALLBACK_MARKER.length)
  try {
    return decodeURIComponent(atob(payload))
  } catch {
    try {
      return decodeURIComponent(b64Decode(payload))
    } catch {
      // Marked but undecodable: damaged on disk. Hand the marked string back
      // rather than a token — supabase-js fails to parse it and treats the
      // session as absent, which is the honest outcome. It is NOT plaintext.
      return stored
    }
  }
}

function fallbackGet(key: string): string | null {
  const raw = localStorage.getItem(key)
  return raw === null ? null : unpackFallback(raw)
}

/** Exported for its unit tests — this adapter holds the refresh token, and the
 *  invariants in the comments above are worth asserting rather than trusting. */
export const keychainStorage = {
  async getItem(key: string): Promise<string | null> {
    let value: string | null = null
    if (!keychainBroken) {
      try {
        const fromKeychain = await secretGet(keychainAccount(key))
        // A localStorage copy only exists when a later write missed the
        // keychain (transient failure, keychain-less build) — when both
        // stores hold the key, localStorage is the newer one. A clean
        // keychain miss must also consult it, or a fallback-written session
        // is invisible on the next launch and the user is signed out.
        value = fallbackGet(key) ?? fromKeychain
      } catch (err) {
        if (keychainMissing(err)) keychainBroken = true
        value = fallbackGet(key)
      }
    } else {
      value = fallbackGet(key)
    }
    return value === TOMBSTONE ? null : value
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!keychainBroken) {
      try {
        await secretSet(keychainAccount(key), value)
        // Drop any stale fallback copy so the two stores can't diverge and
        // no refresh token lingers in plaintext once the keychain works.
        localStorage.removeItem(key)
        return
      } catch (err) {
        if (keychainMissing(err)) keychainBroken = true
      }
    }
    localStorage.setItem(key, packFallback(value))
  },
  async removeItem(key: string): Promise<void> {
    // Always clear the fallback copy too — sign-out must never leave a
    // resurrectable session (or plaintext refresh token) in localStorage.
    localStorage.removeItem(key)
    if (keychainBroken) return

    const account = keychainAccount(key)
    try {
      await secretDelete(account)
      return
    } catch (err) {
      if (keychainMissing(err)) {
        keychainBroken = true
        return
      }
    }
    // The keychain is THERE and the delete failed anyway (locked at wake, a
    // dismissed unlock prompt, a Credential Manager hiccup) — so the refresh
    // token is still in it and the next launch would sign the user back in
    // after they explicitly signed out. This used to resolve silently, which
    // reported a sign-out that had not happened.
    //
    // Neutralise the surviving entry (best effort: a write may succeed where
    // the delete did not), then report the failure instead of swallowing it.
    try {
      await secretSet(account, TOMBSTONE)
    } catch {
      // Nothing left to try — the throw below is the only honest outcome.
    }
    throw new Error('Signed out, but the saved session could not be removed from the keychain.')
  },
}

/**
 * Ask the OS secret store again.
 *
 * The adapter stops asking for the rest of the session once the store says it
 * does not exist ("keychain unsupported"). That is right on Linux, where it
 * never will. On a phone it is a question of which build is installed: the
 * moment Rust ships a store behind `secret_*` (Android Keystore, iOS Keychain)
 * the adapter uses it by itself at the next start, and this call lets the
 * shell switch over without a restart. The next write then moves the session
 * out of localStorage, because setItem removes the fallback copy.
 */
export function retryKeychainStorage(): void {
  keychainBroken = false
}

/**
 * Who the saved session belongs to, read from storage alone.
 *
 * `getSession()` cannot answer this without a network: an expired access
 * token makes it try a refresh first, and that fails in a dead zone. This
 * reads the stored blob directly, so "is there a session on this device" has
 * an answer offline. Null when nothing is saved or it cannot be read.
 */
export async function savedSessionUser(): Promise<{ id: string; email?: string } | null> {
  try {
    const raw = await keychainStorage.getItem(LOCAL_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    const user = parsed && typeof parsed === 'object' ? (parsed as { user?: unknown }).user : null
    if (!user || typeof user !== 'object') return null
    const { id, email } = user as { id?: unknown; email?: unknown }
    if (typeof id !== 'string' || !id) return null
    return typeof email === 'string' && email ? { id, email } : { id }
  } catch {
    return null
  }
}

let client: SupabaseClient | null = null

export function supabaseCloud(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: keychainStorage,
        storageKey: LOCAL_KEY,
        persistSession: true,
        // Timers are throttled while the app is minimized/asleep, so we do
        // NOT rely on background refresh — getAccessToken() refreshes lazily
        // via getSession() on every use instead.
        autoRefreshToken: true,
        detectSessionInUrl: false,
        // OAuth via the system browser needs PKCE — the browser only ever
        // sees the code, the verifier stays in the app (keychain adapter).
        flowType: 'pkce',
      },
    })
  }
  return client
}

/** Current access token, refreshing an expired session if needed. Null when
 *  logged out. Called per request — getSession() is cached in-memory and only
 *  hits the network when the token actually expired. A failed refresh with the
 *  session still in the keychain is a connectivity problem, not a sign-out —
 *  throw so callers don't tell a signed-in user to sign in. */
export async function getAccessToken(): Promise<string | null> {
  const { data, error } = await supabaseCloud().auth.getSession()
  if (!data.session && error) {
    throw new Error('LU Cloud unreachable. Check your connection.')
  }
  return data.session?.access_token ?? null
}

export type OAuthProvider = 'google' | 'github'

/** The loopback callback is the one place in sign-in where text from outside
 *  the app reaches the UI, and it is NOT the provider's text by construction.
 *
 *  commands/oauth.rs narrows the sender to "a top-level browser navigation"
 *  (GET /callback, right Host, no Origin, Sec-Fetch-Mode: navigate). Its own
 *  comment used to argue that what remains needs a user gesture and therefore
 *  a visible window. That is not true: `location.href = …`, a
 *  `<meta http-equiv="refresh">` and a server-side 302 are all top-level
 *  navigations that any page the user already has open can perform silently,
 *  and they send exactly those headers. So while a sign-in is pending, any
 *  open tab can end the wait and choose this string. The real fix is a
 *  per-attempt `state` nonce, which needs the Rust listener AND a redirect
 *  allow-list entry that tolerates a query parameter — neither is reachable
 *  from here.
 *
 *  What IS reachable from here: never let that string pose as LU's own words.
 *  It is quoted and attributed, control characters are stripped so it cannot
 *  lay itself out as a second paragraph, the quote characters it could use to
 *  close the attribution are stripped, and it is cut to 200 characters. */
const REPORTED_MAX_CHARS = 200

function providerErrorText(params: URLSearchParams): string {
  const raw = params.get('error_description') || params.get('error') || ''
  const clean = raw
    .replace(/\p{C}/gu, ' ')
    .replace(/["'‘’“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, REPORTED_MAX_CHARS)
  if (!clean) return 'Sign-in was cancelled in the browser.'
  return `The sign-in page reported: "${clean}"`
}

/** Google/GitHub sign-in, same identities as lu-labs.ai. Flow: bind a
 *  127.0.0.1 loopback port (Rust, fixed ladder registered in the Supabase
 *  redirect allow-list) → open the provider consent in the SYSTEM browser →
 *  Supabase redirects to the loopback with ?code= → exchange the PKCE code
 *  for a session. Rejects with a readable message on timeout/denial, and
 *  immediately when `signal` aborts (Cancel while waiting for the browser) —
 *  the abandoned Rust wait cleans itself up, and any retry's oauth_start
 *  aborts the stale listener first, so cancelling never wedges the ladder. */
export async function loginWithProvider(provider: OAuthProvider, signal?: AbortSignal, onBrowserOpen?: () => void): Promise<void> {
  // A phone cannot listen on a loopback port while the browser is in front.
  // It comes back through a link instead (see loginWithProviderMobile).
  // `onBrowserOpen` is for the phone only: the desktop never calls it.
  if (isMobile()) return loginWithProviderMobile(provider, signal, onBrowserOpen)
  const port = await oauthStart()
  const { data, error } = await supabaseCloud().auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `http://127.0.0.1:${port}/callback`,
      skipBrowserRedirect: true,
    },
  })
  if (error) throw new Error(error.message)
  if (!data?.url) throw new Error('OAuth start failed, no provider URL')
  await openExternal(data.url)
  const wait = oauthWait(port, 300)
  const query = signal
    ? await Promise.race([
        wait,
        new Promise<never>((_, reject) => {
          const cancel = () => reject(new Error('Sign-in cancelled.'))
          if (signal.aborted) cancel()
          else signal.addEventListener('abort', cancel, { once: true })
        }),
      ])
    : await wait
  const params = new URLSearchParams(query)
  const code = params.get('code')
  if (!code) {
    throw new Error(providerErrorText(params))
  }
  const { error: exchangeError } = await supabaseCloud().auth.exchangeCodeForSession(code)
  if (exchangeError) throw new Error(exchangeError.message)
}

// ── Sign-in on a phone: back through a link ─────────────────────────────

/** The provider page did not open on this phone. A sentence for the logic layer; the screen has its own. */
export const MOBILE_OAUTH_NOT_OPENED = 'The sign-in page could not be opened.'

/** How long a sign-in waits for the link to come back, like the desktop wait. */
export const MOBILE_OAUTH_WAIT_MS = 300_000

export type OAuthCallbackResult =
  /** Not the sign-in link. Nothing happened. */
  | { handled: false }
  | { handled: true; ok: true }
  /** `error` is a sentence for the user. */
  | { handled: true; ok: false; error: string }

interface PendingLogin {
  resolve: () => void
  reject: (err: Error) => void
}

let pendingLogin: PendingLogin | null = null

// ── Only a link somebody asked for (review N2) ──────────────────────────
//
// Any app or web page on the phone can open `lu://oauth/callback?code=x`.
// It cannot take over an account (PKCE: the verifier never leaves this
// device), but the exchange it sets off ends a sign-in that is waiting, and
// the auth client drops the verifier after a try, so the real link fails
// afterwards. So a link is only taken while one is expected: a sign-in or a
// password reset was started from this phone a short while ago. The mark is
// on disk, because the app may be started cold by the very link it waits for.

const OAUTH_EXPECTED_KEY = 'lu-oauth-expected-until'
/** A sign-in in the browser: the wait is five minutes, a cold start may take longer. */
export const OAUTH_SIGNIN_WINDOW_MS = 15 * 60_000
/** A reset mail is read later than a browser tab: as long as the link in it is good. */
export const OAUTH_RESET_WINDOW_MS = 60 * 60_000
let expectedUntilMemory = 0

function expectOAuthCallback(windowMs: number): void {
  const until = Math.max(Date.now() + windowMs, readExpectedUntil())
  expectedUntilMemory = until
  try { localStorage.setItem(OAUTH_EXPECTED_KEY, String(until)) } catch { /* the memory copy holds for this run */ }
}

function readExpectedUntil(): number {
  let stored = 0
  try { stored = Number(localStorage.getItem(OAUTH_EXPECTED_KEY)) || 0 } catch { /* no storage */ }
  return Math.max(stored, expectedUntilMemory)
}

/** Is a sign-in link expected right now? */
export function oauthCallbackExpected(now: number = Date.now()): boolean {
  const until = readExpectedUntil()
  // A mark further ahead than the longest window is not one this code wrote.
  return until > now && until - now <= OAUTH_RESET_WINDOW_MS
}

function forgetOAuthExpectation(): void {
  expectedUntilMemory = 0
  try { localStorage.removeItem(OAUTH_EXPECTED_KEY) } catch { /* nothing to remove */ }
}

/** What a link that nobody asked for is answered with. It is not shown: the link is dropped. */
export const OAUTH_NOT_EXPECTED = 'This sign-in link was not asked for on this phone, or it is too old. Start the sign-in again.'

let lastHandled: { code: string; result: Promise<OAuthCallbackResult> } | null = null
/** When the last link that was asked for came in. 0: none in this run. */
let lastCallbackAt = 0

/**
 * Did a link that was asked for come back since `since` (a Date.now() value)?
 * The phone asks this when the user is back in the app after the browser: no
 * link means the browser ended somewhere else, a web page for example.
 */
export function oauthCallbackSeenSince(since: number): boolean {
  return lastCallbackAt > 0 && lastCallbackAt >= since
}
const signedInListeners = new Set<() => void>()

/** Runs after a link signed somebody in. The account probe hangs here, so a
 *  sign-in that completes on a cold start, with no login() call waiting for
 *  it, still ends in a signed-in app. */
export function onOAuthSignedIn(fn: () => void): () => void {
  signedInListeners.add(fn)
  return () => { signedInListeners.delete(fn) }
}

/**
 * Take the sign-in link the system handed to the app and finish the sign-in.
 *
 * Works without a login() call waiting for it: after the system killed the
 * app while the browser was in front, the app starts cold with this link, and
 * the PKCE verifier for the code is still in the session store. The shell does
 * not call this directly, it reports every link to reportIncomingUrl()
 * (lib/incoming-url.ts), which hands the right ones here.
 *
 * The same link twice (the launch link and the event for it) is one sign-in:
 * a code can be exchanged once, so the second call gets the first result.
 */
export async function handleOAuthCallbackUrl(url: string): Promise<OAuthCallbackResult> {
  const parsed = parseOAuthCallbackUrl(url)
  if (parsed.kind === 'not-oauth') return { handled: false }

  // The second delivery of a link that was taken (launch link and its event).
  if (parsed.kind === 'code' && lastHandled?.code === parsed.code) return lastHandled.result
  // Nobody on this phone asked for a link: dropped, the waiting sign-in and
  // the verifier are not touched.
  if (!oauthCallbackExpected()) return { handled: true, ok: false, error: OAUTH_NOT_EXPECTED }
  // The browser found its way back into the app, whatever the link says.
  lastCallbackAt = Date.now()

  if (parsed.kind === 'error') {
    const error = providerErrorText(parsed.params)
    pendingLogin?.reject(new Error(error))
    pendingLogin = null
    return { handled: true, ok: false, error }
  }

  if (lastHandled?.code === parsed.code) return lastHandled.result
  const result = (async (): Promise<OAuthCallbackResult> => {
    try {
      const { data, error } = await supabaseCloud().auth.exchangeCodeForSession(parsed.code)
      if (error) throw new Error(error.message)
      // The code came from a reset mail, not from a sign-in: the session is
      // there to choose a new password with (see onPasswordRecovery).
      if ((data as { redirectType?: unknown } | null | undefined)?.redirectType === 'recovery') notePasswordRecovery()
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      pendingLogin?.reject(new Error(error))
      pendingLogin = null
      return { handled: true, ok: false, error }
    }
    pendingLogin?.resolve()
    pendingLogin = null
    // The link that was waited for came: the next one has to be asked for again.
    forgetOAuthExpectation()
    for (const fn of [...signedInListeners]) {
      try { fn() } catch { /* a listener must not undo a sign-in */ }
    }
    return { handled: true, ok: true }
  })()
  lastHandled = { code: parsed.code, result }
  return result
}

/**
 * Google/GitHub sign-in on a phone. Same PKCE flow as the desktop, with the
 * loopback listener replaced by "wait for the link": the provider page opens
 * in the browser, Supabase redirects to MOBILE_OAUTH_REDIRECT, the system
 * hands that link to the app and handleOAuthCallbackUrl exchanges the code.
 *
 * Rejects on cancel (`signal`), on a refusal from the provider and after
 * MOBILE_OAUTH_WAIT_MS. If the system kills the app while the browser is in
 * front, this promise is gone with it, and the cold start finishes the
 * sign-in through the same handler.
 */
async function loginWithProviderMobile(provider: OAuthProvider, signal?: AbortSignal, onBrowserOpen?: () => void): Promise<void> {
  const { data, error } = await supabaseCloud().auth.signInWithOAuth({
    provider,
    options: { redirectTo: MOBILE_OAUTH_REDIRECT, skipBrowserRedirect: true },
  })
  if (error) throw new Error(error.message)
  if (!data?.url) throw new Error('OAuth start failed, no provider URL')

  // From here on the link is expected, also by a cold start (review N2).
  expectOAuthCallback(OAUTH_SIGNIN_WINDOW_MS)
  // A second attempt replaces the first: only one link can come back.
  pendingLogin?.reject(new Error('Sign-in cancelled.'))
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  let drop = () => {}
  const waiting = new Promise<void>((resolve, reject) => {
    const mine: PendingLogin = { resolve, reject }
    pendingLogin = mine
    drop = () => { if (pendingLogin === mine) pendingLogin = null }
    timer = setTimeout(() => {
      drop()
      reject(new Error('Sign-in timed out. Tap the sign-in button to try again.'))
    }, MOBILE_OAUTH_WAIT_MS)
    onAbort = () => { drop(); reject(new Error('Sign-in cancelled.')) }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
  // Marked as handled: a refusal may arrive before the line below awaits it.
  waiting.catch(() => {})
  try {
    // The one way out of the app on a phone (lib/phone-oauth-page.ts). Not
    // openExternal of api/backend: `plugin:shell|open` starts a program,
    // and an iPhone has none to start (check on the iPhone, round 22, N5).
    let page: PhoneOAuthPage
    try {
      page = await showPhoneOAuthPage(data.url)
    } catch {
      // Nothing is open, so nothing can come back: never wait for it.
      throw new Error(MOBILE_OAUTH_NOT_OPENED)
    }
    if (page.kind === 'cancelled') throw new Error('Sign-in cancelled.')
    if (page.kind === 'returned') {
      // The sheet of the system handed the link back itself, no deep link follows.
      const taken = await handleOAuthCallbackUrl(page.url)
      if (!taken.handled) throw new Error(MOBILE_OAUTH_NOT_OPENED)
      if (!taken.ok) throw new Error(taken.error)
    } else {
      onBrowserOpen?.()
    }
    await waiting
  } finally {
    drop()
    if (timer) clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
}

/** Test-only. */
export function __resetMobileOAuthForTests(): void {
  pendingLogin = null
  lastHandled = null
  lastCallbackAt = 0
  forgetOAuthExpectation()
  signedInListeners.clear()
  recoveryListeners.clear()
  recoveryPending = false
}

// ── A forgotten password ────────────────────────────────────────────────

/**
 * Ask the auth server to send the reset mail for this address.
 *
 * The server answers the same for an address with an account and for one
 * without (it must not tell a stranger which addresses exist), so resolving
 * means "the request was taken", never "a mail was sent". The screen has to
 * say exactly that. Rejects with the auth error when the request itself
 * failed: no network, too many requests, an address the server refuses.
 *
 * On a phone the link in the mail leads back into the app, through the same
 * `lu://oauth/callback` the sign-in with Google uses: this client speaks
 * PKCE, so only the device that asked holds the verifier for the code in that
 * link, and handleOAuthCallbackUrl exchanges it. The exchange signs the user
 * in and says that the code came from a reset (see onPasswordRecovery), which
 * is the moment to ask for the new password. The desktop has no screen for this yet;
 * without a redirect the mail leads to the site address of the project.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabaseCloud().auth.resetPasswordForEmail(
    email.trim(),
    isMobile() ? { redirectTo: MOBILE_OAUTH_REDIRECT } : undefined,
  )
  if (error) throw error
  // The link in the mail comes back through the same door (review N2).
  if (isMobile()) expectOAuthCallback(OAUTH_RESET_WINDOW_MS)
}

const recoveryListeners = new Set<() => void>()
let recoveryPending = false

function tellRecoveryListeners(): void {
  if (!recoveryPending || recoveryListeners.size === 0) return
  recoveryPending = false
  for (const listener of [...recoveryListeners]) {
    try { listener() } catch { /* a listener must not undo the sign-in */ }
  }
}

/** A reset link was exchanged. Kept until somebody listens: on a cold start the link is faster than the screens. */
function notePasswordRecovery(): void {
  recoveryPending = true
  // Not inside the exchange: whoever listens may call the auth client, and that call must not wait on this one.
  setTimeout(tellRecoveryListeners, 0)
}

/**
 * Runs when a reset link was exchanged: the user is signed in for the one
 * purpose of choosing a new password. A link that came in before anybody
 * listened (the app was started by it) is delivered to the first listener.
 * Returns the unsubscribe.
 */
export function onPasswordRecovery(fn: () => void): () => void {
  recoveryListeners.add(fn)
  if (recoveryPending) setTimeout(tellRecoveryListeners, 0)
  return () => { recoveryListeners.delete(fn) }
}

/** Set the password of the signed-in account. Rejects with the auth error (too short, same as before, session gone). */
export async function setNewPassword(password: string): Promise<void> {
  const { error } = await supabaseCloud().auth.updateUser({ password })
  if (error) throw error
}
