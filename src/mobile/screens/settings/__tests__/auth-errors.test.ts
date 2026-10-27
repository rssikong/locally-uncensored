/** What a failed sign in says, case by case. */
import { describe, expect, it } from 'vitest'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { authErrorText, classifyAuthError, isOAuthCancel, readAuthFailure, validateCredentials } from '../parts/auth-errors'

const T = SETTINGS_STRINGS.account

describe('classifyAuthError', () => {
  it('reads the machine code of the auth server', () => {
    expect(classifyAuthError({ code: 'invalid_credentials', status: 400 }, true)).toBe('wrong-password')
    expect(classifyAuthError({ code: 'email_not_confirmed', status: 400 }, true)).toBe('not-confirmed')
    expect(classifyAuthError({ code: 'user_already_exists', status: 422 }, true)).toBe('exists')
    expect(classifyAuthError({ code: 'weak_password', status: 422 }, true)).toBe('password-short')
    expect(classifyAuthError({ code: 'over_request_rate_limit', status: 429 }, true)).toBe('too-many')
  })

  it('falls back to the sentence of older servers', () => {
    expect(classifyAuthError(new Error('Invalid login credentials'), true)).toBe('wrong-password')
    expect(classifyAuthError(new Error('Email not confirmed'), true)).toBe('not-confirmed')
    expect(classifyAuthError(new Error('User already registered'), true)).toBe('exists')
  })

  it('calls a dead network offline, whatever the error says', () => {
    expect(classifyAuthError({ code: 'invalid_credentials' }, false)).toBe('offline')
    expect(classifyAuthError({ name: 'AuthRetryableFetchError', message: 'x' }, true)).toBe('offline')
    expect(classifyAuthError(new TypeError('Failed to fetch'), true)).toBe('offline')
  })

  it('tells a broken server from an unknown answer', () => {
    expect(classifyAuthError({ status: 503, message: 'upstream' }, true)).toBe('server')
    expect(classifyAuthError({ status: 418, message: 'teapot' }, true)).toBe('unknown')
    expect(classifyAuthError(null, true)).toBe('unknown')
  })
})

describe('authErrorText', () => {
  it('uses the sentences of the design', () => {
    expect(authErrorText('wrong-password')).toBe('Email or password is not correct.')
    expect(authErrorText('not-confirmed')).toBe('Check your inbox to confirm your email.')
    expect(authErrorText('offline')).toBe(T.errOffline)
  })

  it('never hands out an empty sentence', () => {
    for (const kind of ['wrong-password', 'not-confirmed', 'offline', 'email-invalid', 'password-short', 'exists', 'too-many', 'server', 'unknown'] as const) {
      expect(authErrorText(kind).length).toBeGreaterThan(10)
    }
  })
})

describe('validateCredentials', () => {
  it('wants something that looks like an email', () => {
    expect(validateCredentials('', 'secret-pass', 'signin')).toBe('email-invalid')
    expect(validateCredentials('nobody', 'secret-pass', 'signin')).toBe('email-invalid')
    expect(validateCredentials(' a@b.co ', 'secret-pass', 'signin')).toBeNull()
  })

  it('asks for 8 characters only when an account is created', () => {
    expect(validateCredentials('a@b.co', 'short', 'signup')).toBe('password-short')
    expect(validateCredentials('a@b.co', 'short', 'signin')).toBeNull()
    expect(validateCredentials('a@b.co', '', 'signin')).toBe('wrong-password')
  })
})

describe('helpers', () => {
  it('knows a cancelled browser sign in', () => {
    expect(isOAuthCancel(new Error('Sign-in cancelled.'))).toBe(true)
    expect(isOAuthCancel(new Error('Sign-in timed out.'))).toBe(false)
  })

  it('reads a failure from anything thrown', () => {
    expect(readAuthFailure('plain')).toEqual({ message: 'plain' })
    expect(readAuthFailure({ code: 'x', status: 400, name: 'AuthApiError', message: 'm' })).toEqual({ code: 'x', status: 400, name: 'AuthApiError', message: 'm' })
  })
})
