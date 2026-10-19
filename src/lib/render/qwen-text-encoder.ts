// Which text encoder a local Qwen-Image 2.1 run loads: the pure half. No
// stores, no network; api/comfyui.ts (findMatchingCLIP) asks it for the file.
//
// Qwen-Image 2.1 reads the prompt with a Qwen3-VL 8B encoder. Read off the
// sources on 2026-10-03:
//   - Comfy-Org/Qwen-Image-2.1 ships the official one as a single file,
//     text_encoders/qwen3vl_8b_int8_convrot.safetensors.
//   - pottokao/Qwen-Image-2.1-Text-Encoder-Heretic-int8-convrot ships the same
//     encoder with the refusal direction removed (Heretic, on o_proj and
//     down_proj), in the same format with the same tensor names:
//     qwen3vl_8b_int8_convrot_heretic.safetensors. Only the text encoder is
//     changed, the image model and the VAE are not.
// Both load with the stock CLIPLoader (type qwen_image) and go into the same
// TextEncodeQwenImage21 node, so everything the family does works with either.

/** The official file, or a community edition with the refusals removed. */
export type QwenEncoderVariant = 'official' | 'unfiltered'

export interface QwenEncoderFile {
  /** The name ComfyUI lists, with its subfolder when it has one. */
  file: string
  variant: QwenEncoderVariant
}

const ENCODER_NAME = /qwen3[._-]?vl[._-]?8b/i
const UNFILTERED_NAME = /heretic|abliterat/i

/** Is this text encoder file Qwen-Image 2.1's encoder tier (Qwen3-VL 8B), and
 *  which edition? Krea 2 uses the 4B sibling under a near-identical name and
 *  MiniMax H3 the 32B one; both have other embedding dimensions and are no
 *  match. The name is the only thing ComfyUI tells us. */
export function qwenEncoderFile(file: string): QwenEncoderFile | null {
  const base = file.split(/[\\/]/).pop() ?? file
  if (!ENCODER_NAME.test(base)) return null
  return { file, variant: UNFILTERED_NAME.test(base) ? 'unfiltered' : 'official' }
}

/** Which encoder reads the prompt. 'auto' is the default: the official one
 *  when it is there, otherwise the edition that is. */
export type QwenEncoderChoice = 'auto' | QwenEncoderVariant

export const QWEN_ENCODER_CHOICES: readonly QwenEncoderChoice[] = ['auto', 'official', 'unfiltered']

export interface QwenEncoderOption {
  id: QwenEncoderVariant
  label: string
}

const ENCODER_LABEL: Record<QwenEncoderVariant, string> = {
  official: 'Qwen3-VL 8B',
  unfiltered: 'Qwen3-VL 8B, No Filter',
}

/** One file per installed edition, official first. */
function installed(textEncoders: readonly string[]): QwenEncoderFile[] {
  const files = textEncoders.map(qwenEncoderFile).filter((f): f is QwenEncoderFile => f !== null)
  const first = (variant: QwenEncoderVariant) => files.find((f) => f.variant === variant)
  return [first('official'), first('unfiltered')].filter((f): f is QwenEncoderFile => !!f)
}

/** What the setting lets the user choose between. Empty unless both editions
 *  are installed: with one there is nothing to choose, it reads the prompt. */
export function qwenEncoderOptions(textEncoders: readonly string[]): QwenEncoderOption[] {
  const files = installed(textEncoders)
  if (files.length < 2) return []
  return files.map((f) => ({ id: f.variant, label: ENCODER_LABEL[f.variant] }))
}

/** The encoder file a run loads, or null when none is installed. The user's
 *  choice wins when that edition is installed; otherwise the first one there. */
export function pickQwenEncoder(textEncoders: readonly string[], choice: QwenEncoderChoice = 'auto'): QwenEncoderFile | null {
  const files = installed(textEncoders)
  return files.find((f) => f.variant === choice) ?? files[0] ?? null
}

/** Discord report (3.0.7): next to Improve my prompt the row read like the
 *  same job. It says what it is and what it is not. */
export const QWEN_ENCODER_HELP =
  'Part of the image model: it reads your prompt for Qwen-Image 2.1 on every run. Improve my prompt is a separate step that rewrites the prompt before this. The No Filter edition has its refusal direction removed by the community (Heretic). The image model is the same.'
