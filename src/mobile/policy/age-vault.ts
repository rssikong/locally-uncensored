/**
 * The second, durable home of the age declaration.
 *
 * The answer used to sit only in the localStorage of the WebView, and that
 * reaches the disk late: an app that was shut down within about half a second
 * after "No" asked the question again (acceptance android-knoepfe, finding M1).
 *
 * Here it also goes into the secure storage of the native layer (the Android
 * Keystore file, written with commit(), and the iOS Keychain). The command
 * answers only after the value is on the disk, so a caller that waits for
 * `saveAgeToDevice` knows the answer survives whatever happens next.
 *
 * There is no command of its own for this yet. The secure storage takes a
 * fixed list of names plus the "parked" names, which are free within
 * [a-z0-9-]; the answer uses one of those. The value is one word, never a
 * date. A name of its own on the native side is asked for in
 * mobile-docs/r4/kit.md.
 */
import { isTauri, secretParkGet, secretParkSet } from '../../api/backend'

/** The name in the parked part of the secure storage. Must match [a-z0-9-]{1,64}. */
export const AGE_VAULT_ID = 'lu-age-declaration'

/** How long the app waits for the native layer before it goes on without it. */
export const AGE_VAULT_TIMEOUT_MS = 3000

export type DeviceAge = 'adult' | 'minor'

export interface AgeVault {
  /** Is there a native storage to ask at all. False in a browser tab. */
  available(): boolean
  /** The saved answer, or null when there is none. Rejects when the storage cannot be read. */
  load(): Promise<string | null>
  /** Resolves once the answer is on the disk. */
  save(answer: DeviceAge): Promise<void>
}

const nativeVault: AgeVault = {
  available: () => isTauri(),
  load: () => secretParkGet(AGE_VAULT_ID),
  save: (answer) => secretParkSet(AGE_VAULT_ID, answer),
}

let vault: AgeVault = nativeVault

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('age vault timed out')), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      },
    )
  })
}

export function ageVaultAvailable(): boolean {
  try {
    return vault.available()
  } catch {
    return false
  }
}

/** The answer kept by the native layer. null: none, or the storage did not answer. Never throws. */
export async function loadAgeFromDevice(): Promise<DeviceAge | null> {
  if (!ageVaultAvailable()) return null
  try {
    const raw = await withTimeout(vault.load(), AGE_VAULT_TIMEOUT_MS)
    return raw === 'adult' || raw === 'minor' ? raw : null
  } catch {
    return null
  }
}

/** True once the native layer confirmed the write. False: no native layer, or it failed. Never throws. */
export async function saveAgeToDevice(answer: DeviceAge): Promise<boolean> {
  if (!ageVaultAvailable()) return false
  try {
    await withTimeout(vault.save(answer), AGE_VAULT_TIMEOUT_MS)
    return true
  } catch {
    return false
  }
}

/** Only for tests. null puts the real one back. */
export function setAgeVaultForTests(next: AgeVault | null): void {
  vault = next ?? nativeVault
}
