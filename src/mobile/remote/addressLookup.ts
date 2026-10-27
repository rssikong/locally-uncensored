/**
 * Adressauskunft bei lu-labs.ai (PROTOKOLL 14): unter welcher Tunnel-Adresse
 * ein Desktop gerade zu finden ist.
 *
 *   GET https://lu-labs.ai/api/remote/address/<desktop_id>
 *   200 {"address":"https://<label>.trycloudflare.com","time":<unix s>}
 *   404 {"error":"not_found"}  (nie gemeldet oder seit 7 Tagen still)
 *   400                        falsche Form der Kennung
 *   429 rate_limited           mit Retry-After; Grenze 120 Abfragen je 10 min je IP
 *
 * AUSGESCHALTET (`ADDRESS_LOOKUP_ENABLED`), bis Web live ist und David das
 * Go gibt. Bis dahin liefert `lookupDesktopAddress` ohne Netzaufruf null,
 * und das Wiederfinden nimmt WLAN und die letzte Tunnel-Adresse.
 *
 * Der Antwort wird nicht vertraut: eine falsche Adresse scheitert am
 * Handschlag mit dem festgenagelten Schluessel. Darum reicht hier die
 * Formpruefung der Adresse. Bei 429 wird nicht wiederholt, die Sperre gilt
 * bis zum genannten Zeitpunkt.
 */
import { isTunnelAddress } from './pairingLink'

/** Schalter. Erst nach Davids Go und dem Deploy von Web auf true. */
export const ADDRESS_LOOKUP_ENABLED = false

export const ADDRESS_LOOKUP_ORIGIN = 'https://lu-labs.ai'

export type LookupFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

export interface LookupOptions {
  fetch: LookupFetch
  /** Fuer Tests: den Schalter ueberstimmen. Die App setzt das nie. */
  enabled?: boolean
  now?: () => number
  signal?: AbortSignal
}

let blockedUntil = 0

/** Nur fuer Tests. */
export function __resetAddressLookupForTests(): void {
  blockedUntil = 0
}

/** Die gemeldete Tunnel-Adresse oder null (aus, unbekannt, gesperrt, Netzfehler). Wirft nie. */
export async function lookupDesktopAddress(desktopId: string, options: LookupOptions): Promise<string | null> {
  if (!(options.enabled ?? ADDRESS_LOOKUP_ENABLED)) return null
  if (!/^[A-Za-z0-9_-]{22}$/.test(desktopId)) return null
  const now = options.now ?? (() => Date.now())
  if (now() < blockedUntil) return null
  try {
    const res = await options.fetch(`${ADDRESS_LOOKUP_ORIGIN}/api/remote/address/${desktopId}`, { signal: options.signal })
    if (res.status === 429) {
      const secs = Number(res.headers.get('retry-after'))
      blockedUntil = now() + (Number.isFinite(secs) && secs > 0 ? secs : 600) * 1000
      return null
    }
    if (res.status !== 200) return null
    const data = (await res.json()) as { address?: unknown }
    return typeof data?.address === 'string' && isTunnelAddress(data.address) ? data.address : null
  } catch {
    return null
  }
}
