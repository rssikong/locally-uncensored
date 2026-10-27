/**
 * An in-app purchase of credits, in every order of events (lib/iap-flow.ts).
 *
 * The store and the server are played. The store keeps what a real one keeps:
 * a purchase that was not finished is handed out again by `unfinished`, a
 * finished one never is. The server credits a transaction once and answers a
 * second hand-in of the same one with "credited" again, as the requirement
 * says (mobile-docs/r17/in-app-kauf-gebaut.md).
 *
 * The rule under test: finish only AFTER the server said "credited". The
 * counter-check at the end runs a flow that finishes first through the same
 * played world and shows that the checks of this file catch it.
 *
 * Run: npx vitest run src/mobile/lib/__tests__/iap-flow.test.ts
 */
import { describe, expect, it } from 'vitest'
import { createIapFlow, type FlowPurchase, type FlowTransaction, type IapFlowDeps } from '../iap-flow'

const ACCOUNT = '0b0e7a52-6f0c-4c3e-9a51-3d2f1c9a7e10'
const PACK = 'pack.small'

class ServerDown extends Error {
  readonly kind = 'unavailable'
}

interface World {
  deps: IapFlowDeps
  /** Everything that happened, in order. */
  log: string[]
  /** What the store still holds as open. */
  open: FlowTransaction[]
  /** Transaction ids the server credited, each once. */
  credited: string[]
  /** How often the server was handed each transaction. */
  handedIn: Record<string, number>
  balance: () => number
  /** The next answers of the sheet of the system. Default: success. */
  sheet: Array<'success' | 'userCancelled' | 'pending' | 'fail'>
  /** While true the server cannot be reached. */
  serverDown: boolean
  /** While true `finish` of the store fails. */
  finishFails: boolean
  /** Resolve the server call by hand (for two hand-ins at the same time). */
  gate: { wait: Promise<void>; open: () => void } | null
}

function world(): World {
  let next = 1000
  let balance = 0
  const w: World = {
    log: [],
    open: [],
    credited: [],
    handedIn: {},
    balance: () => balance,
    sheet: [],
    serverDown: false,
    finishFails: false,
    gate: null,
    deps: {
      async purchase(productId, accountToken): Promise<FlowPurchase> {
        w.log.push(`purchase ${productId} for ${accountToken}`)
        const answer = w.sheet.shift() ?? 'success'
        if (answer === 'fail') throw new Error('The App Store could not be reached. Check your connection, then try again.')
        if (answer !== 'success') return { state: answer }
        const transaction: FlowTransaction = { transactionId: String(next++), productId, transaction: `jws.${productId}.${next}` }
        // The store holds the purchase as open from this moment on.
        w.open.push(transaction)
        return { state: 'success', ...transaction }
      },
      async unfinished() {
        w.log.push('unfinished')
        return w.open.map((t) => ({ ...t }))
      },
      async finish(transactionId) {
        w.log.push(`finish ${transactionId}`)
        if (w.finishFails) throw new Error('The store did not answer.')
        w.open = w.open.filter((t) => t.transactionId !== transactionId)
        return true
      },
      async redeem(jws) {
        const transaction = [...w.open].find((t) => t.transaction === jws)
        const id = transaction?.transactionId ?? `unknown:${jws}`
        w.log.push(`redeem ${id}`)
        w.handedIn[id] = (w.handedIn[id] ?? 0) + 1
        if (w.gate) await w.gate.wait
        if (w.serverDown) throw new ServerDown('down')
        // Idempotent by the id of the transaction: credited once, answered "credited" every time.
        if (!w.credited.includes(id)) {
          w.credited.push(id)
          balance += 100
        }
        w.log.push(`credited ${id}`)
        return { credited: true as const, balance }
      },
      async reloadBalance() {
        w.log.push('reload')
      },
    },
  }
  return w
}

/**
 * The one rule: no transaction is finished before the server credited it.
 * Returns the ids that broke it.
 */
function finishedTooEarly(log: readonly string[]): string[] {
  const broken: string[] = []
  log.forEach((entry, at) => {
    const id = /^finish (.+)$/.exec(entry)?.[1]
    if (id && !log.slice(0, at).includes(`credited ${id}`)) broken.push(id)
  })
  return broken
}

