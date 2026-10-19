/**
 * The context window a person picked for one LM Studio model.
 *
 * GH #168: "256K · max" was picked for an LM Studio model, the main model was
 * switched away and back, and LU loaded it again with 16384. Two things were
 * wrong. The picker wrote the pick only into `contextWindowOverride`, a single
 * number for every model and the same field Settings calls "Context window
 * (Ollama)", so a pick for LM Studio also changed the num_ctx of every Ollama
 * model. And the load that a pick in the model list starts never read it at
 * all: it asked for `LMS_AUTOLOAD_CONTEXT` (16384) every time.
 *
 * Now the pick is saved per model, in `contextWindowByModel` under
 * `lmstudio|<id>` (the custom server picks live there too, under
 * `<baseUrl>|<id>`, so the keys cannot meet), and every load LU starts on its
 * own reads it back. Auto removes the entry.
 *
 * A size picked before 3.0.7 lives only in the shared override and is not
 * carried over: that number was also Ollama's, and a value meant for one
 * backend is not a safe load size for a model on the other. Picking the size
 * once more saves it for the model.
 *
 * Leaf module: imports nothing from api/* or the stores.
 */

import { contextWindowKey, storedWindow, withStoredWindow } from './context-source'

/** The key of one LM Studio model. The routing prefix (`openai::`) is not part of it. */
export function lmStudioPickKey(modelName: string): string {
  return contextWindowKey('lmstudio', modelName.replace(/^[^:]+::/, ''))
}

/** The saved window for this model, 0 = Auto. */
export function savedLmStudioContext(
  settings: { contextWindowByModel?: Record<string, number> },
  modelName: string,
): number {
  return storedWindow(settings.contextWindowByModel, lmStudioPickKey(modelName))
}

/** The map after a pick. 0 (Auto) removes the entry. */
export function withLmStudioPick(
  map: Record<string, number> | undefined,
  modelName: string,
  tokens: number,
): Record<string, number> {
  return withStoredWindow(map, lmStudioPickKey(modelName), tokens)
}

/**
 * The window to ask LM Studio for when LU loads the model by itself.
 *
 * @param saved      `savedLmStudioContext`, 0 = Auto
 * @param modelMax   the model row's `contextLength`, else 0
 * @param autoWindow what Auto asks for (`LMS_AUTOLOAD_CONTEXT`)
 *
 * A saved pick is sent as it is. It was made in the context picker, whose list
 * already ends at the maximum LM Studio itself reported. The row's
 * `contextLength` can be a guess from the model's name when the listing said
 * nothing (an unknown name reads 8192), and capping by it could undo exactly
 * the pick #168 is about.
 *
 * Auto keeps what it always was: the auto window, never above the row's value.
 */
export function lmStudioLoadContext(saved: number, modelMax: number, autoWindow: number): number {
  if (saved > 0) return Math.floor(saved)
  const max = typeof modelMax === 'number' && Number.isFinite(modelMax) && modelMax > 0 ? modelMax : 0
  return max > 0 ? Math.min(max, autoWindow) : autoWindow
}
