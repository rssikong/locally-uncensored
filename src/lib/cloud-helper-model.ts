import type { AppMode } from '../types/settings'
import { useModelStore } from '../stores/modelStore'
import { useSettingsStore } from '../stores/settingsStore'

/**
 * The hosted model a helper call runs on in Cloud mode while the user has
 * picked no chat model yet.
 *
 * Since 3.0.5 the app no longer picks a hosted chat model by itself
 * (lib/active-model-mode), so a new account can sit in Create with "Improve my
 * prompt" on and no chat model anywhere. The switch must not be a dead end
 * for that. A helper call is not a chat: nothing of it lands in a history, so
 * a fixed small instruct model is the right tool, and the same one the web
 * app uses. The one place this id is written down.
 */
export const CLOUD_HELPER_MODEL = 'lu-cloud::mistralai/Mistral-Small-3.2-24B-Instruct-2506'

/**
 * Which model a helper call runs on: the picked chat model when there is one,
 * the helper model in Cloud mode when there is none, and nothing in Local
 * mode, where a model has to be on the machine and only the user knows which.
 */
export function helperModelFor(activeModel: string | null, appMode: AppMode | undefined): string | null {
  if (activeModel) return activeModel
  return appMode === 'cloud' ? CLOUD_HELPER_MODEL : null
}

/** The same answer for right now, read from the stores. */
export function currentHelperModel(): string | null {
  return helperModelFor(useModelStore.getState().activeModel, useSettingsStore.getState().settings.appMode)
}

/** The chat model list of right now: it carries the display name of the
 *  helper model, for the places that name it. */
export function currentChatModelList(): ReadonlyArray<{ name: string; displayName?: string }> {
  return useModelStore.getState().models
}
