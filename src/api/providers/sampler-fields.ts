/**
 * GH #175: which of the extra samplers a backend reads, and under which name.
 *
 * Read by the providers when they build a request and by the Sampling popup
 * when it says which values reach the model of the current speaker, so both
 * give the same answer. Pure, no runtime imports.
 *
 *  - Ollama: `options.min_p`, `repeat_penalty`, `presence_penalty`,
 *    `frequency_penalty`. No DRY sampler.
 *  - Bundled engine (llama-server): `min_p`, `repeat_penalty`,
 *    `presence_penalty`, `frequency_penalty`, `dry_multiplier`.
 *  - Own OpenAI compatible server on this machine or the LAN (LM Studio,
 *    KoboldCpp, vLLM, llama-server): the same, plus `repetition_penalty`, the
 *    name vLLM and KoboldCpp read. Which of these servers sits behind the slot
 *    is not known, and each of them ignores the names it does not read.
 *  - Remote OpenAI compatible endpoint: only `presence_penalty` and
 *    `frequency_penalty`, the two of the OpenAI spec. A strict server answers
 *    an unknown field with an error.
 *  - Anthropic and the hosted endpoint: none.
 */
import type { ProviderId } from './types'

export type ExtraSamplerKey = 'minP' | 'repeatPenalty' | 'presencePenalty' | 'frequencyPenalty' | 'dryMultiplier'

export interface SamplerTarget {
  id: ProviderId
  isLocal?: boolean
  managed?: boolean
}

const OLLAMA: readonly ExtraSamplerKey[] = ['minP', 'repeatPenalty', 'presencePenalty', 'frequencyPenalty']
const LOCAL_OPENAI: readonly ExtraSamplerKey[] = [...OLLAMA, 'dryMultiplier']
const SPEC_OPENAI: readonly ExtraSamplerKey[] = ['presencePenalty', 'frequencyPenalty']

/** The extra samplers this backend reads. */
export function extraSamplersFor(target: SamplerTarget): readonly ExtraSamplerKey[] {
  if (target.id === 'ollama') return OLLAMA
  if (target.id === 'openai') return target.isLocal || target.managed ? LOCAL_OPENAI : SPEC_OPENAI
  return []
}

type ExtraValues = Partial<Record<ExtraSamplerKey, number>>

/** The extra samplers as top level fields of an OpenAI compatible body. */
export function openAiSamplerFields(target: SamplerTarget, values: ExtraValues): Record<string, number> {
  const known = extraSamplersFor(target)
  const out: Record<string, number> = {}
  const put = (key: ExtraSamplerKey, field: string) => {
    const value = values[key]
    if (value !== undefined && known.includes(key)) out[field] = value
  }
  put('minP', 'min_p')
  put('repeatPenalty', 'repeat_penalty')
  // The bundled engine is llama-server and reads only the name above.
  if (target.managed !== true) put('repeatPenalty', 'repetition_penalty')
  put('presencePenalty', 'presence_penalty')
  put('frequencyPenalty', 'frequency_penalty')
  put('dryMultiplier', 'dry_multiplier')
  return out
}

/** The extra samplers as keys of Ollama's `options`. */
export function ollamaSamplerOptions(values: ExtraValues): Record<string, number> {
  const out: Record<string, number> = {}
  if (values.minP !== undefined) out.min_p = values.minP
  if (values.repeatPenalty !== undefined) out.repeat_penalty = values.repeatPenalty
  if (values.presencePenalty !== undefined) out.presence_penalty = values.presencePenalty
  if (values.frequencyPenalty !== undefined) out.frequency_penalty = values.frequencyPenalty
  return out
}
