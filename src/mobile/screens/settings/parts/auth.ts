/**
 * Account actions of the phone: sign in, create an account, sign out,
 * refresh. All of them go through the logic layer (api/cloud/supabase,
 * hooks/useCloudAuth). The hook `useCloudAuth()` itself is mounted exactly
 * once by the frame of the shell; a second mount would arm a second probe
 * timer, so this file calls the functions and screens read `cloudAuthStore`.
 */
import { handAppleCode } from '../../../../api/cloud/account'
import { loginWithProvider, supabaseCloud, type OAuthProvider } from '../../../../api/cloud/supabase'
import { probeAccount, signOutAccount } from '../../../../hooks/useCloudAuth'
import { useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import { APPLE_SIGN_IN_MISSING, appleFailureText, appleSignInSheet, makeAppleNonce } from '../../../platform/apple-sign-in'
import { mobileOS } from '../../../platform/detect'
import { storePolicy } from './policy'

/** True while the user asked for the sign out, so the session watch does not call it "expired". */
let signingOutOnPurpose = false

export function isSigningOutOnPurpose(): boolean {
  return signingOutOnPurpose
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabaseCloud().auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw error
  await probeAccount()
}

/** Resolves 'confirm' when the account exists but the email has to be confirmed first. */
export async function signUp(email: string, password: string): Promise<'signed-in' | 'confirm'> {
  const { data, error } = await supabaseCloud().auth.signUp({ email: email.trim(), password })
  if (error) throw error
  if (!data.session) return 'confirm'
  await probeAccount()
  return 'signed-in'
}

/** What a build without sign in through a third party answers. Never shown: such a build has no button that asks. */
export const THIRD_PARTY_SIGN_IN_OFF = 'This version of LU signs in with email and password.'

/**
 * Sign in with Google or GitHub. A build without it (store switch
 * thirdPartySignIn, on in every preset since 10.10.2026) starts none, whoever
 * asks: no browser opens and no link is waited for, so the link
 * lu://oauth/callback has nothing of this kind to finish there. The link
 * itself stays: "Forgot password?" comes back through it.
 */
export async function signInWithProvider(provider: OAuthProvider, signal: AbortSignal, onBrowserOpen?: () => void): Promise<void> {
  if (!storePolicy().thirdPartySignIn) throw new Error(THIRD_PARTY_SIGN_IN_OFF)
  // `onBrowserOpen` runs once a browser is really in front (Android). On an iPhone the sheet of the
  // system lies over the app instead and hands the link back itself, so it never runs there.
  await loginWithProvider(provider, signal, onBrowserOpen)
  await probeAccount()
}

/**
 * Is "Sign in with Apple" offered here: the store switch appleSignIn is on
 * and this is an iPhone or iPad. Android has no such sheet and no button.
 */
export function appleSignInOffered(): boolean {
  return storePolicy().appleSignIn && mobileOS() === 'ios'
}

/**
 * A failure of the sheet of the system. Its message is one English sentence
 * and is shown as it is; a failure of the account server is not of this kind
 * and goes through classifyAuthError like every other sign in.
 */
export class AppleSheetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppleSheetError'
  }
}

/**
 * Sign in with Apple, the native way: the sheet of the system answers with
 * an identity token, and the account server takes it together with the nonce
 * it was made for. No browser, no link back. Resolves 'cancelled' when the
 * user closed the sheet, which is not an error.
 *
 * An account that was made with Google, GitHub or a password is reached by
 * this only when Apple hands out the same email address. With "Hide My
 * Email" the address is another one and the server makes a second account.
 * The page says so in one sentence (sameSignIn), this function does not try
 * to guess.
 */
