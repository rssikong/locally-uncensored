/**
 * Wo der `openai`-Steckplatz wirklich hinzeigt.
 *
 * `ProviderId` ist eine feste Menge von vier Steckplaetzen, und JEDES
 * OpenAI-kompatible Backend teilt sich denselben: api.openai.com, ein
 * llama.cpp auf 127.0.0.1:8080, ein vLLM im LAN, LM Studio, der eingebaute
 * Motor dieses Hauses. Der Name `openai` sagt also nur, welches Protokoll
 * gesprochen wird, und nichts darueber, wer die Rechnung schickt.
 *
 * Zwei Stellen mussten das schon wissen, und bis zum 11.09.2026 wusste es nur
 * eine: `useActiveContextWindow` (GH #129) hat die Frage gestellt, damit ein
 * eigener Server einen Fensterwaehler bekommt und nicht den bezahlten
 * Sendedeckel. Der Kompaktierungsweg daneben hat sie nicht gestellt und den
 * Steckplatz weiter an einer Liste gemessen, in der `openai` als bezahlt
 * steht. Beide fragen jetzt hier.
 */

import { isPrivateOrLanHost, hostnameOf } from '../api/backend'
import { isCompatProviderId } from '../api/providers/compat-id'
import { useProviderStore } from '../stores/providerStore'
import { openaiEntryOfModel, getProviderIdFromModel } from '../api/providers/model-name'
import type { ProviderConfig, ProviderId } from '../api/providers/types'

/**
 * Laeuft der eingestellte OpenAI-Slot auf diesem Rechner oder im LAN?
 *
 * Dieselbe Frage, die `isLanBackend` im Provider stellt, und bewusst dieselbe
 * Antwortquelle: die Voreinstellung des Slots ODER der Hostname. Ein fremder
 * Host im Internet bekommt weder Metadaten-Abfragen noch einen Fensterwaehler.
 */
export function isLanOpenAiBackend(entryId?: string | null): boolean {
  try {
    // GitHub #173: an additional OpenAI-compatible entry answers for itself.
    const st = useProviderStore.getState()
    const cfg = entryId ? st.openaiEntries.find((e) => e.entryId === entryId) : st.providers.openai
    if (!cfg) return false
    return cfg.isLocal === true || isPrivateOrLanHost(hostnameOf(cfg.baseUrl))
  } catch {
    return false
  }
}

/**
 * Geht eine Sendung an diesem Modell an eine Maschine, fuer die niemand
 * bezahlt?
 *
 * Nur fuer den `openai`-Steckplatz eine echte Frage. `ollama` und `lmstudio`
 * sind ohnehin lokal und stehen gar nicht erst auf der Bezahlliste, `lu-cloud`
 * und `anthropic` sind immer fern. Die Antwort darf NICHT ohne den
 * Anbieternamen gegeben werden: ein eigener Server im `openai`-Steckplatz
 * macht eine Sendung an LU Cloud nicht kostenlos.
 */
export function sendsToALanBackend(providerId: string, model: string | null | undefined): boolean {
  // GitHub #173: the model is not optional. A model of an additional
  // OpenAI-compatible entry has to be asked about ITS server, and a call that
  // left the model out answered for the slot instead (LM Studio next to a
  // paid cloud endpoint in the slot got the paid cap).
  // An extra OpenAI-compatible slot of a phone (`openai-<slug>`) is asked
  // about its own address, not about the shared one's.
  if (isCompatProviderId(providerId)) return isLanSlot(providerId)
  return providerId === 'openai' && isLanOpenAiBackend(model ? openaiEntryOfModel(model) : null)
}

/** The same question for an extra OpenAI-compatible slot of a phone. */
function isLanSlot(slot: ProviderId): boolean {
  try {
    const cfg = useProviderStore.getState().providers[slot]
    if (!cfg) return false
    return cfg.isLocal === true || isPrivateOrLanHost(hostnameOf(cfg.baseUrl))
  } catch {
    return false
  }
}

/**
 * GH #175 with #173: the backend a model runs on, as sampler-fields.ts reads
 * it. The OpenAI-compatible server of THIS model (slot or entry), local when
 * it is on this machine or the LAN, the same rule the provider sends by.
 */
export function samplerTargetOfModel(model: string): { id: ProviderId; isLocal?: boolean; managed?: boolean } {
  const providerId = getProviderIdFromModel(model)
  if (providerId !== 'openai') {
    const cfg = useProviderStore.getState().providers[providerId]
    return { id: providerId, isLocal: cfg?.isLocal, managed: cfg?.managed }
  }
  const cfg = openaiConfigOfModel(model)
  return {
    id: 'openai',
    isLocal: isLanOpenAiBackend(openaiEntryOfModel(model)),
    managed: openaiEntryOfModel(model) ? false : cfg?.managed,
  }
}

/**
 * GitHub #173: the configuration of the OpenAI-compatible server a model runs
 * on, the slot or an additional entry. Undefined for every other provider and
 * for an entry that no longer exists.
 */
export function openaiConfigOfModel(model: string | null | undefined): ProviderConfig | undefined {
  if (!model || getProviderIdFromModel(model) !== 'openai') return undefined
  const st = useProviderStore.getState()
  const entryId = openaiEntryOfModel(model)
  return entryId ? st.openaiEntries.find((e) => e.entryId === entryId) : st.providers.openai
}
