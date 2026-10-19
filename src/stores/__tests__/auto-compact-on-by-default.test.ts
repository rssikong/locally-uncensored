/**
 * @vitest-environment jsdom
 *
 * Auto-compact is on by default since 3.0.7. Before, a 0 threshold was the
 * only way to be off and it was also what every profile held that never
 * touched the setting, so a stored profile with 0 (or without the new switch)
 * comes back on, with the threshold fitted to the window. Only an explicit
 * `autoCompact: false` stays off.
 *
 * Run: npx vitest run src/stores/__tests__/auto-compact-on-by-default.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from '../settingsStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { resolveCompactThreshold } from '../../lib/compact-trigger'

const KEY = 'chat-settings'

function seed(settings: Record<string, unknown>, version = 23) {
  window.localStorage.setItem(KEY, JSON.stringify({
    state: { settings, personas: [], activePersonaId: 'unrestricted', _version: version },
    version,
  }))
}

function withoutSwitch(threshold: number): Record<string, unknown> {
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS, autoCompactThreshold: threshold }
  delete s.autoCompact
  return s
}

beforeEach(() => window.localStorage.removeItem(KEY))

describe('auto-compact on by default', () => {
  it('ships on, with the threshold fitted to the window', () => {
    expect(DEFAULT_SETTINGS.autoCompact).toBe(true)
    expect(DEFAULT_SETTINGS.autoCompactThreshold).toBe(0)
    expect(resolveCompactThreshold(DEFAULT_SETTINGS, 32768)).toBe(0.81)
  })

  it('a stored profile from before 3.0.7 with 0 comes back on', async () => {
    seed(withoutSwitch(0))
    await useSettingsStore.persist.rehydrate()
    const s = useSettingsStore.getState().settings
    expect(s.autoCompact).toBe(true)
    expect(resolveCompactThreshold(s, 32768)).toBe(0.81)
    // Below a 32K model window the default stays quiet (18.10.2026).
    expect(resolveCompactThreshold(s, 8192)).toBeNull()
  })

  it('the same holds for an older store version that runs the migrate', async () => {
    seed(withoutSwitch(0), 20)
    await useSettingsStore.persist.rehydrate()
    expect(useSettingsStore.getState().settings.autoCompact).toBe(true)
  })

  it('a threshold someone set before stays theirs, and is now on', async () => {
    seed(withoutSwitch(0.7))
    await useSettingsStore.persist.rehydrate()
    const s = useSettingsStore.getState().settings
    expect(s.autoCompact).toBe(true)
    expect(s.autoCompactThreshold).toBe(0.7)
    expect(resolveCompactThreshold(s, 131072)).toBe(0.7)
  })

  it('an explicit off survives the start', async () => {
    seed({ ...DEFAULT_SETTINGS, autoCompact: false })
    await useSettingsStore.persist.rehydrate()
    const s = useSettingsStore.getState().settings
    expect(s.autoCompact).toBe(false)
    expect(resolveCompactThreshold(s, 32768)).toBeNull()
  })
})
