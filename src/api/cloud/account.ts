/**
 * Deleting the account, as one call of the logic layer.
 *
 * The route exists on the website: POST /api/account/delete. It takes the
 * same bearer the app sends everywhere (a request with a bearer and without a
 * cookie is let through its origin check), cancels a running subscription,
 * removes everything the account owns on the server and then the account
 * itself. Both stores demand that an account can be deleted inside the app,
 * so the phone calls it from Settings (src/mobile/screens/settings/
 * DeleteAccountSheet.tsx). The desktop has no button for it yet; the call is
 * platform neutral and waits for one.
 *
 * Nothing is signed out here. Ending the session on the device is the
 * caller's second step, and only after this call resolved.
 */
import { cloudFetch } from './client'
import { savedSessionUser } from './supabase'

/**
 * Why the server did not delete.
 *  offline        no answer at all (no network, a timeout)
 *  not-signed-in  the session was refused (expired, or there is none)
 *  server         the server answered and declined, or answered nonsense
 */
export type DeleteAccountFailure = 'offline' | 'not-signed-in' | 'server'

export class DeleteAccountError extends Error {
  readonly reason: DeleteAccountFailure
  readonly status: number | null
  constructor(reason: DeleteAccountFailure, status: number | null) {
    super(`account not deleted: ${reason}`)
    this.name = 'DeleteAccountError'
    this.reason = reason
    this.status = status
  }
}

/** Pure: the reason, from the status of the answer (null: no answer at all). */
export function deleteAccountFailure(status: number | null, online: boolean): DeleteAccountFailure {
  // 0 is how cloudFetch reports a request that never reached anything, 408 its own deadline.
  if (!online || status === null || status === 0 || status === 408) return 'offline'
  if (status === 401 || status === 403) return 'not-signed-in'
  return 'server'
}

function isOnlineNow(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/**
 * Resolves when the server confirmed the deletion with `{ ok: true }`.
 * Rejects with a DeleteAccountError in every other case; the account is then
 * untouched as far as this device can know. Never retries: a deletion is not
 * a call to repeat silently.
 */
export async function deleteAccount(online: () => boolean = isOnlineNow): Promise<void> {
  let status: number | null = null
  try {
    const res = await cloudFetch('/api/account/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      timeoutMs: 60_000,
    })
    status = res.status
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { ok?: unknown } | null
      if (body?.ok === true) return
      // 200 without the confirmation is not a deletion.
      status = 502
    }
  } catch (err) {
    // cloudFetch throws with `status` when the server answered with an error, and without one when nothing answered.
    const s = (err as { status?: unknown } | null)?.status
    status = typeof s === 'number' ? s : null
    // The token could not be renewed. With no session left on the device that is "sign in again", not "no network":
    // the auth client drops a session the server refused to renew.
    if (status === null && online() && (await savedSessionUser().catch(() => null)) === null) status = 401
  }
  throw new DeleteAccountError(deleteAccountFailure(status, online()), status)
}

/**
 * Sign in with Apple, before the account is deleted (Apple 5.1.1(v)).
 *
 * The phone hands the one-time code of a fresh Apple sheet to POST
 * /api/account/apple-token, with the bearer of the session. The server trades
 * it with Apple for the token it then revokes inside /api/account/delete.
 * Body and answers as the website defines them (feat/web-307-store,
 * app/api/account/apple-token/route.ts):
 *   { "authorization_code": "<code>" }
 *   200 { ok: true, stored: true }   the server holds what it needs to revoke
 *   200 { ok: true, stored: false }  the server has no Apple keys, nothing kept
 *   400, 401, 403, 409, 422, 429, 502: not kept
 *
 * Resolves true only for `stored: true`. Never throws and never retries: the
 * code is dead after five minutes or one use anyway. False is not an error of
 * the deletion, it only means LU cannot say the Apple link was ended.
 */
export async function handAppleCode(code: string): Promise<boolean> {
  if (!code) return false
  try {
    const res = await cloudFetch('/api/account/apple-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authorization_code: code }),
      timeoutMs: 30_000,
    })
    if (!res.ok) return false
    const body = (await res.json().catch(() => null)) as { ok?: unknown; stored?: unknown } | null
    return body?.ok === true && body.stored === true
  } catch {
    return false
  }
}
