// The Mac has two image engines. The first is the sidecar: diffusers on Metal,
// full precision repositories, with a setup step of its own. The second is
// `mflux`: packs that are quantized already, in native MLX. It lives in a venv
// of its own and arrives with the first model that needs it
// (src-tauri/src/commands/image_mflux.rs).
//
// Kept apart from `api/mlx-image`, which the tests replace as a whole.

/** The family of the mflux packs, as `mlx_image_models` names it. */
export const MFLUX_FAMILY = 'mflux'

/** The family of the Qwen-Image 2.1 prompt enhancers, listed in the same
 *  catalogue (commands/mlx_enhancer.rs). They make no images: no picker
 *  offers them, and their install sets up the engine that runs them. */
export const ENHANCER_FAMILY = 'enhancer'

/** Whether a catalogue entry is a prompt enhancer and no image model. */
export function isMlxEnhancer(m: { family?: string; enhancer?: string }): boolean {
  return m.family === ENHANCER_FAMILY || !!m.enhancer
}

/** The installed prompt enhancers by their catalogue ids, which carry the
 *  name "Improve my prompt" knows an enhancer by (lib/render/qwen-enhancer). */
export function installedMlxEnhancers(catalog: readonly { id: string; installed: boolean; family?: string; enhancer?: string }[]): string[] {
  return catalog.filter((m) => m.installed && isMlxEnhancer(m)).map((m) => m.id)
}

/**
 * Whether a model of this family brings its engine along. Such a model needs
 * no engine set up beforehand: its own install does that, in the same slot.
 */
export function imageModelBringsItsEngine(family: string | undefined): boolean {
  return family === MFLUX_FAMILY || family === ENHANCER_FAMILY
}

/**
 * Whether any image engine is set up. Which one a model needs is the
 * backend's to say: it lists a model as installed only with its engine.
 */
/** What Create has to know of a listed image model to pick its lane. */
type LaneModel = { name: string; editImages?: number; ownSampling?: boolean; mlxLoras?: boolean }

/**
 * The image models the given tab can run. Only a list that says so itself is
 * narrowed: on the Mac every entry carries `editImages`, and Edit lists the
 * models that take an image. A ComfyUI list carries none and comes back as it
 * is, the same array.
 */
export function imageLaneModels<T extends LaneModel>(list: T[], intent: string): T[] {
  if (intent !== 'edit' || !list.some((m) => m.editImages !== undefined)) return list
  return list.filter((m) => m.editImages === undefined || m.editImages > 0)
}

/** The image model a run on this tab takes: the stored pick while the tab
 *  can run it, otherwise the first model that can. One rule for the picker,
 *  the reference strip, the settings and the run. */
export function laneImageModel(list: LaneModel[], stored: string, intent: string): string {
  const lane = imageLaneModels(list, intent)
  // Nothing was narrowed (every tab on a ComfyUI host): the pick as it is.
  if (lane === list) return stored
  return lane.some((m) => m.name === stored) ? stored : (lane[0]?.name ?? stored)
}

/** Whether Edit has a local lane on this Mac: one installed model that takes
 *  an image is enough, and without one the tab would lead to an empty picker. */
export function mlxTakesEditImage(list: readonly Pick<LaneModel, 'editImages'>[]): boolean {
  return list.some((m) => (m.editImages ?? 0) > 0)
}

/** Whether this listed model runs at its own steps and guidance. */
export function runsAtOwnSampling(list: readonly LaneModel[], name: string): boolean {
  return list.find((m) => m.name === name)?.ownSampling === true
}

/** Whether a run with this listed model takes the LoRA stack from the Mac's
 *  LoRA folder. Only the Mac's catalogue says so, and there only for the
 *  packs of the second engine: a ComfyUI list and the sidecar's models do not. */
export function takesMlxLoras(list: readonly LaneModel[], name: string): boolean {
  return list.find((m) => m.name === name)?.mlxLoras === true
}

/**
 * The size of an edit's result on the Mac: the pixel budget of `side`
 * (`qwenEditResolution` in api/dynamic-workflow, the number Windows hands
 * TextEncodeQwenImage21) in the shape of the image that is edited, on the
 * engine's grid of 32. This is the
 * engine's own rule (mflux `QwenImage21LatentCreator.dimensions`), worked out
 * here because the engine applies it to the LAST image of several, and the
 * result follows the first, as on Windows.
 */
export function editCanvas(side: number, source: { width: number; height: number }): { width: number; height: number } {
  const ratio = source.width > 0 && source.height > 0 ? source.width / source.height : 1
  const width = Math.sqrt(side * side * ratio)
  const grid = (v: number) => Math.max(32, Math.round(v / 32) * 32)
  return { width: grid(width), height: grid(width / ratio) }
}

/**
 * The one canvas Qwen-Image 2.1 does not edit on, and the side an edit takes
 * in its place (`EDIT_DEAD_SIDE` and `EDIT_SIDE_INSTEAD` in image_mflux.rs).
 * Real run, 09.10.2026: at 1024 x 1024 the picture comes back with its
 * subject unchanged and sharpened like an HDR filter, at 1056 the edit is
 * made. Rust moves the run, so Create names the size the run has.
 */
export const MAC_EDIT_DEAD_SIDE = 1024
export const MAC_EDIT_SIDE_INSTEAD = 1056

/** The side an edit on the Mac really scales its images to (`edit_side`). */
export function macEditSide(side: number): number {
  return side === MAC_EDIT_DEAD_SIDE ? MAC_EDIT_SIDE_INSTEAD : side
}

/** The canvas an edit with several images really has (`canvas`): only the
 *  dead square moves, every other shape is measured as it was asked for. */
export function macEditCanvas(size: { width: number; height: number }): { width: number; height: number } {
  return size.width === MAC_EDIT_DEAD_SIDE && size.height === MAC_EDIT_DEAD_SIDE
    ? { width: MAC_EDIT_SIDE_INSTEAD, height: MAC_EDIT_SIDE_INSTEAD }
    : size
}

export function anyImageEngineReady(
  status: { installed?: boolean; mfluxInstalled?: boolean } | null | undefined,
): boolean {
  return !!status && (!!status.installed || !!status.mfluxInstalled)
}
