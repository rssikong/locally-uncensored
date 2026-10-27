// @vitest-environment jsdom
/**
 * Round 6, G9: a build without Remote desktop answers a `lu://remote` link
 * with one sentence, and says it at a moment the user can read it.
 *
 * On the phone the App Store build said nothing, with the app open and with
 * the link starting the app. The sentence is a toast of a few seconds, and a
 * link from outside arrives before the shell is drawn (the start takes the
 * launch link first), while the app is still behind another one, or during
 * the onboarding, where it was dropped without a word.
 *
 * Run: npx vitest run src/mobile/nav/__tests__/deeplink-unavailable.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const LINK = 'lu://remote?url=https%3A%2F%2F192.168.77.5%3A8443&code=123456'
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

let visibility: 'visible' | 'hidden' = 'visible'

async function setup(opts: { start?: string | null; preset?: 'appstore' | 'open' } = {}) {
  vi.resetModules()
  const { setStorePresetForTests } = await import('../../policy/storePolicy')
  setStorePresetForTests(opts.preset ?? 'appstore')
  const said = vi.fn()
  let deliver: ((url: string) => void) | null = null
  const { __setBridgeForTests } = await import('../../platform/bridge')
  __setBridgeForTests({
    onDeepLink: async (handler: (url: string) => void) => {
      deliver = handler
      // The link the app was started with, handed out the moment the start asks for it.
      if (opts.start) handler(opts.start)
      return () => {}
    },
  } as never)
  const deeplink = await import('../deeplink')
  deeplink.__resetDeepLinksForTests()
  deeplink.setLinkOfferPreloader(() => flush())
  deeplink.setLinkUnavailableNotice(said)
  const { navApi } = await import('../api')
  deeplink.installDeepLinks()
  await flush()
  await flush()
  return { deeplink, navApi, said, link: (url: string) => deliver?.(url) }
}

beforeEach(() => {
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})
afterEach(async () => {
  const { __setBridgeForTests } = await import('../../platform/bridge')
  __setBridgeForTests(undefined)
  const { setStorePresetForTests } = await import('../../policy/storePolicy')
  setStorePresetForTests(null)
})

describe('G9: the App Store build and a link to a desktop', () => {
  it('warm, the app open: one sentence at once, and nothing of the link is kept', async () => {
    const { deeplink, navApi, said, link } = await setup()
    deeplink.linkNoticesReady()
    link(LINK)
    await flush()
    expect(said).toHaveBeenCalledTimes(1)
    expect(deeplink.currentLinkOffer()).toBeNull()
    expect(navApi.getState().overlays).toEqual([])
  })

  it('cold, the link starts the app: nothing is said into the loading page, one sentence once the shell is drawn', async () => {
    const { deeplink, said } = await setup({ start: LINK })
    // The start has taken the link, the shell is not drawn yet.
    expect(said).not.toHaveBeenCalled()
    deeplink.linkNoticesReady()
    expect(said).toHaveBeenCalledTimes(1)
    // Drawn again (a new frame after the age question): not said twice.
    deeplink.linkNoticesReady()
    expect(said).toHaveBeenCalledTimes(1)
  })

  it('warm, but the app is still behind the one the link was tapped in: said when the page comes into sight', async () => {
    const { deeplink, said, link } = await setup()
    deeplink.linkNoticesReady()
    visibility = 'hidden'
    link(LINK)
    await flush()
    expect(said).not.toHaveBeenCalled()
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(said).toHaveBeenCalledTimes(1)
  })

  it('during the onboarding: not dropped, said when the onboarding is over', async () => {
    const { deeplink, navApi, said, link } = await setup()
    deeplink.linkNoticesReady()
    navApi.startFlow('onboarding')
    link(LINK)
    await flush()
    expect(said).not.toHaveBeenCalled()
    navApi.finishFlow()
    expect(said).toHaveBeenCalledTimes(1)
  })

  it('the same link twice while the sentence waits is one sentence, a link later is answered again', async () => {
    const { deeplink, said, link } = await setup({ start: LINK })
    link(LINK)
    link('lu://remote?address=192.168.0.12%3A8080')
    await flush()
    deeplink.linkNoticesReady()
    expect(said).toHaveBeenCalledTimes(1)
    link(LINK)
    await flush()
    expect(said).toHaveBeenCalledTimes(2)
  })

  it('a link that is not ours says nothing', async () => {
    const { deeplink, said, link } = await setup()
    deeplink.linkNoticesReady()
    link('lu://something-else')
    link('https://example.com')
    await flush()
    expect(said).not.toHaveBeenCalled()
  })

  it('the open build is untouched: the link becomes the offer, and the sentence is never said', async () => {
    const { deeplink, navApi, said, link } = await setup({ preset: 'open' })
    deeplink.linkNoticesReady()
    link(LINK)
    await flush()
    expect(said).not.toHaveBeenCalled()
    expect(deeplink.currentLinkOffer()).toMatchObject({ kind: 'remote' })
    await vi.waitFor(() => expect(navApi.getState().overlays.at(-1)).toMatchObject({ kind: 'sheet', sheet: 'link-offer' }))
  })
})
