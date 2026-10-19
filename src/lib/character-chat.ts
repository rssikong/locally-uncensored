// The `character` argument of image_generate and video_generate in the local
// chat (3.0.7, characters everywhere). The chat model names a character, the
// app finds its LoRA, the model it was trained for and its trigger word. A
// video goes through the same chain as Create (lib/characters.ts,
// characterStartImage): an image of the character first, the clip from it.
import type { ModelType } from '../api/comfyui'
import {
  CharacterLookupError, characterLoraFile, characterStartImage, resolveCharacter, withTriggerWord,
  type CharacterRef,
} from './characters'
import { characterBaseModel } from './character-base'
import { characterImagePrompt } from './character-run'
import { defaultLoraStrength } from './lora-strength'

/** The tool arguments as the media tools read them (VramHandoffArgs). */
export type MediaArgs = Record<string, unknown> & { prompt?: string; model?: string; inputImage?: string }

export interface CharacterChatDeps {
  /** The characters on this machine. */
  characters: () => Promise<CharacterRef[]>
  /** The installed image models. */
  imageModels: () => Promise<{ name: string; type: ModelType }[]>
  /** One image on the chat's image path; returns the tool's result line. */
  renderImage: (args: MediaArgs) => Promise<string>
  /** True when the result line is a failure. */
  failed: (result: string) => boolean
  /** Can this video model start from an image? */
  takesStartImage: (model: string) => boolean
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v])

/** The arguments with the character's LoRA added to whatever the model asked
 *  for, once, with its strength in the same place. */
export function withCharacterLoraArgs(args: MediaArgs, file: string, strength: number): MediaArgs {
  const loras = asList(args.lora).filter((x): x is string => typeof x === 'string' && !!x)
  if (loras.some((l) => l === file || l.replace(/^.*[\\/]/, '') === file.replace(/^.*[\\/]/, ''))) return args
  const strengths = args.loraStrength
  const next: MediaArgs = { ...args, lora: [...loras, file] }
  if (Array.isArray(strengths)) next.loraStrength = [...strengths, ...Array(Math.max(0, loras.length - strengths.length)).fill(1), strength]
  else if (typeof strengths === 'number') next.loraStrength = [...Array(loras.length).fill(strengths), strength]
  else next.loraStrength = [...Array(loras.length).fill(1), strength]
  return next
}

/** The image file a result line names ("Image generated: <file> (prompt: ..."). */
export function generatedFile(result: string): string | null {
  return /generated: (.+?) \(prompt:/.exec(result)?.[1] ?? null
}

async function lookup(query: string, deps: CharacterChatDeps): Promise<{ ref: CharacterRef; file: string } | string> {
  try {
    const ref = resolveCharacter(query, await deps.characters())
    const file = characterLoraFile(ref)
    if (!file) return `Error: "${ref.name}" is an LU Cloud character. Local generation needs a character trained on this machine.`
    return { ref, file }
  } catch (e) {
    if (e instanceof CharacterLookupError) return `Error: ${e.message}`
    throw e
  }
}

/**
 * image_generate with a character: the arguments the image path runs with
 * (its model, its LoRA, the trigger word in the prompt), or the error line
 * for the chat model.
 */
export async function characterImageArgs(query: string, args: MediaArgs, deps: CharacterChatDeps): Promise<MediaArgs | string> {
  const found = await lookup(query, deps)
  if (typeof found === 'string') return found
  const base = characterBaseModel(found.file, await deps.imageModels(), typeof args.model === 'string' ? args.model : '')
  if (!base) return `Error: "${found.ref.name}" was trained for Z Image, and no Z Image model is installed. Get one in the Model Manager to use it.`
  return withCharacterLoraArgs(
    { ...args, model: base.name, prompt: withTriggerWord(String(args.prompt ?? ''), found.ref.triggerWord) },
    found.file, defaultLoraStrength(found.file),
  )
}

/**
 * video_generate with a character: step 1 renders the character's image
 * through characterStartImage, and the clip starts from it. Returns the video
 * arguments with `inputImage` set, or the error line for the chat model.
 */
export async function characterVideoArgs(query: string, args: MediaArgs, deps: CharacterChatDeps): Promise<MediaArgs | string> {
  const found = await lookup(query, deps)
  if (typeof found === 'string') return found
  if (typeof args.model === 'string' && args.model && !deps.takesStartImage(args.model)) {
    return `Error: ${args.model} makes video from text only and cannot start from a character. Omit model, or pass one that takes a start image.`
  }
  const prompt = String(args.prompt ?? '')
  try {
    const start = await characterStartImage(found.ref, characterImagePrompt('video', prompt, found.ref.triggerWord), {
      models: await deps.imageModels(),
      renderImage: async (req) => {
        const out = await deps.renderImage({
          prompt: req.prompt, model: req.model,
          ...(typeof args.negativePrompt === 'string' ? { negativePrompt: args.negativePrompt } : {}),
          lora: [req.lora.name], loraStrength: [req.lora.strength],
        })
        const file = deps.failed(out) ? null : generatedFile(out)
        if (!file) throw new Error(`The image of ${found.ref.name} did not come out, so the video did not start. ${out}`.trim())
        return { filename: file, url: '', width: 0, height: 0 }
      },
    })
    return { ...args, inputImage: start.filename }
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`
  }
}

/** The `character` property of both media tools. */
export const CHARACTER_ARG_SCHEMA = {
  type: 'string',
  description: 'Optional. Name or trigger word of a trained character. LU sets its model, LoRA and trigger word. An unknown name returns the list.',
} as const
