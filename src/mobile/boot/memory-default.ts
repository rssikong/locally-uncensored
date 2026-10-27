/**
 * On a phone, learning from chats starts switched off.
 *
 * The memory store is shared with the desktop and starts with "Learn from
 * chats" on. A fresh install on a phone then wrote entries about the user out
 * of ordinary chats before the user had seen the Memory page (second check on
 * Android, F12; small iPhone, K12). Decided for the phone, and reversible by
 * the switch on the Memory page: a fresh install starts with it off.
 * "Remember this" and the form on the Memory page do not go through that
 * switch and work as before.
 *
 * What counts as fresh: the onboarding has not been finished. As long as that
 * is so the switch is held off at every start, because nobody can have chosen
 * it yet (the Memory page is behind the onboarding). The first start that
 * finds the onboarding done writes a mark and from then on this file changes
 * nothing, so an install from before this rule keeps what it has, and "Run
 * setup again" does not take a choice back.
 */
import { useMemoryStore } from '../../stores/memoryStore'
import { useSettingsStore } from '../../stores/settingsStore'

export const MEMORY_DEFAULT_DECIDED_KEY = 'lu-mobile-memory-learning-decided'

/** Pure: what the start does with the switch. */
export function memoryLearningAtStart(input: { onboardingDone: boolean; decided: boolean }): 'hold-off' | 'keep' {
  return !input.onboardingDone && !input.decided ? 'hold-off' : 'keep'
}

function decided(): boolean {
  try {
    return localStorage.getItem(MEMORY_DEFAULT_DECIDED_KEY) === '1'
  } catch {
    return false
  }
}

function markDecided(): void {
  try {
    localStorage.setItem(MEMORY_DEFAULT_DECIDED_KEY, '1')
  } catch {
    /* without the mark a later start decides again, by the same rule */
  }
}

function memoryHydrated(): Promise<void> {
  return new Promise((resolve) => {
    const persist = useMemoryStore.persist
    if (!persist || persist.hasHydrated()) resolve()
    else persist.onFinishHydration(() => resolve())
  })
}

let stopWatching: (() => void) | null = null

/** Called once at start, after the settings are back. Resolves when the switch stands. */
export async function applyMemoryLearningDefault(opts: { skipOnboarding?: boolean } = {}): Promise<'hold-off' | 'keep'> {
  stopWatching?.()
  stopWatching = null
  // The developer switch that starts behind the onboarding stands for an install that is set up.
  const onboardingDone = useSettingsStore.getState().settings.onboardingDone || opts.skipOnboarding === true
  const what = memoryLearningAtStart({ onboardingDone, decided: decided() })
  if (what === 'keep') {
    markDecided()
    return what
  }
  // The onboarding ends in this session: from then on the switch belongs to the user.
  stopWatching = useSettingsStore.subscribe((state) => {
    if (!state.settings.onboardingDone) return
    markDecided()
    stopWatching?.()
    stopWatching = null
  })
  // After the stored state is in: written earlier, the default of the store would come back over it.
  await memoryHydrated()
  if (useMemoryStore.getState().settings.autoExtractEnabled) useMemoryStore.getState().updateMemorySettings({ autoExtractEnabled: false })
  return what
}

/** Test only. */
export function __resetMemoryDefaultForTests(): void {
  stopWatching?.()
  stopWatching = null
}
