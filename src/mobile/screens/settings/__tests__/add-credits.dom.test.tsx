// @vitest-environment jsdom
/**
 * The sheet "Add credits" and the three buttons that lead to it (round 17,
 * store switch `purchase: 'in-app'`, iOS only, in no preset).
 *
 * The store is played by a bridge (the plugin lu-native as Iap.swift
 * answers), the account server by `fetch`. Nothing is bought and nothing
 * leaves the machine.
 *
 * Held here:
 *  - where the purchase is offered at all: the switch AND an iPhone AND the
 *    address that credits a purchase AND at least one pack,
 *  - that a build without it shows no sign of it: no button on the page
 *    Account, on the page LU Cloud or in "out of credits", and the sheet
 *    itself says "Not part of this version",
 *  - every state of the sheet, with the price as the store words it,
 *  - the order on a real tap: the sheet of the system, then the server, and
 *    the finish only after "credited".
 *
 * Run: npx vitest run src/mobile/screens/settings/__tests__/add-credits.dom.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'

const h = vi.hoisted(() => ({
  probeAccount: vi.fn(async () => {}),
  token: vi.fn(async (): Promise<string | null> => 'session-token'),
}))

vi.mock('../../../../api/cloud/supabase', async (original) => ({
  ...(await original<typeof import('../../../../api/cloud/supabase')>()),
  getAccessToken: h.token,
}))
vi.mock('../../../../hooks/useCloudAuth', () => ({ probeAccount: h.probeAccount, signOutAccount: vi.fn(async () => {}) }))

import { useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import { __resetIapForTests, iapAccountToken, iapOffered, iapOfferedToAccount, resumeIapPurchases, startIap, useIapStore } from '../../../lib/iap'
import { SheetContext } from '../../../nav/context'
import type { SheetEntry } from '../../../nav/types'
import { __setBridgeForTests, type LuNativeBridge } from '../../../platform/bridge'
import { __setIapConfigForTests } from '../../../platform/iap-server'
import { STORE_PRESETS, setPurchaseForTests, setStorePresetForTests, type StorePolicy, type StorePreset } from '../../../policy'
import CreditsSheet from '../../../resilience/CreditsSheet'
import { POLICY } from '../../../strings/policy'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import AccountPage from '../AccountPage'
import AddCreditsSheet from '../AddCreditsSheet'
import CloudGatePage from '../cloud/CloudGatePage'

const T = SETTINGS_STRINGS.iap
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const REDEEM = 'https://server.example/redeem'
const PACKS = ['app.credits.small', 'app.credits.large']
const ACCOUNT = '0b0e7a52-6f0c-4c3e-9a51-3d2f1c9a7e10'
/** What the store would word. Deliberately no real price: the app must show whatever comes. */
const PRICE = { 'app.credits.small': 'STORE-PRICE-A', 'app.credits.large': 'STORE-PRICE-B' } as Record<string, string>

function device(userAgent: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true })
  Object.defineProperty(window.navigator, 'platform', { value: userAgent.includes('iPhone') ? 'iPhone' : 'Linux armv8l', configurable: true })
}

function signedIn(id: string = ACCOUNT): void {
  useCloudAuthStore.setState({ status: 'signed-in', user: { id, email: 'someone@example.com' }, offline: false, licenseActive: true, access: true, pastDue: false } as never)
}

interface Store {
  bridge: LuNativeBridge
  log: string[]
  open: Array<{ transactionId: string; productId?: string; transaction: string }>
  sheet: Array<'success' | 'userCancelled' | 'pending' | string>
  products: Array<{ id: string; displayName: string; description?: string; displayPrice: string }> | Error
  canPurchase: boolean
  emit: (payload: unknown) => void
}

