/**
 * Credits as an in-app purchase: is it offered here, and the flow wired to
 * the real store and the real server.
 *
 * Offered only when ALL of this holds:
 *   - the store switch `purchase` is 'in-app' (in no preset today),
 *   - this is an iPhone or iPad (the store of the system, StoreKit),
 *   - the build names the address that credits a purchase,
 *   - the build names at least one pack.
 * Without the address there is no purchase, whatever the switch says: the app
 * never takes money for credits nobody would add.
 *
 * Built in round 17 and switched off: mobile-docs/r17/in-app-kauf-gebaut.md.
 */
import { create } from 'zustand'
import { useCloudAuthStore } from '../../stores/cloudAuthStore'
import { mobileOS } from '../platform/detect'
import { iapFinish, iapProducts, iapPurchase, iapUnfinished, onIapTransaction, type IapProduct } from '../platform/iap'
import { iapConfig, redeemPurchase } from '../platform/iap-server'
import { storePolicy } from '../policy/storePolicy'
import { createIapFlow, type BuyOutcome, type IapFlow, type IapFlowDeps, type ResumeReport } from './iap-flow'

/** Is the purchase of credits part of this app on this phone. */
export function iapOffered(): boolean {
  if (storePolicy().purchase !== 'in-app') return false
  if (mobileOS() !== 'ios') return false
  const config = iapConfig()
  return config.redeemUrl !== '' && config.productIds.length > 0
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The id of the signed in account as the store binds it into a purchase, or null: no purchase without an account. */
export function iapAccountToken(): string | null {
  const id = useCloudAuthStore.getState().user?.id
  return typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null
}

/** May this account open the sheet "Add credits" right now. */
export function iapOfferedToAccount(): boolean {
  return iapOffered() && iapAccountToken() !== null
}

interface IapState {
  /** Purchases that are bought and not credited yet. The sheet says so while this is above 0. */
  late: number
  setLate(late: number): void
}

export const useIapStore = create<IapState>((set) => ({ late: 0, setLate: (late) => set({ late }) }))

async function reloadBalance(): Promise<void> {
  const { probeAccount } = await import('../../hooks/useCloudAuth')
  await probeAccount()
}

const REAL: IapFlowDeps = {
  purchase: iapPurchase,
  unfinished: iapUnfinished,
  finish: iapFinish,
  redeem: (jws) => redeemPurchase(jws),
  reloadBalance,
}

let flow: IapFlow = createIapFlow(REAL)

/** Only for tests: a flow over a played store and a played server, null for the real one. */
export function __setIapFlowDepsForTests(deps: IapFlowDeps | null): void {
  flow = createIapFlow(deps ?? REAL)
}

/** The packs of this build as the store names and prices them. */
export async function loadIapProducts(): Promise<{ products: IapProduct[]; canPurchase: boolean }> {
  return iapProducts(iapConfig().productIds)
}

/** Buy one pack for the signed in account. Throws an Error with one English sentence when the purchase did not work. */
export async function buyCredits(productId: string): Promise<BuyOutcome> {
  const account = iapAccountToken()
  if (!iapOffered() || !account) throw new Error('Sign in to your account, then add credits.')
  const outcome = await flow.buy(productId, account)
  if (outcome.state === 'late') useIapStore.getState().setLate(useIapStore.getState().late + 1)
  return outcome
}

/**
 * Hand every open purchase to the server again. Runs at the start of the app,
 * when the store reports a purchase, when an account signs in and when the
 * user asks for it. Does nothing where the purchase is not offered or nobody
 * is signed in.
 */
export async function resumeIapPurchases(): Promise<ResumeReport> {
  const account = iapAccountToken()
  if (!iapOffered() || account === null) return { credited: 0, late: 0, failed: false, foreign: 0 }
  // A purchase another account made on this phone waits for that account.
  const report = await flow.resume(account)
  if (!report.failed) useIapStore.getState().setLate(report.late)
  return report
}

let started = false
/** What startIap put in place, so a test can take it away again. */
let stops: Array<() => void> = []

/**
 * At the start of the app. In a build that does not offer the purchase this
 * returns at its first line: the store is never asked and nothing listens.
 * `onCredited` is told when a purchase from an earlier run got its credit now.
 */
export function startIap(onCredited?: (count: number) => void): void {
  if (started || !iapOffered()) return
  started = true
  const run = () => {
    void resumeIapPurchases()
      .then((report) => {
        if (report.credited > 0) onCredited?.(report.credited)
      })
      .catch(() => {})
  }
  run()
  // A purchase somebody else approved ("Ask to Buy") arrives while the app runs.
  void onIapTransaction(run).then(
    (stop) => {
      if (started) stops.push(stop)
      else stop()
    },
    () => {},
  )
  // An open purchase belongs to an account: once that account is signed in, hand it in.
  stops.push(
    useCloudAuthStore.subscribe((state, previous) => {
      if (state.user?.id && state.user.id !== previous.user?.id) run()
    }),
  )
}

/** Only for tests: let startIap run again. */
export function __resetIapForTests(): void {
  started = false
  for (const stop of stops) stop()
  stops = []
  useIapStore.setState({ late: 0 })
}
