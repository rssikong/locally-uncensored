import type { Persona, SamplerValues, Settings } from '../types/settings'
import type { ProviderConfig, ProviderId } from '../api/providers/types'
import { displayModelName, getProviderIdFromModel } from '../api/providers/model-name'
import { extraSamplersFor, type ExtraSamplerKey, type SamplerTarget } from '../api/providers/sampler-fields'
import { effectiveExtraSamplers, effectiveSampling, type SamplingOverrides } from './sampling'
import { samplingPresetFor } from './chat-persona'
import { isGroupChat, groupSpeakers } from './group-chat'

/**
 * GH #175: what the Sampling popup says about each speaker of the open chat.
 *
 * One line per speaker: the model, where its values come from (a persona or
 * the chat), and every value that holds for it, from the same rules the send
 * path uses (lib/chat-persona.ts, lib/sampling.ts). A value the backend of
 * that model does not read is marked, because it is not sent
 * (api/providers/sampler-fields.ts).
 */
export interface SpeakerSamplingLine {
  model: string
  label: string
  /** "Persona Baron" or "Chat settings". */
  source: string
  preset?: SamplerValues
  values: { label: string; text: string; sent: boolean }[]
}

const EXTRA_LABELS: Record<ExtraSamplerKey, string> = {
  minP: 'Min P',
  repeatPenalty: 'Repeat penalty',
  presencePenalty: 'Presence penalty',
  frequencyPenalty: 'Frequency penalty',
  dryMultiplier: 'DRY multiplier',
}

const num = (n: number) => String(Number(n.toFixed(4)))

export function speakerSamplingLines(input: {
  settings: Pick<Settings, 'temperature' | 'topP' | 'maxTokens' | 'topK' | 'personasEnabled'>
  conv: Parameters<typeof samplingPresetFor>[0] & { sampling?: SamplingOverrides }
  activeModel: string | null
  personas: readonly Persona[]
  activePersonaId: string | undefined
  providers: Partial<Record<ProviderId, Pick<ProviderConfig, 'id' | 'isLocal' | 'managed'>>>
  /** GitHub #173: the backend of one model, slot or additional entry. When
   *  given it wins over `providers`, which only knows the four slots. */
  targetOf?: (model: string) => SamplerTarget
}): SpeakerSamplingLine[] {
  const { settings, conv, activeModel, personas, activePersonaId, providers, targetOf } = input
  const group = isGroupChat(conv.groupModels)
  const models = group ? conv.groupModels ?? [] : activeModel ? [activeModel] : []
  // In a group, members follow the send path's rule: not gated on the
  // Personas switch (hooks/useChat.ts, runGroupTurn).
  const personasOn = group ? true : settings.personasEnabled !== false
  const names = group ? groupSpeakers(models, conv.groupPersonas, personas) : undefined
  return models.map((model) => {
    const { persona, preset } = samplingPresetFor(conv, model, personas, activePersonaId, personasOn)
    const core = effectiveSampling(settings, conv.sampling, preset)
    const extras = effectiveExtraSamplers(conv.sampling, preset)
    const providerId = getProviderIdFromModel(model)
    const known = extraSamplersFor(targetOf?.(model) ?? providers[providerId] ?? { id: providerId })
    const values: SpeakerSamplingLine['values'] = [
      { label: 'Temperature', text: num(core.temperature), sent: true },
      { label: 'Top P', text: num(core.topP), sent: true },
      { label: 'Top K', text: String(extras.topK ?? settings.topK), sent: providerId !== 'lu-cloud' },
      { label: 'Max tokens', text: core.maxTokens > 0 ? String(core.maxTokens) : 'auto', sent: true },
    ]
    for (const key of Object.keys(EXTRA_LABELS) as ExtraSamplerKey[]) {
      const v = extras[key]
      if (v !== undefined) values.push({ label: EXTRA_LABELS[key], text: num(v), sent: known.includes(key) })
    }
    return {
      model,
      label: names?.[model]?.name && names[model].name !== model ? `${names[model].name} (${displayModelName(model)})` : displayModelName(model),
      source: persona ? `Persona ${persona.name}` : 'Chat settings',
      preset,
      values,
    }
  })
}
