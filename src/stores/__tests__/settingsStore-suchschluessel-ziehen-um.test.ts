/**
 * @vitest-environment jsdom
 *
 * A phone reads a settings blob that still carries a plain web search key
 * (an older mobile build, or a backup made on a desktop). Right after the
 * read the key moves into the keychain and the blob that is written back,
 * the one a backup carries, no longer contains it. The desktop keeps it.
 *
 * Since 3.0.8 the boot of the phone starts the move (mobile/boot/index.tsx,
 * moveLegacySearchKeys) instead of the rehydrate of the store, which made a
 * circle with api/backend. The test calls what the boot calls.
 *
 * Run: npx vitest run src/stores/__tests__/settingsStore-suchschluessel-ziehen-um.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const vault = new Map<string, string>()
const device = { mobile: true }

vi.mock('../../api/backend', () => ({
  isMacOS: () => false,
  secretParkSet: async (id: string, value: string) => {
    vault.set(id, value)
  },
  secretParkGet: async (id: string) => vault.get(id) ?? null,
  secretParkDelete: async (id: string) => {
    vault.delete(id)
  },
}))
vi.mock('../../lib/device-kind', () => ({ isMobile: () => device.mobile, isMacOS: () => false }))

import { useSettingsStore } from '../settingsStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { __resetSearchKeyMovesForTests } from '../../lib/search-key-vault'
import { moveLegacySearchKeys } from '../../lib/search-keys'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SECRET = 'BSA-not-a-real-key-9911'

async function rehydrateWithPlainKey(): Promise<void> {
  const version = useSettingsStore.persist.getOptions().version
  localStorage.setItem(
    'chat-settings',
    JSON.stringify({ state: { settings: { ...DEFAULT_SETTINGS, braveApiKey: SECRET, searchProvider: 'brave' }, personas: [], activePersonaId: 'unrestricted' }, version }),
  )
  await useSettingsStore.persist.rehydrate()
  // What the boot of the phone runs right after the read.
  await moveLegacySearchKeys()
}

beforeEach(() => {
  vault.clear()
  localStorage.clear()
  __resetSearchKeyMovesForTests()
})

describe('settings store, web search keys after a read', () => {
  it('phone: the plain key moves into the keychain and leaves the stored blob', async () => {
    device.mobile = true
    await rehydrateWithPlainKey()
    await vi.waitFor(() => expect(useSettingsStore.getState().settings.braveKeyStored).toBe(true))
    expect(vault.get('search-brave')).toBe(SECRET)
    expect(useSettingsStore.getState().settings.braveApiKey).toBe('')
    expect(useSettingsStore.getState().settings.searchProvider).toBe('brave')
    expect(localStorage.getItem('chat-settings')).not.toContain(SECRET)
  })

  it('desktop: nothing moves, the field stays as the settings page wrote it', async () => {
    device.mobile = false
    await rehydrateWithPlainKey()
    await new Promise((r) => setTimeout(r, 20))
    expect(vault.size).toBe(0)
    expect(useSettingsStore.getState().settings.braveApiKey).toBe(SECRET)
    expect(useSettingsStore.getState().settings.braveKeyStored).toBe(false)
  })

  it('the boot of the phone starts the move, right after the stores are read', () => {
    const boot = readFileSync(resolve(__dirname, '../../mobile/boot/index.tsx'), 'utf8')
    expect(boot).toContain('void moveLegacySearchKeys().catch(() => {})')
  })
})
