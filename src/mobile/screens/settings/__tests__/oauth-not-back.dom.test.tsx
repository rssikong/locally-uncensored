// @vitest-environment jsdom
/**
 * Round 43. On the Android phone "Continue with Google" opened the browser,
 * and the account server led to the start page of the website instead of
 * back into the app (the app address was not on its list yet). Back in LU by
 * hand, the page went on waiting, with a busy button, for five minutes.
 *
 * What the page shows now: once the app is on screen again and no link came
 * within a short grace, one clear sentence with "Try again", and the wait
 * ends. The same for the mail of "Forgot password?". The sheet of an iPhone
 * (it hands the link back itself) is not touched.
 *
 * Run: npx vitest run src/mobile/screens/settings/__tests__/oauth-not-back.dom.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

type Login = (provider: string, signal?: AbortSignal, onBrowserOpen?: () => void) => Promise<void>
const h = vi.hoisted(() => ({
  loginWithProvider: vi.fn<Login>(async () => {}),
  requestPasswordReset: vi.fn(async (_email: string) => {}),
  seen: vi.fn((_since: number) => false),
  probeAccount: vi.fn(async () => {}),
}))

vi.mock('../../../../api/cloud/supabase', async (original) => ({
  ...(await original<typeof import('../../../../api/cloud/supabase')>()),
  loginWithProvider: h.loginWithProvider,
  requestPasswordReset: h.requestPasswordReset,
  oauthCallbackSeenSince: h.seen,
}))
vi.mock('../../../../hooks/useCloudAuth', () => ({ probeAccount: h.probeAccount, signOutAccount: vi.fn(async () => {}) }))

import { SheetContext } from '../../../nav/context'
import { NATIVE_EVENTS } from '../../../platform/contract'
import { setStorePresetForTests } from '../../../policy'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import AccountPage from '../AccountPage'
import ForgotPasswordSheet from '../ForgotPasswordSheet'
import { NO_LINK_BACK_GRACE_MS } from '../parts/no-link-back'

const T = SETTINGS_STRINGS.account
const R = SETTINGS_STRINGS.reset

function held() {
  let resolve: () => void = () => {}
  let browserOpen: (() => void) | undefined
  let signal: AbortSignal | undefined
  h.loginWithProvider.mockImplementationOnce((_provider, s, open) => {
    signal = s
    browserOpen = open
    return new Promise<void>((res, rej) => {
      resolve = res
      s?.addEventListener('abort', () => rej(new Error('Sign-in cancelled.')), { once: true })
    })
  })
  return {
    resolve: () => act(async () => resolve()),
    browserOpen: () => act(async () => browserOpen?.()),
    aborted: () => signal?.aborted === true,
  }
}

const tap = (testid: string) => act(async () => { fireEvent.click(screen.getByTestId(testid)) })
/** The user leaves LU for the browser (or the mail) and comes back by hand. */
const awayAndBack = () =>
  act(async () => {
    window.dispatchEvent(new Event(NATIVE_EVENTS.background))
    window.dispatchEvent(new Event(NATIVE_EVENTS.foreground))
  })
const wait = (ms: number) => act(async () => { vi.advanceTimersByTime(ms) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  localStorage.clear()
  h.loginWithProvider.mockReset()
  h.loginWithProvider.mockImplementation(async () => {})
  h.requestPasswordReset.mockReset()
  h.requestPasswordReset.mockImplementation(async () => {})
  h.seen.mockReset()
  h.seen.mockImplementation(() => false)
  useCloudAuthStore.setState({ status: 'signed-out' })
  setStorePresetForTests('play')
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setStorePresetForTests(null)
  vi.unstubAllGlobals()
})