describe('buying a pack', () => {
  it('success: buy, hand the transaction to the server, finish only then, reload the balance', async () => {
    const w = world()
    const outcome = await createIapFlow(w.deps).buy(PACK, ACCOUNT)
    expect(outcome).toEqual({ state: 'credited', balance: 100 })
    expect(w.log).toEqual([`purchase ${PACK} for ${ACCOUNT}`, 'redeem 1000', 'credited 1000', 'finish 1000', 'reload'])
    expect(finishedTooEarly(w.log)).toEqual([])
    expect(w.open).toEqual([])
    expect(w.credited).toEqual(['1000'])
  })

  it('the user closes the sheet of the system: nothing is handed in, nothing is finished, nothing is said', async () => {
    const w = world()
    w.sheet = ['userCancelled']
    expect(await createIapFlow(w.deps).buy(PACK, ACCOUNT)).toEqual({ state: 'cancelled' })
    expect(w.log).toEqual([`purchase ${PACK} for ${ACCOUNT}`])
    expect(w.balance()).toBe(0)
  })

  it('pending ("Ask to Buy"): nothing is bought yet, so nothing is handed in and nothing is finished', async () => {
    const w = world()
    w.sheet = ['pending']
    expect(await createIapFlow(w.deps).buy(PACK, ACCOUNT)).toEqual({ state: 'pending' })
    expect(w.log).toEqual([`purchase ${PACK} for ${ACCOUNT}`])
    expect(w.open).toEqual([])
  })

  it('the purchase itself fails: the sentence of the store is passed on, nothing else happens', async () => {
    const w = world()
    w.sheet = ['fail']
    await expect(createIapFlow(w.deps).buy(PACK, ACCOUNT)).rejects.toThrow('The App Store could not be reached.')
    expect(w.log).toEqual([`purchase ${PACK} for ${ACCOUNT}`])
  })

  it('the credit fails: the purchase is NOT finished and stays open in the store', async () => {
    const w = world()
    w.serverDown = true
    const outcome = await createIapFlow(w.deps).buy(PACK, ACCOUNT)
    expect(outcome).toEqual({ state: 'late', reason: 'unavailable' })
    expect(w.log.some((entry) => entry.startsWith('finish'))).toBe(false)
    expect(w.log).not.toContain('reload')
    expect(w.open.map((t) => t.transactionId)).toEqual(['1000'])
    expect(w.balance()).toBe(0)
  })

  it('a server that answers without "credited" credited nothing: not finished', async () => {
    const w = world()
    w.deps.redeem = async () => ({ credited: false, balance: 5 }) as unknown as { credited: true; balance: number }
    const outcome = await createIapFlow(w.deps).buy(PACK, ACCOUNT)
    expect(outcome).toEqual({ state: 'late', reason: 'refused' })
    expect(w.log.some((entry) => entry.startsWith('finish'))).toBe(false)
    expect(w.open).toHaveLength(1)
  })
})

