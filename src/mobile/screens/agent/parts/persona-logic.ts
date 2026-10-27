/** Pure helpers of E6 Personas. */
import type { Persona } from '../../../../types/settings'

/** The id the editor route uses for a persona that does not exist yet. */
export const NEW_ID = 'new'

export type PersonaProblem = 'name-empty' | 'name-taken' | 'instructions-empty'

export function personaProblem(input: { id: string | null; name: string; instructions: string }, all: ReadonlyArray<Persona>): PersonaProblem | null {
  const name = input.name.trim()
  if (!name) return 'name-empty'
  if (all.some((p) => p.id !== input.id && p.name.trim().toLowerCase() === name.toLowerCase())) return 'name-taken'
  if (!input.instructions.trim()) return 'instructions-empty'
  return null
}

/** The built in personas whose name or text differ from the first ones, or that are missing. */
export function changedBuiltIns(current: ReadonlyArray<Persona>, first: ReadonlyArray<Persona>): Persona[] {
  return first.filter((original) => {
    const now = current.find((p) => p.id === original.id)
    return !now || now.name !== original.name || now.systemPrompt !== original.systemPrompt || now.icon !== original.icon
  })
}

/** A new id for a persona of the user: readable, and never one that exists. */
export function newPersonaId(name: string, all: ReadonlyArray<Persona>, random: () => string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'persona'
  let id = `custom-${base}`
  while (all.some((p) => p.id === id)) id = `custom-${base}-${random()}`
  return id
}
