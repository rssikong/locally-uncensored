/**
 * No secrets in a phone backup.
 *
 * On a phone the folder store_backup.json lies in is copied off the device
 * by the system (cloud backup, transfer to a new phone), so the file travels.
 * A provider key must not travel with it, not even in the reversed and base64
 * encoded form providerStore keeps in localStorage when the secure storage is
 * missing or a write to it failed. Neither must the keys of the web search,
 * the token of the local API or the environment of an MCP server.
 *
 * The desktop snapshot stays byte for byte what it was: there the file is the
 * app's own, and it has to carry the stores across a WebView2 wipe.
 *
 * Run: npx vitest run src/lib/__tests__/store-backup-no-secrets.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { standOn } from '../../test-support/devices'

const backendCall = vi.fn()
vi.mock('../../api/backend', () => ({
  backendCall: (...args: unknown[]) => backendCall(...args),
}))

function fakeLocalStorage() {
  const mem = new Map<string, string>()
  return {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    get length() { return mem.size },
    key: (i: number) => Array.from(mem.keys())[i] ?? null,
  }
}

/** What providerStore writes for a key without a secure storage: reversed, then base64. */
function obfuscated(key: string): string {
  return btoa(key.split('').reverse().join(''))
}

// Made up. None of these is a key of anything.
const PROVIDER_KEY = 'sk-or-made-up-0123456789abcdef'
const SLOT_KEY = 'gsk_made_up_fedcba9876543210'
const DISPLACED_KEY = 'sk-made-up-displaced-000111222'
const BRAVE_KEY = 'BSA-made-up-brave-key-123'
const TAVILY_KEY = 'tvly-made-up-tavily-key-456'
const API_TOKEN = 'lu-made-up-local-api-token-789'
const MCP_SECRET = 'ghp_made_up_mcp_secret_abc'

const SECRETS = [
  PROVIDER_KEY, obfuscated(PROVIDER_KEY),
  SLOT_KEY, obfuscated(SLOT_KEY),
  DISPLACED_KEY, obfuscated(DISPLACED_KEY),
  BRAVE_KEY, TAVILY_KEY, API_TOKEN, MCP_SECRET,
]

