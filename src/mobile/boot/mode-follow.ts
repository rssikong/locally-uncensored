/**
 * The active model follows the mode (on device or cloud).
 *
 * Both effects come from the desktop (AppShell.tsx), with the same rule
 * functions:
 *  - Flipping the mode moves the chat selection to the model that mode had
 *    last (pickForMode in src/lib/active-model-mode.ts). An out of mode model
 *    never stays active: a cloud model left active on device would keep
 *    billing credits.
 *  - Entering cloud unloads the local model so it does not sit in memory,
 *    but only once no local run is using it. Coming back asks for the model
 *    list again, which is where the engine is started.
 *
 * When the rule replaces the user's choice without the user having flipped
 * the mode (the chosen model left the list), the app says so, with the same
 * call the desktop uses (announceChatModelReplaced). The sentence names the
 * two models and nothing a phone does not have; boot/ModelNotes.tsx shows it.
 * The other door, a list that drops the chosen model while it is loaded, is
 * announced by hooks/useModels itself.
 *
 * Left out on purpose: the unloading of desktop backends.
 */
import { useEffect, useRef } from 'react'
import { isTauri } from '../../api/backend'
import { stopBundledEngine } from '../../api/engine'
import { announceChatModelReplaced } from '../../api/lu-engine-switch'
import { pickForMode, replacedBehindTheUsersBack } from '../../lib/active-model-mode'
import { offloadWhenLocalLaneFree } from '../../lib/cloud-offload-defer'
import { oweEngineResume } from '../../lib/engine-resume-policy'
import { useGenerationStore } from '../../stores/generationStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'

export function useModeFollow(): void {
  const appMode = useSettingsStore((s) => s.settings.appMode)
  const allModels = useModelStore((s) => s.models)
  const lastMode = useRef(appMode)

  useEffect(() => {
    const { activeModel, setActiveModel, lastLocalModel, lastCloudModel } = useModelStore.getState()
    const { pendingCloudModel, setPendingCloudModel } = useUIStore.getState()
    const pick = pickForMode(activeModel, allModels, appMode, pendingCloudModel, {
      local: lastLocalModel,
      cloud: lastCloudModel,
    })
    // A flip of the mode is the user's own doing and needs no sentence.
    const modeFlipped = lastMode.current !== appMode
    lastMode.current = appMode
    if (replacedBehindTheUsersBack(activeModel, pick, modeFlipped)) {
      announceChatModelReplaced(activeModel!, pick.next!)
    }
    if (pick.change) setActiveModel(pick.next)
    if (pick.usedRequest) setPendingCloudModel(null)
  }, [appMode, allModels])

  const wasInCloud = useRef(false)
  useEffect(() => {
    if (!isTauri()) return
    if (appMode === 'cloud') {
      wasInCloud.current = true
      oweEngineResume()
      return offloadWhenLocalLaneFree(useGenerationStore, () => {
        // Silent: this frees memory the user is no longer using. The switch itself already happened.
        void Promise.resolve(stopBundledEngine()).catch(() => {})
      })
    }
    if (!wasInCloud.current) return
    wasInCloud.current = false
    window.dispatchEvent(new CustomEvent('lu-models-refresh'))
  }, [appMode])
}