export async function signInWithApple(): Promise<'signed-in' | 'cancelled'> {
  if (!appleSignInOffered()) throw new AppleSheetError(APPLE_SIGN_IN_MISSING)
  const nonce = makeAppleNonce()
  let credential: Awaited<ReturnType<typeof appleSignInSheet>>
  try {
    credential = await appleSignInSheet(nonce)
  } catch (err) {
    throw new AppleSheetError(appleFailureText(err))
  }
  if (!credential) return 'cancelled'
  const { error } = await supabaseCloud().auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce })
  if (error) throw error
  // The name Apple hands out with the first sign in stays on this phone and is dropped here: the app shows
  // it nowhere, and an account that carried it would have to declare it as collected (App Privacy, "Name").
  await probeAccount()
  return 'signed-in'
}

/**
 * Pure: does this account sign in with Apple, as the saved session describes
 * its user (identities, or the providers the account server lists).
 */
export function userUsesApple(user: unknown): boolean {
  if (!user || typeof user !== 'object') return false
  const u = user as { identities?: unknown; app_metadata?: { provider?: unknown; providers?: unknown } }
  if (Array.isArray(u.identities) && u.identities.some((i) => i && typeof i === 'object' && (i as { provider?: unknown }).provider === 'apple')) return true
  const meta = u.app_metadata
  if (meta && typeof meta === 'object') {
    if (meta.provider === 'apple') return true
    if (Array.isArray(meta.providers) && meta.providers.includes('apple')) return true
  }
  return false
}

/**
 * What became of the Apple link before a deletion.
 *  none        not an iPhone, or the account does not use Sign in with Apple
 *  cancelled   the user closed the Apple sheet: nothing is deleted
 *  handed      the server holds what it needs to revoke the token at Apple
 *  not-handed  the sheet failed, Apple sent no code, or the server did not
 *              keep it: the account can still be deleted, but LU must not
 *              say that the Apple link ended
 */
export type AppleBeforeDelete = 'none' | 'cancelled' | 'handed' | 'not-handed'

/**
 * Apple 5.1.1(v): deleting an account that uses Sign in with Apple also ends
 * that link at Apple. The server revokes the token inside the deletion, and
 * for that it needs a fresh one-time code of the Apple sheet, which this asks
 * for and hands over (api/cloud/account.ts, handAppleCode). iPhone only;
 * Android and the desktop delete as before.
 */
export async function appleBeforeDelete(): Promise<AppleBeforeDelete> {
  if (mobileOS() !== 'ios') return 'none'
  let user: unknown = null
  try {
    user = (await supabaseCloud().auth.getSession()).data.session?.user ?? null
  } catch {
    user = null
  }
  if (!userUsesApple(user)) return 'none'
  let credential: Awaited<ReturnType<typeof appleSignInSheet>>
  try {
    credential = await appleSignInSheet(makeAppleNonce())
  } catch {
    return 'not-handed'
  }
  if (!credential) return 'cancelled'
  if (!credential.authorizationCode) return 'not-handed'
  return (await handAppleCode(credential.authorizationCode)) ? 'handed' : 'not-handed'
}

export async function refreshAccount(): Promise<void> {
  await probeAccount()
}

/** Throws when the saved session survived; the store then still says signed in. */
export async function signOut(): Promise<void> {
  signingOutOnPurpose = true
  try {
    await signOutAccount()
  } finally {
    // The store change is synchronous inside signOutAccount; the watch has seen it by now.
    signingOutOnPurpose = false
  }
}

/**
 * After the server deleted the account: end the session on this phone,
 * whatever the sign out call answers (the account it would revoke is gone).
 * Marked as asked for, so the session watch does not call it "expired".
 */
export async function signOutAfterDeletion(): Promise<void> {
  signingOutOnPurpose = true
  try {
    await signOutAccount().catch(() => undefined)
    if (useCloudAuthStore.getState().status === 'signed-in') useCloudAuthStore.getState().setSignedOut()
  } finally {
    signingOutOnPurpose = false
  }
}

export function isSignedIn(): boolean {
  const s = useCloudAuthStore.getState()
  return s.status === 'signed-in' && !!s.user
}
