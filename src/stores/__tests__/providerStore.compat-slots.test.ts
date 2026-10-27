import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Extra OpenAI-compatible slots (`openai-<slug>`): a saved provider with the
// user's own key gets a slot of its own, so the shared `openai` slot keeps
// whoever holds it (on a phone: the on device engine). These tests mock the
// keychain bridge and re-import the store per case, like the H5 tests do,
// because `keychainReady` is module-level state.

const vault = vi.hoisted(() => ({
  secretGet: vi.fn(),
  secretSet: vi.fn(),
  secretDelete: vi.fn(),
  secretParkGet: vi.fn(),
  secretParkSet: vi.fn(),
  secretParkDelete: vi.fn(),
}))
const darkened = vi.hoisted(() => ({ announce: vi.fn() }))

vi.mock('../../api/providers/client-cache', () => ({ clearProviderCache: vi.fn() }))
vi.mock('../../api/backend', () => vault)
vi.mock('../../lib/provider-slot-darkening', () => ({ announceDarkenedSlots: darkened.announce }))
vi.mock('../../lib/builtin-slot-eviction', () => ({ onLocalSlotChanged: vi.fn() }))

async function freshStore() {
  vi.resetModules()
  const mod = await import('../providerStore')
  return mod.useProviderStore
}

const obf = (k: string) => btoa(k.split('').reverse().join(''))

function installLocalStorage(): Map<string, string> {
  const map = new Map<string, string>()
  const ls = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  }
  vi.stubGlobal('localStorage', ls)
  vi.stubGlobal('window', { localStorage: ls })
  return map
}

