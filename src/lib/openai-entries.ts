/**
 * GitHub #173: where an OpenAI-compatible backend goes when the user adds it.
 *
 * Until 3.0.7 every OpenAI-protocol backend shared the one `openai` slot, so
 * adding KoboldCpp pushed LM Studio out ("took over the local OpenAI
 * compatible slot, which holds one backend at a time"), and a group chat could
 * never mix a model from each. The slot stays (it is where the LU Engine
 * lives, and every stored `openai::<model>` points at it), and next to it the
 * provider store keeps a list of additional entries, each with its own
 * address, key and model list.
 *
 * The rule for a new backend, in one place so the Settings list, the startup
 * detection and the tests ask the same thing:
 *
 *   - Not OpenAI-protocol (Ollama, Anthropic): its own fixed slot, as always.
 *   - The LU Engine: only the slot can hold it, so the slot, as always.
 *   - Already configured, in the slot or as an entry: that one, no double.
 *   - The slot is on and serves some other backend: a new entry next to it.
 *   - The slot is off or unused: the slot, exactly as before.
 *
 * Pure: reads the configs it is handed and changes nothing.
 */

import type { ProviderConfig } from '../api/providers/types'
import { endpointKey } from './extra-model-ids'

export interface IncomingBackend {
  providerId: 'ollama' | 'openai' | 'anthropic' | 'lu-cloud'
  baseUrl: string
  managed?: boolean
}

export type BackendPlacement =
  | { kind: 'slot' }
  | { kind: 'entry-new' }
  | { kind: 'entry-existing'; entryId: string }

/** Same server: the address compared without case and trailing slash. An
 *  empty address (the Custom preset before anything is typed) matches nothing. */
export function sameEndpoint(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  return endpointKey(a) === endpointKey(b)
}

export function placeBackend(
  slot: ProviderConfig | undefined,
  entries: readonly ProviderConfig[],
  incoming: IncomingBackend,
): BackendPlacement {
  if (incoming.providerId !== 'openai') return { kind: 'slot' }
  if (incoming.managed) return { kind: 'slot' }
  const existing = entries.find((e) => e.entryId && sameEndpoint(e.baseUrl, incoming.baseUrl))
  if (existing?.entryId) return { kind: 'entry-existing', entryId: existing.entryId }
  if (!slot || !slot.enabled) return { kind: 'slot' }
  if (!slot.managed && sameEndpoint(slot.baseUrl, incoming.baseUrl)) return { kind: 'slot' }
  return { kind: 'entry-new' }
}

/** Is this address already served, by the slot or by an entry. */
export function endpointConfigured(
  slot: ProviderConfig | undefined,
  entries: readonly ProviderConfig[],
  baseUrl: string,
): boolean {
  if (slot && sameEndpoint(slot.baseUrl, baseUrl)) return true
  return entries.some((e) => sameEndpoint(e.baseUrl, baseUrl))
}
