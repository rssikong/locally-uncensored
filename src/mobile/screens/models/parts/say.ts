/**
 * What the engine pages say after a setting changed (E13, E13.8).
 */
import { MODELS_STRINGS as S } from '../../../strings/models'
import { toast } from '../../../ui'
import type { ApplyOutcome } from './engine'

/** Applied by loading the model again, saved for the next load, or the model did not come back. */
export function sayApplied(outcome: ApplyOutcome, applied: string = S.engine.settingsApplied): void {
  if (outcome === 'saved') toast(S.engine.contextSaved, { testid: 'engine-saved' })
  else if (outcome === 'applied') toast(applied, { testid: 'engine-applied' })
  else toast(S.engine.restartFailed, { tone: 'error', testid: 'engine-restart-failed' })
}
