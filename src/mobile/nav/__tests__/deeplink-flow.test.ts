// @vitest-environment jsdom
/**
 * Every link from the system goes through the door of the logic layer:
 * the sign in callback is finished there, everything else becomes an offer
 * of the shell, and each link is taken exactly once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handleOAuthCallbackUrl = vi.fn(async (_url: string) => ({ handled: true, ok: true }))
vi.mock('../../../api/cloud/supabase', () => ({ handleOAuthCallbackUrl: (url: string) => handleOAuthCallbackUrl(url) }))

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.resetModules()
  handleOAuthCallbackUrl.mockClear()
})
afterEach(async () => {
  const { __setBridgeForTests } = await import('../../platform/bridge')
  __setBridgeForTests(undefined)
})

async function setup(bridge: import('../../platform/bridge').LuNativeBridge | null) {
  const { __setBridgeForTests } = await import('../../platform/bridge')
  __setBridgeForTests(bridge)
  const deeplink = await import('../deeplink')
  // What the boot does: the file of the sheet is loaded before the sheet opens.
  deeplink.setLinkOfferPreloader(() => flush())
  const { navApi } = await import('../api')
  deeplink.installDeepLinks()
  await flush()
  return { deeplink, navApi }
}

describe('links with the plugin', () => {
  it('the start link and later links come through onDeepLink, each once', async () => {
    let deliver: ((url: string) => void) | null = null
    const pendingDeepLink = vi.fn(async () => null)
    const { deeplink, navApi } = await setup({
      onDeepLink: async (handler) => {
        deliver = handler
        // The bridge hands out the start link itself.
        handler('lu://remote?address=192.168.0.12%3A8080')
        return () => {}
      },
      pendingDeepLink,
    })
    await flush()
    expect(deeplink.currentLinkOffer()).toMatchObject({ kind: 'remote', address: '192.168.0.12:8080' })
    // The sheet opens once its file is loaded, so it never shows a skeleton under the title.
    await vi.waitFor(() => expect(navApi.getState().overlays.at(-1)).toMatchObject({ kind: 'sheet', sheet: 'link-offer' }), { timeout: 10000 })
    // No second way next to the bridge: the shell does not ask pending_deep_link itself.
    expect(pendingDeepLink).not.toHaveBeenCalled()
    expect(deliver).not.toBeNull()
  })

  it('the sign in callback is finished by the logic layer and never becomes an offer', async () => {
    let deliver: ((url: string) => void) | null = null
    const { deeplink, navApi } = await setup({
      onDeepLink: async (handler) => {
        deliver = handler
        return () => {}
      },
    })
    deliver!('lu://oauth/callback?code=abc123')
    await flush()
    await flush()
    expect(handleOAuthCallbackUrl).toHaveBeenCalledWith('lu://oauth/callback?code=abc123')
    expect(deeplink.currentLinkOffer()).toBeNull()
    expect(navApi.getState().overlays).toEqual([])
  })
})

describe('the question opens with its file loaded', () => {
  it('waits for the file, and does not open for an offer that is gone by then', async () => {
    const { deeplink, navApi } = await setup(null)
    let release: () => void = () => {}
    deeplink.setLinkOfferPreloader(() => new Promise<void>((resolve) => { release = resolve }))
    expect(deeplink.receiveDeepLink('lu://remote?address=10.0.0.5')).toBe(true)
    await flush()
    // Not open yet: a sheet now would show a skeleton under the title "Continue?".
    expect(navApi.getState().overlays).toEqual([])
    release()
    await flush()
    expect(navApi.getState().overlays.at(-1)).toMatchObject({ kind: 'sheet', sheet: 'link-offer' })

    navApi.closeSheet()
    deeplink.receiveDeepLink('lu://remote?address=10.0.0.6')
    deeplink.useLinkOfferStore.getState().clear()
    release()
    await flush()
    expect(navApi.getState().overlays).toEqual([])
  })

  it('a file that cannot be loaded does not swallow the question', async () => {
    const { deeplink, navApi } = await setup(null)
    deeplink.setLinkOfferPreloader(() => Promise.reject(new Error('offline')))
    deeplink.receiveDeepLink('lu://remote?address=10.0.0.5')
    await flush()
    expect(navApi.getState().overlays.at(-1)).toMatchObject({ kind: 'sheet', sheet: 'link-offer' })
  })
})

describe('links without the plugin', () => {
  it('the DOM event of the contract still delivers', async () => {
    const { deeplink } = await setup(null)
    window.dispatchEvent(new CustomEvent('lu:deep-link', { detail: { url: 'lu://remote?address=10.0.0.5' } }))
    await flush()
    expect(deeplink.currentLinkOffer()).toMatchObject({ kind: 'remote', address: '10.0.0.5:11435' })

    window.dispatchEvent(new CustomEvent('lu:deep-link', { detail: { url: 'lu://oauth/callback?error=access_denied' } }))
    await flush()
    await flush()
    expect(handleOAuthCallbackUrl).toHaveBeenCalledWith('lu://oauth/callback?error=access_denied')
  })

  it('a link that is not ours is taken by nobody', async () => {
    const { deeplink } = await setup(null)
    expect(await deeplink.deliverIncomingLink('https://example.com/')).toBe(false)
    expect(await deeplink.deliverIncomingLink('')).toBe(false)
    expect(deeplink.currentLinkOffer()).toBeNull()
  })

  it('installing twice does not deliver a link twice', async () => {
    const { deeplink, navApi } = await setup(null)
    deeplink.installDeepLinks()
    window.dispatchEvent(new CustomEvent('lu:deep-link', { detail: { url: 'lu://remote?address=10.0.0.5' } }))
    await flush()
    await vi.waitFor(() => expect(navApi.getState().overlays.filter((o) => o.kind === 'sheet' && o.sheet === 'link-offer')).toHaveLength(1), { timeout: 10000 })
    await flush()
    expect(navApi.getState().overlays.filter((o) => o.kind === 'sheet' && o.sheet === 'link-offer')).toHaveLength(1)
  })
})

describe('a sign in link that is not the callback', () => {
  it('is no offer and is taken by nobody', async () => {
    const { deeplink, navApi } = await setup(null)
    expect(await deeplink.deliverIncomingLink('lu://auth?code=abc')).toBe(false)
    expect(await deeplink.deliverIncomingLink('lu://oauth?code=abc')).toBe(false)
    expect(deeplink.currentLinkOffer()).toBeNull()
    expect(navApi.getState().overlays).toEqual([])
    expect('finishAuthOffer' in deeplink).toBe(false)
  })
})
