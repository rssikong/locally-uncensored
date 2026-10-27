import { declaredVision, isVisionCompatible } from '../../../../lib/model-compatibility'

/** Can the chosen model read images? What the model list declares wins over the guess from the name. */
export function modelReadsImages(name: string | null, models: ReadonlyArray<{ name: string }>): boolean {
  if (!name) return false
  return declaredVision(models.find((m) => m.name === name)) ?? isVisionCompatible(name)
}
