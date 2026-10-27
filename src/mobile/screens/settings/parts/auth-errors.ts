/**
 * What a failed sign in says. Pure, so every case is a unit test.
 *
 * The auth client reports a machine code where it can (`invalid_credentials`,
 * `email_not_confirmed`) and an English sentence where it cannot. Both are
 * read here and turned into the sentences of DESIGN.md E2 and 5.1. The raw
 * text of the server is never shown: it names things the app does not have.
 */
import { SETTINGS_STRINGS } from '../../../strings/settings'

export type AuthErrorKind =
  | 'wrong-password'
  | 'not-confirmed'
  | 'offline'
  | 'email-invalid'
  | 'password-short'
  | 'exists'
  | 'too-many'
  | 'server'
  | 'unknown'

export interface AuthFailure {
  code?: string
  status?: number
  name?: string
  message?: string
}

export function readAuthFailure(err: unknown): AuthFailure {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    return {
      code: typeof e.code === 'string' ? e.code : undefined,
      status: typeof e.status === 'number' ? e.status : undefined,
      name: typeof e.name === 'string' ? e.name : undefined,
      message: typeof e.message === 'string' ? e.message : undefined,
    }
  }
  return { message: typeof err === 'string' ? err : undefined }
}

const NETWORK = /failed to fetch|load failed|networkerror|network request failed|fetch failed|unreachable|err_internet|err_network/i

export function classifyAuthError(err: unknown, online: boolean): AuthErrorKind {
  const f = readAuthFailure(err)
  const code = (f.code ?? '').toLowerCase()
  const text = (f.message ?? '').toLowerCase()
  if (!online) return 'offline'
  if (f.name === 'AuthRetryableFetchError' || f.status === 0 || NETWORK.test(text)) return 'offline'
  if (code === 'email_not_confirmed' || text.includes('email not confirmed')) return 'not-confirmed'
  if (code === 'invalid_credentials' || text.includes('invalid login credentials')) return 'wrong-password'
  if (code === 'user_already_exists' || code === 'email_exists' || text.includes('already registered')) return 'exists'
  if (code === 'weak_password' || text.includes('password should be')) return 'password-short'
  if (code === 'email_address_invalid' || code === 'validation_failed' || text.includes('invalid email') || text.includes('unable to validate email')) {
    return 'email-invalid'
  }
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || f.status === 429) return 'too-many'
  if (typeof f.status === 'number' && f.status >= 500) return 'server'
  return 'unknown'
}

export function authErrorText(kind: AuthErrorKind): string {
  const T = SETTINGS_STRINGS.account
  switch (kind) {
    case 'wrong-password':
      return T.errWrongPassword
    case 'not-confirmed':
      return T.errNotConfirmed
    case 'offline':
      return T.errOffline
    case 'email-invalid':
      return T.errEmailInvalid
    case 'password-short':
      return T.errPasswordShort
    case 'exists':
      return T.errExists
    case 'too-many':
      return T.errTooMany
    case 'server':
      return T.errServer
    default:
      return T.errUnknown
  }
}

/** Checked before anything is sent, so a typo costs no round trip. Null when the form may go. */
export function validateCredentials(email: string, password: string, mode: 'signin' | 'signup'): AuthErrorKind | null {
  const mail = email.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return 'email-invalid'
  if (mode === 'signup' && password.length < 8) return 'password-short'
  if (password.length === 0) return 'wrong-password'
  return null
}

/**
 * Sign in with Google or GitHub ends in a sentence of the logic layer. The
 * ones that only say "the user stopped" are not errors on screen.
 */
export function isOAuthCancel(err: unknown): boolean {
  const text = readAuthFailure(err).message ?? ''
  return /sign-?in cancelled|cancelled in the browser/i.test(text)
}

/**
 * The page of Google or GitHub did not open on this phone (the sentence
 * MOBILE_OAUTH_NOT_OPENED of the logic layer; a test holds the two together).
 * The screen then says so and offers "Try again": it never goes on waiting
 * for a browser that did not come.
 */
export function isOAuthNotOpened(err: unknown): boolean {
  const text = readAuthFailure(err).message ?? ''
  return /sign-?in page could not be opened/i.test(text)
}
