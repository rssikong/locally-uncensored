/**
 * An in-app purchase of credits, step by step. Pure: the store and the
 * server are handed in, so every order of events is a unit test.
 *
 * The order is fixed:
 *
 *   1. buy            the sheet of the system
 *   2. redeem         the signed transaction goes to the account server
 *   3. finish         ONLY after the server said "credited"
 *   4. reload         the balance of the account
 *
 * Step 3 before step 2 would lose a purchase for good: a finished consumable
 * never comes back from the store, and if the credit then fails, the money is
 * taken and nothing is left to hand in. So while the credit has not arrived
 * the purchase stays open. The store hands every open purchase out again
 * (`unfinished`), and `resume` hands each to the server once more: at the
 * start of the app, when the store reports one, and when the user asks.
 *
 * The same transaction can reach the server twice (the app ended between the
 * credit and the finish, or finish itself failed). The server answers
 * "credited" again without crediting again; that is its business
 * (mobile-docs/r17/in-app-kauf-gebaut.md). Inside one run of the app a
 * transaction that is on its way is not sent a second time.
 */
export interface FlowTransaction {
  transactionId: string
  productId?: string
  /** The transaction as the store signed it (JWS). */
  transaction: string
  /** The account the purchase was made for, when the store reports it. */
  accountToken?: string
}

export type FlowPurchase = ({ state: 'success' } & FlowTransaction) | { state: 'userCancelled' } | { state: 'pending' }

export interface IapFlowDeps {
  /** The sheet of the system. Throws when the purchase did not work. */
  purchase(productId: string, accountToken: string): Promise<FlowPurchase>
  /** Every purchase that is bought and not finished. */
  unfinished(): Promise<FlowTransaction[]>
  /** End one purchase in the store. */
  finish(transactionId: string): Promise<unknown>
  /** Hand the signed transaction to the server. Resolves only with `credited: true`, throws otherwise. */
  redeem(jws: string): Promise<{ credited: true; balance: number }>
  /** Ask the account for its balance again. */
  reloadBalance(): Promise<unknown>
}

export type SettleOutcome =
  /** Credited by the server, and finished in the store. */
  | { state: 'credited'; balance: number }
  /** Bought, and not credited yet. The purchase stays open and is handed in again. `reason` is what the server call ended in. */
  | { state: 'late'; reason: string }

export type BuyOutcome =
  | SettleOutcome
  /** The user closed the sheet of the system. */
  | { state: 'cancelled' }
  /** Waiting for somebody else to approve ("Ask to Buy"). Nothing is bought yet. */
  | { state: 'pending' }

export interface ResumeReport {
  /** Open purchases that are credited and finished now. */
  credited: number
  /** Open purchases that are still not credited. */
  late: number
  /** The store could not be asked. */
  failed: boolean
  /** Open purchases of another account: left alone, for the account that made them. */
  foreign: number
}

export interface IapFlow {
  buy(productId: string, accountToken: string): Promise<BuyOutcome>
  settle(transaction: FlowTransaction): Promise<SettleOutcome>
  /**
   * Hand every open purchase in again. With `accountToken`, a purchase the
   * store reports for another account is left alone: it is neither handed in
   * with this account's session nor counted as late for this user.
   */
  resume(accountToken?: string): Promise<ResumeReport>
}

function reasonOf(err: unknown): string {
  const kind = err && typeof err === 'object' ? (err as { kind?: unknown }).kind : undefined
  return typeof kind === 'string' ? kind : 'unavailable'
}

export function createIapFlow(deps: IapFlowDeps): IapFlow {
  /** Transactions on their way to the server, so the same one is not sent twice at the same time. */
  const underway = new Map<string, Promise<SettleOutcome>>()

  async function settleOnce(transaction: FlowTransaction): Promise<SettleOutcome> {
    let answer: { credited: true; balance: number }
    try {
      answer = await deps.redeem(transaction.transaction)
    } catch (err) {
      // Not credited. Nothing is finished: the store keeps the purchase and hands it out again.
      return { state: 'late', reason: reasonOf(err) }
    }
    if (!answer || answer.credited !== true) return { state: 'late', reason: 'refused' }
    // Credited. Only now may the purchase end in the store.
    try {
      await deps.finish(transaction.transactionId)
    } catch {
      // The credit stands. The store hands the purchase out again, and the server answers "credited" again.
    }
    try {
      await deps.reloadBalance()
    } catch {
      // The balance shows the next time the account is asked.
    }
    return { state: 'credited', balance: answer.balance }
  }

  function settle(transaction: FlowTransaction): Promise<SettleOutcome> {
    const running = underway.get(transaction.transactionId)
    if (running) return running
    const started = settleOnce(transaction).finally(() => underway.delete(transaction.transactionId))
    underway.set(transaction.transactionId, started)
    return started
  }

  async function buy(productId: string, accountToken: string): Promise<BuyOutcome> {
    const answer = await deps.purchase(productId, accountToken)
    if (answer.state === 'userCancelled') return { state: 'cancelled' }
    if (answer.state === 'pending') return { state: 'pending' }
    return settle({ transactionId: answer.transactionId, productId: answer.productId, transaction: answer.transaction })
  }

  async function resume(accountToken?: string): Promise<ResumeReport> {
    let open: FlowTransaction[]
    try {
      open = await deps.unfinished()
    } catch {
      return { credited: 0, late: 0, failed: true, foreign: 0 }
    }
    const report: ResumeReport = { credited: 0, late: 0, failed: false, foreign: 0 }
    for (const transaction of open) {
      if (accountToken && transaction.accountToken && transaction.accountToken.toLowerCase() !== accountToken.toLowerCase()) {
        report.foreign += 1
        continue
      }
      const outcome = await settle(transaction)
      if (outcome.state === 'credited') report.credited += 1
      else report.late += 1
    }
    return report
  }

  return { buy, settle, resume }
}
