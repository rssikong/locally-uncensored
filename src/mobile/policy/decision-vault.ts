/**
 * A second, durable home for two small decisions: the consent to LU Cloud
 * and the note that the question for notifications was put.
 *
 * Both used to live only in the localStorage of the WebView. On Android with
 * a full phone that is not enough (round 30, B3): after a hard end at full
 * storage the consent and the note were gone, while the age answer, which
 * also sits in the native layer (age-vault.ts), was still there. The copy in
 * IndexedDB (boot/settings-durable.ts) did not help: it was gone as well, and
 * it only fills gaps in a localStorage that still knows its stamp.
 *
 * Here each decision also goes into the parked part of the secure storage of
 * the native layer (Android Keystore file written with commit(), iOS
 * Keychain for this device only), the same place the age answer uses. The
 * values are short and carry no secret. At the start both sides are held
 * together (consent.ts, notify.ts). Without a native layer (a browser tab, a
 * test) everything stays in localStorage as before.
 */
import { isTauri, secretParkGet, secretParkSet } from '../../api/backend'

/** Names in the parked part of the secure storage. Must match [a-z0-9-]{1,64}. */
export const CONSENT_VAULT_ID = 'lu-ai-consent'
export const NOTIFY_OFFERED_VAULT_ID = 'lu-notify-offered'

/** How long the app waits for the native layer before it goes on without it. */
export const DECISION_VAULT_TIMEOUT_MS = 3000

export interface DecisionVault {
  /** Is there a native storage to ask at all. False in a browser tab. */
  available(): boolean
  /** The saved value, or null when there is none. Rejects when the storage cannot be read. */
  load(id: string): Promise<string | null>
  /** Resolves once the value is on the disk. */
  save(id: string, value: string): Promise<void>
}

const nativeVault: DecisionVault = {
  available: () => isTauri(),
  load: (id) => secretParkGet(id),
  save: (id, value) => secretParkSet(id, value),
}

let vault: DecisionVault = nativeVault

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('decision vault timed out')), ms)
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

export function decisionVaultAvailable(): boolean {
  try {
    return vault.available()
  } catch {
    return false
  }
}

/** The kept value. undefined: no native layer, or it did not answer (nothing is known). null: it holds none. Never throws. */
export async function loadDecision(id: string): Promise<string | null | undefined> {
  if (!decisionVaultAvailable()) return undefined
  try {
    const raw = await withTimeout(vault.load(id), DECISION_VAULT_TIMEOUT_MS)
    return typeof raw === 'string' && raw !== '' ? raw : null
  } catch {
    return undefined
  }
}

/** True once the native layer confirmed the write. Never throws. */
export async function saveDecision(id: string, value: string): Promise<boolean> {
  if (!decisionVaultAvailable()) return false
  try {
    await withTimeout(vault.save(id, value), DECISION_VAULT_TIMEOUT_MS)
    return true
  } catch {
    return false
  }
}

/** Only for tests. null puts the real one back. */
export function setDecisionVaultForTests(next: DecisionVault | null): void {
  vault = next ?? nativeVault
}
