/**
 * What the active model can do, for the switches of this strand. The same
 * precedence the desktop composer uses: what the catalogue declares wins
 * over the guess from the name.
 */
import { useModelStore } from '../../../../stores/modelStore'
import { useSettingsStore } from '../../../../stores/settingsStore'
import { clampEffort, DEFAULT_EFFORT, effortChoices, type EffortLevel } from '../../../../lib/effort'
import { isThinkingCompatible } from '../../../../lib/model-compatibility'
import { isDeviceModel } from '../../../lib/model-place'

export interface ThinkingState {
  /** The model thinks whatever the switch says. */
  lockedOn: boolean
  /** The switch has an effect. */
  canThink: boolean
  /** Thinking happens on the next send. */
  on: boolean
  /** The rungs this model declares, empty when it declares none. */
  effortSteps: EffortLevel[]
  /** The rung that goes on the wire. */
  effort: EffortLevel
}

export function useThinkingState(): ThinkingState {
  const activeModel = useModelStore((s) => s.activeModel)
  const meta = useModelStore((s) => s.models.find((m) => m.name === s.activeModel))
  const thinkingEnabled = useSettingsStore((s) => s.settings.thinkingEnabled)
  const reasoningEffort = useSettingsStore((s) => s.settings.reasoningEffort)
  const thinkMode = meta && 'thinkMode' in meta ? meta.thinkMode : undefined
  const lockedOn = thinkMode === 'always'
  const canThink = thinkMode ? thinkMode === 'toggle' : isThinkingCompatible(activeModel)
  const levels = meta && 'effortLevels' in meta ? meta.effortLevels : undefined
  const fallback = meta && 'effortDefault' in meta ? meta.effortDefault : undefined
  const effortSteps = effortChoices(levels)
  return {
    lockedOn,
    canThink,
    on: lockedOn || (thinkingEnabled && canThink),
    effortSteps,
    effort: clampEffort(levels, reasoningEffort ?? DEFAULT_EFFORT, fallback) as EffortLevel,
  }
}

/** Is the active model one that runs on this phone? */
export function useActiveModelIsLocal(): boolean {
  const activeModel = useModelStore((s) => s.activeModel)
  if (!activeModel) return true
  return isDeviceModel(activeModel)
}
