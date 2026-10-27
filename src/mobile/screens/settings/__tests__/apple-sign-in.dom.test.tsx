// @vitest-environment jsdom
/**
 * "Sign in with Apple" on the page Account (round 15, store switch `appleSignIn`).
 *
 * Apple's rule 4.8 asks for it wherever a sign in through a third party is
 * offered, and David decided on 10.10.2026 that Google and GitHub stay in
 * the App Store build. The sheet is the one of the system (plugin lu-native,
 * AppleSignIn.swift); here the plugin is played, and so is the account
 * server. What is held:
 *
 *  - where the button is: on iOS in every preset, never on Android, never
 *    with the switch off, and above Google and GitHub,
 *  - the nonce: the text the plugin gets is the text the account server
 *    gets, and what Apple would write into the token is its SHA-256,
 *  - the three ends: signed in, closed by the user (says nothing), failed
 *    (one English sentence),
 *  - that the token is kept nowhere,
 *  - the sentence about the same way to sign in.
 *
 * Run: npx vitest run src/mobile/screens/settings/__tests__/apple-sign-in.dom.test.tsx
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  signInWithIdToken: vi.fn(),
  updateUser: vi.fn(),
  loginWithProvider: vi.fn(async () => {}),
  probeAccount: vi.fn(async () => {}),
}))

vi.mock('../../../../api/cloud/supabase', async (original) => ({
  ...(await original<typeof import('../../../../api/cloud/supabase')>()),
  loginWithProvider: h.loginWithProvider,
  supabaseCloud: () => ({ auth: { signInWithIdToken: h.signInWithIdToken, updateUser: h.updateUser } }),
}))
vi.mock('../../../../hooks/useCloudAuth', () => ({ probeAccount: h.probeAccount, signOutAccount: vi.fn(async () => {}) }))

import { useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import { APPLE_SIGN_IN_FAILED, APPLE_SIGN_IN_MISSING, appleFailureText, makeAppleNonce } from '../../../platform/apple-sign-in'
import { __setBridgeForTests } from '../../../platform/bridge'
import { STORE_PRESETS, setStorePresetForTests, type StorePreset } from '../../../policy'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import AccountPage from '../AccountPage'
import { AppleSheetError, appleSignInOffered, signInWithApple } from '../parts/auth'

const T = SETTINGS_STRINGS.account
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const PRESETS = ['open', 'play', 'appstore'] as const

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

function device(userAgent: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true })
  Object.defineProperty(window.navigator, 'platform', { value: userAgent.includes('iPhone') ? 'iPhone' : 'Linux armv8l', configurable: true })
}

/** The one line of a preset, for the length of a test. */
function flip(key: 'appleSignIn' | 'thirdPartySignIn', value: boolean, preset: StorePreset = 'appstore'): void {
  ;(STORE_PRESETS[preset] as Record<typeof key, boolean>)[key] = value
}

interface PlayedCredential {
  identityToken: string
  fullName?: string
  givenName?: string
  familyName?: string
}

/**
 * The plugin as AppleSignIn.swift behaves: it hashes the nonce it is handed
 * and Apple writes the hash into the token. `extra` is what the first sign
 * in of an Apple Account adds.
 */
function playedSheet(extra: Partial<PlayedCredential> = {}) {
  return vi.fn(async (nonce: string): Promise<PlayedCredential | null> => ({
    identityToken: `${b64url({ alg: 'RS256' })}.${b64url({ iss: 'https://appleid.apple.com', aud: 'com.purpledoubled.lu', nonce: sha256(nonce) })}.sig`,
    ...extra,
  }))
}

