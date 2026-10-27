/**
 * The one door to the account server for an in-app purchase
 * (platform/iap-server.ts), against a played server.
 *
 * Run: npx vitest run src/mobile/platform/__tests__/iap-server.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IAP_MAX_PRODUCTS, RedeemError, __setIapConfigForTests, failureForStatus, iapConfig, parseProductIds, parseRedeemUrl, redeemPurchase } from '../iap-server'

const URL_ = 'https://server.example/redeem'

afterEach(() => {
  __setIapConfigForTests(null)
  vi.useRealTimers()
})

function answer(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function failure(run: Promise<unknown>): Promise<string> {
  try {
    await run
  } catch (err) {
    expect(err).toBeInstanceOf(RedeemError)
    return (err as RedeemError).kind
  }
  return 'resolved'
}

describe('what a build names', () => {
  it('a build without the variables sells nothing', () => {
    expect(iapConfig()).toEqual({ redeemUrl: '', productIds: [] })
  })

  it('the address must be https', () => {
    expect(parseRedeemUrl(URL_)).toBe(URL_)
    expect(parseRedeemUrl(`  ${URL_}  `)).toBe(URL_)
    for (const bad of ['', '   ', 'http://server.example/redeem', 'server.example/redeem', 'javascript:alert(1)', 'https://', 'https:// space', undefined, null, 5]) expect(parseRedeemUrl(bad), String(bad)).toBe('')
  })

  it('product ids: a list with commas, ids only, none twice, a limit', () => {
    expect(parseProductIds('app.credits.small, app.credits.large')).toEqual(['app.credits.small', 'app.credits.large'])
    expect(parseProductIds('a,a , b')).toEqual(['a', 'b'])
    expect(parseProductIds('ok, has space?, 9.99, <b>, ' + 'x'.repeat(129))).toEqual(['ok', 'has', '9.99'])
    expect(parseProductIds('')).toEqual([])
    expect(parseProductIds(undefined)).toEqual([])
    expect(parseProductIds(Array.from({ length: 40 }, (_, i) => `p${i}`).join(','))).toHaveLength(IAP_MAX_PRODUCTS)
  })

  it('a test hands in an address and packs, and gives them back', () => {
    __setIapConfigForTests({ redeemUrl: URL_, productIds: ['a', 'b'] })
    expect(iapConfig()).toEqual({ redeemUrl: URL_, productIds: ['a', 'b'] })
    __setIapConfigForTests({ redeemUrl: 'http://not-https.example', productIds: ['a'] })
    expect(iapConfig().redeemUrl).toBe('')
    __setIapConfigForTests(null)
    expect(iapConfig()).toEqual({ redeemUrl: '', productIds: [] })
  })
})

describe('redeemPurchase', () => {
  it('sends the signed transaction with the session of the account, and reads "credited" and the balance', async () => {
    __setIapConfigForTests({ redeemUrl: URL_, productIds: ['a'] })
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => answer(200, { credited: true, balance: 1500 }))
    expect(await redeemPurchase('header.payload.signature', { token: async () => 'session-token', fetch })).toEqual({ credited: true, balance: 1500 })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(URL_)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer session-token' })
    expect(JSON.parse(String(init?.body))).toEqual({ platform: 'ios', transaction: 'header.payload.signature' })
  })

  it('without an address nothing is sent', async () => {
    const fetch = vi.fn()
    expect(await failure(redeemPurchase('jws', { token: async () => 't', fetch }))).toBe('unavailable')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('without a session nothing is sent: signed out', async () => {
    __setIapConfigForTests({ redeemUrl: URL_, productIds: ['a'] })
    const fetch = vi.fn()
    expect(await failure(redeemPurchase('jws', { token: async () => null, fetch }))).toBe('signed-out')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a session that cannot be read is "try again", not "signed out"', async () => {
    __setIapConfigForTests({ redeemUrl: URL_, productIds: ['a'] })
    const token = async () => {
      throw new Error('LU Cloud unreachable. Check your connection.')
    }
    expect(await failure(redeemPurchase('jws', { token, fetch: vi.fn() }))).toBe('unavailable')
  })

  it('only "credited: true" is a credit', async () => {
    __setIapConfigForTests({ redeemUrl: URL_, productIds: ['a'] })
    const token = async () => 't'
    for (const body of [{ credited: false, balance: 10 }, { credited: 'true', balance: 10 }, { ok: true }, {}, null, [], { balance: 10 }]) {
      expect(await failure(redeemPurchase('jws', { token, fetch: async () => answer(200, body) })), JSON.stringify(body)).toBe('refused')
    }
    expect(await failure(redeemPurchase('jws', { token, fetch: async () => answer(200, 'not json') }))).toBe('unavailable')
    // A credit without a readable balance is still a credit: the app asks the account for the balance anyway.
    expect(await redeemPurchase('jws', { token, fetch: async () => answer(200, { credited: true }) })).toEqual({ credited: true, balance: 0 })
  })

  it('what a status means', async () => {
    expect([401].map(failureForStatus)).toEqual(['signed-out'])
    expect([400, 403, 404, 409, 410, 422].map(failureForStatus)).toEqual(Array(6).fill('refused'))
    expect([408, 425, 429, 500, 502, 503, 504].map(failureForStatus)).toEqual(Array(7).fill('unavailable'))
    __setIapConfigForTests({ redeemUrl: URL_, productIds: ['a'] })
    const token = async () => 't'
    expect(await failure(redeemPurchase('jws', { token, fetch: async () => answer(503, { error: 'down' }) }))).toBe('unavailable')
    expect(await failure(redeemPurchase('jws', { token, fetch: async () => answer(422, { error: 'no' }) }))).toBe('refused')
    // An error body that says "credited" is still an error.
    expect(await failure(redeemPurchase('jws', { token, fetch: async () => answer(500, { credited: true, balance: 1 }) }))).toBe('unavailable')
  })

  it('no network, or no answer in time: try again', async () => {
    __setIapConfigForTests({ redeemUrl: URL_, productIds: ['a'] })
    const token = async () => 't'
    const offline = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect(await failure(redeemPurchase('jws', { token, fetch: offline }))).toBe('unavailable')
    vi.useFakeTimers()
    const hangs = (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    const run = failure(redeemPurchase('jws', { token, fetch: hangs }))
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await run).toBe('unavailable')
  })

  it('the error says what kind it is and never carries the transaction or the token', async () => {
    __setIapConfigForTests({ redeemUrl: URL_, productIds: ['a'] })
    try {
      await redeemPurchase('SECRET.JWS.TEXT', { token: async () => 'SECRET-TOKEN', fetch: async () => answer(500, {}) })
      expect.unreachable()
    } catch (err) {
      expect(String((err as Error).message)).not.toMatch(/SECRET/)
    }
  })
})