describe('picking a purchase up again', () => {
  it('the credit failed, the next start hands the same transaction in again and finishes it then', async () => {
    const w = world()
    w.serverDown = true
    const first = createIapFlow(w.deps)
    await first.buy(PACK, ACCOUNT)
    // A new run of the app: a new flow, the same store, the server is back.
    w.serverDown = false
    w.log.length = 0
    const report = await createIapFlow(w.deps).resume()
    expect(report).toEqual({ credited: 1, late: 0, failed: false, foreign: 0 })
    expect(w.log).toEqual(['unfinished', 'redeem 1000', 'credited 1000', 'finish 1000', 'reload'])
    expect(finishedTooEarly(w.log)).toEqual([])
    expect(w.open).toEqual([])
    expect(w.balance()).toBe(100)
  })

  it('the server is still down at the next start: still open, still not finished, and tried again the time after', async () => {
    const w = world()
    w.serverDown = true
    await createIapFlow(w.deps).buy(PACK, ACCOUNT)
    expect(await createIapFlow(w.deps).resume()).toEqual({ credited: 0, late: 1, failed: false, foreign: 0 })
    expect(w.open).toHaveLength(1)
    w.serverDown = false
    expect(await createIapFlow(w.deps).resume()).toEqual({ credited: 1, late: 0, failed: false, foreign: 0 })
    expect(w.handedIn['1000']).toBe(3)
    expect(w.credited).toEqual(['1000'])
    expect(finishedTooEarly(w.log)).toEqual([])
  })

  it('the app ended between the purchase and the finish: the store still holds it, the start credits and finishes it', async () => {
    const w = world()
    // The sheet of the system came back with a purchase, and the app was gone before anything else ran.
    await w.deps.purchase(PACK, ACCOUNT)
    w.log.length = 0
    const report = await createIapFlow(w.deps).resume()
    expect(report).toEqual({ credited: 1, late: 0, failed: false, foreign: 0 })
    expect(w.log).toEqual(['unfinished', 'redeem 1000', 'credited 1000', 'finish 1000', 'reload'])
    expect(w.open).toEqual([])
  })

  it('the app ended between the credit and the finish: handed in twice, credited once, finished the second time', async () => {
    const w = world()
    w.finishFails = true
    const outcome = await createIapFlow(w.deps).buy(PACK, ACCOUNT)
    // The credit stands although the store did not take the finish.
    expect(outcome).toEqual({ state: 'credited', balance: 100 })
    expect(w.open).toHaveLength(1)
    w.finishFails = false
    const report = await createIapFlow(w.deps).resume()
    expect(report).toEqual({ credited: 1, late: 0, failed: false, foreign: 0 })
    // The double hand-in is the server's to absorb: one credit, one balance.
    expect(w.handedIn['1000']).toBe(2)
    expect(w.credited).toEqual(['1000'])
    expect(w.balance()).toBe(100)
    expect(w.open).toEqual([])
    expect(finishedTooEarly(w.log)).toEqual([])
  })

  it('the same transaction is not sent twice at the same time: the start and the event of the store share one hand-in', async () => {
    const w = world()
    await w.deps.purchase(PACK, ACCOUNT)
    let open = () => {}
    w.gate = { wait: new Promise<void>((done) => (open = done)), open: () => open() }
    const flow = createIapFlow(w.deps)
    const both = Promise.all([flow.resume(), flow.resume(), flow.settle(w.open[0])])
    await new Promise((done) => setTimeout(done, 0))
    w.gate.open()
    const [a, b, c] = await both
    expect(w.handedIn['1000']).toBe(1)
    expect(a.credited + b.credited).toBe(2)
    expect(c).toEqual({ state: 'credited', balance: 100 })
    expect(w.log.filter((entry) => entry === 'finish 1000')).toHaveLength(1)
  })

  it('several open purchases: each is handed in, a failed one does not stop the others', async () => {
    const w = world()
    await w.deps.purchase(PACK, ACCOUNT)
    await w.deps.purchase('pack.large', ACCOUNT)
    const redeem = w.deps.redeem
    w.deps.redeem = async (jws) => {
      if (jws.startsWith(`jws.${PACK}.`)) {
        w.log.push('redeem 1000')
        throw new ServerDown('down')
      }
      return redeem(jws)
    }
    const report = await createIapFlow(w.deps).resume()
    expect(report).toEqual({ credited: 1, late: 1, failed: false, foreign: 0 })
    expect(w.open.map((t) => t.transactionId)).toEqual(['1000'])
    expect(finishedTooEarly(w.log)).toEqual([])
  })

  it('a purchase another account made on this phone is left alone: not handed in with this session, not counted as late', async () => {
    const w = world()
    const other = '9c1d2e3f-0000-4000-8000-aaaaaaaaaaaa'
    await w.deps.purchase(PACK, other)
    await w.deps.purchase('pack.large', ACCOUNT)
    w.open[0].accountToken = other
    w.open[1].accountToken = ACCOUNT.toUpperCase()
    w.log.length = 0
    const report = await createIapFlow(w.deps).resume(ACCOUNT)
    expect(report).toEqual({ credited: 1, late: 0, failed: false, foreign: 1 })
    expect(w.log).toEqual(['unfinished', 'redeem 1001', 'credited 1001', 'finish 1001', 'reload'])
    // It is still open, for the account that made it.
    expect(w.open.map((t) => t.transactionId)).toEqual(['1000'])
    expect((await createIapFlow(w.deps).resume(other)).credited).toBe(1)
    expect(w.open).toEqual([])
  })

  it('a purchase the store reports without an account is handed in: the server decides whose it is', async () => {
    const w = world()
    await w.deps.purchase(PACK, ACCOUNT)
    expect(await createIapFlow(w.deps).resume(ACCOUNT)).toEqual({ credited: 1, late: 0, failed: false, foreign: 0 })
  })

  it('nothing is open: nothing is handed in', async () => {
    const w = world()
    expect(await createIapFlow(w.deps).resume()).toEqual({ credited: 0, late: 0, failed: false, foreign: 0 })
    expect(w.log).toEqual(['unfinished'])
  })

  it('the store cannot be asked: said as failed, nothing is finished', async () => {
    const w = world()
    w.deps.unfinished = async () => {
      throw new Error('no store')
    }
    expect(await createIapFlow(w.deps).resume()).toEqual({ credited: 0, late: 0, failed: true, foreign: 0 })
  })

  it('a reload of the balance that fails does not undo a credit', async () => {
    const w = world()
    w.deps.reloadBalance = async () => {
      throw new Error('offline')
    }
    expect(await createIapFlow(w.deps).buy(PACK, ACCOUNT)).toEqual({ state: 'credited', balance: 100 })
    expect(w.open).toEqual([])
  })
})

describe('counter-check: a flow that finishes before the credit is caught', () => {
  /** The wrong order, on purpose: finish first, then the server. */
  async function wrongBuy(deps: IapFlowDeps): Promise<void> {
    const answer = await deps.purchase(PACK, ACCOUNT)
    if (answer.state !== 'success') return
    await deps.finish(answer.transactionId)
    await deps.redeem(answer.transaction).catch(() => {})
  }

  it('the order check names the transaction', async () => {
    const w = world()
    await wrongBuy(w.deps)
    expect(finishedTooEarly(w.log)).toEqual(['1000'])
  })

  it('and with the server down the purchase is lost for good: finished, not credited, nothing left to hand in', async () => {
    const w = world()
    w.serverDown = true
    await wrongBuy(w.deps)
    expect(w.open).toEqual([])
    expect(w.balance()).toBe(0)
    expect(await createIapFlow(w.deps).resume()).toEqual({ credited: 0, late: 0, failed: false, foreign: 0 })
    // The right flow in the same situation keeps it: this is the difference the rule is for.
    const right = world()
    right.serverDown = true
    await createIapFlow(right.deps).buy(PACK, ACCOUNT)
    expect(right.open).toHaveLength(1)
  })
})
