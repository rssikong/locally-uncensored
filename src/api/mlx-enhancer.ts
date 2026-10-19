// The Qwen-Image 2.1 prompt enhancer on a Mac (GH #148): the run.
//
// Windows runs the enhancer as a ComfyUI job (api/qwen-enhancer.ts). A Mac has
// no ComfyUI: the MLX edition of the same model runs as a process of its own
// in Rust (src-tauri/src/commands/mlx_enhancer.rs), on the official system
// prompt and the sampling Windows uses, and in the one place an image takes.
// What becomes a prompt of its answer is decided here, by the rules Windows
// applies (lib/render/qwen-enhancer.ts).

import { invokeMedia } from './mlx-invoke'
import { mlxEnhancedOutcome, type QwenEnhancerMode } from '../lib/render/qwen-enhancer'
import type { ImproveOutcome } from '../lib/render/improve-prompt'

export interface MlxEnhanceRequest {
  /** The catalogue id of the installed enhancer (`mlx_image_models`). */
  model: string
  mode: QwenEnhancerMode
  prompt: string
  /** Edit only: the staged images of the edit, the source first, in the
   *  order the picture's run reads them. */
  images?: string[]
  seed: number
}

let runsNamed = 0
/** A name no other run of this session has. Cancel names it. */
function nameRun(): string {
  runsNamed += 1
  return `enhance-${Date.now().toString(36)}-${runsNamed}`
}

/** The seed as Rust takes it: a whole number from 0 on. */
function seedFor(seed: number): number {
  return Number.isFinite(seed) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(seed))) : 0
}

/**
 * Rewrite the prompt with the enhancer. Never throws: a refusal of the
 * backend, an engine that stopped or Cancel all answer `failed`, and the run
 * goes on with the user's own prompt (Cancel is the caller's to notice on its
 * signal). The enhancer's process has ended when this returns, so the image
 * model that follows has the memory to itself.
 */
export async function enhancePromptOnMac(req: MlxEnhanceRequest, signal?: AbortSignal): Promise<ImproveOutcome> {
  if (signal?.aborted) return { status: 'failed' }
  const run = nameRun()
  // The request may not have arrived when Cancel is pressed, so the stop is
  // asked for again until the run has ended. It names this run alone.
  const stop = () => { void invokeMedia('mlx_generate_cancel', { run }).catch(() => null) }
  signal?.addEventListener('abort', stop)
  const again = setInterval(() => { if (signal?.aborted) stop() }, 1000)
  try {
    const answer = await invokeMedia<{ text?: unknown }>('mlx_enhance_prompt', {
      model: req.model,
      prompt: req.prompt,
      images: req.mode === 'i2i' ? (req.images ?? []).filter(Boolean) : [],
      seed: seedFor(req.seed),
      run,
    })
    if (signal?.aborted) return { status: 'failed' }
    return mlxEnhancedOutcome(typeof answer?.text === 'string' ? answer.text : null, req.prompt)
  } catch {
    return { status: 'failed' }
  } finally {
    clearInterval(again)
    signal?.removeEventListener('abort', stop)
  }
}
