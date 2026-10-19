// Characters everywhere in Create (3.0.7). A character trained in Character
// Studio used to work in one place only: Create, Character, Use character,
// with a Z Image model. This file is what every other place reads: the list,
// the lookup by name, the prompt rule, and the one chain that turns a
// character into a start image for a video.
//
// The interface is shared with the Mac (MLX) side, which brings its own LoRA
// list and its own image run through the same parameters:
//
//   CharacterRef      { id, name, triggerWord, family }
//                     id: 'local:<file>' (ComfyUI loras), 'mlx:<file>' (Mac
//                     LoRA folder) or the LU Cloud id. family: the ModelType
//                     'zimage' for a local character. The cloud shelf keeps
//                     the server's own word ('z-image', 'flux', ...), because
//                     the cloud run picks its endpoint by it.
//   localLoraNames()  the LoRA names of this host (ComfyUI or the Mac folder)
//   listLocalCharacters(names)
//   resolveCharacter(query, list)
//   characterStartImage(ref, prompt, deps)  deps.renderImage does the render
import { parseLocalCharacterLora } from '../api/trainer'
import type { ModelType } from '../api/comfyui'
import type { ImageRef } from './image-ref'
import { LOCAL_PREFIX, MLX_PREFIX, characterLoraFile, type CharacterRef } from './character-ref'
import { characterBaseModel, characterFamily } from './character-base'
import { defaultLoraStrength } from './lora-strength'

export {
  LOCAL_PREFIX,
  MLX_PREFIX,
  characterLoraFile,
  isLocalCharacter,
  type CharacterRef,
} from './character-ref'

/** The family as a ModelType. Reads the old 'z-image' too. */
export function characterModelType(ref: Pick<CharacterRef, 'family'>): ModelType | null {
  const f = ref.family.toLowerCase().replace(/[-_\s]/g, '')
  return f === 'zimage' ? 'zimage' : null
}

/** The ref for a LoRA file, or null when it is not a character file. */
export function characterFromLora(file: string, prefix: string = LOCAL_PREFIX): CharacterRef | null {
  const parsed = parseLocalCharacterLora(file)
  if (!parsed) return null
  const family = characterFamily(parsed.file)?.family ?? 'zimage'
  return { id: `${prefix}${parsed.file}`, name: parsed.trigger, triggerWord: parsed.trigger, family }
}

/**
 * The LoRA names of this host: the Mac's LoRA folder on Apple Silicon, the
 * list ComfyUI reports everywhere else. Loaded late so a test or a caller
 * that brings its own list pulls in neither backend.
 */
export async function localLoraNames(): Promise<string[]> {
  const { isMlxImageHost } = await import('../api/mlx-image')
  if (isMlxImageHost()) {
    const { listMlxLoras } = await import('../api/mlx-loras')
    return (await listMlxLoras()).loras.map((l) => l.name)
  }
  const { getLoraModels } = await import('../api/comfyui')
  return getLoraModels()
}

/** The prefix this host's character ids carry. */
export async function localCharacterPrefix(): Promise<string> {
  const { isMlxImageHost } = await import('../api/mlx-image')
  return isMlxImageHost() ? MLX_PREFIX : LOCAL_PREFIX
}

/**
 * The characters on this machine, from a LoRA list. A file counts when the
 * trainer named it (char_<trigger>_zimage). Sorted by name, one per file.
 */
export async function listLocalCharacters(
  names: () => Promise<string[]> = localLoraNames,
  prefix?: string,
): Promise<CharacterRef[]> {
  const idPrefix = prefix ?? await localCharacterPrefix()
  const seen = new Set<string>()
  const out: CharacterRef[] = []
  for (const n of await names()) {
    const ref = characterFromLora(n, idPrefix)
    if (ref && !seen.has(ref.id)) { seen.add(ref.id); out.push(ref) }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** The names a message lists, as in "anna, ben". */
export function characterNames(list: CharacterRef[]): string {
  return list.map((c) => c.name).join(', ')
}

/** A lookup that found nothing, or more than one. The message names the
 *  characters there are, so a chat model can pick again. */
export class CharacterLookupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CharacterLookupError'
  }
}

/**
 * The character a name, trigger word or id means. Exact id first, then a
 * name or trigger word without regard to case. Anything else throws a
 * CharacterLookupError that lists the characters there are.
 */
