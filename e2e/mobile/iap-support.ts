/**
 * The played world of the in-app purchase (round 17), shared by
 * e2e/mobile/iap.mobile.ts and the store guard: an account with an id of the
 * shape a real one has, the store of the system as a bridge inside the page,
 * and the account server as a route.
 *
 * Nothing is bought and nothing leaves the machine.
 */
import type { Page } from '@playwright/test'

export const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
/** The id of the mocked account. The store binds a purchase to it, so it has to be a UUID like a real one. */
export const IAP_ACCOUNT = '0b0e7a52-6f0c-4c3e-9a51-3d2f1c9a7e10'
export const IAP_HOST = 'iap-server.e2e.test'
export const IAP_REDEEM = `https://${IAP_HOST}/redeem`
export const IAP_PACKS = ['app.credits.small', 'app.credits.large']

export interface PlayedProduct {
  id: string
  displayName: string
  description?: string
  displayPrice: string
}

export interface IapServer {
  down: boolean
  /** Transactions credited, each once. */
  credited: string[]
  calls: Array<{ auth: string | null; body: { platform?: string; transaction?: string }; finishedBefore: string[] }>
}

export interface PlayedStore {
  /** What the sheet of the system answers, one per purchase. Default: success. */
  sheet?: string[]
  /** Purchases the store still holds as open when the app starts. */
  open?: Array<{ transactionId: string; productId: string; transaction: string }>
  products: PlayedProduct[] | 'fail'
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
const JSON_HEADERS = { ...CORS, 'content-type': 'application/json' }

/**
 * The mocked account of e2e/support/cloud-mock.ts, with an id that is a UUID.
 * Call it AFTER routeCloud: a route added later answers first, and everything
 * this one does not answer falls through to the mock.
 */
export async function routeIapAccount(page: Page): Promise<void> {
  const user = { id: IAP_ACCOUNT, email: 'qa@lu-labs.ai', aud: 'authenticated', role: 'authenticated' }
  await page.route('**/auth/v1/**', (route) => {
    const url = route.request().url()
    if (route.request().method() === 'OPTIONS') return route.fallback()
    if (url.includes('/token')) {
      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ access_token: 'e2e-access-token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'e2e-refresh-token', user }),
      })
    }
    if (url.includes('/user')) return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(user) })
    return route.fallback()
  })
  await page.route('https://lu-labs.ai/api/me', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback()
    const answer = await route.fetch().catch(() => null)
    // The live answer only lends the other fields; an empty or broken one (the site
    // under load) must not take the test down.
    const body = answer ? ((await answer.json().catch(() => ({}))) as { user?: unknown }) : {}
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ ...body, user: { id: IAP_ACCOUNT, email: user.email } }) })
  })
}

/**
 * The account server: credits a transaction once and answers "credited" every
 * time it is handed the same one. Each call notes what the store had finished
 * at that moment, so a spec can hold "nothing was finished before the hand-in".
 */
export async function routeIapServer(page: Page, down = false): Promise<IapServer> {
  const server: IapServer = { down, credited: [], calls: [] }
  await page.route(IAP_REDEEM, async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = JSON.parse(request.postData() ?? '{}') as { platform?: string; transaction?: string }
    const finishedBefore = await page.evaluate(() => (window as unknown as { __iap: { log: string[] } }).__iap.log.filter((entry) => entry.startsWith('finish')))
    server.calls.push({ auth: request.headers().authorization ?? null, body, finishedBefore })
    if (server.down) return route.fulfill({ status: 503, headers: JSON_HEADERS, body: JSON.stringify({ error: 'unavailable' }) })
    if (body.transaction && !server.credited.includes(body.transaction)) server.credited.push(body.transaction)
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ credited: true, balance: 100 * server.credited.length }) })
  })
  return server
}

/**
 * Inside the loaded app: the store of the system as the plugin lu-native
 * answers for it (a purchase stays open until it is finished), and the
 * address and the packs a build would name. What the store was asked is kept
 * in window.__iap.log.
 */
export async function playIapStore(page: Page, store: PlayedStore): Promise<void> {
  await page.evaluate(
    async (setup) => {
      const origin = location.origin
      const { __setBridgeForTests } = await import(/* @vite-ignore */ `${origin}/src/mobile/platform/bridge.ts`)
      const { __setIapConfigForTests } = await import(/* @vite-ignore */ `${origin}/src/mobile/platform/iap-server.ts`)
      interface Open {
        transactionId: string
        productId?: string
        transaction: string
      }
      const played = { log: [] as string[], open: [...setup.open] as Open[], sheet: [...setup.sheet], next: 700, emit: (_payload: unknown) => {} }
      ;(window as unknown as { __iap: typeof played }).__iap = played
      __setBridgeForTests({
        on: async (event: string, handler: (payload: unknown) => void) => {
          if (event === 'iap-transaction') played.emit = handler
          return () => {}
        },
        iapProducts: async (ids: string[]) => {
          played.log.push(`products ${ids.join(',')}`)
          if (setup.products === 'fail') throw 'The App Store could not be reached. Check your connection, then try again.'
          return { products: setup.products, canPurchase: true }
        },
        iapPurchase: async (id: string, accountToken: string) => {
          played.log.push(`purchase ${id} ${accountToken}`)
          await new Promise((done) => setTimeout(done, 120))
          const answer = played.sheet.shift() ?? 'success'
          if (answer === 'userCancelled' || answer === 'pending') return { state: answer }
          if (answer !== 'success') throw answer
          const transaction = { transactionId: String(played.next++), productId: id, transaction: `jws-${id}-${played.next}` }
          played.open.push(transaction)
          return { state: 'success', ...transaction }
        },
        iapFinish: async (transactionId: string) => {
          played.log.push(`finish ${transactionId}`)
          played.open = played.open.filter((t) => t.transactionId !== transactionId)
          return true
        },
        iapUnfinished: async () => {
          played.log.push('unfinished')
          return played.open.map((t) => ({ ...t }))
        },
      })
      __setIapConfigForTests({ redeemUrl: setup.redeem, productIds: setup.packs })
    },
    { redeem: IAP_REDEEM, packs: IAP_PACKS, products: store.products, sheet: store.sheet ?? [], open: store.open ?? [] },
  )
}

/** Inside the loaded app: sign the mocked account in and let the app look at it. */
export async function signInMocked(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const origin = location.origin
    const { supabaseCloud } = await import(/* @vite-ignore */ `${origin}/src/api/cloud/supabase.ts`)
    const { probeAccount } = await import(/* @vite-ignore */ `${origin}/src/hooks/useCloudAuth.ts`)
    await supabaseCloud().auth.signInWithPassword({ email: 'qa@lu-labs.ai', password: 'e2e-password' })
    await probeAccount()
    window.dispatchEvent(new CustomEvent('lu-models-refresh'))
  })
}

/** What the app itself says about the switch and the offer, asked of the running page. */
export async function iapState(page: Page): Promise<{ preset: string; purchase: string; offered: boolean; account: boolean }> {
  return page.evaluate(async () => {
    const { storePolicy } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/policy/storePolicy.ts`)
    const { iapOffered, iapOfferedToAccount } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/lib/iap.ts`)
    return { preset: storePolicy().preset as string, purchase: storePolicy().purchase as string, offered: iapOffered() as boolean, account: iapOfferedToAccount() as boolean }
  })
}
