/**
 * Credits as an in-app purchase (round 17), in the browser with a played store.
 *
 * The switch `purchase: 'in-app'` is in no preset. This spec looks at the
 * build David would make if Apple asks for it: the App Store preset with the
 * one switch on (the developer address ?purchase=in-app), on an iPhone, with
 * the address that credits a purchase and two packs handed in for the test.
 *
 * The store of the system is played by a bridge inside the page (what the
 * plugin lu-native answers), the account server by a route of this spec.
 * LU Cloud is mocked at the network. Nothing is bought, nothing is signed in
 * for real, nothing leaves the machine.
 *
 *   LU_E2E_PORT=5397 LU_E2E_ONLY=iap npx playwright test --project=mobile
 */
import { expect, test, type Page } from '@playwright/test'
import { routeCloud } from '../support/cloud-mock'
import { IAP_ACCOUNT as ACCOUNT, IAP_HOST, IAP_PACKS as PACKS, IPHONE_UA, iapState, playIapStore, routeIapAccount, routeIapServer, signInMocked, type IapServer, type PlayedProduct, type PlayedStore } from './iap-support'
import { CLEAN_LAYOUT, SIZES, declareAdult, measureLayout, screensLoaded, shellUrl, watchErrors } from './support'

/** What the store would word. Not a price: the app has to show whatever text comes. */
const PRODUCTS: PlayedProduct[] = [
  { id: PACKS[0], displayName: 'Small pack', description: 'A few credits for chat and images.', displayPrice: 'STORE-PRICE-A' },
  { id: PACKS[1], displayName: 'Large pack with a longer name', displayPrice: 'STORE-PRICE-B' },
]
const LATE = 'Your purchase went through. Adding the credits is taking longer than usual. We will keep trying.'

interface Opened {
  server: IapServer
  opened: () => Promise<string[]>
  log: () => Promise<string[]>
}

interface Options {
  /** false: the App Store preset as it is built today, without the switch. */
  inApp?: boolean
  theme?: 'dark' | 'light'
  fontScale?: number
  sheet?: PlayedStore['sheet']
  open?: PlayedStore['open']
  products?: PlayedStore['products']
  serverDown?: boolean
}

async function open(page: Page, options: Options = {}): Promise<Opened> {
  await routeCloud(page, { license: 'active', access: true, paidPlan: true })
  await routeIapAccount(page)
  await page.route('https://lu-labs.ai/api/funnel/switch', (route) => route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }))
  const server = await routeIapServer(page, options.serverDown === true)
  // Nothing else leaves the developer server.
  await page.route(
    (url) => url.protocol.startsWith('http') && !['localhost', '127.0.0.1', 'lu-labs.ai', IAP_HOST].includes(url.hostname) && !url.pathname.includes('/auth/v1/'),
    (route) => route.abort('blockedbyclient'),
  )

  await declareAdult(page)
  await page.addInitScript(() => {
    const opened: string[] = []
    ;(window as unknown as { __opened: string[] }).__opened = opened
    window.open = (url?: string | URL) => {
      opened.push(String(url))
      return null
    }
  })
  await page.goto(`${shellUrl({ store: 'appstore', theme: options.theme, fontScale: options.fontScale })}${options.inApp === false ? '' : '&purchase=in-app'}`)
  await page.getByTestId('m-app').waitFor()
  await playIapStore(page, { products: options.products ?? PRODUCTS, sheet: options.sheet, open: options.open })
  await signInMocked(page)
  // Several runs share this machine: this is the developer server of this working copy, with the switch as asked.
  expect(await iapState(page)).toEqual({ preset: 'appstore', purchase: options.inApp === false ? 'none' : 'in-app', offered: options.inApp !== false, account: options.inApp !== false })
  return {
    server,
    opened: () => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened),
    log: () => page.evaluate(() => (window as unknown as { __iap: { log: string[] } }).__iap.log),
  }
}

