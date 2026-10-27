/**
 * What the moving preview of the page LU Cloud may show, and when it moves.
 * Pure, so the guard (__tests__/cloud-schaukasten.test.ts) reads it.
 */

/**
 * The stills the preview shows, from public/create-presets/. Only neutral
 * ones: never a still whose name or content belongs to the presets without a
 * filter (spicy, horror). They fit every store package. Plan 4.3.
 */
export const SHOWCASE_IMAGES = ['two-speakers', 'product-scene', 'sharpen-4k', 'product-360'] as const
export type ShowcaseImage = (typeof SHOWCASE_IMAGES)[number]

export const showcaseImageUrl = (id: ShowcaseImage) => `/create-presets/${id}.webp`

/**
 * The chat model the chat scene names: a model of the catalogue that every
 * package lists (no mark of the measurement, no word in its name). The guard
 * holds it against lib/no-refusals-measurement.md and cloudModelListed.
 */
export const SHOWCASE_CHAT_MODEL = { id: 'moonshotai/Kimi-K3', name: 'Kimi K3' } as const

export const SHOWCASE_SCENES = ['chat', 'image', 'video'] as const
export type ShowcaseScene = (typeof SHOWCASE_SCENES)[number]

/** One scene every 4.5 seconds. */
export const SHOWCASE_STEP_MS = 4500
/** Two full rounds, then the first scene stands. */
export const SHOWCASE_MAX_STEPS = SHOWCASE_SCENES.length * 2

export interface ShowcaseState {
  scene: number
  steps: number
  /** The user picked a scene: nothing changes on its own any more. */
  held: boolean
}

export interface ShowcaseWorld {
  /** The app is in the background or the page is covered. */
  hidden: boolean
  /** The preview is on screen. */
  inView: boolean
  /** The system asks for reduced motion. */
  reduced: boolean
}

/** Pure: may the preview change on its own right now. */
export function showcaseRuns(state: ShowcaseState, world: ShowcaseWorld): boolean {
  return !state.held && !world.reduced && !world.hidden && world.inView && state.steps < SHOWCASE_MAX_STEPS
}

/** Pure: the state after one tick of the timer. */
export function showcaseTick(state: ShowcaseState, world: ShowcaseWorld): ShowcaseState {
  if (!showcaseRuns(state, world)) return state
  return { ...state, scene: (state.scene + 1) % SHOWCASE_SCENES.length, steps: state.steps + 1 }
}