/** The store of the system as the plugin answers for it. An unfinished purchase stays in `open`. */
function playedStore(): Store {
  let next = 500
  const store: Store = {
    log: [],
    open: [],
    sheet: [],
    products: PACKS.map((id, i) => ({ id, displayName: i === 0 ? 'Small pack' : 'Large pack', description: i === 0 ? 'A few credits.' : undefined, displayPrice: PRICE[id] })),
    canPurchase: true,
    emit: () => {},
    bridge: {
      on: async (event, handler) => {
        if (event === 'iap-transaction') store.emit = handler
        return () => {}
      },
      iapProducts: async (ids) => {
        store.log.push(`products ${ids.join(',')}`)
        if (store.products instanceof Error) throw store.products.message
        return { products: store.products, canPurchase: store.canPurchase }
      },
      iapPurchase: async (id, accountToken) => {
        store.log.push(`purchase ${id} ${accountToken}`)
        const answer = store.sheet.shift() ?? 'success'
        if (answer === 'userCancelled' || answer === 'pending') return { state: answer }
        if (answer !== 'success') throw answer
        const transaction = { transactionId: String(next++), productId: id, transaction: `jws-${id}-${next}` }
        store.open.push(transaction)
        return { state: 'success', ...transaction }
      },
      iapFinish: async (transactionId) => {
        store.log.push(`finish ${transactionId}`)
        store.open = store.open.filter((t) => t.transactionId !== transactionId)
        return true
      },
      iapUnfinished: async () => {
        store.log.push('unfinished')
        return store.open.map((t) => ({ ...t }))
      },
    },
  }
  return store
}

interface Server {
  down: boolean
  credited: string[]
  calls: Array<{ url: string; auth: string | null; body: { platform?: string; transaction?: string } }>
}

/** The account server: credits a transaction once, answers "credited" every time it is handed the same one. */
function playedServer(store: Store): Server {
  const server: Server = { down: false, credited: [], calls: [] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { platform?: string; transaction?: string }
      server.calls.push({ url: String(url), auth: (init?.headers as Record<string, string> | undefined)?.authorization ?? null, body })
      store.log.push(`redeem ${body.transaction}`)
      if (server.down) return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })
      if (!server.credited.includes(body.transaction ?? '')) server.credited.push(body.transaction ?? '')
      store.log.push(`credited ${body.transaction}`)
      return new Response(JSON.stringify({ credited: true, balance: 100 * server.credited.length }), { status: 200 })
    }),
  )
  return server
}

/** The build David would make: the App Store preset with the switch on in-app, the address and the packs. */
function offer(options: { purchase?: StorePolicy['purchase']; preset?: StorePreset; redeemUrl?: string; productIds?: string[]; os?: string } = {}): void {
  setStorePresetForTests(options.preset ?? 'appstore')
  setPurchaseForTests(options.purchase ?? 'in-app')
  __setIapConfigForTests({ redeemUrl: options.redeemUrl ?? REDEEM, productIds: options.productIds ?? PACKS })
  device(options.os ?? IPHONE)
}

const ENTRY = { kind: 'sheet', sheet: 'settings-add-credits', props: undefined, sub: [], key: 's#1' } as unknown as SheetEntry

function inSheet(node: ReactElement, sheet = 'settings-add-credits', props?: unknown) {
  return render(<SheetContext.Provider value={{ entry: { ...ENTRY, sheet, props } as SheetEntry, isTop: true, locked: false, title: 'Sheet', depth: 0 }}>{node}</SheetContext.Provider>)
}

async function openSheet(): Promise<HTMLElement> {
  const view = inSheet(<AddCreditsSheet />)
  await waitFor(() => expect(screen.getByTestId('m-iap-state').getAttribute('data-state')).not.toBe('loading'))
  return view.container
}

async function tap(testid: string, index = 0): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getAllByTestId(testid)[index])
  })
}

let store: Store
let server: Server

beforeEach(() => {
  localStorage.clear()
  h.probeAccount.mockReset()
  h.probeAccount.mockResolvedValue(undefined)
  h.token.mockReset()
  h.token.mockResolvedValue('session-token')
  store = playedStore()
  server = playedServer(store)
  __setBridgeForTests(store.bridge)
  __resetIapForTests()
  signedIn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setPurchaseForTests(null)
  setStorePresetForTests(null)
  __setIapConfigForTests(null)
  __setBridgeForTests(undefined)
  __resetIapForTests()
  useCloudAuthStore.setState({ status: 'signed-out', user: null } as never)
  device(DESKTOP)
})

