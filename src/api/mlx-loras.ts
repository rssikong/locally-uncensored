/**
 * The LoRA folder of the Mac's image engine (src-tauri commands/mlx_loras.rs).
 *
 * On Windows and Linux a LoRA is a file in ComfyUI's models/loras and ComfyUI
 * lists it. The Mac has no ComfyUI: its second image engine (mflux) is handed
 * LoRA files with each run. They live in a folder of their own in the app's
 * data folder, and a run names them by their path below it.
 */
import { invokeMedia } from './mlx-invoke'

/** How a file names its matrices, read from its header. */
export type MlxLoraKeys = 'peft' | 'kohya' | 'other' | 'unreadable'

/**
 * What a file says about the weight of its layers, read from its header. A
 * layer may carry an alpha and then counts alpha / rank times its matrices.
 * `uniform`: one share for every layer. `mixed`: the layers differ.
 */
export type MlxLoraAlpha = 'none' | 'uniform' | 'mixed'

export interface MlxLora {
  /** The path below the LoRA folder. This is what a run sends. */
  name: string
  sizeBytes: number
  keys: MlxLoraKeys
  alpha?: MlxLoraAlpha
}

export interface MlxLoraListing {
  /** The folder itself, for the line that says where the files go. */
  dir: string
  loras: MlxLora[]
}

export async function listMlxLoras(): Promise<MlxLoraListing> {
  const listing = await invokeMedia<MlxLoraListing>('mlx_loras')
  return { dir: listing?.dir ?? '', loras: Array.isArray(listing?.loras) ? listing.loras : [] }
}

/** Show the LoRA folder in Finder. It is made first if it is not there. */
export async function openMlxLoraFolder(): Promise<void> {
  await invokeMedia('mlx_loras_open_folder')
}

/** Take one file out of the LoRA folder. It moves to the Trash. */
export async function deleteMlxLora(name: string): Promise<void> {
  await invokeMedia('mlx_lora_delete', { name })
}

/** Fired when the folder changed through the app (a download, a delete), so
 *  the stack in Create and the Model Manager read it again. */
export const MLX_LORAS_CHANGED = 'mlx-loras-changed'

/**
 * What a row says about a file whose naming not every model reads, or null.
 * Qwen-Image 2.1 reads lora_A / lora_B keys alone; the other quantized packs
 * also read the Kohya naming.
 */
export function mlxLoraKeysNote(keys: MlxLoraKeys): string | null {
  if (keys === 'kohya') return 'Kohya format. Z-Image, FLUX.2 and Qwen-Image read it, Qwen-Image 2.1 does not.'
  if (keys === 'other') return 'Not a plain LoRA. The image engine may refuse it.'
  if (keys === 'unreadable') return 'Not a readable safetensors file. It may be an incomplete download.'
  return null
}

/**
 * What a row says about a file whose layers carry different alphas, or null.
 *
 * The image engine does not read an alpha for Qwen-Image 2.1. Where a file
 * has one share for all its layers, the run hands the engine the strength
 * times that share (`lora_files` in `image_mflux.rs`), and the picture is
 * the one ComfyUI makes of the same file and number. Nothing to say then.
 * Where the layers differ, no single strength stands for them, the file runs
 * at the strength that was set, and the row says so.
 */
export function mlxLoraAlphaNote(alpha: MlxLoraAlpha | undefined): string | null {
  if (alpha === 'mixed') return 'Sets its own weight for each layer. Qwen-Image 2.1 on a Mac runs every layer at the strength you set, which can come out stronger than in ComfyUI.'
  return null
}

/**
 * The image models of the Mac that take a LoRA, as the customer reads them
 * in Create and in the Model Manager. These are the packs of the second
 * image engine (`mlx.rs`, every entry with `mflux: Some`), and their names
 * all end in "4-bit" or "8-bit"; the models of the first engine, SD Turbo
 * and "Z-Image Turbo" without a bit count among them, have no place for a
 * LoRA. The hints said "one of the quantized MLX image models", which is
 * nothing a customer reads anywhere: with SD Turbo picked, Create has no
 * Expert group at all, and the hint did not say why.
 */
export const MAC_LORA_MODEL_FAMILIES = ['Qwen-Image 2.1', 'Qwen-Image 2512', 'Z-Image Turbo', 'FLUX.2 klein 4B'] as const
export const MAC_LORA_MODELS = `an image model whose name ends in 4-bit or 8-bit (${MAC_LORA_MODEL_FAMILIES.join(', ')})`

/**
 * Why a run with the picked model would refuse this file, or null.
 *
 * The run itself refuses it before the model loads (`lora_files` in
 * `image_mflux.rs`), with a sentence, after the click on Create. The stack
 * knows the same from the folder listing and says it on the row, before the
 * click. `qwen21` is true for a model of the Qwen-Image 2.1 family, which
 * reads lora_A / lora_B keys alone; the other families also read the Kohya
 * naming and judge a file themselves.
 *
 * `video` is the Mac's video engine the picked model runs on: an LTX of the
 * second engine reads lora_A / lora_B keys alone, as Qwen-Image 2.1 does,
 * and a Wan reads both namings (`lora_stack` in video.rs). The run checks
 * more than the listing carries (which layers the keys name), and says it.
 */
export function mlxLoraRefusal(keys: MlxLoraKeys | undefined, qwen21: boolean, video?: 'ltx' | 'wan'): { label: string; title: string } | null {
  if (keys === 'unreadable') return { label: 'not readable', title: 'Not a readable safetensors file. It may be an incomplete download.' }
  if (qwen21 && keys === 'kohya') return { label: 'Kohya format', title: 'Qwen-Image 2.1 reads LoRAs with lora_A and lora_B keys, the diffusers and ComfyUI format. This file is in the Kohya format, which Z-Image, FLUX.2 and Qwen-Image read.' }
  if (qwen21 && keys === 'other') return { label: 'not a plain LoRA', title: 'Qwen-Image 2.1 reads plain LoRAs with lora_A and lora_B keys only.' }
  if (video === 'ltx' && keys === 'kohya') return { label: 'Kohya format', title: 'LTX on a Mac reads LoRAs with lora_A and lora_B keys, the format of the LTX trainer and of ComfyUI. This file is in the Kohya format.' }
  if (video && keys === 'other') return { label: 'not a plain LoRA', title: video === 'ltx' ? 'LTX on a Mac reads plain LoRAs with lora_A and lora_B keys only.' : 'Wan on a Mac reads plain LoRAs with lora_A and lora_B or lora_down and lora_up keys.' }
  return null
}
