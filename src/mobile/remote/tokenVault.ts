/**
 * Ablage fuer das Sitzungstoken des Remote-Clients.
 *
 * Eine eigene, kleine Naht, damit das Token spaeter in einen sicheren
 * Speicher umziehen kann (Android Keystore, iOS Keychain, am Desktop gibt es
 * dafuer schon `secret_set`, `secret_get`, `secret_delete`), ohne dass der
 * Store davon etwas merkt.
 *
 * Zwei Regeln, die jede Implementierung halten muss:
 *   - Das Token liegt NICHT im persistierten Zustand des Stores. Der Zustand
 *     enthaelt Chatverlaeufe und wandert in Sicherungen und Exporte.
 *   - Ein Token gehoert zu genau einer Adresse. `load` gibt es nur fuer die
 *     Adresse heraus, fuer die es gespeichert wurde, damit es nie an einen
 *     anderen Server geschickt wird.
 *
 * Das Token gilt hoechstens 60 Minuten ohne Benutzung und hoechstens 24
 * Stunden insgesamt. Der Schaden eines ausgelesenen Tokens ist damit
 * begrenzt, aber nicht null: mit freigeschalteter Shell am Desktop ist es
 * eine Fernsteuerung. Deshalb der sichere Speicher als Ziel.
 */
import type { StateStorage } from 'zustand/middleware'
import { idbStorage } from '../../lib/idbStorage'
import { secureTokenVault } from '../platform/bridge'

export interface TokenVault {
  /** Token fuer diese Adresse, oder null. Wirft nie. */
  load(baseUrl: string): Promise<string | null>
  save(baseUrl: string, token: string): Promise<void>
  /** Loescht das gespeicherte Token, egal fuer welche Adresse. */
  clear(): Promise<void>
}

export const TOKEN_VAULT_KEY = 'lu-mobile-remote-token'

interface VaultRecord {
  baseUrl: string
  token: string
  savedAt: number
}

/**
 * Standard: ein eigener Schluessel im selben Speicher wie der Store
 * (IndexedDB), getrennt vom Zustand. Nicht verschluesselt. Das ist der Stand,
 * von dem aus umgezogen wird, kein Endzustand.
 */
export function createStorageTokenVault(storage: StateStorage = idbStorage, key: string = TOKEN_VAULT_KEY): TokenVault {
  return {
    async load(baseUrl) {
      try {
        const raw = await storage.getItem(key)
        if (!raw) return null
        const rec = JSON.parse(raw) as Partial<VaultRecord>
        if (rec.baseUrl !== baseUrl || typeof rec.token !== 'string' || !rec.token) return null
        return rec.token
      } catch {
        return null
      }
    },
    async save(baseUrl, token) {
      const rec: VaultRecord = { baseUrl, token, savedAt: Date.now() }
      await storage.setItem(key, JSON.stringify(rec))
    },
    async clear() {
      await storage.removeItem(key)
    },
  }
}

/**
 * Der sichere Speicher des Geraets (Android Keystore, iOS Keychain) vor der
 * alten Ablage in IndexedDB.
 *
 *   - Gelesen wird zuerst aus dem sicheren Speicher. Liegt dort nichts, aber
 *     in der alten Ablage noch ein Token (ein Bau vor der nativen Schicht),
 *     zieht es einmal um und die alte Ablage wird geleert.
 *   - Geschrieben wird NUR in den sicheren Speicher. Lehnt er ab, gibt es
 *     keinen Rueckfall auf die unverschluesselte Ablage: das Token gilt dann
 *     bis zum Schliessen der App, danach wird neu gekoppelt. Ein Token ist
 *     mit freigeschalteter Shell am Desktop eine Fernsteuerung.
 *   - Geloescht wird in beiden.
 */
export function createMigratingTokenVault(secure: TokenVault, legacy: TokenVault): TokenVault {
  return {
    async load(baseUrl) {
      const stored = await secure.load(baseUrl)
      if (stored) return stored
      const old = await legacy.load(baseUrl)
      if (!old) return null
      try {
        await secure.save(baseUrl, old)
      } catch {
        // Nicht umgezogen: fuer diese Sitzung gilt es trotzdem, liegen bleibt es nicht.
      }
      await legacy.clear().catch(() => {})
      return old
    },
    async save(baseUrl, token) {
      await legacy.clear().catch(() => {})
      await secure.save(baseUrl, token)
    },
    async clear() {
      await Promise.allSettled([secure.clear(), legacy.clear()])
    },
  }
}

/**
 * Die Ablage, die der Store ohne eigene Angabe nimmt: in der App der sichere
 * Speicher, im Browser (Entwicklung, Tests ohne Bruecke) die alte Ablage.
 */
export function createDefaultTokenVault(storage: StateStorage = idbStorage): TokenVault {
  const legacy = createStorageTokenVault(storage)
  // The bridge of the native layer is loaded on first use (platform/bridge.ts).
  let chosen: Promise<TokenVault> | null = null
  const vault = (): Promise<TokenVault> => {
    if (!chosen) chosen = secureTokenVault().then((secure) => (secure ? createMigratingTokenVault(secure, legacy) : legacy))
    return chosen
  }
  return {
    load: async (baseUrl) => (await vault()).load(baseUrl),
    save: async (baseUrl, token) => (await vault()).save(baseUrl, token),
    clear: async () => (await vault()).clear(),
  }
}

/** Nur im Arbeitsspeicher: fuer Tests und fuer "nach dem Schliessen neu koppeln". */
export function createMemoryTokenVault(): TokenVault {
  let rec: VaultRecord | null = null
  return {
    async load(baseUrl) {
      return rec && rec.baseUrl === baseUrl ? rec.token : null
    },
    async save(baseUrl, token) {
      rec = { baseUrl, token, savedAt: Date.now() }
    },
    async clear() {
      rec = null
    },
  }
}
