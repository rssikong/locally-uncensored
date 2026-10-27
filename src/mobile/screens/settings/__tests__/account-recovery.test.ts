/**
 * "Forgot password?" on the phone: reading a failure into the sentence the
 * sheet shows, and the watch that opens "Choose a new password" when the
 * link of the reset mail came back.
 *
 * Run: npx vitest run src/mobile/screens/settings/__tests__/account-recovery.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  listeners: [] as Array<() => void>,
  openSheet: vi.fn((_id: string) => {}),
  refreshAccount: vi.fn(async () => {}),
  state: { flow: null as string | null, overlays: [] as Array<{ kind: string; sheet: string }> },
}))

vi.mock('../../../../api/cloud/supabase', () => ({
  onPasswordRecovery: (fn: () => void) => {
    h.listeners.push(fn)
    return () => {}
  },
}))
vi.mock('../parts/auth', () => ({ refreshAccount: h.refreshAccount }))
vi.mock('../../../nav', () => ({ nav: { getState: () => h.state, openSheet: h.openSheet } }))

import { SETTINGS_STRINGS } from '../../../strings/settings'
import { __resetPasswordRecoveryForTests, armPasswordRecovery, newPasswordFailure, resetRequestFailure, validResetEmail } from '../parts/password-reset'

describe('validResetEmail', () => {
  it('wants something that looks like an address before anything is sent', () => {
    expect(validResetEmail(' someone@example.com ')).toBe(true)
    expect(validResetEmail('someone@example')).toBe(false)
    expect(validResetEmail('someone example.com')).toBe(false)
    expect(validResetEmail('')).toBe(false)
  })
})

describe('resetRequestFailure', () => {
  it('no network, whatever the error says', () => {
    expect(resetRequestFailure(new Error('anything'), false)).toBe('offline')
    expect(resetRequestFailure({ name: 'AuthRetryableFetchError', message: 'x' }, true)).toBe('offline')
    expect(resetRequestFailure(new TypeError('Failed to fetch'), true)).toBe('offline')
  })

  it('too many requests for one address', () => {
    expect(resetRequestFailure({ code: 'over_email_send_rate_limit', status: 429 }, true)).toBe('too-many')
    expect(resetRequestFailure({ status: 429 }, true)).toBe('too-many')
    expect(resetRequestFailure({ message: 'For security purposes, you can only request this after 52 seconds.' }, true)).toBe('too-many')
  })

  it('an address the server refuses', () => {
    expect(resetRequestFailure({ code: 'email_address_invalid' }, true)).toBe('email-invalid')
    expect(resetRequestFailure({ message: 'Unable to validate email address: invalid format' }, true)).toBe('email-invalid')
  })

  it('everything else is a plain failure, never "sent"', () => {
    expect(resetRequestFailure({ status: 500, message: 'boom' }, true)).toBe('failed')
    expect(resetRequestFailure(null, true)).toBe('failed')
  })
})

describe('newPasswordFailure', () => {
  it('reads the reasons of the auth server', () => {
    expect(newPasswordFailure({ code: 'same_password' }, true)).toBe('same')
    expect(newPasswordFailure({ message: 'New password should be different from the old password.' }, true)).toBe('same')
    expect(newPasswordFailure({ code: 'weak_password', message: 'Password should be at least 8 characters.' }, true)).toBe('short')
    expect(newPasswordFailure({ code: 'weak_password', message: 'Password is known to be weak and easy to guess.' }, true)).toBe('weak')
    expect(newPasswordFailure({ name: 'AuthSessionMissingError', message: 'Auth session missing!' }, true)).toBe('expired')
    expect(newPasswordFailure({ status: 401 }, true)).toBe('expired')
    expect(newPasswordFailure({ status: 500 }, true)).toBe('failed')
    expect(newPasswordFailure({ status: 500 }, false)).toBe('offline')
  })
})

describe('the texts', () => {
  it('never claim that a mail was sent, only that one is on its way if the account exists', () => {
    const T = SETTINGS_STRINGS.reset
    expect(T.sent).toBe('If this address has an account, an email is on its way.')
    expect(`${T.sent} ${T.sentNext} ${T.sentSpam}`).not.toMatch(/we sent|was sent|has been sent/i)
    expect(T.sentNext).toContain('on this phone')
  })
})

describe('armPasswordRecovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: number) => clearTimeout(id) })
    h.listeners.length = 0
    h.openSheet.mockClear()
    h.refreshAccount.mockClear()
    h.state.flow = null
    h.state.overlays = []
    __resetPasswordRecoveryForTests()
  })
  afterEach(() => {
    __resetPasswordRecoveryForTests()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('listens once, however often it is armed', () => {
    armPasswordRecovery()
    armPasswordRecovery()
    expect(h.listeners).toHaveLength(1)
  })

  it('opens "Choose a new password" a moment after the link was exchanged', () => {
    armPasswordRecovery()
    h.listeners[0]()
    expect(h.openSheet).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(h.openSheet).toHaveBeenCalledWith('settings-new-password')
    expect(h.openSheet).toHaveBeenCalledTimes(1)
  })

  it('reads the account at once: the link signed the user in, and the pages have to show that', () => {
    armPasswordRecovery()
    expect(h.refreshAccount).not.toHaveBeenCalled()
    h.listeners[0]()
    expect(h.refreshAccount).toHaveBeenCalledTimes(1)
  })

  it('a failed read of the account does not keep the sheet from opening', async () => {
    h.refreshAccount.mockRejectedValueOnce(new Error('offline'))
    armPasswordRecovery()
    h.listeners[0]()
    await vi.advanceTimersByTimeAsync(300)
    expect(h.openSheet).toHaveBeenCalledTimes(1)
  })

  it('waits while the onboarding runs or "Finish signing in?" is open, then opens', () => {
    armPasswordRecovery()
    h.state.overlays = [{ kind: 'sheet', sheet: 'link-offer' }]
    h.listeners[0]()
    vi.advanceTimersByTime(2000)
    expect(h.openSheet).not.toHaveBeenCalled()
    h.state.overlays = []
    h.state.flow = 'onboarding'
    vi.advanceTimersByTime(2000)
    expect(h.openSheet).not.toHaveBeenCalled()
    h.state.flow = null
    vi.advanceTimersByTime(600)
    expect(h.openSheet).toHaveBeenCalledTimes(1)
  })

  it('does not open a second copy on top of itself', () => {
    armPasswordRecovery()
    h.state.overlays = [{ kind: 'sheet', sheet: 'settings-new-password' }]
    h.listeners[0]()
    vi.advanceTimersByTime(5000)
    expect(h.openSheet).not.toHaveBeenCalled()
  })
})