/** The account server as it checks an identity token: the nonce in the token is the SHA-256 of the nonce next to it. */
function playedServer(user: { user_metadata?: Record<string, unknown> } = {}) {
  h.signInWithIdToken.mockImplementation(async (credentials: { provider: string; token: string; nonce?: string }) => {
    const claims = JSON.parse(Buffer.from(credentials.token.split('.')[1], 'base64url').toString('utf8')) as { nonce?: string }
    if (credentials.provider !== 'apple' || !credentials.nonce || claims.nonce !== sha256(credentials.nonce)) {
      return { data: { user: null, session: null }, error: { name: 'AuthApiError', status: 400, message: 'Nonces mismatch' } }
    }
    return { data: { user: { id: 'u1', user_metadata: user.user_metadata ?? {} }, session: {} }, error: null }
  })
}

function show(preset: StorePreset): HTMLElement {
  setStorePresetForTests(preset)
  return render(<AccountPage />).container
}

async function tapApple(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId('m-account-apple'))
  })
}

beforeEach(() => {
  localStorage.clear()
  for (const mock of Object.values(h)) mock.mockReset()
  h.updateUser.mockResolvedValue({ data: {}, error: null })
  h.probeAccount.mockImplementation(async () => {
    useCloudAuthStore.setState({ status: 'signed-in', user: { id: 'u1', email: 'someone@example.com' } } as never)
  })
  useCloudAuthStore.setState({ status: 'signed-out', user: null } as never)
  device(IPHONE)
})
afterEach(() => {
  cleanup()
  for (const preset of PRESETS) {
    flip('appleSignIn', true, preset)
    flip('thirdPartySignIn', true, preset)
  }
  setStorePresetForTests(null)
  __setBridgeForTests(undefined)
  device(DESKTOP)
})

describe('where the button is', () => {
  it.each(PRESETS)('%s on an iPhone: there, with the prescribed words, above Google and GitHub', (preset) => {
    const page = show(preset)
    const apple = screen.getByTestId('m-account-apple')
    expect(apple.textContent).toContain('Sign in with Apple')
    expect(apple.className).toContain('m-btn--apple')
    expect(apple.className).toContain('m-btn--block')
    // The logo is decoration: a screen reader hears the words once.
    expect(apple.querySelector('[aria-hidden="true"]')?.textContent).toBe('\uF8FF')
    const order = Array.from(page.querySelectorAll('[data-testid="m-account-apple"], [data-testid="m-account-google"], [data-testid="m-account-github"]')).map((el) => el.getAttribute('data-testid'))
    expect(order).toEqual(['m-account-apple', 'm-account-google', 'm-account-github'])
    // As prominent as the others: the same kind of element, full width, not smaller, not folded away.
    expect(apple.tagName).toBe(screen.getByTestId('m-account-google').tagName)
    expect(apple.closest('details, [hidden], [aria-hidden="true"]')).toBeNull()
    expect(appleSignInOffered()).toBe(true)
  })

  it.each(PRESETS)('%s on Android: no button and no word about Apple', (preset) => {
    device(ANDROID)
    const page = show(preset)
    expect(screen.queryByTestId('m-account-apple')).toBeNull()
    expect(page.textContent).not.toMatch(/apple/i)
    expect(appleSignInOffered()).toBe(false)
    // Google and GitHub are untouched there.
    expect(screen.getByTestId('m-account-google')).toBeTruthy()
    expect(screen.getByTestId('m-account-github')).toBeTruthy()
  })

  it('neither a desktop browser nor an unknown device has it', () => {
    device(DESKTOP)
    show('open')
    expect(screen.queryByTestId('m-account-apple')).toBeNull()
  })

  it('an iPad that reports a Mac has it', () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)', configurable: true })
    Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true })
    Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 5, configurable: true })
    show('appstore')
    expect(screen.getByTestId('m-account-apple')).toBeTruthy()
    Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 0, configurable: true })
  })

  it('the switch off: no button on an iPhone either, and nothing can be started', async () => {
    flip('appleSignIn', false)
    const sheet = playedSheet()
    __setBridgeForTests({ appleSignIn: sheet })
    const page = show('appstore')
    expect(screen.queryByTestId('m-account-apple')).toBeNull()
    expect(page.textContent).not.toMatch(/apple/i)
    await expect(signInWithApple()).rejects.toBeInstanceOf(AppleSheetError)
    expect(sheet).not.toHaveBeenCalled()
    expect(h.signInWithIdToken).not.toHaveBeenCalled()
  })

  it('on Android nothing can be started, whoever asks', async () => {
    device(ANDROID)
    const sheet = playedSheet()
    __setBridgeForTests({ appleSignIn: sheet })
    setStorePresetForTests('open')
    await expect(signInWithApple()).rejects.toThrow(APPLE_SIGN_IN_MISSING)
    expect(sheet).not.toHaveBeenCalled()
    expect(h.signInWithIdToken).not.toHaveBeenCalled()
  })
})

