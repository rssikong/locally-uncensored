/**
 * recheckOnline(): "Try again" on a page that hangs on the network of the
 * phone (review H1, addition). It asks the system, never a server of a third
 * party, and with Cloud off it asks no server at all.
 *
 * Run: npx vitest run src/mobile/resilience/__tests__/recheck-online.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ kind: 'unknown' as string, onLine: true, appMode: 'local' as string, events: new Map<string, Set<() => void>>() }))

vi.mock('../../platform/network', () => ({
  connectionKind: async () => state.kind,
  isOnline: () => state.onLine,
  onNetworkChange: (fn: (online: boolean) => void) => {
    const up = () => fn(true)
    const set = state.events.get('change') ?? new Set()
    set.add(up)
    state.events.set('change', set)
    return () => { set.delete(up) }
  },
}))
vi.mock('../../platform/lifecycle', () => ({ onLifecycle: () => () => {} }))
vi.mock('../../../api/backend', () => ({ isTauri: () => true }))
vi.mock('../../../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: { appMode: state.appMode } }), subscribe: () => () => {} },
}))

import { __resetOnlineForTests, recheckOnline } from '../useOnline'

const fetchSpy = vi.fn(async () => new Response(null))

beforeEach(() => {
  __resetOnlineForTests()
  state.kind = 'unknown'
  state.onLine = true
  state.appMode = 'local'
  state.events.clear()
  fetchSpy.mockClear()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => { vi.unstubAllGlobals() })

describe('recheckOnline', () => {
  it('with Cloud off asks the system and no server', async () => {
    state.kind = 'wifi'
    expect(await recheckOnline()).toBe(true)
    state.kind = 'none'
    expect(await recheckOnline()).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the system wins over a navigator.onLine that is stale, in both directions', async () => {
    state.onLine = false
    state.kind = 'cellular'
    expect(await recheckOnline()).toBe(true)
    state.onLine = true
    state.kind = 'none'
    expect(await recheckOnline()).toBe(false)
  })

  it('without an answer of the system navigator.onLine is the answer', async () => {
    state.kind = 'unknown'
    state.onLine = false
    expect(await recheckOnline()).toBe(false)
    state.onLine = true
    expect(await recheckOnline()).toBe(true)
  })

  it('with Cloud on LU Cloud is probed again too, and nobody else', async () => {
    state.appMode = 'cloud'
    state.kind = 'wifi'
    expect(await recheckOnline()).toBe(true)
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    for (const call of fetchSpy.mock.calls as unknown as Array<[string]>) {
      expect(new URL(call[0]).hostname).toBe('lu-labs.ai')
    }
  })

  it('never throws', async () => {
    state.kind = 'wifi'
    await expect(recheckOnline()).resolves.toBe(true)
  })
})
