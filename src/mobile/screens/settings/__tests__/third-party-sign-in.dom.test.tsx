// @vitest-environment jsdom
/**
 * Store switch `thirdPartySignIn`.
 *
 * Apple's rule 4.8: an app that offers a sign in through a third party
 * (Google, GitHub) has to offer an equivalent one, in practice "Sign in with
 * Apple". Round 14 turned the switch off in the App Store preset because
 * that was not built. David decided on 10.10.2026 that Google and GitHub
 * stay in the App Store build (most accounts were made that way), and round
 * 15 built "Sign in with Apple" (apple-sign-in.dom.test.tsx). So the switch
 * is on in all three presets now.
 *
 * The switch itself stays, and what it does when it is off stays held here:
 * the line of the App Store preset is turned off for the length of a test
 * (`flip`). Three things: what the page Account shows, that no such sign in
 * can be started in such a build whoever asks, and that the link
 * lu://oauth/callback, which still exists for "Forgot password?", breaks
 * nothing when it arrives unasked.
 *
 * Run: npx vitest run src/mobile/screens/settings/__tests__/third-party-sign-in.dom.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({
  loginWithProvider: vi.fn(async (_provider: string, _signal?: AbortSignal) => {}),
  probeAccount: vi.fn(async () => {}),
}))

vi.mock('../../../../api/cloud/supabase', async (original) => ({
  ...(await original<typeof import('../../../../api/cloud/supabase')>()),
  loginWithProvider: h.loginWithProvider,
}))
vi.mock('../../../../hooks/useCloudAuth', () => ({ probeAccount: h.probeAccount, signOutAccount: vi.fn(async () => {}) }))

import { OAUTH_NOT_EXPECTED, handleOAuthCallbackUrl } from '../../../../api/cloud/supabase'
import { reportIncomingUrl } from '../../../../lib/incoming-url'
import { useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import { navApi } from '../../../nav/api'
import { STORE_PRESETS, setStorePresetForTests, type StorePreset } from '../../../policy'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import AccountPage from '../AccountPage'
import { THIRD_PARTY_SIGN_IN_OFF, signInWithProvider } from '../parts/auth'

const T = SETTINGS_STRINGS.account
let network = vi.fn()

/** The one line of the App Store preset, for the length of a test. */
function flip(value: boolean): void {
  ;(STORE_PRESETS.appstore as { thirdPartySignIn: boolean }).thirdPartySignIn = value
}

function show(preset: StorePreset): HTMLElement {
  setStorePresetForTests(preset)
  return render(<AccountPage />).container
}

beforeEach(() => {
  localStorage.clear()
  h.loginWithProvider.mockClear()
  h.probeAccount.mockClear()
  useCloudAuthStore.setState({ status: 'signed-out' })
  // Nothing in this file may reach a server: a request that is tried is counted and fails.
  network = vi.fn(async () => {
    throw new TypeError('Failed to fetch')
  })
  vi.stubGlobal('fetch', network)
})
afterEach(() => {
  cleanup()
  flip(true)
  setStorePresetForTests(null)
  vi.unstubAllGlobals()
})

describe('the page Account, signed out', () => {
  it.each(['open', 'play', 'appstore'] as const)('%s: both buttons are there', (preset) => {
    const page = show(preset)
    expect(screen.getByTestId('m-account-google').textContent).toBe(T.google)
    expect(screen.getByTestId('m-account-github').textContent).toBe(T.github)
    expect(page.textContent).toContain(T.orContinue)
  })

  it('a build with the switch off: email and password only, and no word about another way', () => {
    flip(false)
    const page = show('appstore')
    expect(screen.queryByTestId('m-account-google')).toBeNull()
    expect(screen.queryByTestId('m-account-github')).toBeNull()
    expect(screen.queryByTestId('m-account-oauth-waiting')).toBeNull()
    expect(page.textContent).not.toMatch(/google|github|continue with|your browser\. finish/i)
    for (const el of Array.from(page.querySelectorAll('[aria-label], [title], [placeholder]'))) {
      for (const name of ['aria-label', 'title', 'placeholder']) expect(el.getAttribute(name) ?? '').not.toMatch(/google|github/i)
    }
    // What stays: both modes, the two fields, the button, and the way to a new password.
    expect(screen.getByTestId('m-account-mode-signin')).toBeTruthy()
    expect(screen.getByTestId('m-account-mode-signup')).toBeTruthy()
    expect(screen.getByTestId('m-account-email')).toBeTruthy()
    expect(screen.getByTestId('m-account-password')).toBeTruthy()
    expect(screen.getByTestId('m-account-signin')).toBeTruthy()
    expect(screen.getByTestId('m-account-forgot').textContent).toContain(T.forgot)
  })

  it('no sentence a failed sign in can end in names a third party', () => {
    const errors = Object.entries(T).filter(([key, value]) => key.startsWith('err') && typeof value === 'string')
    expect(errors.length).toBeGreaterThan(5)
    for (const [key, value] of errors) expect(value as string, key).not.toMatch(/google|github|continue with/i)
    expect(THIRD_PARTY_SIGN_IN_OFF).not.toMatch(/google|github|apple/i)
  })
})

