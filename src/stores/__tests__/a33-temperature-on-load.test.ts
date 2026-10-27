/**
 * @vitest-environment jsdom
 *
 * A33 (3.0.8): until 3.0.7 the temperature sliders ran to 2.0. A profile that
 * kept a value above TEMPERATURE_MAX made every model write noise, so on the
 * first start of the new build the Settings page value goes back to the
 * default, and so does a persona's own temperature. A value inside the limit
 * was chosen on purpose and stays.
 *
 * Run: npx vitest run src/stores/__tests__/a33-temperature-on-load.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from '../settingsStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'

const KEY = 'chat-settings'

function seed(temperature: number, personaTemperature?: number, version = 23) {
  window.localStorage.setItem(KEY, JSON.stringify({
    state: {
      settings: { ...DEFAULT_SETTINGS, temperature },
      personas: [{
        id: 'mine', name: 'Mine', icon: 'User', systemPrompt: 'x', isBuiltIn: false,
        ...(personaTemperature === undefined ? {} : { sampling: { temperature: personaTemperature, topP: 0.5 } }),
      }],
      activePersonaId: 'mine',
      _version: version,
    },
    version,
  }))
}

const persona = () => useSettingsStore.getState().personas.find((p) => p.id === 'mine')

beforeEach(() => window.localStorage.removeItem(KEY))

describe('a temperature above the limit, stored by an older build', () => {
  it('the customer case: 1.9 on the Settings page goes back to the default', async () => {
    seed(1.9)
    await useSettingsStore.persist.rehydrate()
    expect(useSettingsStore.getState().settings.temperature).toBe(DEFAULT_SETTINGS.temperature)
  })

  it('also for a profile written before the current store version', async () => {
    seed(2, undefined, 20)
    await useSettingsStore.persist.rehydrate()
    expect(useSettingsStore.getState().settings.temperature).toBe(DEFAULT_SETTINGS.temperature)
  })

  it('a persona loses only its temperature, the other values stay', async () => {
    seed(0.8, 1.9)
    await useSettingsStore.persist.rehydrate()
    expect(persona()?.sampling).toEqual({ topP: 0.5 })
  })

  it('NEGATIVKONTROLLE: 1.3 was chosen on purpose and stays, here and on the persona', async () => {
    seed(1.3, 1.3)
    await useSettingsStore.persist.rehydrate()
    expect(useSettingsStore.getState().settings.temperature).toBe(1.3)
    expect(persona()?.sampling).toEqual({ temperature: 1.3, topP: 0.5 })
  })
})
