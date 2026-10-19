/**
 * GitHub #173: "Add all side by side" in the startup backend dialog.
 *
 * The dialog used to offer one choice: which detected backend becomes THE
 * OpenAI-compatible backend. With LM Studio and KoboldCpp both running that
 * meant giving one up. This adds every detected backend that is not set up yet,
 * each where lib/openai-entries.ts puts it: Ollama in its own slot, an
 * OpenAI-compatible server in the slot when the slot is free, otherwise as its
 * own entry next to it. A backend the user switched off on purpose stays off
 * (the same gate the startup detection asks), and nothing already configured
 * is touched.
 *
 * Returns how many backends it added or switched on.
 */

import { PROVIDER_PRESETS } from '../api/providers/types'
import { useProviderStore } from '../stores/providerStore'
import type { DetectedBackend } from './backend-detector'
import { endpointConfigured, placeBackend } from './openai-entries'
import { mayEnableFromWizard } from './onboarding-provider-gate'

export function addDetectedSideBySide(backends: readonly DetectedBackend[]): number {
  let changed = 0
  for (const b of backends) {
    const preset = PROVIDER_PRESETS.find((p) => p.id === b.id)
    if (!preset) continue
    const st = useProviderStore.getState()
    if (preset.providerId === 'ollama') {
      const cfg = st.providers.ollama
      if (cfg.enabled || !mayEnableFromWizard(cfg)) continue
      st.setProviderConfig('ollama', { enabled: true, baseUrl: b.baseUrl, isLocal: true })
      changed++
      continue
    }
    if (preset.providerId !== 'openai') continue
    if (endpointConfigured(st.providers.openai, st.openaiEntries, b.baseUrl)) continue
    const place = placeBackend(st.providers.openai, st.openaiEntries, { providerId: 'openai', baseUrl: b.baseUrl })
    // The LU Engine's slot is never overwritten from here, not even while it
    // is switched off: the engine has no other place to live.
    if (place.kind === 'entry-new' || (place.kind === 'slot' && st.providers.openai.managed === true)) {
      st.addOpenAIEntry({ name: b.name, baseUrl: b.baseUrl, isLocal: true })
      changed++
    } else if (place.kind === 'slot' && mayEnableFromWizard(st.providers.openai)) {
      st.setProviderConfig('openai', { enabled: true, name: b.name, baseUrl: b.baseUrl, isLocal: true, managed: false })
      st.setEngineOptedOut(true)
      changed++
    }
  }
  return changed
}