function fillStores(): void {
  localStorage.setItem('lu-providers', JSON.stringify({
    state: {
      providers: {
        ollama: { id: 'ollama', name: 'Ollama', enabled: false, baseUrl: 'http://localhost:11434', apiKey: '', isLocal: true },
        anthropic: { id: 'anthropic', name: 'Anthropic', enabled: true, baseUrl: 'https://api.anthropic.com', apiKey: obfuscated(PROVIDER_KEY), isLocal: false },
        'openai-groq': { id: 'openai-groq', name: 'Groq', enabled: true, baseUrl: 'https://api.groq.com/openai/v1', apiKey: obfuscated(SLOT_KEY), isLocal: false },
        openai: {
          id: 'openai', name: 'LU Engine', enabled: true, baseUrl: 'http://127.0.0.1:8127/v1', apiKey: '', isLocal: true,
          displaced: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: obfuscated(DISPLACED_KEY), isLocal: false },
        },
      },
      dismissedHints: ['a'],
    },
    version: 3,
  }))
  localStorage.setItem('chat-settings', JSON.stringify({
    state: { settings: { temperature: 0.7, maxTokens: 2048, theme: 'dark', searchProvider: 'brave', braveApiKey: BRAVE_KEY, tavilyApiKey: TAVILY_KEY, onboardingDone: true } },
    version: 12,
  }))
  localStorage.setItem('lu-local-api', JSON.stringify({ state: { port: 8765, lan: false, token: API_TOKEN, corsOrigins: [] }, version: 0 }))
  localStorage.setItem('locally-uncensored-mcp-servers', JSON.stringify({
    state: { servers: [{ id: 'gh', name: 'GitHub', command: 'npx', args: ['-y', 'server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: MCP_SECRET, MODE: 'ro' }, enabled: true }] },
    version: 0,
  }))
  localStorage.setItem('locally-uncensored-voice', JSON.stringify({ state: { ttsEnabled: true, cloudTtsVoice: 'Calm_Woman' }, version: 0 }))
  localStorage.setItem('lu-mobile-theme', 'dark')
  localStorage.setItem('lu-mobile-settings-prefs', JSON.stringify({ state: { switchCounter: false, systemVoiceFallback: true, lastBackupAt: 0, teaserHintShown: true, lastSelfTest: null }, version: 0 }))
  localStorage.setItem('lu-mobile-remote-desktops', JSON.stringify([{ baseUrl: 'http://192.168.1.20:8787', address: '192.168.1.20:8787', route: 'lan', lastConnectedAt: 1 }]))
  localStorage.setItem('lu-mobile-resume-seen', JSON.stringify(['m1', 'm2']))
  localStorage.setItem('lu-mobile-download-wifi-only', '1')
  localStorage.setItem('lu-mobile-unload-in-background', '1')
  // Not in the list on purpose: the Remote token has its own home in the secure storage.
  localStorage.setItem('lu-mobile-remote-token', 'made-up-remote-token-must-never-be-listed')
}

function writtenPayloads(): string[] {
  return backendCall.mock.calls.filter((c) => c[0] === 'backup_stores').map((c) => (c[1] as { data: string }).data)
}

function expectNoSecret(text: string): void {
  for (const secret of SECRETS) expect(text.includes(secret), `the backup contains ${secret}`).toBe(false)
  expect(text).not.toContain('made-up-remote-token')
}

beforeEach(() => {
  vi.resetModules()
  backendCall.mockReset()
  backendCall.mockResolvedValue(undefined)
  vi.stubGlobal('localStorage', fakeLocalStorage())
})
afterEach(() => vi.unstubAllGlobals())

describe.each(['android', 'iphone', 'ipad'] as const)('on %s', (device) => {
  beforeEach(() => {
    standOn(device)
    vi.stubGlobal('localStorage', fakeLocalStorage())
    fillStores()
  })

  it('the snapshot carries no key and no token, in no encoding', async () => {
    const { collectStoreSnapshot } = await import('../store-backup')
    const snapshot = await collectStoreSnapshot()
    expectNoSecret(JSON.stringify(snapshot))
  })

  it('neither does any of the three ways the file is written', async () => {
    const { backupStoresIfChanged, backupStoresNow, flushSyncStoreBackup } = await import('../store-backup')
    expect(await backupStoresIfChanged()).toBe('written')
    await vi.waitFor(() => expect(writtenPayloads()).toHaveLength(1))
    localStorage.setItem('lu-mobile-theme', 'light')
    expect(flushSyncStoreBackup()).toBe('written')
    await vi.waitFor(() => expect(writtenPayloads()).toHaveLength(2))
    expect(await backupStoresNow()).toBe(true)
    const payloads = writtenPayloads()
    expect(payloads.length).toBeGreaterThanOrEqual(3)
    for (const payload of payloads) expectNoSecret(payload)
  })

  it('keeps everything else of those stores: the provider stays set up, only its key is gone', async () => {
    const { collectStoreSnapshot } = await import('../store-backup')
    const snapshot = await collectStoreSnapshot()
    const providers = JSON.parse(snapshot['lu-providers']).state.providers
    expect(providers.anthropic).toMatchObject({ enabled: true, baseUrl: 'https://api.anthropic.com', apiKey: '' })
    expect(providers['openai-groq']).toMatchObject({ enabled: true, baseUrl: 'https://api.groq.com/openai/v1', apiKey: '' })
    expect(providers.openai.displaced).toMatchObject({ name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: '' })
    const settings = JSON.parse(snapshot['chat-settings']).state.settings
    expect(settings).toMatchObject({ temperature: 0.7, maxTokens: 2048, theme: 'dark', searchProvider: 'brave', braveApiKey: '', tavilyApiKey: '', onboardingDone: true })
    expect(JSON.parse(snapshot['lu-local-api']).state).toMatchObject({ port: 8765, lan: false, token: '' })
    const server = JSON.parse(snapshot['locally-uncensored-mcp-servers']).state.servers[0]
    expect(server).toMatchObject({ id: 'gh', command: 'npx', args: ['-y', 'server-github'], enabled: true, env: { GITHUB_PERSONAL_ACCESS_TOKEN: '', MODE: '' } })
  })

  it('carries the phone settings, and a store without secrets as the very same text', async () => {
    const { collectStoreSnapshot, MOBILE_STORE_KEYS } = await import('../store-backup')
    const snapshot = await collectStoreSnapshot()
    for (const key of MOBILE_STORE_KEYS) expect(snapshot[key], key).toBe(localStorage.getItem(key))
    expect(snapshot['locally-uncensored-voice']).toBe(localStorage.getItem('locally-uncensored-voice'))
    expect(snapshot).not.toHaveProperty('lu-mobile-remote-token')
  })

  it('a store that cannot be read as JSON is left out, not passed on unchecked', async () => {
    localStorage.setItem('lu-providers', `{"state":{"providers":{"anthropic":{"apiKey":"${obfuscated(PROVIDER_KEY)}"`)
    const { collectStoreSnapshot } = await import('../store-backup')
    const snapshot = await collectStoreSnapshot()
    expect(snapshot).not.toHaveProperty('lu-providers')
    expectNoSecret(JSON.stringify(snapshot))
  })

  it('does not write again while nothing changed: the cleaned text is stable', async () => {
    const { backupStoresIfChanged } = await import('../store-backup')
    expect(await backupStoresIfChanged()).toBe('written')
    await vi.waitFor(() => expect(writtenPayloads()).toHaveLength(1))
    expect(await backupStoresIfChanged()).toBe('unchanged')
    expect(await backupStoresIfChanged()).toBe('unchanged')
    expect(writtenPayloads()).toHaveLength(1)
  })
})

describe.each(['windows', 'mac', 'linux'] as const)('on %s the snapshot is what it always was', (device) => {
  beforeEach(() => {
    standOn(device)
    vi.stubGlobal('localStorage', fakeLocalStorage())
    fillStores()
  })

  it('every listed store goes in as the very text that is stored', async () => {
    const { collectStoreSnapshot, STORE_KEYS } = await import('../store-backup')
    const snapshot = await collectStoreSnapshot()
    for (const key of STORE_KEYS) {
      const stored = localStorage.getItem(key)
      if (stored) expect(snapshot[key], key).toBe(stored)
      else expect(snapshot, key).not.toHaveProperty(key)
    }
  })
})

describe('withoutSecrets', () => {
  it('returns the same string for a store that is not in the list of secret bearers', async () => {
    const { withoutSecrets } = await import('../store-backup')
    const text = JSON.stringify({ state: { apiKey: 'looks like one', token: 'x' } })
    expect(withoutSecrets('create-store', text)).toBe(text)
  })

  it('returns the same string when there was nothing to blank', async () => {
    const { withoutSecrets } = await import('../store-backup')
    const text = JSON.stringify({ state: { providers: { ollama: { apiKey: '', baseUrl: 'http://localhost:11434' } } } })
    expect(withoutSecrets('lu-providers', text)).toBe(text)
  })

  it('does not touch numbers and fields that only contain the word', async () => {
    const { withoutSecrets } = await import('../store-backup')
    const text = JSON.stringify({ state: { settings: { maxTokens: 4096, tokenCount: 'twelve', keyboardHint: 'on', hfToken: 'hf_made_up', password: 'made-up' } } })
    const clean = JSON.parse(withoutSecrets('chat-settings', text)!).state.settings
    expect(clean).toEqual({ maxTokens: 4096, tokenCount: 'twelve', keyboardHint: 'on', hfToken: '', password: '' })
  })

  it('names the stores it cleans, and every one of them is a backed up store', async () => {
    const { SECRET_BEARING_STORE_KEYS, STORE_KEYS } = await import('../store-backup')
    expect([...SECRET_BEARING_STORE_KEYS].sort()).toEqual(['chat-settings', 'locally-uncensored-mcp-servers', 'lu-local-api', 'lu-providers'])
    for (const key of SECRET_BEARING_STORE_KEYS) expect(STORE_KEYS).toContain(key)
  })
})

describe('the phone keys', () => {
  it('are all in STORE_KEYS, and the Remote token is not', async () => {
    const { MOBILE_STORE_KEYS, STORE_KEYS, IDB_STORE_KEYS } = await import('../store-backup')
    for (const key of ['lu-mobile-theme', 'lu-mobile-settings-prefs', 'lu-mobile-remote-desktops', 'lu-mobile-resume-seen', 'lu-mobile-download-wifi-only', 'lu-mobile-unload-in-background']) {
      expect(STORE_KEYS).toContain(key)
      expect(MOBILE_STORE_KEYS).toContain(key)
      expect(IDB_STORE_KEYS.has(key)).toBe(false)
    }
    expect(STORE_KEYS).not.toContain('lu-mobile-remote-token')
    expect(STORE_KEYS).not.toContain('lu-cloud-session')
    expect(new Set(STORE_KEYS).size).toBe(STORE_KEYS.length)
  })
})

describe('lastStoreBackupAt', () => {
  it('is the moment the native side confirmed a write, and null before', async () => {
    standOn('android')
    fillStores()
    const { backupStoresNow, lastStoreBackupAt, onStoreBackupWritten } = await import('../store-backup')
    expect(lastStoreBackupAt()).toBeNull()
    const heard = vi.fn()
    const off = onStoreBackupWritten(heard)
    const before = Date.now()
    expect(await backupStoresNow()).toBe(true)
    expect(lastStoreBackupAt()).toBeGreaterThanOrEqual(before)
    expect(heard).toHaveBeenCalledTimes(1)
    off()
    localStorage.setItem('lu-mobile-theme', 'light')
    expect(await backupStoresNow()).toBe(true)
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('stays null when the write failed', async () => {
    standOn('android')
    fillStores()
    backendCall.mockRejectedValue(new Error('disk full'))
    const { backupStoresNow, lastStoreBackupAt } = await import('../store-backup')
    expect(await backupStoresNow()).toBe(false)
    expect(lastStoreBackupAt()).toBeNull()
  })
})
