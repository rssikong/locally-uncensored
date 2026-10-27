/**
 * "Sign in with Apple": the sheet of the system on an iPhone or iPad.
 *
 * The native side (plugin lu-native, AppleSignIn.swift) shows the sheet and
 * answers with the identity token of Apple. This file makes the nonce that
 * binds the token to one sign in, and nothing else: the token goes to the
 * account server in screens/settings/parts/auth.ts and is kept nowhere.
 *
 * The nonce: a random text made here. The native side hands Apple its
 * SHA-256, Apple writes that into the token, and the account server gets the
 * text itself and compares. A token made for one sign in is useless for
 * another one.
 */
import { tryBridge } from './bridge'

export interface AppleCredential {
  /** The signed token of Apple. */
  identityToken: string
  /** The one-time code of the sheet. Only deleting an account uses it (api/cloud/account.ts, handAppleCode). */
  authorizationCode?: string
}

/** What a build without the sheet says: Android, a browser, an app older than the command. */
export const APPLE_SIGN_IN_MISSING = 'Sign in with Apple is not available on this device.'
/** What a failure without a sentence of its own ends in. */
export const APPLE_SIGN_IN_FAILED = 'Sign in with Apple did not work. Try again.'

/** 32 random bytes as 64 hex digits. */
export function makeAppleNonce(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The sentence a failed sheet ends in: the one of the native side, or the plain one. */
export function appleFailureText(err: unknown): string {
  const text = typeof err === 'string' ? err : err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string' ? (err as { message: string }).message : ''
  const clean = text.trim()
  // A sentence a person can read: starts with a capital letter, ends with a full stop, one line, not a dump.
  return /^[A-Z][^\n{}<>]{8,220}\.$/.test(clean) ? clean : APPLE_SIGN_IN_FAILED
}

/**
 * Show the sheet. Resolves null when the user closed it. Throws an Error
 * with one English sentence for everything else, and with
 * APPLE_SIGN_IN_MISSING where there is no sheet.
 */
export async function appleSignInSheet(nonce: string): Promise<AppleCredential | null> {
  let answer: Awaited<ReturnType<typeof tryBridge<AppleCredential | null>>>
  try {
    answer = await tryBridge<AppleCredential | null>((bridge) => bridge.appleSignIn?.(nonce))
  } catch (err) {
    throw new Error(appleFailureText(err))
  }
  if (!answer.ok) throw new Error(APPLE_SIGN_IN_MISSING)
  const credential = answer.value
  if (!credential) return null
  if (typeof credential.identityToken !== 'string' || credential.identityToken.length === 0) throw new Error(APPLE_SIGN_IN_FAILED)
  return credential
}
