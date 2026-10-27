// @vitest-environment jsdom
/**
 * What the shell hands to the seams of the logic layer: the share handler,
 * the two limits of the one model slot, the reaction to cloud renders that
 * finished while the app was away, and the lifecycle passed on to the hub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../api/cloud/jobs', () => ({ getQuota: vi.fn(async () => ({ credits: 5 })) }))

import { getQuota } from '../../../api/cloud/jobs'
import { __resetAppLifecycleForTests, onAppBackground, onAppForeground } from '../../../lib/app-lifecycle'
import { __resetModelSlotForTests, embedderFit, getMobileContextCap } from '../../../lib/model-slot'
import { __resetSaveOrShareForTests, mobileShare, mobileShareAcceptsUrl } from '../../../lib/save-or-share'
import { getDeviceOverride, setDeviceOverride, MOBILE_MAX_CTX } from '../../lib/device-fit'
import { useNavStore } from '../../nav/store'
import { __setBridgeForTests, type LuNativeBridge } from '../../platform/bridge'
import { useToastStore } from '../../ui/Toast'
import { COMMON } from '../../strings/common'
import { __resetWiringForTests, contextCapFor, embedderFitFor, onJobsResumed, shareForLogic, wireLogic } from '../wiring'

const GIB = 1024 ** 3
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  __resetWiringForTests()
  __resetModelSlotForTests()
  __resetSaveOrShareForTests()
  __resetAppLifecycleForTests()
  useToastStore.setState({ current: null })
})
afterEach(() => {
  __setBridgeForTests(undefined)
  setDeviceOverride(null)
  vi.clearAllMocks()
})

describe('the one model slot', () => {
  const phone6 = { platform: 'ios' as const, ramGb: 6 }
  const phone12 = { platform: 'android' as const, ramGb: 12 }

  it('an unknown device raises nothing and answers "unknown"', () => {
    expect(contextCapFor({ platform: 'android', ramGb: 0 }, null)).toBe(0)
    expect(embedderFitFor({ platform: 'android', ramGb: 0 }, { fileBytes: GIB, contextTokens: 2048 })).toBe('unknown')
  })

  it('the cap never exceeds what the engine of a phone is started with', () => {
    const cap = contextCapFor(phone12, { fileBytes: 1 * GIB, contextTokens: 2048 })
    expect(cap).toBeGreaterThan(0)
    expect(cap).toBeLessThanOrEqual(MOBILE_MAX_CTX)
  })

  it('a model that barely fits leaves no room to raise the context', () => {
    const big = contextCapFor(phone6, { fileBytes: 2.6 * GIB, contextTokens: 1024 })
    const small = contextCapFor(phone6, { fileBytes: 0.5 * GIB, contextTokens: 1024 })
    expect(big).toBeLessThan(small)
  })

  it('the embedder fits next to a small model and not next to one that fills the phone', () => {
    expect(embedderFitFor(phone12, { fileBytes: 1 * GIB, contextTokens: 2048 })).toBe('fits')
    expect(embedderFitFor(phone6, { fileBytes: 3.2 * GIB, contextTokens: 4096 })).toBe('no-room')
    expect(embedderFitFor(phone6, null)).toBe('fits')
  })
})

describe('the share handler for the logic layer', () => {
  it('text and bytes go to the share sheet of the platform seam', async () => {
    const shareFile = vi.fn(async (_source: { filename?: string; mime?: string }) => ({ presented: true, completed: true }))
    __setBridgeForTests({ shareFile })
    expect(await shareForLogic({ filename: 'chat.md', mime: 'text/markdown', text: '# hi' })).toBe('shared')
    expect(await shareForLogic({ filename: 'a.bin', mime: 'application/octet-stream', bytes: new Uint8Array([1, 2, 3]) })).toBe('shared')
    expect(shareFile).toHaveBeenCalledTimes(2)
    expect(shareFile.mock.calls[0][0]).toMatchObject({ filename: 'chat.md', mime: 'text/markdown' })
  })

  it('a closed sheet is "cancelled", never "shared"', async () => {
    __setBridgeForTests({ shareFile: async () => ({ presented: true, completed: false }) })
    expect(await shareForLogic({ filename: 'chat.md', mime: 'text/markdown', text: 'x' })).toBe('cancelled')
  })

  it('an address is downloaded by the native side when the plugin can', async () => {
    const calls: string[] = []
    const bridge: LuNativeBridge = {
      downloadToTemp: async (url) => { calls.push(`download:${url}`); return { path: '/tmp/v.mp4' } },
      shareFile: async (source) => { calls.push(`share:${source.path}`); return { presented: true } },
      deleteTempFile: async () => true,
    }
    __setBridgeForTests(bridge)
    expect(await shareForLogic({ filename: 'v.mp4', mime: 'video/mp4', url: 'https://example.com/v.mp4' })).toBe('shared')
    expect(calls).toEqual(['download:https://example.com/v.mp4', 'share:/tmp/v.mp4'])
  })

  it('wireLogic sets the handler, and says "accepts an address" only with the plugin', async () => {
    __setBridgeForTests({
      downloadToTemp: async () => ({ path: '/tmp/x' }),
      shareFile: async () => ({ presented: true }),
    })
    wireLogic()
    await flush()
    expect(mobileShareAcceptsUrl()).toBe(true)
    expect(await mobileShare({ filename: 'a.txt', mime: 'text/plain', text: 'a' })).toBe('shared')

    __resetWiringForTests()
    __resetSaveOrShareForTests()
    __setBridgeForTests(null)
    wireLogic()
    await flush()
    expect(mobileShareAcceptsUrl()).toBe(false)
  })
})

describe('wireLogic', () => {
  it('passes pause and resume of the platform seam on to the hub of the logic layer', async () => {
    __setBridgeForTests(null)
    wireLogic()
    const seen: string[] = []
    onAppBackground(() => void seen.push('bg'))
    onAppForeground(() => void seen.push('fg'))
    window.dispatchEvent(new CustomEvent('lu:background'))
    window.dispatchEvent(new CustomEvent('lu:foreground'))
    expect(seen).toEqual(['bg', 'fg'])
  })

  it('takes a pretended device from the developer switch', () => {
    __setBridgeForTests(null)
    wireLogic({ device: 'ios:6' })
    expect(getDeviceOverride()).toMatchObject({ platform: 'ios', ramGb: 6 })
  })

  it('installs a fit check and a context cap that never throw without a device', async () => {
    __setBridgeForTests(null)
    wireLogic()
    await flush()
    expect(['fits', 'no-room', 'unknown']).toContain(await embedderFit())
    expect(getMobileContextCap()).toBeGreaterThanOrEqual(0)
  })

  it('a second call connects nothing twice', () => {
    __setBridgeForTests(null)
    wireLogic()
    wireLogic()
    let count = 0
    onAppBackground(() => void (count += 1))
    window.dispatchEvent(new CustomEvent('lu:background'))
    expect(count).toBe(1)
  })
})

describe('cloud renders that finished while the app was away', () => {
  it('says so, asks the credit meter again and offers the way to the gallery', async () => {
    onJobsResumed({ landed: ['job1'], failed: [], waiting: [], dropped: [] })
    const shown = useToastStore.getState().current
    expect(shown?.text).toBe('Your result is in the gallery')
    expect(shown?.text).toBe(COMMON.resultInGallery)
    expect(getQuota).toHaveBeenCalledOnce()
    shown?.action?.onPress()
    const state = useNavStore.getState()
    expect(state.tab).toBe('create')
    expect(state.stacks.create.at(-1)?.route).toBe('/create/gallery')
  })

  it('more than one result reads as plural', () => {
    onJobsResumed({ landed: ['a', 'b'], failed: [], waiting: [], dropped: [] })
    expect(useToastStore.getState().current?.text).toBe(COMMON.resultsInGallery)
  })

  it('a failed render shows the sentence of the server', () => {
    onJobsResumed({ landed: [], failed: [{ id: 'j', error: 'The prompt was refused.' }], waiting: [], dropped: [] })
    const shown = useToastStore.getState().current
    expect(shown?.tone).toBe('error')
    expect(shown?.text).toContain('The prompt was refused.')
    expect(getQuota).toHaveBeenCalledOnce()
  })

  it('stays quiet when nothing landed and nothing failed', () => {
    onJobsResumed({ landed: [], failed: [], waiting: ['j'], dropped: ['k'] })
    expect(useToastStore.getState().current).toBeNull()
    expect(getQuota).not.toHaveBeenCalled()
  })
})