describe('starting a sign in through a third party', () => {
  it('every preset: goes to the logic layer', async () => {
    for (const preset of ['open', 'play', 'appstore'] as const) {
      setStorePresetForTests(preset)
      await signInWithProvider('google', new AbortController().signal)
    }
    expect(h.loginWithProvider).toHaveBeenCalledTimes(3)
  })

  it('a build with the switch off: refused before anything is started, whoever asks', async () => {
    flip(false)
    setStorePresetForTests('appstore')
    for (const provider of ['google', 'github'] as const) {
      await expect(signInWithProvider(provider, new AbortController().signal)).rejects.toThrow(THIRD_PARTY_SIGN_IN_OFF)
    }
    expect(h.loginWithProvider).not.toHaveBeenCalled()
    expect(h.probeAccount).not.toHaveBeenCalled()
    // Nothing waits for a link afterwards.
    expect(localStorage.getItem('lu-oauth-expected-until')).toBeNull()
  })

  it('it is one line in the preset, on in all three since 10.10.2026', () => {
    expect(STORE_PRESETS.appstore.thirdPartySignIn).toBe(true)
    expect(STORE_PRESETS.play.thirdPartySignIn).toBe(true)
    expect(STORE_PRESETS.open.thirdPartySignIn).toBe(true)
    // And the App Store build never has it without "Sign in with Apple" (rule 4.8).
    expect(STORE_PRESETS.appstore.appleSignIn).toBe(true)
  })
})

describe.each([
  ['the App Store build as it is', true],
  ['a build with the switch off', false],
] as const)('%s: the link lu://oauth/callback arrives although nobody asked', (_name, thirdParty) => {
  beforeEach(() => flip(thirdParty))

  const LINKS = ['lu://oauth/callback?code=abc123', 'lu://oauth/callback?error=access_denied&error_description=x', 'lu://oauth/callback', 'lu://oauth/callback#access_token=t&refresh_token=r']

  it.each(LINKS)('%s is taken, signs nobody in and opens nothing', async (link) => {
    show('appstore')
    const before = JSON.stringify({ stack: navApi.getState().stacks, overlays: navApi.getState().overlays, flow: navApi.getState().flow })
    await expect(reportIncomingUrl(link)).resolves.toBe(true)
    // The logic layer dropped it: nobody on this phone asked for a link. No code went to the server.
    expect(await handleOAuthCallbackUrl(link)).toEqual({ handled: true, ok: false, error: OAUTH_NOT_EXPECTED })
    expect(network).not.toHaveBeenCalled()
    expect(useCloudAuthStore.getState().status).toBe('signed-out')
    expect(JSON.stringify({ stack: navApi.getState().stacks, overlays: navApi.getState().overlays, flow: navApi.getState().flow })).toBe(before)
    // The page is as it was: the form, no error, no notice.
    expect(screen.getByTestId('m-account-signin')).toBeTruthy()
    expect(screen.queryByTestId('m-account-error')).toBeNull()
    expect(screen.queryByTestId('m-account-notice')).toBeNull()
    expect(screen.queryByTestId('m-account-google') !== null).toBe(thirdParty)
    expect(screen.queryByTestId('m-account-oauth-waiting')).toBeNull()
  })

  it('the link of a reset mail that was asked for here is not dropped: "Forgot password?" keeps its way back', async () => {
    setStorePresetForTests('appstore')
    // What requestPasswordReset leaves behind on a phone (api/cloud/supabase.ts): a link is expected for an hour.
    localStorage.setItem('lu-oauth-expected-until', String(Date.now() + 30 * 60_000))
    const result = await handleOAuthCallbackUrl('lu://oauth/callback?code=from-the-reset-mail')
    // It got past the door and to the exchange. That fails here (no server, no verifier), which is not the point.
    expect(result.handled).toBe(true)
    expect(result).not.toMatchObject({ error: OAUTH_NOT_EXPECTED })
  })
})
