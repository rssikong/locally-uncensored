/**
 * The ONE door from the app to the account server for an in-app purchase:
 * hand in the transaction the store signed, hear whether it was credited.
 *
 *   redeemPurchase(jws) -> { credited: true, balance }   or it throws RedeemError
 *
 * The server side is not built yet (mobile-docs/r17/in-app-kauf-gebaut.md has
 * what it must do, as a requirement). Until a build names its address in
 * VITE_LU_IAP_REDEEM_URL there is no purchase in the app at all, whatever the
 * store switch says: nothing is sold that nobody would credit.
 *
 * The packs on offer come from VITE_LU_IAP_PRODUCT_IDS, a list of product
 * ids separated by commas. Ids only: names and prices are the store's.
 *
 * What the app sends:  POST <address>, Authorization: Bearer <the session of
 * the account>, body { platform: "ios", transaction: "<JWS>" }.
 * What it reads back:  200 with { credited: true, balance: <number> }.
 * Everything else is "not credited": the purchase stays open in the store and
 * is handed in again (lib/iap-flow.ts). Handing the same transaction in twice
 * must be answered the same way both times; that is the server's business.
 */
import { testOverridesAllowed } from '../policy/storePolicy'

export interface IapConfig {
  /** Where a purchase is handed in. Empty: this build sells nothing. */
  redeemUrl: string
  /** The product ids of the packs, in the order they are shown. */
  productIds: string[]
}

export interface Redeemed {
  credited: true
  /** The credits of the account after this purchase, as the server counts them. */
  balance: number
}

export type RedeemFailure =
  /** No session: nobody is signed in on this phone. */
  | 'signed-out'
  /** The server could not be reached, took too long or answered with a fault. Worth another try as it is. */
  | 'unavailable'
  /** The server answered and did not credit this transaction for this account. */
  | 'refused'

export class RedeemError extends Error {
  readonly kind: RedeemFailure
  constructor(kind: RedeemFailure) {
    super(`purchase not credited: ${kind}`)
    this.name = 'RedeemError'
    this.kind = kind
  }
}

export const REDEEM_TIMEOUT_MS = 20_000

const PRODUCT_ID = /^[A-Za-z0-9._-]{1,128}$/
export const IAP_MAX_PRODUCTS = 20

/** Pure: the address a build names, or '' when it names none or one that is not https. */
export function parseRedeemUrl(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const text = raw.trim()
  if (!/^https:\/\/[^\s/]+\/?\S*$/.test(text)) return ''
  try {
    return new URL(text).protocol === 'https:' ? text : ''
  } catch {
    return ''
  }
}

/** Pure: the product ids a build names. Anything that is not an id is left out, none twice, at most IAP_MAX_PRODUCTS. */
export function parseProductIds(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  const ids = raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => PRODUCT_ID.test(part))
  return [...new Set(ids)].slice(0, IAP_MAX_PRODUCTS)
}

function builtConfig(): IapConfig {
  let url: unknown
  let ids: unknown
  try {
    url = import.meta.env.VITE_LU_IAP_REDEEM_URL
    ids = import.meta.env.VITE_LU_IAP_PRODUCT_IDS
  } catch {
    url = undefined
    ids = undefined
  }
  return { redeemUrl: parseRedeemUrl(url), productIds: parseProductIds(ids) }
}

let forced: IapConfig | null = null

/** What this build was given: the address and the packs. */
export function iapConfig(): IapConfig {
  return (testOverridesAllowed() ? forced : null) ?? builtConfig()
}

/** Only for tests: hand in an address and packs, null to go back to the build. Without effect in a build a customer gets. */
export function __setIapConfigForTests(config: { redeemUrl: string; productIds: readonly string[] } | null): void {
  if (!testOverridesAllowed()) return
  forced = config ? { redeemUrl: parseRedeemUrl(config.redeemUrl), productIds: parseProductIds(config.productIds.join(',')) } : null
}

/** Pure: what an HTTP status of the server means for a purchase that was handed in and not credited. */
export function failureForStatus(status: number): RedeemFailure {
  if (status === 401) return 'signed-out'
  if (status === 400 || status === 403 || status === 404 || status === 409 || status === 410 || status === 422) return 'refused'
  return 'unavailable'
}

export interface RedeemTransport {
  /** The session of the signed in account, or null. */
  token(): Promise<string | null>
  fetch: typeof fetch
}

async function sessionToken(): Promise<string | null> {
  const { getAccessToken } = await import('../../api/cloud/supabase')
  return getAccessToken()
}

/**
 * Hand one signed transaction to the account server. Resolves only when the
 * server said `credited: true`. Throws RedeemError for everything else, and
 * never says "credited" on its own.
 */
export async function redeemPurchase(jws: string, transport: Partial<RedeemTransport> = {}): Promise<Redeemed> {
  const url = iapConfig().redeemUrl
  if (!url || !jws) throw new RedeemError('unavailable')
  let token: string | null
  try {
    token = await (transport.token ?? sessionToken)()
  } catch {
    throw new RedeemError('unavailable')
  }
  if (!token) throw new RedeemError('signed-out')
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), REDEEM_TIMEOUT_MS)
  let response: Response
  try {
    response = await (transport.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ platform: 'ios', transaction: jws }),
      signal: ac.signal,
    })
  } catch {
    throw new RedeemError('unavailable')
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) throw new RedeemError(failureForStatus(response.status))
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new RedeemError('unavailable')
  }
  const answer = (body ?? {}) as { credited?: unknown; balance?: unknown }
  // "credited" is the one word that ends a purchase. A 200 without it credited nothing.
  if (answer.credited !== true) throw new RedeemError('refused')
  return { credited: true, balance: typeof answer.balance === 'number' && Number.isFinite(answer.balance) ? answer.balance : 0 }
}
