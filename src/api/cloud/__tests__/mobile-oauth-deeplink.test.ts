/**
 * Point 5 of the mobile groundwork: Google and GitHub sign-in on a phone
 * comes back through the link lu://oauth/callback, on a running app and on a
 * cold start.
 *
 * The desktop flow binds a 127.0.0.1 port and waits up to five minutes while
 * the browser is in front. On a phone the system freezes the app as soon as
 * the browser opens, and nothing leads back (audit section 6).
 *
 * Run: npx vitest run src/api/cloud/__tests__/mobile-oauth-deeplink.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { standOn } from '../../../test-support/devices'

const backend = vi.hoisted(() => ({
  oauthStart: vi.fn(async () => 17872),
  oauthWait: vi.fn(async () => 'code=desktop-code'),
  openExternal: vi.fn(async () => undefined),
  secretGet: vi.fn(),
  secretSet: vi.fn(),
  secretDelete: vi.fn(),
}))
vi.mock('../../backend', () => backend)
// The one way a phone shows the provider page (lib/phone-oauth-page.ts). Its own tests are in
// src/lib/__tests__/phone-oauth-page.test.ts; here it is played: a browser came to the front.
const phonePage = vi.hoisted(() => ({
  showPhoneOAuthPage: vi.fn(async (_url: string): Promise<{ kind: 'opened' } | { kind: 'returned'; url: string } | { kind: 'cancelled' }> => ({ kind: 'opened' })),
}))
vi.mock('../../../lib/phone-oauth-page', () => phonePage)
vi.mock('../config', () => ({ SUPABASE_URL: 'https://x.test', SUPABASE_ANON_KEY: 'anon' }))

const auth = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth }) }))

import {
  MOBILE_OAUTH_NOT_OPENED, OAUTH_NOT_EXPECTED, OAUTH_SIGNIN_WINDOW_MS, __resetMobileOAuthForTests, handleOAuthCallbackUrl, keychainStorage, loginWithProvider,
  oauthCallbackExpected, oauthCallbackSeenSince, onOAuthSignedIn, retryKeychainStorage, savedSessionUser,
} from '../supabase'
import { MOBILE_OAUTH_REDIRECT, isOAuthCallbackUrl, parseOAuthCallbackUrl } from '../../../lib/oauth-callback-url'
import { onIncomingUrl, reportIncomingUrl } from '../../../lib/incoming-url'

const store = new Map<string, string>()

beforeEach(() => {
  vi.clearAllMocks()
  __resetMobileOAuthForTests()
  auth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://accounts.google.test/o' }, error: null })
  auth.exchangeCodeForSession.mockResolvedValue({ error: null })
  phonePage.showPhoneOAuthPage.mockImplementation(async () => ({ kind: 'opened' }))
  backend.oauthStart.mockResolvedValue(17872)
  backend.oauthWait.mockResolvedValue('code=desktop-code')
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

/** What an earlier run of the app left behind when it opened the browser for a sign-in. */
function signInWasStarted(agoMs = 30_000): void {
  store.set('lu-oauth-expected-until', String(Date.now() - agoMs + OAUTH_SIGNIN_WINDOW_MS))
}

