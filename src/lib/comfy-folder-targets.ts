/**
 * Which folder LU writes into per kind of ComfyUI model, and why (GH #183).
 *
 * A user had a shared model folder set up for ComfyUI and every download,
 * every trained LoRA and every render still landed in the instance folder.
 * Rust now reads what the user configured for ComfyUI itself
 * (`extra_model_paths.yaml`, the start script, ComfyUI Desktop; see
 * `src-tauri/src/commands/comfy_user_paths.rs`) and this is the readout for
 * Settings, so the folder LU picked is visible instead of a surprise.
 */

import { backendCall } from '../api/backend'
import { log } from './logger'

export interface ComfyFolderRow {
  key: string
  dir: string
  /** The config file the folder came from, `running ComfyUI`, or `ComfyUI folder`. */
  source: string
}

export interface ComfyFolderTargets {
  shown: boolean
  models: ComfyFolderRow[]
  input: string
  output: string
  sources: string[]
  problems: string[]
}

const NOTHING: ComfyFolderTargets = { shown: false, models: [], input: '', output: '', sources: [], problems: [] }

/** Never throws: an older backend without the command shows nothing. */
export async function loadComfyFolderTargets(): Promise<ComfyFolderTargets> {
  try {
    const res = await backendCall<Partial<ComfyFolderTargets>>('comfy_folder_targets')
    if (!res?.shown) return NOTHING
    return {
      shown: true,
      models: Array.isArray(res.models) ? res.models : [],
      input: res.input ?? '',
      output: res.output ?? '',
      sources: Array.isArray(res.sources) ? res.sources : [],
      problems: Array.isArray(res.problems) ? res.problems : [],
    }
  } catch (err) {
    log.warn('[comfy] folder targets not read', { err })
    return NOTHING
  }
}

/** The last segment of a config path, for a short line. */
export function sourceLabel(source: string): string {
  if (source === 'running ComfyUI' || source === 'ComfyUI folder') return source
  const seg = source.split(/[\\/]/).filter(Boolean).pop()
  return seg || source
}
