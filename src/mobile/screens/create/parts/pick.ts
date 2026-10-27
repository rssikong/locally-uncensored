/**
 * What the gallery is picked from for: a source image, a clip to extend, a
 * voice. The purpose is the one parameter of the route
 * /create/gallery/pick/:purpose. Pure.
 */
export const PICK_PURPOSES = ['source', 'extend', 'voice'] as const

export type PickPurpose = (typeof PICK_PURPOSES)[number]

export function isPickPurpose(value: unknown): value is PickPurpose {
  return typeof value === 'string' && (PICK_PURPOSES as readonly string[]).includes(value)
}

/** The purpose a page parameter names. An address with anything else picks a source image, the most common case. */
export function pickPurposeOf(value: unknown): PickPurpose {
  return isPickPurpose(value) ? value : 'source'
}