describe('reading the link', () => {
  it('is pure and takes the code from the query or the fragment', () => {
    expect(MOBILE_OAUTH_REDIRECT).toBe('lu://oauth/callback')
    expect(parseOAuthCallbackUrl('lu://oauth/callback?code=abc')).toEqual({ kind: 'code', code: 'abc' })
    expect(parseOAuthCallbackUrl('lu://oauth/callback/?code=abc&state=x')).toEqual({ kind: 'code', code: 'abc' })
    expect(parseOAuthCallbackUrl('LU://OAuth/Callback#code=frag')).toEqual({ kind: 'code', code: 'frag' })
    expect(parseOAuthCallbackUrl('  lu://oauth/callback?code=abc  ')).toEqual({ kind: 'code', code: 'abc' })
  })

  it('a link without a code is an error with the provider parameters', () => {
    const out = parseOAuthCallbackUrl('lu://oauth/callback?error=access_denied&error_description=No+thanks')
    expect(out.kind).toBe('error')
    expect(out.kind === 'error' && out.params.get('error_description')).toBe('No thanks')
    expect(parseOAuthCallbackUrl('lu://oauth/callback').kind).toBe('error')
  })

  it('everything else is not ours', () => {
    for (const url of ['lu://chat/123', 'lu://oauth/callbackx?code=1', 'https://evil.test/lu://oauth/callback?code=1', '', null, undefined, 42]) {
      expect(parseOAuthCallbackUrl(url), String(url)).toEqual({ kind: 'not-oauth' })
      expect(isOAuthCallbackUrl(url)).toBe(false)
    }
  })
})

