import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// v19 migration: the macOS Cloud-only wall is lifted, so existing Mac installs
// that were force-pinned to appMode 'cloud' must be reset ONCE to the local
// default. Windows/Linux (a real user choice) must never be touched. This is a
// persist-time migration, so we drive it black-box: seed a versioned blob in
// localStorage, stub navigator for the platform, then fresh-import the store
// and assert the hydrated appMode — same approach as createStore-migrate.test.

const backing = new Map<string, string>()
const localStorageShim = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
  key: (i: number) => [...backing.keys()][i] ?? null,
  get length() {
    return backing.size
  },
} as Storage

const KEY = 'chat-settings'
const CURRENT = 19

const MAC_NAV = { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
const WIN_NAV = { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }

function seed(settings: Record<string, unknown>, version: number) {
  backing.set(
    KEY,
    JSON.stringify({
      state: { settings, personas: [], activePersonaId: 'unrestricted', _version: version },
      version,
    })
  )
}

async function freshStore(nav: { platform: string; userAgent: string }) {
  vi.resetModules()
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('localStorage', localStorageShim)
  vi.stubGlobal('navigator', nav)
  const mod = await import('../settingsStore')
  return mod.useSettingsStore
}

describe('settingsStore migration (Mac cloud-lock → local)', () => {
  beforeEach(() => backing.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('resets a force-pinned Mac install from cloud to local', async () => {
    seed({ appMode: 'cloud', temperature: 0.42 }, CURRENT - 1)
    const store = await freshStore(MAC_NAV)
    const s = store.getState().settings
    expect(s.appMode).toBe('local')
    // Unrelated settings survive the migration.
    expect(s.temperature).toBe(0.42)
  })

  it('resets a Mac install coming from the cloud-only 2.5.x line', async () => {
    // The Mac shipped cloud-only through 2.5.10 (store v13–v18), so every
    // upgrade path below CURRENT has to land in local mode.
    seed({ appMode: 'cloud' }, 13)
    const store = await freshStore(MAC_NAV)
    expect(store.getState().settings.appMode).toBe('local')
  })

  it('leaves a Windows install on its real cloud choice', async () => {
    seed({ appMode: 'cloud' }, CURRENT - 1)
    const store = await freshStore(WIN_NAV)
    expect(store.getState().settings.appMode).toBe('cloud')
  })

  it('does not touch a Mac install that chose cloud after the wall was lifted', async () => {
    // version === current → migrate is not invoked, so a legit later cloud
    // pick is preserved (we only reset the one-time forced pin).
    seed({ appMode: 'cloud' }, CURRENT)
    const store = await freshStore(MAC_NAV)
    expect(store.getState().settings.appMode).toBe('cloud')
  })

  it('rebuilds built-in personas while migrating', async () => {
    seed({ appMode: 'cloud' }, CURRENT - 1)
    const store = await freshStore(MAC_NAV)
    expect(store.getState().personas.length).toBeGreaterThan(0)
    expect(store.getState().personas.some(p => p.isBuiltIn)).toBe(true)
  })
})

// Mobile groundwork, point 1: the migration carried its own copy of the Mac
// check, with iPhone and iPad in it. A phone profile below v19 that sat in
// Cloud mode was thrown back to local on the first start of the new app.
describe('settingsStore migration on a phone', () => {
  beforeEach(() => backing.clear())
  afterEach(() => vi.unstubAllGlobals())

  const IPHONE_NAV = {
    platform: 'iPhone',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    maxTouchPoints: 5,
  }
  const IPAD_NAV = { ...MAC_NAV, maxTouchPoints: 5 }

  it('leaves an iPhone profile on its cloud choice', async () => {
    seed({ appMode: 'cloud' }, CURRENT - 1)
    const store = await freshStore(IPHONE_NAV)
    expect(store.getState().settings.appMode).toBe('cloud')
  })

  it('leaves an iPad profile on its cloud choice, although it reports itself as a Mac', async () => {
    seed({ appMode: 'cloud' }, CURRENT - 1)
    const store = await freshStore(IPAD_NAV)
    expect(store.getState().settings.appMode).toBe('cloud')
  })
})
