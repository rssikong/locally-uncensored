/**
 * How a model is named and where it runs, for the pages of this strand that
 * list several models (Compare, Group chat).
 */
import { displayModelName } from '../../../../api/providers/model-name'
import { useModelStore } from '../../../../stores/modelStore'
import type { AIModel } from '../../../../types/models'
import { deviceFileLabel } from '../../../lib/model-facts'
import { isDeviceModel } from '../../../lib/model-place'
import { cloudModelShownAmong, storePolicy } from '../../../policy'

/**
 * Pure: the name a user reads for a model id. A model of this phone carries the name of the catalogue,
 * the one it was chosen by, and never its file name or its routed id (acceptance on Android, N1).
 */
export function modelLabel(name: string, models: ReadonlyArray<AIModel>): string {
  if (!name) return ''
  // The one naming of a file of this phone: also another packing of a catalogue model (lib/model-facts.ts).
  const known = isDeviceModel(name) ? deviceFileLabel(displayModelName(name)) : undefined
  if (known) return known
  const row = models.find((m) => m.name === name)
  // A store build names a model that does not run on this phone without a word it may not show, and never by its id.
  if (!isDeviceModel(name) && !storePolicy().unfilteredMarketing) return cloudModelShownAmong(models, row ?? { name }, storePolicy()).name
  if (row && 'displayName' in row && typeof row.displayName === 'string' && row.displayName) return row.displayName
  return displayModelName(name)
}

export function useModelLabel(name: string): string {
  return useModelStore((s) => modelLabel(name, s.models))
}

export function whereOf(name: string): 'local' | 'cloud' {
  return isDeviceModel(name) ? 'local' : 'cloud'
}

/** Pure: how many of these models run on this phone. From two up they take turns in the one engine. */
export function localCount(names: ReadonlyArray<string>): number {
  return names.filter((n) => isDeviceModel(n)).length
}
