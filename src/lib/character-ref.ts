/**
 * The plain shape of a character and how its id names a LoRA file. Kept apart
 * from lib/characters so the store and lib/character-photos can use it
 * without an import ring.
 */

/** A trained character, local or on the LU Cloud shelf. */
export interface CharacterRef {
  /** 'local:<file>', 'mlx:<file>' or the LU Cloud id. */
  id: string
  /** What the user calls it. For a local character, its trigger word. */
  name: string
  /** The token that summons the character in a prompt. */
  triggerWord: string
  /** 'zimage' for a local character (older builds wrote 'z-image'). */
  family: string
}

export const LOCAL_PREFIX = 'local:'
export const MLX_PREFIX = 'mlx:'

/** The LoRA file of a local or Mac character, or null for a cloud one. */
export function characterLoraFile(ref: Pick<CharacterRef, 'id'> | null | undefined): string | null {
  if (!ref) return null
  if (ref.id.startsWith(LOCAL_PREFIX)) return ref.id.slice(LOCAL_PREFIX.length)
  if (ref.id.startsWith(MLX_PREFIX)) return ref.id.slice(MLX_PREFIX.length)
  return null
}

/** True for a character that lives on this machine. */
export function isLocalCharacter(ref: Pick<CharacterRef, 'id'> | null | undefined): boolean {
  return characterLoraFile(ref) !== null
}
