/**
 * @vitest-environment jsdom
 *
 * Round 12, F12: on a fresh install of the phone app "Learn from chats"
 * starts switched off. An install that is already set up keeps what it has.
 *
 * Run: npx vitest run src/mobile/boot/__tests__/memory-default.test.ts
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../lib/constants'
import { useMemoryStore } from '../../../stores/memoryStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { MEMORY_DEFAULT_DECIDED_KEY, __resetMemoryDefaultForTests, applyMemoryLearningDefault, memoryLearningAtStart } from '../memory-default'

const learning = () => useMemoryStore.getState().settings.autoExtractEnabled
const setUp = (onboardingDone: boolean, on = true) => {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, onboardingDone } })
  useMemoryStore.setState((s) => ({ settings: { ...s.settings, autoExtractEnabled: on, autoExtractInAllModes: true } }))
}

beforeEach(() => {
  localStorage.clear()
  __resetMemoryDefaultForTests()
})
afterEach(() => __resetMemoryDefaultForTests())

describe('memoryLearningAtStart', () => {
  it('held off only before the onboarding is finished for the first time', () => {
    expect(memoryLearningAtStart({ onboardingDone: false, decided: false })).toBe('hold-off')
    expect(memoryLearningAtStart({ onboardingDone: true, decided: false })).toBe('keep')
    expect(memoryLearningAtStart({ onboardingDone: false, decided: true })).toBe('keep')
    expect(memoryLearningAtStart({ onboardingDone: true, decided: true })).toBe('keep')
  })
})

describe('applyMemoryLearningDefault', () => {
  it('the store itself still starts with learning on: that is the default of the desktop', () => {
    expect(useMemoryStore.getInitialState().settings.autoExtractEnabled).toBe(true)
  })

  it('a fresh install: learning is off, the second switch is not touched', async () => {
    setUp(false)
    expect(await applyMemoryLearningDefault()).toBe('hold-off')
    expect(learning()).toBe(false)
    expect(useMemoryStore.getState().settings.autoExtractInAllModes).toBe(true)
  })

  it('the user turns it on after the onboarding: the next start keeps it', async () => {
    setUp(false)
    await applyMemoryLearningDefault()
    useSettingsStore.getState().updateSettings({ onboardingDone: true })
    expect(localStorage.getItem(MEMORY_DEFAULT_DECIDED_KEY)).toBe('1')
    useMemoryStore.getState().updateMemorySettings({ autoExtractEnabled: true })
    expect(await applyMemoryLearningDefault()).toBe('keep')
    expect(learning()).toBe(true)
  })

  it('an install from before this rule keeps learning on', async () => {
    setUp(true)
    expect(await applyMemoryLearningDefault()).toBe('keep')
    expect(learning()).toBe(true)
    expect(localStorage.getItem(MEMORY_DEFAULT_DECIDED_KEY)).toBe('1')
  })

  it('the developer switch that starts behind the onboarding counts as an install that is set up', async () => {
    setUp(false)
    expect(await applyMemoryLearningDefault({ skipOnboarding: true })).toBe('keep')
    expect(learning()).toBe(true)
  })

  it('"Run setup again" does not take the choice back', async () => {
    setUp(true)
    await applyMemoryLearningDefault()
    useSettingsStore.getState().updateSettings({ onboardingDone: false })
    expect(await applyMemoryLearningDefault()).toBe('keep')
    expect(learning()).toBe(true)
  })

  it('the app is closed during the first onboarding: the next start holds it off again', async () => {
    setUp(false)
    await applyMemoryLearningDefault()
    // What a lost write would leave: the default of the store.
    useMemoryStore.getState().updateMemorySettings({ autoExtractEnabled: true })
    __resetMemoryDefaultForTests()
    expect(await applyMemoryLearningDefault()).toBe('hold-off')
    expect(learning()).toBe(false)
  })
})
