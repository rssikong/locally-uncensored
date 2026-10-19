// GH #161 (2026-10-12): a character trained for Z Image was picked under
// "Use character" while a Qwen image model was selected. The model stayed, the
// run left the character out with a line that was gone a second later, and
// the image showed somebody else. This file decides which installed model a
// local character runs on, and what a run says when it cannot.
import { TRAINER_BASE_FILES, parseLocalCharacterLora } from '../api/trainer'
import type { ClassifiedModel, ModelType } from '../api/comfyui'
import { knownLora } from './lora-stack'

type ListedModel = Pick<ClassifiedModel, 'name' | 'type'>

/** The model family a local character was trained for, with its label. */
export function characterFamily(file: string): { family: ModelType; label: string } | null {
  if (!parseLocalCharacterLora(file)) return null
  const known = knownLora(file)
  return known ? { family: known.family, label: known.familyLabel.replace('-', ' ') } : null
}

const fileOf = (name: string) => name.replace(/^.*[\\/]/, '').toLowerCase()

/**
 * The installed model a character runs on, or null when none of its family is
 * installed. The picked model stays when it already fits. Otherwise the file
 * the trainer trained on comes first, then any model of the family.
 */
export function characterBaseModel<T extends ListedModel>(file: string, list: T[], current: string): T | null {
  const family = characterFamily(file)?.family
  if (!family) return null
  const fitting = list.filter((m) => m.type === family)
  return fitting.find((m) => m.name === current)
    ?? fitting.find((m) => fileOf(m.name) === TRAINER_BASE_FILES[0].filename)
    ?? fitting[0]
    ?? null
}

/**
 * Why a run with this character cannot start on this model, or null when it
 * can. A model the app could not classify is let through: that would be a
 * guess about the model.
 */
export function characterRunBlock(file: string, modelType: ModelType, installed: boolean): string | null {
  const family = characterFamily(file)
  if (!family || modelType === family.family || modelType === 'unknown') return null
  return installed
    ? `This character was trained for ${family.label}. Pick a ${family.label} model to use it.`
    : `This character was trained for ${family.label}, and no ${family.label} model is installed. Get one in the Model Manager to use it.`
}