async function go(page: Page, step: { route?: string; sheet?: string; props?: unknown }): Promise<void> {
  await page.evaluate(async (to) => {
    const { navApi } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/nav/api.ts`)
    navApi.resetTo('settings', [])
    if (to.route) navApi.push(to.route)
    if (to.sheet) navApi.openSheet(to.sheet, to.props)
  }, step)
  await expect(page.locator('.m-page[data-m-exit]')).toHaveCount(0)
  await screensLoaded(page)
}

/** LU_IAP_SHOTS=<folder> saves what a state looked like, to judge it by eye. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.LU_IAP_SHOTS
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` })
}

async function layout(page: Page) {
  await screensLoaded(page)
  await page.waitForTimeout(250)
  return measureLayout(page)
}

const visible = (page: Page, testid: string) => page.locator(`[data-testid="${testid}"]:visible`)

test.use({ userAgent: IPHONE_UA, hasTouch: true })

test.describe('the App Store preset as it is built today', () => {
  test('no sign of a purchase: no button on Account, on LU Cloud or in "out of credits", and the sheet is "Not part of this version"', async ({ page }) => {
    const errors = watchErrors(page)
    const { server, log, opened } = await open(page, { inApp: false })
    await go(page, { route: '/settings/account' })
    await expect(visible(page, 'm-account-signedin')).toBeVisible()
    await expect(page.getByTestId('m-account-add-credits')).toHaveCount(0)
    await go(page, { route: '/cloud' })
    await expect(visible(page, 'm-cloud-state')).toBeVisible()
    await expect(page.getByTestId('m-cloud-add-credits')).toHaveCount(0)
    await go(page, { sheet: 'credits', props: { reason: 'credits' } })
    await expect(visible(page, 'm-account-credits-empty').last()).toBeVisible()
    await expect(page.getByTestId('m-credits-add')).toHaveCount(0)
    await go(page, { sheet: 'settings-add-credits' })
    await expect(visible(page, 'm-unavailable')).toHaveText('This version of LU does not include this feature.')
    await expect(page.getByTestId('m-iap-sheet')).toHaveCount(0)
    expect(await page.getByTestId('m-app').innerText()).not.toMatch(/add credits|purchase|restore|app store/i)
    // The store was never asked and the server never called.
    expect(await log()).toEqual([])
    expect(server.calls).toEqual([])
    expect(await opened()).toEqual([])
    expect(errors()).toEqual([])
  })
})

