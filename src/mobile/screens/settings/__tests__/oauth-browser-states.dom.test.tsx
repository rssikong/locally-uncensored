// @vitest-environment jsdom
/**
 * Check on the iPhone, round 22, N5: after a tap on "Continue with Google"
 * the page said "Waiting for your browser" and no browser came, for as long
 * as one cared to look.
 *
 * What the page Account shows now, for every way the provider page can end:
 *   - "Waiting for your browser" only once a browser is really in front,
 *   - an honest sentence with "Try again" when the page did not open,
 *   - nothing when the user closed the sheet or tapped Cancel.
 *
 * Run: npx vitest run src/mobile/screens/settings/__tests__/oauth-browser-states.dom.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

type Login = (provider: string, signal?: AbortSignal, onBrowserOpen?: () => void) => Promise<void>
const h = vi.hoisted(() => ({
  loginWithProvider: vi.fn<Login>(async () => {}),
  probeAccount: vi.fn(async () => {}),
}))

vi.mock('../../../../api/cloud/supabase', async (original) => ({
  ...(await original<typeof import('../../../../api/cloud/supabase')>()),
  loginWithProvider: h.loginWithProvider,
}))
vi.mock('../../../../hooks/useCloudAuth', () => ({ probeAccount: h.probeAccount, signOutAccount: vi.fn(async () => {}) }))

import { MOBILE_OAUTH_NOT_OPENED } from '../../../../api/cloud/supabase'
import { useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import { setStorePresetForTests } from '../../../policy'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import AccountPage from '../AccountPage'
import { isOAuthCancel, isOAuthNotOpened } from '../parts/auth-errors'

const T = SETTINGS_STRINGS.account

/** A sign-in that is in the hands of the test. */
function held() {
  let resolve: () => void = () => {}
  let reject: (err: Error) => void = () => {}
  let browserOpen: (() => void) | undefined
  let signal: AbortSignal | undefined
  h.loginWithProvider.mockImplementationOnce((_provider, s, open) => {
    signal = s
    browserOpen = open
    return new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
      s?.addEventListener('abort', () => rej(new Error('Sign-in cancelled.')), { once: true })
    })
  })
  return {
    resolve: () => act(async () => resolve()),
    reject: (err: Error) => act(async () => reject(err)),
    browserOpen: () => act(async () => browserOpen?.()),
    aborted: () => signal?.aborted === true,
  }
}

const tap = (testid: string) => act(async () => { fireEvent.click(screen.getByTestId(testid)) })

beforeEach(() => {
  localStorage.clear()
  h.loginWithProvider.mockReset()
  h.loginWithProvider.mockImplementation(async () => {})
  h.probeAccount.mockClear()
  useCloudAuthStore.setState({ status: 'signed-out' })
  setStorePresetForTests('appstore')
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
})
afterEach(() => {
  cleanup()
  setStorePresetForTests(null)
  vi.unstubAllGlobals()
})

