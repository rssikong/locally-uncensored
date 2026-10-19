/**
 * Der Modellname als Zeichenkette: wie ein Slot-Präfix drangeschrieben,
 * ausgelesen und wieder abgeschnitten wird.
 *
 *   "ollama::llama3.1:8b"  →  Slot ollama, Modell llama3.1:8b
 *   "llama3.1:8b"          →  Slot ollama (kein Präfix = Ollama, Altbestand)
 *
 * Audit W-T2: Diese drei Funktionen standen in registry.ts, zwischen der
 * Client-Fabrik und dem Zugriff auf den providerStore. Wer nur wissen wollte,
 * zu welchem Slot ein Name gehört — api/engine.ts, stores/modelStore.ts und ein
 * Dutzend Komponenten —, zog damit die vier Provider-Klassen und den Store mit
 * herein. Über engine.ts und modelStore.ts schloss sich daraus ein Kreis:
 * providers/index → openai-provider → builtin-ensure → providerStore →
 * modelStore/engine → providers/index.
 *
 * Sie brauchen nichts davon. Es sind reine Zeichenketten-Funktionen, sie
 * kennen nur den Typ eines Slot-Bezeichners. Also liegen sie hier, in einem
 * Modul ohne Laufzeit-Import. registry.ts und providers/index.ts exportieren
 * sie unverändert weiter.
 */

import type { ProviderId } from './types'

/**
 * GitHub #173: neben dem einen `openai`-Slot gibt es weitere
 * OpenAI-kompatible Eintraege (LM Studio und KoboldCpp gleichzeitig). Ihre
 * Modelle tragen den Eintrag im Praefix:
 *
 *   "openai::qwen3-8b"            →  der bisherige Slot (alte Ids bleiben gueltig)
 *   "openai:kobold-3f9a::mistral" →  der Eintrag kobold-3f9a
 *
 * Die Eintrags-Kennung ist ein Slug aus [a-z0-9-], also nie ein Doppelpunkt:
 * `split('::')` liefert weiter genau zwei Teile, und alles, was nur den
 * nackten Modellnamen will (`displayModelName`, `split('::')[1]`), bleibt
 * unveraendert richtig.
 */
export const OPENAI_ENTRY_PREFIX = 'openai:'

const ENTRY_ID = /^[a-z0-9][a-z0-9-]{0,47}$/

/** Is this a usable entry id (slug, no colon, short). */
export function isOpenAIEntryId(id: unknown): id is string {
  return typeof id === 'string' && ENTRY_ID.test(id)
}

/**
 * The OpenAI-compatible entry a model name points at, or null for the
 * original `openai` slot and for every other provider.
 */
export function openaiEntryOfModel(modelName: string): string | null {
  if (!modelName) return null
  const parts = modelName.split('::')
  if (parts.length !== 2) return null
  const head = parts[0]
  if (!head.startsWith(OPENAI_ENTRY_PREFIX)) return null
  const id = head.slice(OPENAI_ENTRY_PREFIX.length)
  return isOpenAIEntryId(id) ? id : null
}

/**
 * A model of the ORIGINAL `openai` slot (the one the LU Engine lives in), not
 * of an additional entry. Every "is this our engine's model" question asks
 * this and not `getProviderIdFromModel(...) === 'openai'`, which is true for
 * every entry too.
 */
export function isOpenAISlotModel(modelName: string): boolean {
  return getProviderIdFromModel(modelName) === 'openai' && openaiEntryOfModel(modelName) === null
}

/**
 * Which backend serves this model, as one comparable key: the provider id,
 * or `openai:<entry>` for an additional OpenAI-compatible entry. Two models
 * share a key exactly when switching that backend off makes both unservable.
 */
export function modelBackendKey(modelName: string): string {
  const entry = openaiEntryOfModel(modelName)
  return entry ? `${OPENAI_ENTRY_PREFIX}${entry}` : getProviderIdFromModel(modelName)
}

/**
 * Extract the provider ID from a prefixed model name.
 * Returns 'ollama' if no prefix. A model of an additional OpenAI-compatible
 * entry (GitHub #173) answers 'openai': it speaks that protocol through that
 * provider class. Whether it is the app's OWN slot is `openaiEntryOfModel`.
 */
export function getProviderIdFromModel(modelName: string): ProviderId {
  if (!modelName) return 'ollama'
  const parts = modelName.split('::')
  if (parts.length !== 2) return 'ollama'
  if (openaiEntryOfModel(modelName)) return 'openai'
  return parts[0] as ProviderId
}

/**
 * Create a prefixed model name for storage. `entryId` names an additional
 * OpenAI-compatible entry (GitHub #173); without it the name points at the
 * original slot, exactly as before.
 */
export function prefixModelName(provider: ProviderId, modelId: string, entryId?: string): string {
  if (provider === 'ollama') return modelId // backward compat: Ollama models have no prefix
  if (provider === 'openai' && entryId && isOpenAIEntryId(entryId)) {
    return `${OPENAI_ENTRY_PREFIX}${entryId}::${modelId}`
  }
  return `${provider}::${modelId}`
}

/**
 * Get the display name for a model (strip provider prefix).
 */
export function displayModelName(modelName: string): string {
  const parts = modelName.split('::')
  return parts.length === 2 ? parts[1] : modelName
}
