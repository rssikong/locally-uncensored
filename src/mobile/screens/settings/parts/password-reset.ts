/**
 * "Forgot password?" on the phone, the parts without a screen.
 *
 * The request and the new password go through the logic layer
 * (api/cloud/supabase.ts). What is here: reading a failure into one of a few
 * kinds the sheets have a sentence for, and the watch that opens "Choose a
 * new password" when a reset link came back into the app.
 */
import { onPasswordRecovery } from '../../../../api/cloud/supabase'
import { refreshAccount } from './auth'
import { nav } from '../../../nav'
import { readAuthFailure } from './auth-errors'

export type ResetRequestFailure = 'offline' | 'too-many' | 'email-invalid' | 'failed'

const NETWORK = /failed to fetch|load failed|networkerror|network request failed|fetch failed|unreachable|err_internet|err_network/i

function looksOffline(err: unknown, online: boolean): boolean {
  if (!online) return true
  const f = readAuthFailure(err)
  return f.name === 'AuthRetryableFetchError' || f.status === 0 || NETWORK.test(f.message ?? '')
}

/** Why the request for the reset mail failed. Pure. */
export function resetRequestFailure(err: unknown, online: boolean): ResetRequestFailure {
  if (looksOffline(err, online)) return 'offline'
  const f = readAuthFailure(err)
  const code = (f.code ?? '').toLowerCase()
  const text = (f.message ?? '').toLowerCase()
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || f.status === 429 || text.includes('rate limit') || text.includes('security purposes')) return 'too-many'
  if (code === 'email_address_invalid' || code === 'validation_failed' || text.includes('invalid email') || text.includes('unable to validate email')) return 'email-invalid'
  return 'failed'
}

export type NewPasswordFailure = 'short' | 'same' | 'weak' | 'expired' | 'offline' | 'failed'

/** Why the new password was not saved. Pure. */
export function newPasswordFailure(err: unknown, online: boolean): NewPasswordFailure {
  if (looksOffline(err, online)) return 'offline'
  const f = readAuthFailure(err)
  const code = (f.code ?? '').toLowerCase()
  const text = (f.message ?? '').toLowerCase()
  if (code === 'same_password' || text.includes('different from the old password')) return 'same'
  if (code === 'weak_password') return text.includes('at least') || text.includes('characters') ? 'short' : 'weak'
  if (text.includes('password should be at least')) return 'short'
  if (code === 'session_not_found' || code === 'session_expired' || code === 'no_authorization' || f.name === 'AuthSessionMissingError' || f.status === 401 || f.status === 403) return 'expired'
  return 'failed'
}

/** Checked before anything is sent. Null when the address may go. */
export function validResetEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export const NEW_PASSWORD_MIN = 8

function sheetIsOpen(id: string): boolean {
  return nav.getState().overlays.some((o) => o.kind === 'sheet' && o.sheet === id)
}

let watching = false
let waiting: number | null = null

function openWhenFree(triesLeft: number): void {
  waiting = null
  if (sheetIsOpen('settings-new-password')) return
  // Not on top of the onboarding and not on top of "Finish signing in?": the sheet comes up once those are gone.
  const busy = !!nav.getState().flow || sheetIsOpen('link-offer')
  if (busy && triesLeft > 0) {
    waiting = window.setTimeout(() => openWhenFree(triesLeft - 1), 500)
    return
  }
  if (busy) return
  nav.openSheet('settings-new-password')
}

/**
 * Open "Choose a new password" when the link of a reset mail was exchanged.
 * Armed once, with the other services of this strand (parts/services.ts), so
 * it works whatever page is open and after a start by the link itself.
 */
export function armPasswordRecovery(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  onPasswordRecovery(() => {
    // The link signed the user in. Read the account now, so that every page shows it and the sheet can name the address.
    void refreshAccount().catch(() => undefined)
    if (waiting !== null) window.clearTimeout(waiting)
    // A moment for the page behind to settle; up to two minutes for a flow or an open offer to end.
    waiting = window.setTimeout(() => openWhenFree(240), 300)
  })
}

/** Only for tests. */
export function __resetPasswordRecoveryForTests(): void {
  watching = false
  if (waiting !== null && typeof window !== 'undefined') window.clearTimeout(waiting)
  waiting = null
}