describe('where the purchase is offered', () => {
  it('the switch, an iPhone, the address and a pack: all four', () => {
    offer()
    expect(iapOffered()).toBe(true)
    expect(iapOfferedToAccount()).toBe(true)
  })

  it.each(['links', 'text-only', 'none'] as const)('purchase %s: not offered, whatever else is set', (purchase) => {
    offer({ purchase })
    expect(iapOffered()).toBe(false)
  })

  it.each(['open', 'play', 'appstore'] as const)('preset %s as it is built today: not offered, with the address and the packs set', (preset) => {
    setStorePresetForTests(preset)
    __setIapConfigForTests({ redeemUrl: REDEEM, productIds: PACKS })
    device(IPHONE)
    expect(STORE_PRESETS[preset].purchase).not.toBe('in-app')
    expect(iapOffered()).toBe(false)
  })

  it('Android and a browser: not offered', () => {
    offer({ os: ANDROID })
    expect(iapOffered()).toBe(false)
    offer({ os: DESKTOP })
    expect(iapOffered()).toBe(false)
  })

  it('without the address that credits a purchase: not offered. Nothing is sold that nobody would credit', () => {
    offer({ redeemUrl: '' })
    expect(iapOffered()).toBe(false)
    offer({ redeemUrl: 'http://not-https.example/redeem' })
    expect(iapOffered()).toBe(false)
  })

  it('without a pack: not offered', () => {
    offer({ productIds: [] })
    expect(iapOffered()).toBe(false)
  })

  it('without an account, or with an account whose id is no UUID: no purchase', () => {
    offer()
    useCloudAuthStore.setState({ status: 'signed-out', user: null } as never)
    expect(iapAccountToken()).toBeNull()
    expect(iapOfferedToAccount()).toBe(false)
    signedIn('not-a-uuid')
    expect(iapOfferedToAccount()).toBe(false)
    signedIn(ACCOUNT.toUpperCase())
    expect(iapAccountToken()).toBe(ACCOUNT)
  })
})

describe('a build that does not offer it shows no sign of it', () => {
  const WORDS = /add credits|purchase|restore|pack\b|app store/i

  it.each(['open', 'play', 'appstore'] as const)('preset %s on an iPhone, signed in, address and packs set: no button anywhere, the sheet says "Not part of this version"', async (preset) => {
    setStorePresetForTests(preset)
    __setIapConfigForTests({ redeemUrl: REDEEM, productIds: PACKS })
    device(IPHONE)

    const account = render(<AccountPage />)
    expect(screen.queryByTestId('m-account-add-credits')).toBeNull()
    account.unmount()

    const cloud = render(<CloudGatePage />)
    expect(screen.queryByTestId('m-cloud-add-credits')).toBeNull()
    cloud.unmount()

    const credits = inSheet(<CreditsSheet />, 'credits', { reason: 'credits' })
    expect(screen.queryByTestId('m-credits-add')).toBeNull()
    credits.unmount()

    const sheet = inSheet(<AddCreditsSheet />)
    expect(screen.getByTestId('m-unavailable').textContent).toBe(POLICY.unavailableText)
    expect(screen.queryByTestId('m-iap-sheet')).toBeNull()
    expect(sheet.container.textContent ?? '').not.toMatch(WORDS)
    // And the store was never asked.
    expect(store.log).toEqual([])
    sheet.unmount()

    startIap()
    expect(await resumeIapPurchases()).toEqual({ credited: 0, late: 0, failed: false, foreign: 0 })
    expect(store.log).toEqual([])
    expect(server.calls).toEqual([])
  })

  it('in-app without the address: the same', () => {
    offer({ redeemUrl: '' })
    render(<AccountPage />)
    expect(screen.queryByTestId('m-account-add-credits')).toBeNull()
    cleanup()
    inSheet(<AddCreditsSheet />)
    expect(screen.getByTestId('m-unavailable')).toBeTruthy()
    expect(store.log).toEqual([])
  })
})