describe('Continue with Google or GitHub, what the page shows', () => {
  it('while the page is being put up: the button is busy, and nobody speaks of a browser yet', async () => {
    const login = held()
    render(<AccountPage />)
    await tap('m-account-google')
    expect(h.loginWithProvider).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('m-account-oauth-waiting')).toBeNull()
    expect(screen.getByTestId('m-account-google').getAttribute('aria-busy')).toBe('true')
    await login.resolve()
  })

  it('a browser in front: "Waiting for your browser" with Cancel, and it goes when the sign-in ends', async () => {
    const login = held()
    render(<AccountPage />)
    await tap('m-account-github')
    await login.browserOpen()
    expect(screen.getByTestId('m-account-oauth-waiting').textContent).toContain(T.oauthWaiting)
    expect(screen.getByTestId('m-account-oauth-cancel').textContent).toBe(T.oauthCancel)
    await login.resolve()
    expect(screen.queryByTestId('m-account-oauth-waiting')).toBeNull()
    expect(screen.queryByTestId('m-account-oauth-not-opened')).toBeNull()
  })

  it('iPhone: the sheet of the system never makes the page say that it waits for a browser', async () => {
    // The sheet lies over the app and hands the link back itself: onBrowserOpen is never called.
    const login = held()
    render(<AccountPage />)
    await tap('m-account-google')
    expect(screen.queryByTestId('m-account-oauth-waiting')).toBeNull()
    await login.resolve()
    expect(screen.queryByTestId('m-account-oauth-waiting')).toBeNull()
    expect(screen.queryByTestId('m-account-error')).toBeNull()
  })

  it('the page did not open: one honest sentence with "Try again", no wait, and the buttons work again', async () => {
    const login = held()
    render(<AccountPage />)
    await tap('m-account-google')
    await login.reject(new Error(MOBILE_OAUTH_NOT_OPENED))
    const box = screen.getByTestId('m-account-oauth-not-opened')
    expect(box.textContent).toContain(T.oauthNotOpened)
    expect(box.getAttribute('role')).toBe('alert')
    expect(screen.queryByTestId('m-account-oauth-waiting')).toBeNull()
    expect(screen.getByTestId('m-account-google').getAttribute('aria-busy')).not.toBe('true')
    expect((screen.getByTestId('m-account-github') as HTMLButtonElement).disabled).toBe(false)
    // The sentence is for a person: no word of the system, no dash.
    expect(T.oauthNotOpened).not.toMatch(/shell|os error|No such file/)
    expect(T.oauthNotOpened).not.toMatch(new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']'))

    // "Try again" starts the same sign-in again, and the sentence goes while it runs.
    const second = held()
    await tap('m-account-oauth-retry')
    expect(h.loginWithProvider).toHaveBeenCalledTimes(2)
    expect(h.loginWithProvider.mock.calls[1][0]).toBe('google')
    expect(screen.queryByTestId('m-account-oauth-not-opened')).toBeNull()
    await second.resolve()
    expect(screen.queryByTestId('m-account-oauth-not-opened')).toBeNull()
  })

  it('closing the sheet leads back without a word', async () => {
    const login = held()
    render(<AccountPage />)
    await tap('m-account-google')
    await login.reject(new Error('Sign-in cancelled.'))
    expect(screen.queryByTestId('m-account-oauth-waiting')).toBeNull()
    expect(screen.queryByTestId('m-account-oauth-not-opened')).toBeNull()
    expect(screen.queryByTestId('m-account-error')).toBeNull()
    expect(screen.getByTestId('m-account-google').getAttribute('aria-busy')).not.toBe('true')
  })

  it('Cancel under "Waiting for your browser" ends the wait without a word', async () => {
    const login = held()
    render(<AccountPage />)
    await tap('m-account-google')
    await login.browserOpen()
    await tap('m-account-oauth-cancel')
    expect(login.aborted()).toBe(true)
    expect(screen.queryByTestId('m-account-oauth-waiting')).toBeNull()
    expect(screen.queryByTestId('m-account-oauth-not-opened')).toBeNull()
    expect(screen.queryByTestId('m-account-error')).toBeNull()
  })

  it('any other failure keeps its own sentence, not the one about the page', async () => {
    const login = held()
    render(<AccountPage />)
    await tap('m-account-google')
    await login.reject(new Error('invalid flow state'))
    expect(screen.getByTestId('m-account-error').textContent).toBe(T.errUnknown)
    expect(screen.queryByTestId('m-account-oauth-not-opened')).toBeNull()
  })
})

describe('reading the sentences of the logic layer', () => {
  it('"not opened" is told apart from a cancel and from everything else', () => {
    expect(isOAuthNotOpened(new Error(MOBILE_OAUTH_NOT_OPENED))).toBe(true)
    expect(isOAuthCancel(new Error(MOBILE_OAUTH_NOT_OPENED))).toBe(false)
    for (const other of ['Sign-in cancelled.', 'Sign-in was cancelled in the browser.', 'invalid flow state', 'Sign-in timed out. Tap the sign-in button to try again.', '']) {
      expect(isOAuthNotOpened(new Error(other)), other).toBe(false)
    }
    expect(isOAuthNotOpened(null)).toBe(false)
  })
})
