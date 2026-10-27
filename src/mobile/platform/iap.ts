/**
 * Credits as an in-app purchase: the door to the store of the system.
 *
 * iOS only (plugin lu-native, Iap.swift, StoreKit 2). Four calls and one
 * event, and nothing else: what is done with them, and in which order, is
 * lib/iap-flow.ts. Nothing is kept here.
 *
 * A purchase stays open until `iapFinish`. The store hands an open purchase
 * out again at every start (`iapUnfinished`) and reports one that arrives
 * while the app runs (`onIapTransaction`), so a purchase whose credit did not
 * get through is never lost.
 */
import { BRIDGE_EVENTS, nativeBridge, onBridgeEvent, tryBridge, type BridgeUnsubscribe } from './bridge'

/** One pack as the store names it. `displayPrice` is the finished text of the store; the app has no price of its own. */
export interface IapProduct {
  id: string
  displayName: string
  description?: string
  displayPrice: string
}

/** A purchase that is bought and not credited yet. */
export interface IapTransaction {
  transactionId: string
  productId?: string
  /** The transaction as the store signed it (JWS). Goes to the account server and nowhere else. */
  transaction: string
  /** The UUID of the account the purchase was made for (lower case), when the store reports it. */
  accountToken?: string
}

function asTransaction(raw: unknown): IapTransaction | null {
  const t = (raw ?? {}) as Partial<IapTransaction>
  if (typeof t.transactionId !== 'string' || t.transactionId === '' || typeof t.transaction !== 'string' || t.transaction === '') return null
  const entry: IapTransaction = { transactionId: t.transactionId, transaction: t.transaction }
  if (typeof t.productId === 'string') entry.productId = t.productId
  if (typeof t.accountToken === 'string' && t.accountToken !== '') entry.accountToken = t.accountToken.toLowerCase()
  return entry
}

export type IapPurchase = ({ state: 'success' } & IapTransaction) | { state: 'userCancelled' } | { state: 'pending' }

/** What a build without the store says: Android, a browser, an app older than the commands. */
export const IAP_MISSING = 'Adding credits is not available on this device.'
/** What a failure without a sentence of its own ends in. */
export const IAP_FAILED = 'Adding credits did not work. Try again.'

/** The sentence a failed call ends in: the one of the native side, or the plain one. */
export function iapFailureText(err: unknown): string {
  const text = typeof err === 'string' ? err : err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string' ? (err as { message: string }).message : ''
  const clean = text.trim()
  // A sentence a person can read: starts with a capital letter, ends with a full stop, one line, not a dump.
  return /^[A-Z][^\n{}<>]{8,220}\.$/.test(clean) ? clean : IAP_FAILED
}

/** Does this app carry the four calls at all. Says nothing about what the store answers. */
export async function iapBridged(): Promise<boolean> {
  const bridge = await nativeBridge().catch(() => null)
  return !!bridge && typeof bridge.iapProducts === 'function' && typeof bridge.iapPurchase === 'function' && typeof bridge.iapFinish === 'function' && typeof bridge.iapUnfinished === 'function'
}

async function through<T>(call: Parameters<typeof tryBridge<T>>[0]): Promise<T> {
  let answer: Awaited<ReturnType<typeof tryBridge<T>>>
  try {
    answer = await tryBridge<T>(call)
  } catch (err) {
    throw new Error(iapFailureText(err))
  }
  if (!answer.ok) throw new Error(IAP_MISSING)
  return answer.value
}

/** The packs the store knows of `ids`, in that order, and whether this device may buy at all. */
export async function iapProducts(ids: readonly string[]): Promise<{ products: IapProduct[]; canPurchase: boolean }> {
  const answer = await through((bridge) => bridge.iapProducts?.([...ids]))
  const products = (Array.isArray(answer?.products) ? answer.products : []).filter((p) => typeof p?.id === 'string' && typeof p.displayName === 'string' && typeof p.displayPrice === 'string' && p.displayPrice !== '')
  return { products, canPurchase: answer?.canPurchase !== false }
}

/** The sheet of the system for one pack. Throws an Error with one English sentence when the purchase did not work. */
export async function iapPurchase(productId: string, accountToken: string): Promise<IapPurchase> {
  const answer = await through((bridge) => bridge.iapPurchase?.(productId, accountToken))
  if (answer?.state === 'userCancelled' || answer?.state === 'pending') return { state: answer.state }
  if (answer?.state !== 'success' || typeof answer.transaction !== 'string' || answer.transaction === '' || typeof answer.transactionId !== 'string' || answer.transactionId === '') throw new Error(IAP_FAILED)
  return { state: 'success', transactionId: answer.transactionId, productId: answer.productId, transaction: answer.transaction }
}

/** End one purchase. Only ever called after the account server credited it (lib/iap-flow.ts). */
export async function iapFinish(transactionId: string): Promise<boolean> {
  return (await through((bridge) => bridge.iapFinish?.(transactionId))) === true
}

/** Every purchase that is bought and not credited yet. Empty where there is no store. */
export async function iapUnfinished(): Promise<IapTransaction[]> {
  let answer: Awaited<ReturnType<typeof tryBridge<IapTransaction[]>>>
  try {
    answer = await tryBridge<IapTransaction[]>((bridge) => bridge.iapUnfinished?.())
  } catch (err) {
    throw new Error(iapFailureText(err))
  }
  if (!answer.ok || !Array.isArray(answer.value)) return []
  return answer.value.map(asTransaction).filter((t): t is IapTransaction => t !== null)
}

/** A purchase the store reports while the app runs: one that somebody else approved ("Ask to Buy"). */
export function onIapTransaction(handler: (transaction: IapTransaction) => void): Promise<BridgeUnsubscribe> {
  return onBridgeEvent(BRIDGE_EVENTS.iapTransaction, (payload) => {
    const transaction = asTransaction(payload)
    if (transaction) handler(transaction)
  })
}
