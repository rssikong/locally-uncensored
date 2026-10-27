/**
 * Press a fit button (3.0.8, A25; the buttons are in lib/engine-fit.ts): save
 * the change and restart the running engine with it, the same way Settings'
 * Apply & Restart does. Resolves when the engine is back.
 *
 * Its own module because it is the one part that starts the engine: the
 * status path (lib/engine-offload) reads the buttons without importing the
 * engine API back.
 */
import { useSettingsStore } from '../stores/settingsStore'
import { swapBundledModel } from './engine'
import { tuningAfter, type FitAction } from '../lib/engine-fit'

export async function applyFitAction(action: FitAction, modelPath: string | null | undefined): Promise<void> {
  const { settings, updateSettings } = useSettingsStore.getState()
  const next = tuningAfter(settings.builtinEngine, action)
  updateSettings({ builtinEngine: next })
  if (!modelPath) return
  await swapBundledModel(modelPath, next)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('lu-context-reloaded'))
}
