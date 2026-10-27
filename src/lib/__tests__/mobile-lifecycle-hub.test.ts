/**
 * Point 2 of the mobile groundwork: one seam for "goes to the background",
 * "is back" and "network is back", and what hangs on it.
 *
 * The finding (audit 2.6): `pagehide` stopped every chat, agent, sub agent
 * and /loop. On a desktop that is the process ending. On a phone it is the
 * user glancing at another app. Nothing saved the streamed text on the way
 * out, the stream watchdog fired the moment the app thawed, and a reply cut
 * off by a kill stood in the chat without a word.
 *
 * Run: npx vitest run src/lib/__tests__/mobile-lifecycle-hub.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { standInPage, standOn } from '../../test-support/devices'
import {
  __resetAppLifecycleForTests, appIsInBackground, emitNativeLifecycle, installAppLifecycle,
  lastForegroundAt, onAppBackground, onAppForeground, onNetworkBack, wasSuspendedSince,
} from '../app-lifecycle'
import { frameFlush, flushOpenFramesNow, HIDDEN_WRITE_INTERVAL_MS, __resetFrameFlushForTests } from '../frame-flush'
import {
  deadlineWasFrozen, readChunks, STREAM_IDLE_TIMEOUT_MS, FROZEN_TIMER_SLACK_MS,
} from '../../api/stream-idle'

beforeEach(() => { __resetAppLifecycleForTests() })
afterEach(() => {
  __resetAppLifecycleForTests()
  __resetFrameFlushForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the hub', () => {
  it('turns visibilitychange, pagehide and online into the three signals', () => {
    const page = standInPage()
    installAppLifecycle()
    const seen: string[] = []
    onAppBackground(() => { seen.push('background') })
    onAppForeground(() => { seen.push('foreground') })
    onNetworkBack(() => { seen.push('online') })

    page.setVisibility('hidden')
    expect(appIsInBackground()).toBe(true)
    page.setVisibility('visible')
    expect(appIsInBackground()).toBe(false)
    page.window.dispatchEvent(new Event('online'))

    expect(seen).toEqual(['background', 'foreground', 'online'])
    expect(lastForegroundAt()).toBeGreaterThan(0)
  })

  it('one departure is one signal, however many sources report it', () => {
    const page = standInPage()
    installAppLifecycle()
    const out = vi.fn()
    onAppBackground(out)

    emitNativeLifecycle('background')
    page.setVisibility('hidden')
    page.window.dispatchEvent(new Event('pagehide'))

    expect(out).toHaveBeenCalledTimes(1)
  })

  it('the native seam works without any WebView source', () => {
    const back = vi.fn()
    onAppForeground(back)
    emitNativeLifecycle('foreground')
    expect(back).not.toHaveBeenCalled() // never left, nothing to come back from
    emitNativeLifecycle('background')
    emitNativeLifecycle('foreground')
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('a listener that throws or rejects does not cost the others their turn', () => {
    const second = vi.fn()
    onAppBackground(() => { throw new Error('boom') })
    onAppBackground(async () => { throw new Error('async boom') })
    onAppBackground(second)
    emitNativeLifecycle('background')
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('unsubscribing works', () => {
    const fn = vi.fn()
    const off = onAppBackground(fn)
    off()
    emitNativeLifecycle('background')
    expect(fn).not.toHaveBeenCalled()
  })

  it('wasSuspendedSince is true while away and for a timer armed before the return', () => {
    const before = Date.now() - 10
    expect(wasSuspendedSince(before)).toBe(false)
    emitNativeLifecycle('background')
    expect(wasSuspendedSince(before)).toBe(true)
    emitNativeLifecycle('foreground')
    expect(wasSuspendedSince(before)).toBe(true)
    expect(wasSuspendedSince(Date.now() + 1000)).toBe(false)
  })
})

describe('streamed text on the way to the background', () => {
  function fakeFrames() {
    const queue: (() => void)[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { queue.push(cb); return queue.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    return queue
  }

  it('phone: the newest write of every open stream lands when the app leaves', () => {
    standOn('android')
    const queue = fakeFrames()
    const run = { content: '' }
    const store: string[] = []
    const frames = frameFlush()

    run.content = 'Hel'
    frames.schedule(() => { store.push(run.content) })
    run.content = 'Hello wor'
    frames.schedule(() => { store.push(run.content) })
    // A hidden view never runs the frame, so nothing is in the store yet.
    expect(store).toEqual([])
    expect(queue).toHaveLength(1)

    expect(flushOpenFramesNow()).toBe(1)
    expect(store).toEqual(['Hello wor'])
  })

  it('phone: while away, text goes straight to the store at a slow beat', () => {
    standOn('iphone')
    fakeFrames()
    vi.useFakeTimers()
    const run = { content: '' }
    const store: string[] = []
    const frames = frameFlush()
    emitNativeLifecycle('background')

    run.content = 'a'
    frames.schedule(() => { store.push(run.content) })
    run.content = 'ab'
    frames.schedule(() => { store.push(run.content) })
    expect(store).toEqual(['a'])

    vi.advanceTimersByTime(HIDDEN_WRITE_INTERVAL_MS)
    run.content = 'abc'
    frames.schedule(() => { store.push(run.content) })
    expect(store).toEqual(['a', 'abc'])
  })

  it('phone: a closed stream is no longer written', () => {
    standOn('android')
    fakeFrames()
    const write = vi.fn()
    const frames = frameFlush()
    frames.schedule(write)
    frames.close()
    expect(flushOpenFramesNow()).toBe(0)
    expect(write).not.toHaveBeenCalled()
  })

  it('desktop: nothing is registered and the frame is the only writer', () => {
    standOn('windows')
    const queue = fakeFrames()
    const write = vi.fn()
    const frames = frameFlush()
    emitNativeLifecycle('background') // even if somebody sent the signal
    frames.schedule(write)
    frames.schedule(write)
    expect(flushOpenFramesNow()).toBe(0)
    expect(write).not.toHaveBeenCalled()
    expect(queue).toHaveLength(1)
    queue[0]()
    expect(write).toHaveBeenCalledTimes(1)
  })
})

describe('the stream watchdog after a stay in the background', () => {
  /** Delivers one chunk and then goes silent without closing. */
  function stalling(): Response {
    return new Response(new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode('x')) },
    }))
  }

  async function firstThenSilence(): Promise<{ settled: () => 'pending' | 'timeout' | 'other'; idle: ReturnType<typeof vi.fn> }> {
    const idle = vi.fn()
    const gen = readChunks(stalling(), { idleMs: STREAM_IDLE_TIMEOUT_MS, onIdle: idle })
    await gen.next()
    let state: 'pending' | 'timeout' | 'other' = 'pending'
    gen.next().then(
      () => { state = 'other' },
      (err: unknown) => { state = (err as { code?: string }).code === 'stream_idle_timeout' ? 'timeout' : 'other' },
    )
    return { settled: () => state, idle }
  }

  it('phone: a deadline that ran out while the app was away restarts instead of ending the stream', async () => {
    standOn('android')
    vi.useFakeTimers()
    const stream = await firstThenSilence()

    emitNativeLifecycle('background')
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS + 1)
    expect(stream.settled()).toBe('pending')
    expect(stream.idle).not.toHaveBeenCalled()

    // Back on screen: a fresh, full budget. Still silent after that is dead.
    emitNativeLifecycle('foreground')
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS - 1000)
    expect(stream.settled()).toBe('pending')
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS + 1000)
    expect(stream.settled()).toBe('timeout')
    expect(stream.idle).toHaveBeenCalledTimes(1)
  })

  it('desktop: the same silence ends the stream exactly as before, background signal or not', async () => {
    standOn('mac')
    vi.useFakeTimers()
    const stream = await firstThenSilence()
    emitNativeLifecycle('background')
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS + 1)
    expect(stream.settled()).toBe('timeout')
    expect(stream.idle).toHaveBeenCalledTimes(1)
  })

  it('a timer that fires far too late proves a freeze, on a phone only', () => {
    const armed = 1_000_000
    const late = armed + STREAM_IDLE_TIMEOUT_MS + FROZEN_TIMER_SLACK_MS + 1
    const onTime = armed + STREAM_IDLE_TIMEOUT_MS + 5
    standOn('iphone')
    expect(deadlineWasFrozen(armed, STREAM_IDLE_TIMEOUT_MS, late)).toBe(true)
    expect(deadlineWasFrozen(armed, STREAM_IDLE_TIMEOUT_MS, onTime)).toBe(false)
    standOn('linux')
    expect(deadlineWasFrozen(armed, STREAM_IDLE_TIMEOUT_MS, late)).toBe(false)
  })
})
