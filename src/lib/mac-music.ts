// The Music lane on a Mac, as Create sees it: one model of the music engine
// (ACE-Step 1.5, src-tauri/src/commands/music.rs), standing in the lane's
// model list while it is installed. Kept free of imports beyond a type, so
// the store, the intent rules and the picker can read it without pulling the
// engine's commands along (api/mlx-music.ts has those).
import type { ClassifiedModel } from '../api/comfyui'

/** The shortest and the longest track the engine makes here (`MIN_SECONDS`
 *  and `MAX_SECONDS` in music.rs). */
export const MAC_MUSIC_MIN_SECONDS = 10
export const MAC_MUSIC_MAX_SECONDS = 240

/** The name the picker and the gallery give the one model (`MODEL_NAME`). */
export const MAC_MUSIC_MODEL_NAME = 'ACE-Step 1.5 Turbo'

/** The steps every track runs at: the turbo model is distilled to eight. */
export const MAC_MUSIC_STEPS = 8

/** The Music lane's model list on a Mac: the one model while it is
 *  installed, otherwise nothing. It stands where a ComfyUI host lists its
 *  audio checkpoints, so the picker, the lane count and the run read it the
 *  same way on both. */
export function buildMacMusicModels(status: { installed: boolean } | null): ClassifiedModel[] {
  return status?.installed ? [{ name: MAC_MUSIC_MODEL_NAME, type: 'ace', source: 'checkpoint' }] : []
}

/** Whether the Mac's music engine is installed, read from the lane's list. */
export function mlxMakesMusic(list: readonly Pick<ClassifiedModel, 'name'>[]): boolean {
  return list.some((m) => m.name === MAC_MUSIC_MODEL_NAME)
}

/** The length a run asks for, within what the engine makes. */
export function macMusicSeconds(seconds: number): number {
  const s = Number.isFinite(seconds) ? Math.round(seconds) : 120
  return Math.min(MAC_MUSIC_MAX_SECONDS, Math.max(MAC_MUSIC_MIN_SECONDS, s))
}