for (const size of SIZES) {
  test.describe(`in-app purchase, ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    for (const theme of ['dark', 'light'] as const) {
      test(`${theme}: from the page Account to the sheet, a pack is bought, credited and only then finished`, async ({ page }) => {
        const errors = watchErrors(page)
        const { server, log, opened } = await open(page, { theme })
        await go(page, { route: '/settings/account' })
        const row = visible(page, 'm-account-add-credits')
        await expect(row).toContainText('Add credits')
        expect(await layout(page), 'page Account').toEqual(CLEAN_LAYOUT)
        await row.tap()
        const sheet = visible(page, 'm-iap-sheet')
        await expect(sheet).toBeVisible()
        await expect(sheet.getByTestId('m-iap-pack')).toHaveCount(2)
        // Names and price texts are the store's, as they came.
        await expect(sheet.getByTestId('m-iap-pack').nth(0)).toContainText('Small pack')
        await expect(sheet.getByTestId('m-iap-pack').nth(0)).toContainText('STORE-PRICE-A')
        await expect(sheet.getByTestId('m-iap-pack').nth(1)).toContainText('Large pack with a longer name')
        await expect(sheet.getByTestId('m-iap-pack').nth(1)).toContainText('STORE-PRICE-B')
        expect(await layout(page), 'sheet with packs').toEqual(CLEAN_LAYOUT)
        await shot(page, `packs-${size.name}-${theme}`)
        expect(await sheet.locator('a[href]').count()).toBe(0)
        expect(await sheet.innerText()).not.toMatch(/lu-labs|website|https?:|www\./i)

        await sheet.getByTestId('m-iap-pack').nth(0).tap()
        await expect(sheet.getByTestId('m-iap-credited')).toContainText('Credits added')
        expect(await layout(page), 'sheet after the credit').toEqual(CLEAN_LAYOUT)
        // One hand-in, with the session of the account and the signed transaction. Nothing was finished before it.
        expect(server.calls).toHaveLength(1)
        expect(server.calls[0].auth).toBe('Bearer e2e-access-token')
        expect(server.calls[0].body.platform).toBe('ios')
        expect(server.calls[0].body.transaction).toMatch(/^jws-app\.credits\.small-/)
        expect(server.calls[0].finishedBefore).toEqual([])
        // (The developer build draws a screen twice, so the packs may be asked for twice.)
        expect((await log()).filter((entry) => !entry.startsWith('products'))).toEqual([`purchase ${PACKS[0]} ${ACCOUNT}`, 'finish 700'])
        expect((await log())[0]).toBe(`products ${PACKS.join(',')}`)
        expect(await opened()).toEqual([])
        await sheet.getByTestId('m-iap-close').tap()
        await expect(page.getByTestId('m-iap-sheet')).toHaveCount(0)
        expect(errors()).toEqual([])
      })
    }

    test('the sheet of the system is closed, then "Ask to Buy": nothing is sent, and waiting is said', async ({ page }) => {
      const { server, log } = await open(page, { sheet: ['userCancelled', 'pending'] })
      await go(page, { sheet: 'settings-add-credits' })
      const sheet = visible(page, 'm-iap-sheet')
      await sheet.getByTestId('m-iap-pack').nth(0).tap()
      await expect.poll(async () => (await log()).filter((entry) => entry.startsWith('purchase')).length).toBe(1)
      await expect(sheet.getByTestId('m-iap-pack').nth(0)).toBeEnabled()
      await expect(sheet.getByTestId('m-iap-state')).toHaveAttribute('data-result', 'none')
      await sheet.getByTestId('m-iap-pack').nth(1).tap()
      await expect(sheet.getByTestId('m-iap-pending')).toContainText('Waiting for approval')
      expect(await layout(page), 'sheet, pending').toEqual(CLEAN_LAYOUT)
      expect(server.calls).toEqual([])
      expect((await log()).some((entry) => entry.startsWith('finish'))).toBe(false)
    })

    test('the credit does not get through: the honest sentence, nothing is finished, "Restore purchase" brings it home', async ({ page }) => {
      const { server, log } = await open(page, { serverDown: true })
      await go(page, { sheet: 'settings-add-credits' })
      const sheet = visible(page, 'm-iap-sheet')
      await sheet.getByTestId('m-iap-pack').nth(0).tap()
      await expect(sheet.getByTestId('m-iap-late')).toHaveText(LATE)
      expect(await layout(page), 'sheet, credit late').toEqual(CLEAN_LAYOUT)
      expect((await log()).some((entry) => entry.startsWith('finish'))).toBe(false)
      await expect(sheet.getByTestId('m-iap-credited')).toHaveCount(0)
      // Closed and opened again: the sentence is still there, the purchase is still open.
      await sheet.getByTestId('m-iap-close').tap()
      await go(page, { sheet: 'settings-add-credits' })
      await expect(visible(page, 'm-iap-late')).toHaveText(LATE)
      server.down = false
      await visible(page, 'm-iap-restore').tap()
      await expect(visible(page, 'm-iap-credited')).toBeVisible()
      await expect(page.getByTestId('m-iap-late')).toHaveCount(0)
      // The same transaction both times, credited once, and never finished before a hand-in.
      expect(server.calls).toHaveLength(2)
      expect(server.calls[0].body.transaction).toBe(server.calls[1].body.transaction)
      expect(server.credited).toHaveLength(1)
      for (const call of server.calls) expect(call.finishedBefore).toEqual([])
      expect((await log()).filter((entry) => entry.startsWith('finish'))).toEqual(['finish 700'])
    })

    test('a purchase the app lost before the credit is handed in at the start, finished after it, and the user is told', async ({ page }) => {
      const { server, log } = await open(page, { open: [{ transactionId: '41', productId: PACKS[0], transaction: 'jws-from-an-earlier-run' }] })
      // What boot/index.tsx does at the start, once the build names the address (here it is handed in after the start).
      await page.evaluate(async () => {
        const origin = location.origin
        const { startIap } = await import(/* @vite-ignore */ `${origin}/src/mobile/lib/iap.ts`)
        const { toast } = await import(/* @vite-ignore */ `${origin}/src/mobile/ui/Toast.tsx`)
        const { POLICY } = await import(/* @vite-ignore */ `${origin}/src/mobile/strings/policy.ts`)
        startIap(() => toast(POLICY.iapCredited, { testid: 'iap-credited' }))
      })
      await expect(page.getByTestId('m-toast-iap-credited')).toContainText('Your credits were added.')
      expect(server.calls).toHaveLength(1)
      expect(server.calls[0].body.transaction).toBe('jws-from-an-earlier-run')
      expect(server.calls[0].finishedBefore).toEqual([])
      expect(await log()).toEqual(['unfinished', 'finish 41'])
    })

    test('"out of credits" and the page LU Cloud lead to the sheet, and the packs that cannot be loaded say so', async ({ page }) => {
      const { opened } = await open(page, { products: 'fail' })
      await go(page, { sheet: 'credits', props: { reason: 'credits' } })
      await expect(visible(page, 'm-credits-add')).toHaveText('Add credits')
      expect(await layout(page), 'sheet out of credits').toEqual(CLEAN_LAYOUT)
      await expect(page.getByTestId('m-credits-plans')).toHaveCount(0)
      await visible(page, 'm-credits-add').tap()
      await expect(visible(page, 'm-iap-load-error')).toContainText('The packs could not be loaded')
      await expect(visible(page, 'm-iap-load-error')).toContainText('The App Store could not be reached.')
      expect(await layout(page), 'sheet, load error').toEqual(CLEAN_LAYOUT)
      await go(page, { route: '/cloud' })
      await expect(visible(page, 'm-cloud-add-credits')).toHaveText('Add credits')
      expect(await layout(page), 'page LU Cloud').toEqual(CLEAN_LAYOUT)
      await visible(page, 'm-cloud-add-credits').tap()
      await expect(visible(page, 'm-iap-sheet')).toBeVisible()
      expect(await opened()).toEqual([])
    })
  })
}

test.describe('in-app purchase, text at 200 percent on the smallest phone', () => {
  test.use({ viewport: { width: 320, height: 568 } })

  for (const theme of ['dark', 'light'] as const) {
    test(`${theme}: the sheet with packs, with a credit and with a late credit fits`, async ({ page }) => {
      const { server } = await open(page, { theme, fontScale: 200 })
      await go(page, { route: '/settings/account' })
      await expect(visible(page, 'm-account-add-credits')).toBeVisible()
      expect(await layout(page), 'page Account').toEqual(CLEAN_LAYOUT)
      await go(page, { sheet: 'settings-add-credits' })
      const sheet = visible(page, 'm-iap-sheet')
      await expect(sheet.getByTestId('m-iap-pack')).toHaveCount(2)
      expect(await layout(page), 'packs').toEqual(CLEAN_LAYOUT)
      // The price text of the store is on screen whole, not cut.
      for (const price of ['STORE-PRICE-A', 'STORE-PRICE-B']) await expect(sheet.getByText(price, { exact: true })).toBeVisible()
      server.down = true
      await sheet.getByTestId('m-iap-pack').nth(1).tap()
      await expect(sheet.getByTestId('m-iap-late')).toHaveText(LATE)
      // The tapped pack is far down the sheet at this text size: the sentence is brought on screen.
      await expect(sheet.getByTestId('m-iap-late')).toBeInViewport({ ratio: 0.9 })
      expect(await layout(page), 'late').toEqual(CLEAN_LAYOUT)
      await shot(page, `late-320x568-200-${theme}`)
      server.down = false
      await sheet.getByTestId('m-iap-restore').tap()
      await expect(sheet.getByTestId('m-iap-credited')).toBeInViewport({ ratio: 0.9 })
      expect(await layout(page), 'credited').toEqual(CLEAN_LAYOUT)
    })
  }
})
