/**
 * Which model a sub-agent runs on, from the `model` argument of delegate_task.
 *
 * Acceptance on Android with 8 GB, B6: Qwen 3.5 2B filled the optional
 * argument with `"user"` and with `"OMIT"`, and the sub-agent answered "the
 * model "OMIT" is not installed here", followed by the identifiers the app
 * uses inside. No sub-agent ever ran.
 *
 * Two rules, both here so the runner and the lane lookup cannot disagree
 * (api/agents/sub-agent.ts asks in both places):
 *
 *   1. A value that names no model is no wish. A small model that is told an
 *      argument is optional writes a filler word into it. Treated as left out,
 *      on every platform: nobody has a model called "none".
 *
 *   2. A phone holds one local model at a time. A wish for another local model
 *      cannot be met while the chat runs, so the sub-agent runs on the model
 *      of the chat. A cloud model that exists is still honoured.
 *      The desktop keeps its rule: a wish that cannot be met is an error and
 *      never a silent switch (lib/agent-fanout.ts, resolveRequestedModel).
 */
import { resolveRequestedModel, type NamedModel } from './agent-fanout'

/** Words a model writes into an optional argument when it means "nothing". */
const FILLER = new Set([
  'omit', 'omitted', 'none', 'null', 'nil', 'undefined', 'default', 'auto', 'automatic', 'same', 'current', 'active',
  'this', 'self', 'user', 'assistant', 'system', 'model', 'string', 'optional', 'any', 'na', 'unknown', 'empty',
  'thismodel', 'currentmodel', 'activemodel', 'samemodel', 'defaultmodel', 'yourmodel', 'modelname', 'modelid',
])

/** Pure: is this value a filler word and not the name of a model? */
export function isFillerModelName(value: string): boolean {
  const word = (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  return word === '' || FILLER.has(word)
}

export interface SubAgentModelChoice {
  /** The model to run on. null when there is none at all. */
  model: string | null
  /** A wish that could not be met and must be reported (desktop only). */
  missing?: string
}

/**
 * Pure: the model of a sub-agent.
 *
 * @param requested   the `model` argument as the model wrote it
 * @param activeModel the model of the chat
 * @param installed   what the model store lists
 * @param device      `singleSlot`: a phone. `isCloud`: does this name run in the cloud?
 */
export function chooseSubAgentModel<T extends NamedModel>(
  requested: string | undefined,
  activeModel: string | null | undefined,
  installed: readonly T[],
  device: { singleSlot: boolean; isCloud: (name: string) => boolean },
): SubAgentModelChoice {
  const active = activeModel || null
  const wish = typeof requested === 'string' ? requested.trim() : ''
  if (!wish || isFillerModelName(wish)) return { model: active }
  const hit = resolveRequestedModel(wish, installed)
  if (!device.singleSlot) return hit ? { model: hit.name } : { model: null, missing: wish }
  // A phone: the model of the chat, unless the wish is a cloud model that exists.
  if (hit && (hit.name === active || device.isCloud(hit.name))) return { model: hit.name }
  return { model: active }
}
