// "Sign in with my computer" (REMOTE-PROTOKOLL v2, section 15), the desktop's
// part: after its user allowed it, the desktop asks lu-labs.ai with its own
// session for a one-time code bound to the phone's Ed25519 key. Only the code
// goes on to the phone (through commands/remote_sealed.rs); the session stays
// in this window, it is never handed to the Rust side, never logged.

import { cloudFetch, CloudJobError, jsonOrError } from './client'

export type DeviceSigninCode =
  | { kind: 'code'; code: string; expires: number }
  /** LU on this computer is not signed in to an account. */
  | { kind: 'signed-out' }
  /** lu-labs.ai gave no code (offline, refused, malformed answer). */
  | { kind: 'failed' }

/** Shape of a code (PROTOKOLL 15): 16 to 128 characters of base64url. */
const CODE = /^[A-Za-z0-9_-]{16,128}$/
/** Shape of the phone's Ed25519 key: 32 bytes, base64url without padding. */
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/

export async function requestDeviceSigninCode(devicePub: string): Promise<DeviceSigninCode> {
  if (!PUBLIC_KEY.test(devicePub)) return { kind: 'failed' }
  try {
    const res = await cloudFetch('/api/device-signin/codes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_ed25519_pub: devicePub }),
    })
    if (res.status === 401) return { kind: 'signed-out' }
    const body = await jsonOrError<{ code?: unknown; expires?: unknown }>(res)
    if (typeof body.code !== 'string' || !CODE.test(body.code)) return { kind: 'failed' }
    if (typeof body.expires !== 'number' || !Number.isSafeInteger(body.expires) || body.expires <= 0) return { kind: 'failed' }
    return { kind: 'code', code: body.code, expires: body.expires }
  } catch (err) {
    if (err instanceof CloudJobError && err.status === 401) return { kind: 'signed-out' }
    return { kind: 'failed' }
  }
}
