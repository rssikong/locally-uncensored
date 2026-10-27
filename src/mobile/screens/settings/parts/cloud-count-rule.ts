/**
 * The one rule that says what counts as a model on the LU Cloud page (E3).
 *
 * Decision D1 of mobile-docs/plaene/LU-CLOUD-SEITE.md (David, 17.10.2026):
 * the models a customer can pick for chat, image and video. A model that
 * stands in the catalogue twice under another name counts once, and a tool
 * that works on a finished result (extend, upscale, edit, lip sync, motion,
 * restyle, sound, training) is not a model of its own kind.
 *
 * In detail, for image and video:
 *  - classic entries without `ops`: the Image, Video and Animate pickers;
 *  - studio entries that make a picture from words (studioTextToImage), a
 *    clip from words (studioTextToVideo), a clip from one still
 *    (studioImageToVideo) or a clip from reference pictures
 *    (studioReferenceVideo);
 *  - never a studio twin (`sourceModel`): the same endpoint under a new name;
 *  - one name, one model: entries of the same kind whose names differ only by
 *    a mode (" • Reference"), an add on (" + Character", " + Style LoRA") or a
 *    note in brackets ("(fast)") count once. "LTX 2.5" text to video and
 *    "LTX 2.5" image to video are one model.
 * Chat: every LU Cloud chat model of the list, once per id.
 *
 * Pure. Used twice: by the guard that recounts the numbers in cloud-counts.ts
 * from the catalogue this app carries, and by the page, which counts the lists
 * a signed in account really sees.
 */
import { STUDIO_MODELS } from '../../../../lib/render/studio-contract'
import { studioImageToVideo, studioReferenceVideo, studioTextToImage, studioTextToVideo } from '../../../../lib/render/studio-roles'

export interface CountableCreateModel {
  id: string
  label: string
  kind: string
  ops?: readonly string[]
  t2v?: boolean
  i2v?: boolean
}

let makers: { image: Set<string>; video: Set<string> } | null = null

/** The studio ids that make a picture or a clip, by the roles of studio-roles.ts. */
function studioMakers(): { image: Set<string>; video: Set<string> } {
  if (!makers) {
    makers = {
      image: new Set(studioTextToImage()),
      video: new Set([...studioTextToVideo(), ...studioImageToVideo(), ...studioReferenceVideo()]),
    }
  }
  return makers
}

/** Pure: the name a model is told apart by, without mode, add on and note. */
export function modelKey(label: string): string {
  return label
    .split(' • ')[0]
    .split(' + ')[0]
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Pure: does this entry make an image or a clip a customer picks, and of which kind. */
export function countedKind(model: CountableCreateModel): 'image' | 'video' | null {
  const studio = STUDIO_MODELS[model.id]
  if (studio) {
    if (studio.sourceModel) return null
    const m = studioMakers()
    if (studio.kind === 'image' && m.image.has(model.id)) return 'image'
    if (studio.kind === 'video' && m.video.has(model.id)) return 'video'
    return null
  }
  if (model.ops && model.ops.length) return null
  if (model.kind === 'image') return 'image'
  if (model.kind === 'video' && (model.t2v !== false || model.i2v !== false)) return 'video'
  return null
}

/** Pure: the image and video models of a Create catalogue, counted by the rule above. */
export function countCreateModels(models: readonly CountableCreateModel[]): { image: number; video: number } {
  const seen = { image: new Set<string>(), video: new Set<string>() }
  for (const model of models) {
    const kind = countedKind(model)
    if (kind) seen[kind].add(modelKey(STUDIO_MODELS[model.id]?.label ?? model.label))
  }
  return { image: seen.image.size, video: seen.video.size }
}

/** Pure: the chat models of a list, once per id. */
export function countChatModels(ids: Iterable<string>): number {
  return new Set(ids).size
}