export function resolveCharacter(query: string, list: CharacterRef[]): CharacterRef {
  const q = query.trim()
  if (!q) throw new CharacterLookupError(noneLine('No character named.', list))
  const byId = list.find((c) => c.id === q)
  if (byId) return byId
  const low = q.toLowerCase()
  const hits = list.filter((c) => c.name.toLowerCase() === low || c.triggerWord.toLowerCase() === low)
  const unique = [...new Map(hits.map((c) => [c.id, c])).values()]
  if (unique.length === 1) return unique[0]
  if (unique.length > 1) {
    throw new CharacterLookupError(`"${q}" fits more than one character: ${unique.map((c) => c.id).join(', ')}. Pass the id.`)
  }
  throw new CharacterLookupError(noneLine(`No character called "${q}".`, list))
}

function noneLine(head: string, list: CharacterRef[]): string {
  return list.length
    ? `${head} Available characters: ${characterNames(list)}.`
    : `${head} There are no trained characters on this machine yet. Train one in Create, Character.`
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** True when the prompt already holds the trigger word as a word. */
export function hasTriggerWord(prompt: string, trigger: string): boolean {
  if (!trigger.trim()) return true
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRe(trigger.trim())}($|[^\\p{L}\\p{N}_])`, 'iu').test(prompt)
}

/** The prompt with the trigger word in front, unless it is there already. */
export function withTriggerWord(prompt: string, trigger: string): string {
  const p = prompt.trim()
  if (hasTriggerWord(p, trigger)) return p
  return p ? `${trigger.trim()}, ${p}` : trigger.trim()
}

/**
 * The training photos of a character, for Edit references: data URLs of the
 * best photos a local run trained on, at most three (MAX_CHARACTER_PHOTOS in
 * lib/edit-references). No photos for a cloud character or when none are kept
 * (lib/character-photos).
 */
export async function photosOf(ref: CharacterRef): Promise<string[]> {
  const { trainingPhotos } = await import('./character-photos')
  return trainingPhotos(ref)
}

/** The progress lines of the two step chain. */
export const CHAIN_STEP_IMAGE = 'Step 1 of 2: character image'
export const CHAIN_STEP_VIDEO = 'Step 2 of 2: video'

/** What a start image render gets: the character's model, LoRA and prompt. */
export interface CharacterImageRequest {
  character: CharacterRef
  /** The prompt with the trigger word in it. */
  prompt: string
  /** The installed model the character was trained for. */
  model: string
  modelType: ModelType
  lora: { name: string; strength: number }
}

export interface CharacterStartImageDeps {
  /** Runs one image on this host's image path and returns it as a source.
   *  Throws on failure; an aborted run throws or returns after the abort. */
  renderImage: (req: CharacterImageRequest) => Promise<ImageRef>
  /** The installed image models, for the character's base model. */
  models: { name: string; type: ModelType }[]
  /** The image model picked right now; kept when it fits the character. */
  currentModel?: string
  /** The strength the user left the character's LoRA at. */
  strength?: number
  onProgress?: (line: string) => void
  signal?: AbortSignal
}

/** Stop pressed during step 1. */
export class CharacterChainCancelled extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'CharacterChainCancelled'
  }
}

/**
 * Step 1 of every video with a character: one image of the character, made
 * with its base model, its LoRA and its trigger word, handed back as the
 * source the video starts from. Each video lane calls this and nothing else.
 */
export async function characterStartImage(
  ref: CharacterRef,
  prompt: string,
  deps: CharacterStartImageDeps,
): Promise<ImageRef> {
  const file = characterLoraFile(ref)
  if (!file) throw new Error(`"${ref.name}" is an LU Cloud character. Local video runs need a character trained on this machine.`)
  const base = characterBaseModel(file, deps.models, deps.currentModel ?? '')
  if (!base) {
    throw new Error(`"${ref.name}" was trained for Z Image, and no Z Image model is installed. Get one in the Model Manager to use it.`)
  }
  if (deps.signal?.aborted) throw new CharacterChainCancelled()
  deps.onProgress?.(CHAIN_STEP_IMAGE)
  const image = await deps.renderImage({
    character: ref,
    prompt: withTriggerWord(prompt, ref.triggerWord),
    model: base.name,
    modelType: base.type,
    lora: { name: file, strength: deps.strength ?? defaultLoraStrength(file) },
  })
  if (deps.signal?.aborted) throw new CharacterChainCancelled()
  return image
}
