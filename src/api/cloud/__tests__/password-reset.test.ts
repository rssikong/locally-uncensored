/**
 * "Forgot password?" in the logic layer: the request for the reset mail, the
 * moment the link came back, and setting the new password. The auth client is
 * a stand-in; nothing here reaches a server.
 *
 * Run: npx vitest run src/api/cloud/__tests__/password-reset.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { standOn } from '../../../test-support/devices'

vi.mock('../../backend', () => ({
  oauthStart: vi.fn(),
  oauthWait: vi.fn(),
  openExternal: vi.fn(),
  secretGet: vi.fn(),
  secretSet: vi.fn(),
  secretDelete: vi.fn(),
}))
vi.mock('../config', () => ({ SUPABASE_URL: 'https://x.test', SUPABASE_ANON_KEY: 'anon' }))

const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth }) }))

import { __resetMobileOAuthForTests, handleOAuthCallbackUrl, onPasswordRecovery, requestPasswordReset, setNewPassword } from '../supabase'

const store = new Map<string, string>()

beforeEach(() => {
  __resetMobileOAuthForTests()
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  auth.exchangeCodeForSession.mockReset()
  auth.resetPasswordForEmail.mockReset().mockResolvedValue({ data: {}, error: null })
  auth.updateUser.mockReset().mockResolvedValue({ data: {}, error: null })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('requestPasswordReset', () => {
  it('on a phone the mail leads back into the app', async () => {
    standOn('android')
    await requestPasswordReset('  someone@example.com ')
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('someone@example.com', { redirectTo: 'lu://oauth/callback' })
  })

  it('on an iPhone too', async () => {
    standOn('iphone')
    await requestPasswordReset('someone@example.com')
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('someone@example.com', { redirectTo: 'lu://oauth/callback' })
  })

  it('on the desktop no app link is asked for', async () => {
    standOn('windows')
    await requestPasswordReset('someone@example.com')
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('someone@example.com', undefined)
  })

  it('resolves the same for any address: the server does not say whether an account exists', async () => {
    standOn('android')
    await expect(requestPasswordReset('nobody@example.com')).resolves.toBeUndefined()
  })

  it('rejects with the error of the auth server when the request itself failed', async () => {
    standOn('android')
    const error = Object.assign(new Error('rate limit'), { status: 429, code: 'over_email_send_rate_limit' })
    auth.resetPasswordForEmail.mockResolvedValue({ data: null, error })
    await expect(requestPasswordReset('someone@example.com')).rejects.toBe(error)
  })
})

describe('onPasswordRecovery', () => {
  // The link of a reset mail is only taken after a reset was asked for on
  // this phone (review N2), so every case here asks first.
  beforeEach(async () => {
    standOn('android')
    await requestPasswordReset('someone@example.com')
  })

  const recovered = { data: { session: {}, user: {}, redirectType: 'recovery' }, error: null }
  const signedIn = { data: { session: {}, user: {}, redirectType: null }, error: null }

  it('is told when the code of a reset mail was exchanged, after the exchange is over', async () => {
    vi.useFakeTimers()
    auth.exchangeCodeForSession.mockResolvedValue(recovered)
    const heard = vi.fn()
    onPasswordRecovery(heard)
    expect(await handleOAuthCallbackUrl('lu://oauth/callback?code=reset-1')).toEqual({ handled: true, ok: true })
    // Not from inside the exchange: a listener may call the auth client itself.
    expect(heard).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('is not told about an ordinary sign in', async () => {
    vi.useFakeTimers()
    auth.exchangeCodeForSession.mockResolvedValue(signedIn)
    const heard = vi.fn()
    onPasswordRecovery(heard)
    await handleOAuthCallbackUrl('lu://oauth/callback?code=google-1')
    vi.runAllTimers()
    expect(heard).not.toHaveBeenCalled()
  })

  it('is not told when the code was refused', async () => {
    vi.useFakeTimers()
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null, user: null, redirectType: null }, error: { message: 'bad code' } })
    const heard = vi.fn()
    onPasswordRecovery(heard)
    expect((await handleOAuthCallbackUrl('lu://oauth/callback?code=old')).handled).toBe(true)
    vi.runAllTimers()
    expect(heard).not.toHaveBeenCalled()
  })

  it('keeps a reset that came in before anybody listened: the app was started by the link', async () => {
    vi.useFakeTimers()
    auth.exchangeCodeForSession.mockResolvedValue(recovered)
    await handleOAuthCallbackUrl('lu://oauth/callback?code=reset-cold')
    vi.runAllTimers()
    const heard = vi.fn()
    onPasswordRecovery(heard)
    vi.runAllTimers()
    expect(heard).toHaveBeenCalledTimes(1)
    // Once: a second listener later is not asked for a password again.
    const late = vi.fn()
    onPasswordRecovery(late)
    vi.runAllTimers()
    expect(late).not.toHaveBeenCalled()
  })

  it('stops telling a listener that left', async () => {
    vi.useFakeTimers()
    auth.exchangeCodeForSession.mockResolvedValue(recovered)
    const gone = vi.fn()
    const stays = vi.fn()
    onPasswordRecovery(gone)()
    onPasswordRecovery(stays)
    await handleOAuthCallbackUrl('lu://oauth/callback?code=reset-2')
    vi.runAllTimers()
    expect(gone).not.toHaveBeenCalled()
    expect(stays).toHaveBeenCalledTimes(1)
  })
})

describe('a reset link nobody asked for', () => {
  it('is dropped without an exchange', async () => {
    standOn('iphone')
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: {}, user: {}, redirectType: 'recovery' }, error: null })
    const heard = vi.fn()
    onPasswordRecovery(heard)
    expect(await handleOAuthCallbackUrl('lu://oauth/callback?code=foreign')).toMatchObject({ handled: true, ok: false })
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('is taken for an hour after the reset was asked for, and a desktop leaves no mark', async () => {
    standOn('mac')
    await requestPasswordReset('someone@example.com')
    expect(store.has('lu-oauth-expected-until')).toBe(false)
    standOn('iphone')
    await requestPasswordReset('someone@example.com')
    const until = Number(store.get('lu-oauth-expected-until'))
    expect(until - Date.now()).toBeGreaterThan(59 * 60_000)
    expect(until - Date.now()).toBeLessThanOrEqual(60 * 60_000)
  })
})

describe('setNewPassword', () => {
  it('hands the password to the auth client and resolves', async () => {
    await expect(setNewPassword('a-new-made-up-phrase')).resolves.toBeUndefined()
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'a-new-made-up-phrase' })
  })

  it('rejects with the error of the auth server', async () => {
    const error = Object.assign(new Error('weak'), { code: 'weak_password' })
    auth.updateUser.mockResolvedValue({ data: null, error })
    await expect(setNewPassword('short')).rejects.toBe(error)
  })
})
