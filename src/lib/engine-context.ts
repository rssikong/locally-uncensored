/**
 * Set the context window of the built-in engine: the setting and the reload
 * in one call.
 *
 * The engine reads the size when it loads a model. Writing the setting alone
 * changes nothing for the model that already runs, and every screen that
 * offered a size had to know that and reload by itself. This is that
 * knowledge in one place.
 *
 *   value > 0   this size, marked as chosen by the user
 *   value 0     back to "automatic": the engine picks for the device
 *
 * The caller decides which sizes to offer (on a phone never above
 * getMobileContextCap()). Nothing here clamps: a size the device cannot
 * carry fails in the reload, and that failure is thrown to the caller with
 * the setting already written, so the next load tries it again. The caller
 * may write the old size back when it wants the choice undone.
 */
import { bundledEngineStatus, swapBundledModel } from '../api/engine'
import { useSettingsStore } from '../stores/settingsStore'

export type EngineContextOutcome =
  /** The running model was loaded again with the new size. */
  | 'reloaded'
  /** No model runs right now. The size applies to the next load. */
  | 'saved'
  /** The size was already set. Nothing was written or reloaded. */
  | 'unchanged'

export async function setEngineContextWindow(value: number): Promise<EngineContextOutcome> {
  const ctx = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  const current = useSettingsStore.getState().settings.builtinEngine
  const chosenNow = current.ctxChosen && current.ctx > 0 ? current.ctx : 0
  if (chosenNow === ctx) return 'unchanged'
  useSettingsStore.getState().updateSettings({ builtinEngine: { ...current, ctx, ctxChosen: ctx > 0 } })
  const status = await bundledEngineStatus()
  if (!status?.running || !status.model_path) return 'saved'
  await swapBundledModel(status.model_path)
  return 'reloaded'
}
