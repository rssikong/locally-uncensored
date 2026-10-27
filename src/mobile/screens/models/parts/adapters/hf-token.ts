/**
 * ADAPTER: the Hugging Face token (E14.6).
 *
 * The keychain of the phone is the store of record. The native downloader
 * holds the token in memory only, so it is handed over again after every
 * start (`rearmHfToken`, called from parts/watch.ts). The desktop does the
 * same in src/lib/rust-boot-sync.ts, which the phone never runs because it
 * also sets the graphics card.
 *
 * Both calls can fail on a build without the bridge. The page says so
 * instead of pretending.
 */
import { secretDelete, secretGet, secretSet } from '../../../../../api/backend'
import { HF_TOKEN_ACCOUNT, applyHfToken } from '../../../../../api/mlx-image'
import { storePolicy } from '../../../../policy/storePolicy'

/**
 * Store switch gatedModelToken. A build without it has no field for a token
 * and sends none: a token an earlier build stored stays in the keychain,
 * untouched, and is handed to nobody.
 */
function tokenInUse(): boolean {
  return storePolicy().gatedModelToken
}

export async function hasHfToken(): Promise<boolean> {
  try {
    return !!(await secretGet(HF_TOKEN_ACCOUNT))
  } catch {
    return false
  }
}

/** Store the token and hand it to the downloader. False when this phone cannot keep it. */
export async function saveHfToken(token: string): Promise<boolean> {
  try {
    await secretSet(HF_TOKEN_ACCOUNT, token)
    if (!(await secretGet(HF_TOKEN_ACCOUNT))) return false
  } catch {
    return false
  }
  if (tokenInUse()) await applyHfToken(token).catch(() => {})
  return true
}

export async function removeHfToken(): Promise<boolean> {
  try {
    await secretDelete(HF_TOKEN_ACCOUNT)
  } catch {
    return false
  }
  await applyHfToken('').catch(() => {})
  return true
}

/**
 * After a start: read the stored token and hand it to the native downloader.
 * Without this the page says "stored" while a download from a gated repo
 * goes out without the token and ends with 401.
 * Answers whether a token was handed over.
 */
export async function rearmHfToken(): Promise<boolean> {
  if (!tokenInUse()) {
    // The downloader holds none either, whatever handed it one before. The stored token is not even read.
    await applyHfToken('').catch(() => {})
    return false
  }
  let stored: string | null = null
  try {
    stored = await secretGet(HF_TOKEN_ACCOUNT)
  } catch {
    return false
  }
  if (!stored) return false
  try {
    await applyHfToken(stored)
    return true
  } catch {
    return false
  }
}