describe('Google or GitHub: back in LU without the link', () => {
  it('after the grace: one clear sentence with "Try again", and the wait ends', async () => {
    const login = held()
    render(<AccountPage />)
    await tap('m-account-google')
    await login.browserOpen()
    expect(screen.getByTestId('m-account-oauth-waiting')).toBeTruthy()

    await awayAndBack()
    // The link may still be on its way: nothing is said at once.
    await wait(NO_LINK_BACK_GRACE_MS - 100)
    expect(screen.queryByTestId('m-account-oauth-not-back')).toBeNull()
    expect(screen.getByTestId('m-account-oauth-waiting')).toBeTruthy()

    await wait(200)
    const box = screen.getByTestId('m-account-oauth-not-back')
    expect(box.textContent).toContain(T.oauthNotBack)
    expect(box.getAttribute('role')).toBe('alert')
    expect(login.aborted()).toBe(true)
    expect(screen.queryByTestId('m-account-oauth-waiting')).toBeNull()
    expect(screen.getByTestId('m-account-google').getAttribute('aria-busy')).not.toBe('true')
    expect((screen.getByTestId('m-account-github') as HTMLButtonElement).disabled).toBe(false)
    // The way without a browser is named, and stands on the same page.
    expect(T.oauthNotBack).toMatch(/email and password/)
    expect(screen.getByTestId('m-account-email')).toBeTruthy()
    expect(T.oauthNotBack).not.toMatch(new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']'))

    // "Try again" starts the same provider again, and the sentence goes while it runs.
    const second = held()
    await tap('m-account-oauth-not-back-retry')
    expect(h.loginWithProvider).toHaveBeenCalledTimes(2)
    expect(h.loginWithProvider.mock.calls[1][0]).toBe('google')
    expect(screen.queryByTestId('m-account-oauth-not-back')).toBeNull()
    await second.resolve()
  })

  it('GitHub the same way', async () => {
    held()
    render(<AccountPage />)
    await tap('m-account-github')
    await act(async () => h.loginWithProvider.mock.calls[0][2]?.())
    await awayAndBack()
    await wait(NO_LINK_BACK_GRACE_MS + 100)
    expect(screen.getByTestId('m-account-oauth-not-back')).toBeTruthy()
    await tap('m-account-oauth-not-back-retry')
    expect(h.loginWithProvider.mock.calls[1][0]).toBe('github')
  })

  it('the link came with the return: no sentence, the sign in goes on', async () => {
    const login = held()
    render(<AccountPage />)
    await tap('m-account-google')
    await login.browserOpen()
    h.seen.mockImplementation(() => true)
    await awayAndBack()
    await wait(NO_LINK_BACK_GRACE_MS + 500)
    expect(screen.queryByTestId('m-account-oauth-not-back')).toBeNull()
    expect(login.aborted()).toBe(false)
    await login.resolve()
    expect(screen.queryByTestId('m-account-oauth-not-back')).toBeNull()
  })

  it('the sign in ends inside the grace: nothing is said afterwards', async () => {
    const login = held()
    render(<AccountPage />)
    await tap('m-account-google')
    await login.browserOpen()
    await awayAndBack()
    await login.resolve()
    await wait(NO_LINK_BACK_GRACE_MS + 500)
    expect(screen.queryByTestId('m-account-oauth-not-back')).toBeNull()
  })

  it('iPhone: the sheet of the system (no browser in front) is left alone', async () => {
    const login = held()
    render(<AccountPage />)
    await tap('m-account-google')
    await awayAndBack()
    await wait(NO_LINK_BACK_GRACE_MS + 500)
    expect(screen.queryByTestId('m-account-oauth-not-back')).toBeNull()
    expect(login.aborted()).toBe(false)
    await login.resolve()
  })

  it('no wait, no look: coming back to the page says nothing', async () => {
    render(<AccountPage />)
    await awayAndBack()
    await wait(NO_LINK_BACK_GRACE_MS + 500)
    expect(screen.queryByTestId('m-account-oauth-not-back')).toBeNull()
  })
})

describe('Forgot password: back in LU without the link of the mail', () => {
  function renderSheet() {
    const ctx = { entry: { kind: 'sheet', sheet: 'settings-forgot-password', props: { email: 'a@example.com' }, sub: [], key: 's1' }, isTop: true, locked: false }
    return render(
      <SheetContext.Provider value={ctx as never}>
        <ForgotPasswordSheet />
      </SheetContext.Provider>,
    )
  }

  it('asks whether the link opened a web page, with "Try again" that sends a new link', async () => {
    renderSheet()
    await tap('m-account-reset-send')
    expect(screen.getByTestId('m-account-reset-state').getAttribute('data-state')).toBe('sent')
    await awayAndBack()
    await wait(NO_LINK_BACK_GRACE_MS - 100)
    expect(screen.queryByTestId('m-account-reset-not-back')).toBeNull()
    await wait(200)
    const box = screen.getByTestId('m-account-reset-not-back')
    expect(box.textContent).toContain(R.notBack)
    expect(R.notBack).not.toMatch(new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']'))
    await tap('m-account-reset-not-back-retry')
    expect(h.requestPasswordReset).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('m-account-reset-not-back')).toBeNull()
  })

  it('the link of the mail came: nothing is said', async () => {
    renderSheet()
    await tap('m-account-reset-send')
    h.seen.mockImplementation(() => true)
    await awayAndBack()
    await wait(NO_LINK_BACK_GRACE_MS + 500)
    expect(screen.queryByTestId('m-account-reset-not-back')).toBeNull()
  })

  it('before anything was sent, a return says nothing', async () => {
    renderSheet()
    await awayAndBack()
    await wait(NO_LINK_BACK_GRACE_MS + 500)
    expect(screen.queryByTestId('m-account-reset-not-back')).toBeNull()
  })
})