describe('the sentence about the same way to sign in', () => {
  it.each(PRESETS)('%s: stands under the buttons, on an iPhone and on Android', (preset) => {
    for (const ua of [IPHONE, ANDROID]) {
      device(ua)
      const page = show(preset)
      const hint = screen.getByTestId('m-account-same-signin')
      expect(hint.textContent).toBe('Use the same sign-in you used before to reach your existing account.')
      const last = Array.from(page.querySelectorAll('[data-testid="m-account-google"], [data-testid="m-account-github"], [data-testid="m-account-apple"]')).pop() as Element
      expect(last.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      cleanup()
    }
  })

  it('it steers nobody away from a button: no word against Apple, Google or GitHub in it', () => {
    expect(T.sameSignIn).not.toMatch(/apple|google|github|recommend|better|instead|avoid|do not/i)
  })

  it('a build with email and password only has no such sentence', () => {
    flip('appleSignIn', false)
    flip('thirdPartySignIn', false)
    const page = show('appstore')
    expect(screen.queryByTestId('m-account-same-signin')).toBeNull()
    expect(page.textContent).not.toContain(T.orContinue)
  })
})

describe('the nonce', () => {
  it('is 64 hex digits, new every time', () => {
    const many = Array.from({ length: 50 }, () => makeAppleNonce())
    for (const nonce of many) expect(nonce).toMatch(/^[0-9a-f]{64}$/)
    expect(new Set(many).size).toBe(50)
  })

  it('the plugin and the account server get the same text, and the token carries its SHA-256', async () => {
    const sheet = playedSheet()
    __setBridgeForTests({ appleSignIn: sheet })
    playedServer()
    setStorePresetForTests('appstore')
    await expect(signInWithApple()).resolves.toBe('signed-in')
    const handedToPlugin = sheet.mock.calls[0][0]
    const sent = h.signInWithIdToken.mock.calls[0][0] as { provider: string; token: string; nonce: string }
    expect(handedToPlugin).toMatch(/^[0-9a-f]{64}$/)
    expect(sent.nonce).toBe(handedToPlugin)
    expect(sent.provider).toBe('apple')
    // What Apple signed is the hash, never the text itself.
    const claims = JSON.parse(Buffer.from(sent.token.split('.')[1], 'base64url').toString('utf8')) as { nonce: string }
    expect(claims.nonce).toBe(sha256(sent.nonce))
    expect(claims.nonce).not.toBe(sent.nonce)
    expect(Object.keys(sent).sort()).toEqual(['nonce', 'provider', 'token'])
  })

  it('a token made for another nonce is refused by the server, and the page says one sentence', async () => {
    // A plugin that answers with a token of an earlier sign in.
    const stale = `${b64url({ alg: 'RS256' })}.${b64url({ nonce: sha256('an-earlier-nonce') })}.sig`
    __setBridgeForTests({ appleSignIn: vi.fn(async () => ({ identityToken: stale })) })
    playedServer()
    show('appstore')
    await tapApple()
    await waitFor(() => expect(screen.getByTestId('m-account-error').textContent).toBe(T.errApple))
    expect(h.probeAccount).not.toHaveBeenCalled()
    expect(useCloudAuthStore.getState().status).toBe('signed-out')
  })

  it('two sign ins use two nonces', async () => {
    const sheet = playedSheet()
    __setBridgeForTests({ appleSignIn: sheet })
    playedServer()
    setStorePresetForTests('open')
    await signInWithApple()
    await signInWithApple()
    expect(sheet.mock.calls[0][0]).not.toBe(sheet.mock.calls[1][0])
  })
})

describe('signed in', () => {
  it.each(PRESETS)('%s: a tap signs in, without a browser and without a link', async (preset) => {
    const sheet = playedSheet()
    __setBridgeForTests({ appleSignIn: sheet })
    playedServer()
    show(preset)
    await tapApple()
    await waitFor(() => expect(h.probeAccount).toHaveBeenCalledTimes(1))
    expect(sheet).toHaveBeenCalledTimes(1)
    expect(h.signInWithIdToken).toHaveBeenCalledTimes(1)
    expect(h.loginWithProvider).not.toHaveBeenCalled()
    expect(useCloudAuthStore.getState().status).toBe('signed-in')
    expect(screen.queryByTestId('m-account-error')).toBeNull()
    // No link is waited for afterwards.
    expect(localStorage.getItem('lu-oauth-expected-until')).toBeNull()
  })

  it('the token is kept nowhere on the page side', async () => {
    const sheet = playedSheet()
    __setBridgeForTests({ appleSignIn: sheet })
    playedServer()
    show('appstore')
    await tapApple()
    await waitFor(() => expect(h.probeAccount).toHaveBeenCalled())
    const token = (h.signInWithIdToken.mock.calls[0][0] as { token: string }).token
    const stored = Object.keys(localStorage).map((key) => `${key}=${localStorage.getItem(key)}`).join('\n') + Object.keys(sessionStorage).map((key) => sessionStorage.getItem(key)).join('\n')
    expect(stored).not.toContain(token)
    expect(stored).not.toContain(sheet.mock.calls[0][0])
    expect(document.body.innerHTML).not.toContain(token)
  })

  // Round 16: the app asks Apple for the address only. An app that was not updated yet may still hand a name over.
  it('a name an older build of the plugin still answers goes nowhere: not to the account server, not into storage', async () => {
    __setBridgeForTests({ appleSignIn: playedSheet({ fullName: 'Ada Lovelace', givenName: 'Ada', familyName: 'Lovelace' }) })
    playedServer()
    show('appstore')
    await tapApple()
    await waitFor(() => expect(h.probeAccount).toHaveBeenCalledTimes(1))
    // The app shows a name nowhere, and what is not collected needs no line in the privacy declaration.
    expect(h.updateUser).not.toHaveBeenCalled()
    expect(JSON.stringify(h.signInWithIdToken.mock.calls)).not.toMatch(/Ada|Lovelace/)
    const stored = Object.keys(localStorage).map((key) => `${key}=${localStorage.getItem(key)}`).join('\n')
    expect(stored).not.toMatch(/Ada|Lovelace/)
    expect(document.body.textContent).not.toMatch(/Ada|Lovelace/)
  })

  it('a second tap while the sheet is open starts no second one', async () => {
    let close: (value: PlayedCredential | null) => void = () => {}
    const sheet = vi.fn(() => new Promise<PlayedCredential | null>((resolve) => (close = resolve)))
    __setBridgeForTests({ appleSignIn: sheet })
    show('appstore')
    await tapApple()
    await waitFor(() => expect(sheet).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('m-account-apple').getAttribute('aria-busy')).toBe('true')
    await tapApple()
    // Google and GitHub wait as well: two sign ins at once end in an account nobody chose.
    expect((screen.getByTestId('m-account-google') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('m-account-google'))
    expect(sheet).toHaveBeenCalledTimes(1)
    expect(h.loginWithProvider).not.toHaveBeenCalled()
    await act(async () => close(null))
    await waitFor(() => expect(screen.getByTestId('m-account-apple').getAttribute('aria-busy')).toBeNull())
  })
})

describe('closed by the user', () => {
  it('says nothing, signs nobody in, asks no server, and the button works again', async () => {
    const sheet = vi.fn(async (): Promise<PlayedCredential | null> => null)
    __setBridgeForTests({ appleSignIn: sheet })
    playedServer()
    const page = show('appstore')
    const before = page.textContent
    await tapApple()
    await waitFor(() => expect(screen.getByTestId('m-account-apple').getAttribute('aria-busy')).toBeNull())
    expect(sheet).toHaveBeenCalledTimes(1)
    expect(h.signInWithIdToken).not.toHaveBeenCalled()
    expect(h.probeAccount).not.toHaveBeenCalled()
    expect(screen.queryByTestId('m-account-error')).toBeNull()
    expect(screen.queryByTestId('m-account-notice')).toBeNull()
    expect(page.textContent).toBe(before)
    expect(useCloudAuthStore.getState().status).toBe('signed-out')
    await tapApple()
    expect(sheet).toHaveBeenCalledTimes(2)
  })

  it('the function answers "cancelled" and throws nothing', async () => {
    __setBridgeForTests({ appleSignIn: vi.fn(async () => null) })
    setStorePresetForTests('play')
    await expect(signInWithApple()).resolves.toBe('cancelled')
  })
})

describe('failed', () => {
  const NATIVE = 'Sign in with Apple is not available right now. Check that this device is signed in to an Apple Account in the system settings, then try again.'

  it('a sentence of the system sheet is shown as it is', async () => {
    // What Rust hands on from Swift: the plain text of the rejection.
    __setBridgeForTests({ appleSignIn: vi.fn(async () => Promise.reject(NATIVE)) })
    show('appstore')
    await tapApple()
    await waitFor(() => expect(screen.getByTestId('m-account-error').textContent).toBe(NATIVE))
    expect(screen.getByTestId('m-account-error').getAttribute('role')).toBe('alert')
    expect(h.signInWithIdToken).not.toHaveBeenCalled()
    expect(useCloudAuthStore.getState().status).toBe('signed-out')
    // And the button is free for the next try.
    expect(screen.getByTestId('m-account-apple').getAttribute('aria-busy')).toBeNull()
  })

  it.each([
    ['a code', '1000'],
    ['a dump', '{"code":1000,"domain":"com.apple.AuthenticationServices.AuthorizationError"}'],
    ['an object without words', { code: 1000 }],
    ['nothing', undefined],
    ['a text over several lines', 'The operation failed.\nat AppleSignIn.swift:88'],
    ['a text without an end', 'something went wrong'],
  ])('%s from the bridge ends in the plain sentence, never on screen as it came', async (_name, raw) => {
    __setBridgeForTests({ appleSignIn: vi.fn(async () => Promise.reject(raw)) })
    show('appstore')
    await tapApple()
    await waitFor(() => expect(screen.getByTestId('m-account-error').textContent).toBe(APPLE_SIGN_IN_FAILED))
  })

  it('every sentence a failure can end in is English, one line, with a full stop and without a dash', () => {
    for (const sentence of [APPLE_SIGN_IN_FAILED, APPLE_SIGN_IN_MISSING, T.errApple, appleFailureText(NATIVE), appleFailureText(new Error('The native part of the app did not answer.'))]) {
      expect(sentence).toMatch(/^[A-Z][^\n\u2013\u2014]+\.$/)
    }
  })

  it('an app without the command (an older native part, a browser): one sentence, no server asked', async () => {
    __setBridgeForTests(null)
    show('appstore')
    await tapApple()
    await waitFor(() => expect(screen.getByTestId('m-account-error').textContent).toBe(APPLE_SIGN_IN_MISSING))
    expect(h.signInWithIdToken).not.toHaveBeenCalled()
  })

  it('a bridge that answers without a token is a failure, not a sign in', async () => {
    __setBridgeForTests({ appleSignIn: vi.fn(async () => ({ identityToken: '' })) })
    show('appstore')
    await tapApple()
    await waitFor(() => expect(screen.getByTestId('m-account-error').textContent).toBe(APPLE_SIGN_IN_FAILED))
    expect(h.signInWithIdToken).not.toHaveBeenCalled()
  })

  it.each([
    ['the provider is not set up at the account server', { name: 'AuthApiError', status: 400, code: 'provider_disabled', message: 'Provider (issuer "https://appleid.apple.com") is not enabled' }, 'errApple'],
    ['the app is not known to the account server', { name: 'AuthApiError', status: 400, message: 'Unacceptable audience in id_token: [com.purpledoubled.lu]' }, 'errApple'],
    ['no network on the way to the account server', { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, 'errOffline'],
    ['too many tries', { name: 'AuthApiError', status: 429, code: 'over_request_rate_limit', message: 'rate limit' }, 'errTooMany'],
    ['the account server is down', { name: 'AuthApiError', status: 503, message: 'upstream' }, 'errServer'],
  ] as const)('%s: a sentence of the app, never the text of the server', async (_name, error, key) => {
    __setBridgeForTests({ appleSignIn: playedSheet() })
    h.signInWithIdToken.mockResolvedValue({ data: { user: null, session: null }, error })
    show('appstore')
    await tapApple()
    await waitFor(() => expect(screen.getByTestId('m-account-error').textContent).toBe(T[key]))
    expect(screen.getByTestId('m-account-error').textContent).not.toContain(error.message)
    expect(h.probeAccount).not.toHaveBeenCalled()
  })

  it('offline: said before the sheet opens', async () => {
    const sheet = playedSheet()
    __setBridgeForTests({ appleSignIn: sheet })
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    try {
      show('appstore')
      await tapApple()
      expect(screen.getByTestId('m-account-error').textContent).toBe(T.errOffline)
      expect(sheet).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
    }
  })

  it('the account could not be read after the token was taken: said, not shown as nothing', async () => {
    __setBridgeForTests({ appleSignIn: playedSheet() })
    playedServer()
    h.probeAccount.mockImplementation(async () => {})
    show('appstore')
    await tapApple()
    await waitFor(() => expect(screen.getByTestId('m-account-error').textContent).toBe(T.errServer))
  })
})

describe('the scope of "Sign in with Apple" (round 16)', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', '..', '..', '..', ...parts), 'utf8')

  it('asks Apple for the address only, and no layer carries a name', () => {
    const swift = read('src-tauri', 'plugins', 'lu-native', 'ios', 'Sources', 'AppleSignIn.swift')
    expect(swift).toContain('request.requestedScopes = [.email]')
    expect(swift).not.toMatch(/\.fullName|givenName|familyName/)
    expect(read('src-tauri', 'plugins', 'lu-native', 'ios', 'Sources', 'AppleSignInRule.swift')).not.toMatch(/fullName|givenName|familyName/)
    const bridge = read('src', 'lib', 'lu-native.ts')
    const apple = bridge.slice(bridge.indexOf('export interface AppleSignInAnswer'), bridge.indexOf('export const appleSignIn') + 900)
    // The token, and since round 32 the one-time code for deleting the account. Field by field, nothing else is passed on.
    expect(apple).toContain('const result: AppleSignInAnswer = { identityToken: answer.identityToken }')
    expect(apple).toContain('result.authorizationCode = answer.authorizationCode')
    expect(apple).not.toContain('...answer')
    expect(apple).not.toMatch(/fullName|givenName|familyName/)
    expect(read('src', 'mobile', 'platform', 'apple-sign-in.ts')).not.toMatch(/fullName|givenName|familyName/)
    expect(read('src', 'mobile', 'platform', 'bridge.ts')).not.toMatch(/fullName|givenName|familyName/)
  })
})
