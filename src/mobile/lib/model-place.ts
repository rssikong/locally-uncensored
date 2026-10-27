/**
 * Where a model answers from, asked by its stored name.
 *
 *   device  the engine on this phone
 *   own     a provider the user added with an own key (Anthropic, or an
 *           extra OpenAI-compatible slot `openai-<slug>`)
 *   cloud   LU Cloud
 *
 * Three answers and not two on purpose. "Not LU Cloud" used to mean "on this
 * phone", which was true while a phone had nothing else. With the user's own
 * providers in the model list it is not: such a model needs the network,
 * its content leaves the phone, and the engine has nothing to load for it.
 */
import { isCompatProviderId } from '../../api/providers/compat-id'
import { getProviderIdFromModel } from '../../api/providers/model-name'

export type ModelPlace = 'device' | 'own' | 'cloud'

export function placeOfProvider(provider: string | null | undefined): ModelPlace {
  if (provider === 'lu-cloud') return 'cloud'
  if (provider === 'anthropic' || (!!provider && isCompatProviderId(provider))) return 'own'
  return 'device'
}

export function modelPlace(name: string | null | undefined): ModelPlace | null {
  if (!name) return null
  return placeOfProvider(getProviderIdFromModel(name))
}

/** True only for a model the engine of this phone runs. */
export function isDeviceModel(name: string | null | undefined): boolean {
  return modelPlace(name) === 'device'
}

/** True when a send to this model leaves the phone: LU Cloud or an own provider. */
export function leavesPhone(name: string | null | undefined): boolean {
  const place = modelPlace(name)
  return place === 'cloud' || place === 'own'
}