describe('the three ways to the sheet, where it is offered', () => {
  it('the page Account, the page LU Cloud and "out of credits" each have the button, and none is a link', () => {
    offer()
    const account = render(<AccountPage />)
    expect(screen.getByTestId('m-account-add-credits').textContent).toContain(T.open)
    expect(account.container.querySelectorAll('a[href]')).toHaveLength(0)
    // The buttons of a build that links to plans are still gone.
    for (const gone of ['m-account-manage', 'm-account-buy', 'm-account-plans-text', 'm-account-pay-invoice']) expect(screen.queryByTestId(gone)).toBeNull()
    account.unmount()

    const cloud = render(<CloudGatePage />)
    expect(screen.getByTestId('m-cloud-add-credits').textContent).toContain(T.open)
    expect(cloud.container.querySelectorAll('a[href]')).toHaveLength(0)
    expect(screen.queryByTestId('m-cloud-plans-text')).toBeNull()
    cloud.unmount()

    inSheet(<CreditsSheet />, 'credits', { reason: 'credits' })
    expect(screen.getByTestId('m-credits-add').textContent).toContain(T.open)
    expect(screen.queryByTestId('m-credits-plans')).toBeNull()
    expect(screen.queryByTestId('m-credits-plans-text')).toBeNull()
  })

  it('offline, the page Account has no button: a purchase needs the server', () => {
    offer()
    useCloudAuthStore.setState({ offline: true } as never)
    render(<AccountPage />)
    expect(screen.queryByTestId('m-account-add-credits')).toBeNull()
  })

  it('signed out, the page LU Cloud has no button', () => {
    offer()
    useCloudAuthStore.setState({ status: 'signed-out', user: null } as never)
    render(<CloudGatePage />)
    expect(screen.queryByTestId('m-cloud-add-credits')).toBeNull()
  })
})

