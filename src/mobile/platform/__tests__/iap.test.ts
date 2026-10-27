/**
 * The door to the store of the system (platform/iap.ts), with a played bridge.
 *
 * Run: npx vitest run src/mobile/platform/__tests__/iap.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { __setBridgeForTests, type LuNativeBridge } from '../bridge'
import { IAP_FAILED, IAP_MISSING, iapBridged, iapFailureText, iapFinish, iapProducts, iapPurchase, iapUnfinished, onIapTransaction } from '../iap'

afterEach(() => __setBridgeForTests(undefined))

const NOT_FOUND = 'Command iap_products not found'

describe('where there is no store', () => {
  it('no bridge at all (a browser): the calls say so, the open purchases are none', async () => {
    __setBridgeForTests(null)
    expect(await iapBridged()).toBe(false)
    await expect(iapProducts(['a'])).rejects.toThrow(IAP_MISSING)
    await expect(iapPurchase('a', 'token')).rejects.toThrow(IAP_MISSING)
    await expect(iapFinish('1')).rejects.toThrow(IAP_MISSING)
    expect(await iapUnfinished()).toEqual([])
  })

  it('a bridge without the calls (Android), or an app older than the commands', async () => {
    __setBridgeForTests({})
    expect(await iapBridged()).toBe(false)
    await expect(iapProducts(['a'])).rejects.toThrow(IAP_MISSING)
    __setBridgeForTests({ iapProducts: async () => Promise.reject(NOT_FOUND), iapUnfinished: async () => Promise.reject('Command iap_unfinished not found') })
    await expect(iapProducts(['a'])).rejects.toThrow(IAP_MISSING)
    expect(await iapUnfinished()).toEqual([])
  })
})

describe('with the store', () => {
  const bridge = (over: Partial<LuNativeBridge> = {}): LuNativeBridge => ({
    iapProducts: vi.fn(async (ids: string[]) => ({ products: ids.map((id) => ({ id, displayName: `Pack ${id}`, displayPrice: 'PRICE' })), canPurchase: true })),
    iapPurchase: vi.fn(async () => ({ state: 'success' as const, transactionId: '77', productId: 'a', transaction: 'jws' })),
    iapFinish: vi.fn(async () => true),
    iapUnfinished: vi.fn(async () => [{ transactionId: '77', productId: 'a', transaction: 'jws' }]),
    ...over,
  })

  it('all four calls are there', async () => {
    __setBridgeForTests(bridge())
    expect(await iapBridged()).toBe(true)
  })

  it('the packs come as the store names them, with its price text and nothing of the app', async () => {
    const b = bridge()
    __setBridgeForTests(b)
    expect(await iapProducts(['a', 'b'])).toEqual({ products: [{ id: 'a', displayName: 'Pack a', displayPrice: 'PRICE' }, { id: 'b', displayName: 'Pack b', displayPrice: 'PRICE' }], canPurchase: true })
    expect(b.iapProducts).toHaveBeenCalledWith(['a', 'b'])
  })

  it('a pack without a name or without a price text is not shown', async () => {
    __setBridgeForTests(bridge({ iapProducts: async () => ({ products: [{ id: 'a', displayName: 'A', displayPrice: '' }, { id: 'b', displayPrice: 'P' } as never, { id: 'c', displayName: 'C', displayPrice: 'P' }], canPurchase: false }) }))
    expect(await iapProducts(['a', 'b', 'c'])).toEqual({ products: [{ id: 'c', displayName: 'C', displayPrice: 'P' }], canPurchase: false })
  })

  it('a purchase: success with the signed transaction, cancelled, pending', async () => {
    const b = bridge()
    __setBridgeForTests(b)
    expect(await iapPurchase('a', 'account')).toEqual({ state: 'success', transactionId: '77', productId: 'a', transaction: 'jws' })
    expect(b.iapPurchase).toHaveBeenCalledWith('a', 'account')
    __setBridgeForTests(bridge({ iapPurchase: async () => ({ state: 'userCancelled' }) }))
    expect(await iapPurchase('a', 'account')).toEqual({ state: 'userCancelled' })
    __setBridgeForTests(bridge({ iapPurchase: async () => ({ state: 'pending' }) }))
    expect(await iapPurchase('a', 'account')).toEqual({ state: 'pending' })
  })

  it('a "success" without a transaction is not a purchase', async () => {
    for (const broken of [{ state: 'success', transactionId: '77', transaction: '' }, { state: 'success', transactionId: '', transaction: 'jws' }, { state: 'bought' }, null]) {
      __setBridgeForTests(bridge({ iapPurchase: async () => broken as never }))
      await expect(iapPurchase('a', 'account')).rejects.toThrow(IAP_FAILED)
    }
  })

  it('a sentence of the native side is shown as it is, a dump is not', async () => {
    const sentence = 'The App Store could not be reached. Check your connection, then try again.'
    __setBridgeForTests(bridge({ iapPurchase: async () => Promise.reject(sentence) }))
    await expect(iapPurchase('a', 'account')).rejects.toThrow(sentence)
    expect(iapFailureText(new Error(sentence))).toBe(sentence)
    for (const dump of ['', 'error', '{"code":2}', 'SKErrorDomain 2', 'Failed.\nat Iap.swift:88', undefined, null, 7]) expect(iapFailureText(dump)).toBe(IAP_FAILED)
  })

  it('finish and the open purchases', async () => {
    const b = bridge()
    __setBridgeForTests(b)
    expect(await iapFinish('77')).toBe(true)
    expect(b.iapFinish).toHaveBeenCalledWith('77')
    expect(await iapUnfinished()).toEqual([{ transactionId: '77', productId: 'a', transaction: 'jws' }])
    __setBridgeForTests(bridge({ iapUnfinished: async () => [{ transactionId: '', transaction: 'jws' }, { transactionId: '5', transaction: '' }, { transactionId: '6', transaction: 'ok' }] }))
    expect(await iapUnfinished()).toEqual([{ transactionId: '6', transaction: 'ok' }])
  })

  it('a purchase the store reports while the app runs reaches the listener, anything else does not', async () => {
    let send: (payload: unknown) => void = () => {}
    const on = vi.fn(async (_event: string, handler: (payload: unknown) => void) => {
      send = handler
      return () => {}
    })
    __setBridgeForTests(bridge({ on }))
    const seen: unknown[] = []
    await onIapTransaction((t) => seen.push(t))
    expect(on.mock.calls[0][0]).toBe('iap-transaction')
    send({ transactionId: '9', productId: 'a', transaction: 'jws9' })
    send({ transactionId: '', transaction: 'x' })
    send(null)
    expect(seen).toEqual([{ transactionId: '9', productId: 'a', transaction: 'jws9' }])
  })
})
