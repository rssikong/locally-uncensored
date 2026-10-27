/**
 * Web search keys: the keychain holds the key, the settings hold one bit,
 * and a search sends only what the chosen provider may use.
 *
 * Run: npx vitest run src/lib/__tests__/search-keys.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const vault = new Map<string, string>()
const vaultState = { missing: false, refuse: false }
const calls: Array<{ command: string; args: Record<string, unknown> }> = []
const device = { mobile: true }

function gate(): void {
  if (vaultState.missing) throw new Error('keychain unavailable (web build)')
  if (vaultState.refuse) throw new Error('refused: locked')
}

vi.mock('../../api/backend', () => ({
  secretParkSet: async (id: string, value: string) => {
    gate()
    vault.set(id, value)
  },
  secretParkGet: async (id: string) => {
    gate()
    return vault.get(id) ?? null
  },
  secretParkDelete: async (id: string) => {
    gate()
    vault.delete(id)
  },
  backendCall: async (command: string, args: Record<string, unknown>) => {
    calls.push({ command, args })
    return { results: [], provider: 'duckduckgo' }
  },
}))
vi.mock('../device-kind', () => ({ isMobile: () => device.mobile }))

import {
  SEARCH_KEY_ACCOUNT,
  __resetSearchKeyMovesForTests,
  moveLegacySearchKeys,
  removeSearchKey,
  resolveSearchCall,
  runWebSearch,
  saveSearchKey,
  searchKeyIsSet,
  searchProviderAfterKeyChange,
  searchProviderUsable,
} from '../search-keys'
import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../constants'

const settings = () => useSettingsStore.getState().settings
const SECRET = 'BSA-not-a-real-key-1234'

beforeEach(() => {
  vault.clear()
  calls.length = 0
  vaultState.missing = false
  vaultState.refuse = false
  device.mobile = true
  __resetSearchKeyMovesForTests()
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
})

describe('saving a key', () => {
  it('puts the key into the keychain and only a bit into the settings', async () => {
    expect(await saveSearchKey('brave', `  ${SECRET} `)).toBe('stored')
    expect(vault.get(SEARCH_KEY_ACCOUNT.brave)).toBe(SECRET)
    expect(settings().braveKeyStored).toBe(true)
    expect(settings().braveApiKey).toBe('')
    expect(searchKeyIsSet(settings(), 'brave')).toBe(true)
    expect(searchKeyIsSet(settings(), 'tavily')).toBe(false)
  })

  it('the settings blob, which is what a backup carries, never contains the key', async () => {
    await saveSearchKey('brave', SECRET)
    await saveSearchKey('tavily', 'tvly-not-a-real-key-5678')
    const blob = JSON.stringify(useSettingsStore.getState())
    expect(blob).not.toContain(SECRET)
    expect(blob).not.toContain('tvly-not-a-real-key-5678')
  })

  it('without a keychain nothing is stored anywhere and the answer says so', async () => {
    vaultState.missing = true
    expect(await saveSearchKey('brave', SECRET)).toBe('no-keychain')
    expect(settings().braveKeyStored).toBe(false)
    expect(settings().braveApiKey).toBe('')
  })

  it('a keychain that refuses is "failed", an empty value is "empty"', async () => {
    expect(await saveSearchKey('brave', '   ')).toBe('empty')
    vaultState.refuse = true
    expect(await saveSearchKey('brave', SECRET)).toBe('failed')
    expect(settings().braveKeyStored).toBe(false)
  })
})

describe('removing a key', () => {
  it('clears keychain, bit and plain field, and a provider that needed it falls back to auto', async () => {
    await saveSearchKey('tavily', SECRET)
    useSettingsStore.getState().updateSettings({ searchProvider: 'tavily' })
    expect(await removeSearchKey('tavily')).toBe(true)
    expect(vault.has(SEARCH_KEY_ACCOUNT.tavily)).toBe(false)
    expect(settings().tavilyKeyStored).toBe(false)
    expect(settings().searchProvider).toBe('auto')
  })

  it('keeps the truth when the keychain refuses the delete', async () => {
    await saveSearchKey('brave', SECRET)
    vaultState.refuse = true
    expect(await removeSearchKey('brave')).toBe(false)
    expect(settings().braveKeyStored).toBe(true)
  })

  it('the free choice survives the removal of a key', async () => {
    await saveSearchKey('brave', SECRET)
    useSettingsStore.getState().updateSettings({ searchProvider: 'duckduckgo' })
    await removeSearchKey('brave')
    expect(settings().searchProvider).toBe('duckduckgo')
  })
})

describe('provider choice', () => {
  it('brave and tavily need their key, auto and duckduckgo never do', () => {
    const none = { ...DEFAULT_SETTINGS }
    expect(searchProviderUsable('auto', none)).toBe(true)
    expect(searchProviderUsable('duckduckgo', none)).toBe(true)
    expect(searchProviderUsable('brave', none)).toBe(false)
    expect(searchProviderUsable('tavily', { ...none, tavilyKeyStored: true })).toBe(true)
    expect(searchProviderUsable('brave', { ...none, braveApiKey: 'x' })).toBe(true)
    expect(searchProviderAfterKeyChange('brave', none)).toBe('auto')
    expect(searchProviderAfterKeyChange('duckduckgo', none)).toBe('duckduckgo')
  })
})

describe('what one search sends', () => {
  beforeEach(async () => {
    await saveSearchKey('brave', 'brave-key')
    await saveSearchKey('tavily', 'tavily-key')
  })

  it('duckduckgo sends no key at all, whatever is stored', async () => {
    useSettingsStore.getState().updateSettings({ searchProvider: 'duckduckgo' })
    expect(await resolveSearchCall()).toEqual({ provider: 'duckduckgo', braveApiKey: '', tavilyApiKey: '' })
  })

  it('brave sends only the Brave key, tavily only the Tavily key', async () => {
    useSettingsStore.getState().updateSettings({ searchProvider: 'brave' })
    expect(await resolveSearchCall()).toEqual({ provider: 'brave', braveApiKey: 'brave-key', tavilyApiKey: '' })
    useSettingsStore.getState().updateSettings({ searchProvider: 'tavily' })
    expect(await resolveSearchCall()).toEqual({ provider: 'tavily', braveApiKey: '', tavilyApiKey: 'tavily-key' })
  })

  it('auto sends both', async () => {
    expect(await resolveSearchCall()).toEqual({ provider: 'auto', braveApiKey: 'brave-key', tavilyApiKey: 'tavily-key' })
  })

  it('an unknown stored provider is read as auto', async () => {
    useSettingsStore.getState().updateSettings({ searchProvider: 'bing' as never })
    expect((await resolveSearchCall()).provider).toBe('auto')
  })

  it('a bit without a keychain entry is corrected: no key, bit off, provider back to auto', async () => {
    vault.clear()
    useSettingsStore.getState().updateSettings({ searchProvider: 'brave' })
    expect(await resolveSearchCall()).toEqual({ provider: 'auto', braveApiKey: '', tavilyApiKey: '' })
    expect(settings().braveKeyStored).toBe(false)
  })

  it('a keychain that is busy costs this one search the key, not the bit', async () => {
    vaultState.refuse = true
    expect(await resolveSearchCall()).toEqual({ provider: 'auto', braveApiKey: '', tavilyApiKey: '' })
    expect(settings().braveKeyStored).toBe(true)
  })

  it('runWebSearch calls the same command the agent tool calls', async () => {
    await runWebSearch('weather', 3)
    expect(calls).toEqual([{ command: 'web_search', args: { query: 'weather', count: 3, provider: 'auto', braveApiKey: 'brave-key', tavilyApiKey: 'tavily-key' } }])
  })
})

describe('the one-time move of old plain keys', () => {
  it('on a phone a plain key moves into the keychain and the field is emptied', async () => {
    useSettingsStore.getState().updateSettings({ braveApiKey: SECRET, searchProvider: 'brave' })
    expect(await moveLegacySearchKeys()).toEqual(['brave'])
    expect(vault.get(SEARCH_KEY_ACCOUNT.brave)).toBe(SECRET)
    expect(settings().braveApiKey).toBe('')
    expect(settings().braveKeyStored).toBe(true)
    expect(settings().searchProvider).toBe('brave')
    expect(JSON.stringify(useSettingsStore.getState())).not.toContain(SECRET)
    // Nothing left to move.
    expect(await moveLegacySearchKeys()).toEqual([])
  })

  it('a search moves it on the way and still uses the key', async () => {
    useSettingsStore.getState().updateSettings({ tavilyApiKey: SECRET })
    expect((await resolveSearchCall()).tavilyApiKey).toBe(SECRET)
    expect(settings().tavilyApiKey).toBe('')
    expect(settings().tavilyKeyStored).toBe(true)
  })

  it('the desktop keeps its plain field and a search reads it from there', async () => {
    device.mobile = false
    useSettingsStore.getState().updateSettings({ braveApiKey: SECRET, searchProvider: 'brave' })
    expect(await moveLegacySearchKeys()).toEqual([])
    expect(await resolveSearchCall()).toEqual({ provider: 'brave', braveApiKey: SECRET, tavilyApiKey: '' })
    expect(settings().braveApiKey).toBe(SECRET)
    expect(vault.size).toBe(0)
  })

  it('without a keychain the plain key stays and keeps working, and the keychain is asked once', async () => {
    vaultState.missing = true
    useSettingsStore.getState().updateSettings({ braveApiKey: SECRET })
    expect(await moveLegacySearchKeys()).toEqual([])
    expect((await resolveSearchCall()).braveApiKey).toBe(SECRET)
    expect(settings().braveApiKey).toBe(SECRET)
  })
})