describe('the sheet', () => {
  it('loading, then the packs with the names and the price text of the store, as they came', async () => {
    offer()
    inSheet(<AddCreditsSheet />)
    expect(screen.getByTestId('m-iap-state').getAttribute('data-state')).toBe('loading')
    expect(screen.getByTestId('m-iap-loading').getAttribute('aria-label')).toBe(T.loading)
    await waitFor(() => expect(screen.getAllByTestId('m-iap-pack')).toHaveLength(2))
    const [small, large] = screen.getAllByTestId('m-iap-pack')
    expect(small.textContent).toContain('Small pack')
    expect(small.textContent).toContain('A few credits.')
    expect(small.textContent).toContain('STORE-PRICE-A')
    expect(large.textContent).toContain('Large pack')
    expect(large.textContent).toContain('STORE-PRICE-B')
    expect(small.getAttribute('data-m-risk')).toBe('paid')
    expect(store.log).toEqual([`products ${PACKS.join(',')}`])
    expect(screen.getByText(T.title)).toBeTruthy()
  })

  it('no price of the app, no link, no pointer to anywhere else', async () => {
    offer()
    const sheet = await openSheet()
    const text = sheet.textContent ?? ''
    expect(sheet.querySelectorAll('a[href]')).toHaveLength(0)
    expect(text).not.toMatch(/lu-labs|website|https?:|www\./i)
    // The only prices on screen are the two texts of the store.
    expect(text.replace(/STORE-PRICE-[AB]/g, '')).not.toMatch(/[$€£]|\b\d+[.,]\d{2}\b|\busd\b|\beur\b/i)
  })

  it('the store knows none of the packs: said so, nothing to tap', async () => {
    offer()
    store.products = []
    await openSheet()
    expect(screen.getByTestId('m-iap-empty').textContent).toContain(T.emptyTitle)
    expect(screen.queryByTestId('m-iap-pack')).toBeNull()
  })

  it('the packs cannot be loaded: the sentence of the store, and "Try again" loads them', async () => {
    offer()
    store.products = new Error('The App Store could not be reached. Check your connection, then try again.')
    await openSheet()
    expect(screen.getByTestId('m-iap-load-error').textContent).toContain(T.loadErrorTitle)
    expect(screen.getByTestId('m-iap-load-error').textContent).toContain('The App Store could not be reached.')
    store.products = [{ id: PACKS[0], displayName: 'Small pack', displayPrice: 'STORE-PRICE-A' }]
    await tap('m-iap-retry')
    await waitFor(() => expect(screen.getAllByTestId('m-iap-pack')).toHaveLength(1))
    expect(screen.queryByTestId('m-iap-load-error')).toBeNull()
  })

  it('buying is switched off on this device: said so, the packs cannot be tapped', async () => {
    offer()
    store.canPurchase = false
    await openSheet()
    expect(screen.getByTestId('m-iap-not-allowed').textContent).toBe(T.notAllowed)
    for (const pack of screen.getAllByTestId('m-iap-pack')) expect((pack as HTMLButtonElement).disabled || pack.getAttribute('aria-disabled') === 'true').toBe(true)
    await tap('m-iap-pack')
    expect(store.log.some((entry) => entry.startsWith('purchase'))).toBe(false)
  })

  it('bought: the sheet of the system, the server, and the finish only after "credited"; the balance is asked again', async () => {
    offer()
    await openSheet()
    await tap('m-iap-pack')
    await waitFor(() => expect(screen.getByTestId('m-iap-credited')).toBeTruthy())
    expect(screen.getByTestId('m-iap-credited').textContent).toContain(T.creditedTitle)
    const jws = server.calls[0].body.transaction
    expect(store.log.slice(1)).toEqual([`purchase ${PACKS[0]} ${ACCOUNT}`, `redeem ${jws}`, `credited ${jws}`, 'finish 500'])
    expect(server.calls).toHaveLength(1)
    expect(server.calls[0]).toMatchObject({ url: REDEEM, auth: 'Bearer session-token', body: { platform: 'ios' } })
    expect(h.probeAccount).toHaveBeenCalledTimes(1)
    expect(store.open).toEqual([])
    expect(useIapStore.getState().late).toBe(0)
    expect(screen.queryByTestId('m-iap-late')).toBeNull()
  })

  it('the sheet of the system was closed: nothing is said, nothing is sent', async () => {
    offer()
    store.sheet = ['userCancelled']
    await openSheet()
    await tap('m-iap-pack')
    await waitFor(() => expect(store.log.some((entry) => entry.startsWith('purchase'))).toBe(true))
    expect(screen.getByTestId('m-iap-state').getAttribute('data-result')).toBe('none')
    for (const notice of ['m-iap-credited', 'm-iap-pending', 'm-iap-late', 'm-iap-error']) expect(screen.queryByTestId(notice)).toBeNull()
    expect(server.calls).toEqual([])
  })

  it('waiting for approval ("Ask to Buy"): said so, nothing is sent and nothing is finished', async () => {
    offer()
    store.sheet = ['pending']
    await openSheet()
    await tap('m-iap-pack', 1)
    await waitFor(() => expect(screen.getByTestId('m-iap-pending')).toBeTruthy())
    expect(screen.getByTestId('m-iap-pending').textContent).toContain(T.pendingTitle)
    expect(screen.getByTestId('m-iap-pending').textContent).toContain('Ask to Buy')
    expect(server.calls).toEqual([])
    expect(store.log.some((entry) => entry.startsWith('finish'))).toBe(false)
  })

  it('the purchase did not work: the sentence of the store', async () => {
    offer()
    store.sheet = ['This pack is not available right now. Try again later.']
    await openSheet()
    await tap('m-iap-pack')
    await waitFor(() => expect(screen.getByTestId('m-iap-error').textContent).toBe('This pack is not available right now. Try again later.'))
    expect(server.calls).toEqual([])
  })

  it('bought, and the credit does not get through: the honest sentence, the purchase is NOT finished', async () => {
    offer()
    server.down = true
    await openSheet()
    await tap('m-iap-pack')
    await waitFor(() => expect(screen.getByTestId('m-iap-late')).toBeTruthy())
    expect(screen.getByTestId('m-iap-late').textContent).toBe('Your purchase went through. Adding the credits is taking longer than usual. We will keep trying.')
    expect(store.log.some((entry) => entry.startsWith('finish'))).toBe(false)
    expect(store.open).toHaveLength(1)
    expect(screen.queryByTestId('m-iap-credited')).toBeNull()
    expect(h.probeAccount).not.toHaveBeenCalled()
    expect(useIapStore.getState().late).toBe(1)
  })

  it('"Restore purchase" hands the open purchase in again, and finishes it once it is credited', async () => {
    offer()
    server.down = true
    await openSheet()
    await tap('m-iap-pack')
    await waitFor(() => expect(screen.getByTestId('m-iap-late')).toBeTruthy())
    // Still down: still said, still open.
    await tap('m-iap-restore')
    await waitFor(() => expect(server.calls).toHaveLength(2))
    expect(screen.getByTestId('m-iap-late')).toBeTruthy()
    expect(store.open).toHaveLength(1)
    // Back: credited, finished, the sentence is gone.
    server.down = false
    await tap('m-iap-restore')
    await waitFor(() => expect(screen.getByTestId('m-iap-credited')).toBeTruthy())
    expect(screen.queryByTestId('m-iap-late')).toBeNull()
    expect(store.open).toEqual([])
    expect(server.calls).toHaveLength(3)
    expect(new Set(server.calls.map((call) => call.body.transaction)).size).toBe(1)
    expect(server.credited).toHaveLength(1)
    const finished = store.log.indexOf('finish 500')
    expect(finished).toBeGreaterThan(store.log.lastIndexOf(`credited ${server.calls[0].body.transaction}`) - 1)
    expect(store.log.slice(0, finished).filter((entry) => entry.startsWith('credited'))).toHaveLength(1)
    expect(useIapStore.getState().late).toBe(0)
  })

  it('"Restore purchase" with nothing open says so', async () => {
    offer()
    await openSheet()
    await tap('m-iap-restore')
    await waitFor(() => expect(screen.getByTestId('m-iap-note').textContent).toBe(T.restoreNothing))
    expect(server.calls).toEqual([])
  })

  it('a purchase from an earlier run that is still not credited is said when the sheet opens', async () => {
    offer()
    store.open = [{ transactionId: '41', productId: PACKS[0], transaction: 'jws-earlier' }]
    server.down = true
    await act(async () => {
      await resumeIapPurchases()
    })
    await openSheet()
    expect(screen.getByTestId('m-iap-late').textContent).toBe(T.late)
    expect(screen.getByTestId('m-iap-state').getAttribute('data-result')).toBe('late')
  })

  it('signed out with the sheet open: one sentence, no pack, the store is not asked', () => {
    offer()
    useCloudAuthStore.setState({ status: 'signed-out', user: null } as never)
    inSheet(<AddCreditsSheet />)
    expect(screen.getByTestId('m-iap-sign-in').textContent).toBe(T.signIn)
    expect(screen.queryByTestId('m-iap-pack')).toBeNull()
    expect(screen.queryByTestId('m-iap-restore')).toBeNull()
    expect(store.log).toEqual([])
  })
})

