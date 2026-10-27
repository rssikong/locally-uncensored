/**
 * What the onboarding remembers between its steps and how it ends.
 *
 * The picked model is kept in localStorage, so a restart in the middle of
 * the flow still knows which download belongs to it. Everything else is read
 * from the stores at the moment it is shown: what is installed, what is
 * still downloading, whether the user is signed in to LU Cloud.
 */
import { create } from 'zustand'
import { backendCall } from '../../../../api/backend'
import { useModelStore } from '../../../../stores/modelStore'
import { useSettingsStore } from '../../../../stores/settingsStore'
import { nav } from '../../../nav'

const PICKED_KEY = 'lu-mobile-onboarding-model'

function readPicked(): string | null {
  try {
    return localStorage.getItem(PICKED_KEY)
  } catch {
    return null
  }
}

interface FlowState {
  /** File name of the model the user picked in A2, or null. */
  picked: string | null
  setPicked: (filename: string | null) => void
}

export const useFlow = create<FlowState>((set) => ({
  picked: readPicked(),
  setPicked: (picked) => {
    try {
      if (picked) localStorage.setItem(PICKED_KEY, picked)
      else localStorage.removeItem(PICKED_KEY)
    } catch {
      /* storage blocked: the pick lives as long as the page */
    }
    set({ picked })
  },
}))

/** Remember that the onboarding is done, in the settings and in the marker file that survives a lost WebView storage. */
export function markOnboardingDone(): void {
  useSettingsStore.getState().updateSettings({ onboardingDone: true })
  void backendCall('set_onboarding_done').catch(() => {})
}

/**
 * End the flow (A4.1, A4.2). A model that is ready becomes the chat model
 * when the chat has none yet, so the first message has somewhere to go.
 */
export function finishOnboarding(target: 'chat' | 'models', readyModel: string | null): void {
  if (readyModel && !useModelStore.getState().activeModel) useModelStore.getState().setActiveModel(`openai::${readyModel}`)
  markOnboardingDone()
  useFlow.getState().setPicked(null)
  if (target === 'models') nav.finishFlow('models')
  else nav.finishFlow('chat', [{ route: '/chat/:id', params: { id: 'new' } }])
}