const GROQ = { slug: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' }

describe('providerStore: extra OpenAI-compatible slots', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    for (const fn of Object.values(vault)) fn.mockReset()
    darkened.announce.mockReset()
    storage = installLocalStorage()
    // No keychain unless a case says otherwise.
    vault.secretGet.mockRejectedValue(new Error('keychain unavailable (web build)'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('adds a slot of its own and leaves the shared openai slot alone', async () => {
    const useStore = await freshStore()
    const engine = useStore.getState().providers.openai
    const id = useStore.getState().addCompatProvider(GROQ)
    expect(id).toBe('openai-groq')
    const slot = useStore.getState().providers['openai-groq']
    expect(slot).toEqual({ id: 'openai-groq', name: 'Groq', enabled: false, baseUrl: GROQ.baseUrl, apiKey: '', isLocal: false })
    expect(useStore.getState().providers.openai).toBe(engine)
  })

  it('refuses a slug with nothing usable in it and an address that is not http or https', async () => {
    const useStore = await freshStore()
    expect(useStore.getState().addCompatProvider({ ...GROQ, slug: '***' })).toBeNull()
    expect(useStore.getState().addCompatProvider({ ...GROQ, baseUrl: 'javascript:alert(1)' })).toBeNull()
    expect(useStore.getState().addCompatProvider({ ...GROQ, baseUrl: 'file:///etc/passwd' })).toBeNull()
    expect(Object.keys(useStore.getState().providers).sort()).toEqual(['anthropic', 'lu-cloud', 'ollama', 'openai'])
  })

  it('cannot be switched on before it exists, and not without an address', async () => {
    const useStore = await freshStore()
    useStore.getState().setProviderConfig('openai-groq', { enabled: true })
    useStore.getState().setProviderApiKey('openai-groq', 'gsk-secret-1')
    expect(useStore.getState().providers['openai-groq']).toBeUndefined()
  })

  it('a config write can only switch, rename and mark it: never manage it or move its address', async () => {
    const useStore = await freshStore()
    useStore.getState().addCompatProvider(GROQ)
    useStore.getState().setProviderApiKey('openai-groq', 'gsk-secret-1')
    useStore.getState().setProviderConfig('openai-groq', {
      enabled: true,
      managed: true,
      isLocal: true,
      baseUrl: 'https://evil.example/v1',
      displaced: { name: 'x', baseUrl: 'y', isLocal: true },
    })
    const slot = useStore.getState().providers['openai-groq']
    expect(slot.enabled).toBe(true)
    expect(slot.baseUrl).toBe(GROQ.baseUrl)
    expect(slot.managed).toBeUndefined()
    expect(slot.isLocal).toBe(false)
    expect(slot.displaced).toBeUndefined()
  })

  it('shows up among the enabled providers with its real key', async () => {
    const useStore = await freshStore()
    useStore.getState().addCompatProvider(GROQ)
    useStore.getState().setProviderApiKey('openai-groq', 'gsk-secret-1')
    useStore.getState().setProviderConfig('openai-groq', { enabled: true })
    expect(useStore.getState().providers['openai-groq'].apiKey).toBe(obf('gsk-secret-1'))
    const enabled = useStore.getState().getEnabledProviders().find((p) => p.id === 'openai-groq')
    expect(enabled?.apiKey).toBe('gsk-secret-1')
  })

  it('a new address drops the key that was typed for the old one', async () => {
    const useStore = await freshStore()
    useStore.getState().addCompatProvider({ slug: 'custom', name: 'Custom endpoint', baseUrl: 'https://one.example/v1' })
    useStore.getState().setProviderApiKey('openai-custom', 'key-for-one')
    useStore.getState().setProviderConfig('openai-custom', { enabled: true })
    useStore.getState().addCompatProvider({ slug: 'custom', name: 'Custom endpoint', baseUrl: 'https://two.example/v1' })
    const slot = useStore.getState().providers['openai-custom']
    expect(slot.baseUrl).toBe('https://two.example/v1')
    expect(slot.apiKey).toBe('')
    expect(slot.enabled).toBe(false)
    expect(darkened.announce).toHaveBeenCalled()
  })

  it('the same address again keeps key and switch', async () => {
    const useStore = await freshStore()
    useStore.getState().addCompatProvider(GROQ)
    useStore.getState().setProviderApiKey('openai-groq', 'gsk-secret-1')
    useStore.getState().setProviderConfig('openai-groq', { enabled: true })
    useStore.getState().addCompatProvider({ ...GROQ, name: 'Groq Cloud' })
    const slot = useStore.getState().providers['openai-groq']
    expect(slot.name).toBe('Groq Cloud')
    expect(slot.enabled).toBe(true)
    expect(useStore.getState().getProviderApiKey('openai-groq')).toBe('gsk-secret-1')
  })

  it('removing it takes the entry away and says that a pick it served is gone', async () => {
    const useStore = await freshStore()
    useStore.getState().addCompatProvider(GROQ)
    useStore.getState().setProviderApiKey('openai-groq', 'gsk-secret-1')
    useStore.getState().setProviderConfig('openai-groq', { enabled: true })
    useStore.getState().removeCompatProvider('openai-groq')
    expect(useStore.getState().providers['openai-groq']).toBeUndefined()
    const stillDark = darkened.announce.mock.calls.at(-1)?.[0] as () => string[]
    expect(stillDark()).toEqual(['openai-groq'])
  })

  it('removeCompatProvider ignores a fixed slot, resetProvider removes an extra one', async () => {
    const useStore = await freshStore()
    useStore.getState().removeCompatProvider('anthropic')
    expect(useStore.getState().providers.anthropic).toBeDefined()
    useStore.getState().addCompatProvider(GROQ)
    useStore.getState().resetProvider('openai-groq')
    expect(useStore.getState().providers['openai-groq']).toBeUndefined()
  })

  it('"Reset AI Backends" keeps the saved providers of the user', async () => {
    const useStore = await freshStore()
    useStore.getState().addCompatProvider(GROQ)
    useStore.getState().setProviderApiKey('openai-groq', 'gsk-secret-1')
    useStore.getState().setProviderConfig('openai-groq', { enabled: true })
    useStore.getState().resetProvidersToDefaults()
    const slot = useStore.getState().providers['openai-groq']
    expect(slot.enabled).toBe(true)
    expect(useStore.getState().getProviderApiKey('openai-groq')).toBe('gsk-secret-1')
    expect(useStore.getState().providers.openai.managed).toBe(true)
  })

  it('with a keychain the key goes to the parked namespace and stays out of localStorage', async () => {
    vault.secretGet.mockResolvedValue(null)
    vault.secretParkGet.mockResolvedValue(null)
    vault.secretParkSet.mockResolvedValue(undefined)
    vault.secretParkDelete.mockResolvedValue(undefined)
    const useStore = await freshStore()
    await useStore.getState().hydrateProviderKeys()
    useStore.getState().addCompatProvider(GROQ)
    useStore.getState().setProviderApiKey('openai-groq', 'gsk-secret-1')
    expect(vault.secretParkSet).toHaveBeenCalledWith('slot-openai-groq', 'gsk-secret-1')
    expect(vault.secretSet).not.toHaveBeenCalledWith('openai-groq', expect.anything())
    const blob = storage.get('lu-providers') ?? ''
    expect(blob).toContain('openai-groq')
    expect(blob).not.toContain(obf('gsk-secret-1'))
    expect(blob).not.toContain('gsk-secret-1')

    useStore.getState().removeCompatProvider('openai-groq')
    expect(vault.secretParkDelete).toHaveBeenCalledWith('slot-openai-groq')
  })

  it('a failed keychain write keeps the obfuscated key in localStorage instead of losing it', async () => {
    vault.secretGet.mockResolvedValue(null)
    vault.secretParkGet.mockResolvedValue(null)
    vault.secretParkSet.mockRejectedValue(new Error('locked'))
    const useStore = await freshStore()
    await useStore.getState().hydrateProviderKeys()
    useStore.getState().addCompatProvider(GROQ)
    useStore.getState().setProviderApiKey('openai-groq', 'gsk-secret-1')
    await new Promise((r) => setTimeout(r, 0))
    expect(storage.get('lu-providers') ?? '').toContain(obf('gsk-secret-1'))
  })

  it('after a restart the key comes back from the keychain', async () => {
    storage.set('lu-providers', JSON.stringify({
      state: { providers: { 'openai-groq': { id: 'openai-groq', name: 'Groq', enabled: true, baseUrl: GROQ.baseUrl, apiKey: '', isLocal: false } } },
      version: 1,
    }))
    vault.secretGet.mockResolvedValue(null)
    vault.secretParkGet.mockImplementation(async (account: string) => (account === 'slot-openai-groq' ? 'gsk-secret-1' : null))
    const useStore = await freshStore()
    expect(useStore.getState().providers['openai-groq'].enabled).toBe(true)
    await useStore.getState().hydrateProviderKeys()
    expect(useStore.getState().getProviderApiKey('openai-groq')).toBe('gsk-secret-1')
  })

  it('a stored blob cannot smuggle in a managed slot, a foreign id or a strange address', async () => {
    storage.set('lu-providers', JSON.stringify({
      state: {
        providers: {
          'openai-evil': { id: 'openai', name: 'x', enabled: true, baseUrl: 'ftp://host/v1', apiKey: '', isLocal: true, managed: true },
          'openai-odd': { id: 'lu-cloud', name: '', enabled: true, baseUrl: 'https://odd.example/v1', apiKey: 'abc', isLocal: 'yes', managed: true, displaced: { name: 'a', baseUrl: 'b', isLocal: true } },
          'openai-empty': { enabled: true, baseUrl: '' },
          'openai-null': null,
        },
      },
      version: 1,
    }))
    const useStore = await freshStore()
    const providers = useStore.getState().providers
    expect(providers['openai-evil']).toBeUndefined()
    expect(providers['openai-null']).toBeUndefined()
    expect(providers['openai-odd']).toEqual({ id: 'openai-odd', name: 'openai-odd', enabled: true, baseUrl: 'https://odd.example/v1', apiKey: 'abc', isLocal: false })
    expect(providers['openai-empty'].enabled).toBe(false)
    // The four fixed slots are untouched.
    expect(providers.openai.managed).toBe(true)
  })
})