describe('at the start of the app', () => {
  it('a purchase the app lost between the sheet of the system and the finish is credited and finished, and the user is told', async () => {
    offer()
    store.open = [{ transactionId: '41', productId: PACKS[0], transaction: 'jws-earlier' }]
    const told = vi.fn()
    startIap(told)
    await waitFor(() => expect(told).toHaveBeenCalledWith(1))
    expect(store.log).toEqual(['unfinished', 'redeem jws-earlier', 'credited jws-earlier', 'finish 41'])
    expect(store.open).toEqual([])
  })

  it('a purchase that was approved while the app runs arrives as an event and is credited', async () => {
    offer()
    const told = vi.fn()
    startIap(told)
    await waitFor(() => expect(store.log).toEqual(['unfinished']))
    store.open = [{ transactionId: '42', productId: PACKS[1], transaction: 'jws-approved' }]
    await act(async () => {
      store.emit({ transactionId: '42', productId: PACKS[1], transaction: 'jws-approved' })
    })
    await waitFor(() => expect(told).toHaveBeenCalledWith(1))
    expect(store.log.slice(1)).toEqual(['unfinished', 'redeem jws-approved', 'credited jws-approved', 'finish 42'])
  })

  it('nobody is signed in: the open purchase waits, and is handed in when its account signs in', async () => {
    offer()
    useCloudAuthStore.setState({ status: 'signed-out', user: null } as never)
    store.open = [{ transactionId: '43', productId: PACKS[0], transaction: 'jws-waiting' }]
    const told = vi.fn()
    startIap(told)
    await new Promise((done) => setTimeout(done, 10))
    expect(store.log).toEqual([])
    expect(server.calls).toEqual([])
    await act(async () => {
      signedIn()
    })
    await waitFor(() => expect(told).toHaveBeenCalledWith(1))
    expect(store.log).toEqual(['unfinished', 'redeem jws-waiting', 'credited jws-waiting', 'finish 43'])
  })
})

describe('the words', () => {
  it('no dash, no website, no price, and the honest sentence as agreed', () => {
    const texts: string[] = [POLICY.iapCredited]
    for (const value of Object.values(T)) texts.push(typeof value === 'function' ? value('Sample', 'Sample') : value)
    for (const text of texts) {
      expect(text, text).not.toMatch(/[‒-―]/)
      expect(text, text).not.toMatch(/lu-labs|website|https?:|www\.|browser/i)
      expect(text, text).not.toMatch(/[$€£]\s?\d|\b\d+[.,]\d{2}\b/)
    }
    expect(T.late).toBe('Your purchase went through. Adding the credits is taking longer than usual. We will keep trying.')
    expect(T.title).toBe('Add credits')
    expect(T.restore).toBe('Restore purchase')
  })
})