describe('sign-in on a phone', () => {
  it('asks Supabase to come back through the link, binds no port, and resolves when the link arrives', async () => {
    standOn('android')
    const login = loginWithProvider('google')
    await vi.waitFor(() => expect(phonePage.showPhoneOAuthPage).toHaveBeenCalledWith('https://accounts.google.test/o'))
    // Never through the shell plugin: a phone has no program to start (iPhone, round 22, N5).
    expect(backend.openExternal).not.toHaveBeenCalled()
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'lu://oauth/callback', skipBrowserRedirect: true },
    })
    expect(backend.oauthStart).not.toHaveBeenCalled()
    expect(backend.oauthWait).not.toHaveBeenCalled()

    expect(await reportIncomingUrl('lu://oauth/callback?code=phone-code')).toBe(true)
    await expect(login).resolves.toBeUndefined()
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('phone-code')
  })

  it('cold start: the link finishes the sign-in with nobody waiting, and the account probe is told', async () => {
    standOn('iphone')
    signInWasStarted()
    const probe = vi.fn()
    onOAuthSignedIn(probe)
    const result = await handleOAuthCallbackUrl('lu://oauth/callback?code=cold-code')
    expect(result).toEqual({ handled: true, ok: true })
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('cold-code')
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('the same link twice is one exchange', async () => {
    standOn('android')
    signInWasStarted()
    const first = await handleOAuthCallbackUrl('lu://oauth/callback?code=once')
    const second = await handleOAuthCallbackUrl('lu://oauth/callback?code=once')
    expect(first).toEqual({ handled: true, ok: true })
    expect(second).toEqual(first)
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
  })

  it('a refusal comes back quoted and attributed, never as words of the app', async () => {
    standOn('android')
    const login = loginWithProvider('github')
    login.catch(() => {})
    await vi.waitFor(() => expect(phonePage.showPhoneOAuthPage).toHaveBeenCalled())
    const result = await handleOAuthCallbackUrl('lu://oauth/callback?error=access_denied&error_description=Your+account+is+locked')
    expect(result).toEqual({ handled: true, ok: false, error: 'The sign-in page reported: "Your account is locked"' })
    await expect(login).rejects.toThrow('The sign-in page reported: "Your account is locked"')
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('an exchange that fails rejects the waiting sign-in with the reason', async () => {
    standOn('android')
    auth.exchangeCodeForSession.mockResolvedValue({ error: { message: 'invalid flow state' } })
    const login = loginWithProvider('google')
    login.catch(() => {})
    await vi.waitFor(() => expect(phonePage.showPhoneOAuthPage).toHaveBeenCalled())
    expect(await handleOAuthCallbackUrl('lu://oauth/callback?code=bad')).toEqual({ handled: true, ok: false, error: 'invalid flow state' })
    await expect(login).rejects.toThrow('invalid flow state')
  })

  it('cancel ends the wait at once', async () => {
    standOn('iphone')
    const controller = new AbortController()
    const login = loginWithProvider('google', controller.signal)
    login.catch(() => {})
    await vi.waitFor(() => expect(phonePage.showPhoneOAuthPage).toHaveBeenCalled())
    controller.abort()
    await expect(login).rejects.toThrow('Sign-in cancelled.')
  })

  // Review N2: any app or page on the phone can open lu://oauth/callback.
  it('a link nobody asked for is dropped: no exchange, nobody is told', async () => {
    standOn('android')
    const probe = vi.fn()
    onOAuthSignedIn(probe)
    expect(oauthCallbackExpected()).toBe(false)
    expect(await handleOAuthCallbackUrl('lu://oauth/callback?code=x')).toEqual({ handled: true, ok: false, error: OAUTH_NOT_EXPECTED })
    expect(await handleOAuthCallbackUrl('lu://oauth/callback?error=access_denied')).toEqual({ handled: true, ok: false, error: OAUTH_NOT_EXPECTED })
    // Through the door of the shell it counts as taken, so it never becomes an offer either.
    expect(await reportIncomingUrl('lu://oauth/callback?code=x')).toBe(true)
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
  })

  it('a sign-in that was started too long ago no longer takes a link', async () => {
    standOn('iphone')
    signInWasStarted(OAUTH_SIGNIN_WINDOW_MS + 1_000)
    expect(await handleOAuthCallbackUrl('lu://oauth/callback?code=late')).toMatchObject({ handled: true, ok: false })
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
    // A mark far in the future is not one the app wrote.
    store.set('lu-oauth-expected-until', String(Date.now() + 30 * 24 * 3600_000))
    expect(oauthCallbackExpected()).toBe(false)
  })

  it('starting a sign-in opens the window, the link that comes back closes it', async () => {
    standOn('android')
    const login = loginWithProvider('google')
    await vi.waitFor(() => expect(phonePage.showPhoneOAuthPage).toHaveBeenCalled())
    expect(oauthCallbackExpected()).toBe(true)
    expect(Number(store.get('lu-oauth-expected-until'))).toBeGreaterThan(Date.now())
    expect(await handleOAuthCallbackUrl('lu://oauth/callback?code=mine')).toEqual({ handled: true, ok: true })
    await login
    expect(oauthCallbackExpected()).toBe(false)
    // A second link after it, from somebody else: dropped.
    expect(await handleOAuthCallbackUrl('lu://oauth/callback?code=theirs')).toMatchObject({ handled: true, ok: false })
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
  })

  it('a desktop never opens the window', async () => {
    standOn('windows')
    const browserOpen = vi.fn()
    await loginWithProvider('google', undefined, browserOpen)
    // The desktop keeps its own way: the shell plugin and the loopback port. The phone page is not asked.
    expect(backend.openExternal).toHaveBeenCalledWith('https://accounts.google.test/o')
    expect(phonePage.showPhoneOAuthPage).not.toHaveBeenCalled()
    expect(browserOpen).not.toHaveBeenCalled()
    expect(store.has('lu-oauth-expected-until')).toBe(false)
  })

  // Round 43: back in the app by hand, the page asks whether a link came, and ends the wait when none did.
  it('tells whether a link came back since a moment, and a link after the page gave up still signs in', async () => {
    standOn('android')
    const probe = vi.fn()
    onOAuthSignedIn(probe)
    const since = Date.now()
    const controller = new AbortController()
    const login = loginWithProvider('google', controller.signal)
    await vi.waitFor(() => expect(phonePage.showPhoneOAuthPage).toHaveBeenCalled())
    expect(oauthCallbackSeenSince(since)).toBe(false)
    // The page gives up (no link after the return): the wait ends, the window for the link stays.
    controller.abort()
    await expect(login).rejects.toThrow('Sign-in cancelled.')
    expect(oauthCallbackExpected()).toBe(true)
    // A link nobody asked for does not count as one that came back.
    expect(await handleOAuthCallbackUrl('lu://chat/1')).toEqual({ handled: false })
    expect(oauthCallbackSeenSince(since)).toBe(false)
    // The link comes late after all: taken, the account probe is told.
    expect(await handleOAuthCallbackUrl('lu://oauth/callback?code=late')).toEqual({ handled: true, ok: true })
    expect(oauthCallbackSeenSince(since)).toBe(true)
    expect(oauthCallbackSeenSince(Date.now() + 1000)).toBe(false)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('a link that is not the sign-in link goes to the other handlers', async () => {
    const other = vi.fn(async (url: string) => url.startsWith('lu://chat/'))
    const off = onIncomingUrl(other)
    expect(await reportIncomingUrl('lu://chat/42')).toBe(true)
    expect(await reportIncomingUrl('lu://unknown')).toBe(false)
    expect(await reportIncomingUrl(null)).toBe(false)
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
    off()
  })
})

describe('sign-in on a desktop is the loopback flow, unchanged', () => {
  for (const device of ['windows', 'mac', 'linux'] as const) {
    it(`${device}: binds the port, waits on it, exchanges its code`, async () => {
      standOn(device)
      await loginWithProvider('google')
      expect(backend.oauthStart).toHaveBeenCalledTimes(1)
      expect(auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: { redirectTo: 'http://127.0.0.1:17872/callback', skipBrowserRedirect: true },
      })
      expect(backend.oauthWait).toHaveBeenCalledWith(17872, 300)
      expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('desktop-code')
    })
  }
})

describe('the session store on a phone', () => {
  const SESSION = JSON.stringify({ access_token: 'a', refresh_token: 'r', user: { id: 'u1', email: 'a@b.test' } })

  it('uses secret_* the moment Rust has a store, and takes the session out of localStorage', async () => {
    standOn('android')
    retryKeychainStorage()
    // Today: the stub answers "keychain unsupported" and the adapter falls back.
    backend.secretSet.mockRejectedValueOnce(new Error('keychain unsupported on this platform'))
    await keychainStorage.setItem('lu-cloud-session', SESSION)
    expect(store.has('lu-cloud-session')).toBe(true)
    expect(store.get('lu-cloud-session')).not.toContain('refresh_token')

    // Rust ships a store: the shell says so, the next write goes there.
    backend.secretSet.mockResolvedValue(undefined)
    retryKeychainStorage()
    await keychainStorage.setItem('lu-cloud-session', SESSION)
    expect(backend.secretSet).toHaveBeenLastCalledWith('lu-cloud-session', SESSION)
    expect(store.has('lu-cloud-session')).toBe(false)
  })

  it('says who the saved session belongs to without any network', async () => {
    retryKeychainStorage()
    backend.secretGet.mockResolvedValue(SESSION)
    expect(await savedSessionUser()).toEqual({ id: 'u1', email: 'a@b.test' })
    backend.secretGet.mockResolvedValue(null)
    expect(await savedSessionUser()).toBeNull()
    backend.secretGet.mockResolvedValue('{not json')
    expect(await savedSessionUser()).toBeNull()
  })
})

// Check on the iPhone, round 22, N5: "Continue with Google" said "Waiting for your browser" and no
// browser came. Every way the provider page can end, and what the sign-in does then.
describe('showing the provider page on a phone (round 22, N5)', () => {
  it('a browser in front: the caller is told, and the sign-in waits for the link', async () => {
    standOn('android')
    const browserOpen = vi.fn()
    const login = loginWithProvider('google', undefined, browserOpen)
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalledTimes(1))
    let settled = false
    void login.then(() => { settled = true }, () => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    await reportIncomingUrl('lu://oauth/callback?code=later')
    await expect(login).resolves.toBeUndefined()
  })

  it('iPhone: the sheet of the system hands the link back, and the sign-in is finished without a deep link', async () => {
    standOn('iphone')
    phonePage.showPhoneOAuthPage.mockResolvedValue({ kind: 'returned', url: 'lu://oauth/callback?code=sheet-code' })
    const browserOpen = vi.fn()
    const probe = vi.fn()
    onOAuthSignedIn(probe)
    await expect(loginWithProvider('github', undefined, browserOpen)).resolves.toBeUndefined()
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('sheet-code')
    expect(probe).toHaveBeenCalledTimes(1)
    // No browser is in front, so nobody is told that one is.
    expect(browserOpen).not.toHaveBeenCalled()
    // The link that was waited for came: the next one has to be asked for again.
    expect(oauthCallbackExpected()).toBe(false)
  })

  it('iPhone: closing the sheet is a cancel, said to nobody, and nothing goes on waiting', async () => {
    standOn('iphone')
    phonePage.showPhoneOAuthPage.mockResolvedValue({ kind: 'cancelled' })
    await expect(loginWithProvider('google')).rejects.toThrow('Sign-in cancelled.')
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
    // A second attempt right after it is a fresh one, not the "replaced" first.
    phonePage.showPhoneOAuthPage.mockResolvedValue({ kind: 'returned', url: 'lu://oauth/callback?code=second' })
    await expect(loginWithProvider('google')).resolves.toBeUndefined()
  })

  it('the page does not open: one honest sentence at once, never a wait for a browser that did not come', async () => {
    for (const device of ['iphone', 'android'] as const) {
      standOn(device)
      vi.useFakeTimers()
      phonePage.showPhoneOAuthPage.mockRejectedValue(new Error('Scoped shell IO error: No such file or directory (os error 2)'))
      const browserOpen = vi.fn()
      const login = loginWithProvider('google', undefined, browserOpen)
      const seen = login.then(() => 'resolved', (err: Error) => err.message)
      // No timer has to run for it: the answer is there before the five minutes begin.
      await vi.advanceTimersByTimeAsync(0)
      expect(await seen, device).toBe(MOBILE_OAUTH_NOT_OPENED)
      expect(browserOpen).not.toHaveBeenCalled()
      // The raw text of the system is not what the caller gets.
      expect(MOBILE_OAUTH_NOT_OPENED).not.toMatch(/shell|os error|No such file/i)
      // Nothing is left waiting: a link that arrives now finds no sign-in to reject or resolve twice.
      expect(vi.getTimerCount()).toBe(0)
      vi.useRealTimers()
    }
  })

  it('the sheet comes back with a refusal of the provider: the sentence for it, quoted', async () => {
    standOn('iphone')
    phonePage.showPhoneOAuthPage.mockResolvedValue({ kind: 'returned', url: 'lu://oauth/callback?error=access_denied&error_description=No+thanks' })
    await expect(loginWithProvider('google')).rejects.toThrow('The sign-in page reported: "No thanks"')
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('the sheet comes back with something that is not the sign-in link: not opened, nothing exchanged', async () => {
    standOn('iphone')
    phonePage.showPhoneOAuthPage.mockResolvedValue({ kind: 'returned', url: 'lu://chat/123' })
    await expect(loginWithProvider('google')).rejects.toThrow(MOBILE_OAUTH_NOT_OPENED)
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('the exchange of the code from the sheet fails: the reason, and no endless wait', async () => {
    standOn('iphone')
    auth.exchangeCodeForSession.mockResolvedValue({ error: { message: 'invalid flow state' } })
    phonePage.showPhoneOAuthPage.mockResolvedValue({ kind: 'returned', url: 'lu://oauth/callback?code=bad' })
    await expect(loginWithProvider('google')).rejects.toThrow('invalid flow state')
  })

  it('Cancel while the sheet or the browser is still being put up ends the sign-in', async () => {
    standOn('android')
    let open: (page: { kind: 'opened' }) => void = () => {}
    phonePage.showPhoneOAuthPage.mockImplementation(() => new Promise((resolve) => { open = resolve }))
    const controller = new AbortController()
    const login = loginWithProvider('google', controller.signal)
    login.catch(() => {})
    await vi.waitFor(() => expect(phonePage.showPhoneOAuthPage).toHaveBeenCalled())
    controller.abort()
    open({ kind: 'opened' })
    await expect(login).rejects.toThrow('Sign-in cancelled.')
  })
})
