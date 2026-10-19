import type { Persona } from '../types/settings'
import { substituteMacros, DEFAULT_USER_NAME } from './character-card'
import { estimateMessageTokens } from './context-compaction'

/**
 * GH #181: a persona's reminder, sent close to the end of the prompt.
 *
 * In a long chat the system prompt sits far from the end, and the model
 * follows the recent turns more than its persona: in a group story two
 * characters drifted into each other's style. SillyTavern answers that with
 * an author's note at a depth. This is the same thing per persona: a short
 * text the persona carries (`Persona.note`), put `noteDepth` messages from
 * the end on every send, wherever that persona speaks (its chat, its seat in
 * a group, Agent mode).
 *
 * The reminder lives on the wire only. The store and the transcript never
 * see it, so it never piles up and an edit in Settings applies on the next
 * send.
 *
 * WHY IT RIDES INSIDE A USER TURN. A system message deep in the history is
 * what strict Jinja templates refuse ("System message must be at the
 * beginning"), and normalizeSystemMessages pulls every late system part to
 * the front, which would put the reminder right back where it does not help.
 * A separate user message would sit next to another user turn, and a model
 * whose template wants strict alternation would get the two merged anyway
 * (normalize-system.ts alternateRoles). So the text is folded into the user
 * turn at that depth: no extra message, no same role neighbours, and the
 * alternation of the payload is exactly what it was without a reminder.
 */

/** Where the reminder goes when the persona sets no depth: four messages
 *  from the end, SillyTavern's default for an author's note. */
export const DEFAULT_NOTE_DEPTH = 4
/** The deepest a reminder may sit. Deeper than this it is history, not a
 *  reminder, and a history trim would drop it first. */
export const MAX_NOTE_DEPTH = 50

export interface PersonaNote {
  text: string
  /** Messages from the end: 0 is the latest message. */
  depth: number
}

export function clampNoteDepth(depth: unknown): number {
  const n = typeof depth === 'number' && Number.isFinite(depth) ? Math.round(depth) : DEFAULT_NOTE_DEPTH
  return Math.min(MAX_NOTE_DEPTH, Math.max(0, n))
}

/** The reminder a persona carries, or null when it carries none. A character
 *  card persona gets `{{char}}` and `{{user}}` filled in, as its prompt does. */
export function personaNoteOf(persona: Pick<Persona, 'name' | 'card' | 'note' | 'noteDepth'> | undefined): PersonaNote | null {
  const raw = persona?.note?.trim()
  if (!persona || !raw) return null
  const text = persona.card ? substituteMacros(raw, persona.name, DEFAULT_USER_NAME) : raw
  return { text, depth: clampNoteDepth(persona.noteDepth) }
}

/** What the reminder costs in the send budget. */
export function noteTokens(note: PersonaNote | null): number {
  return note ? estimateMessageTokens([{ role: 'user', content: note.text }]) : 0
}

interface NoteMessage {
  role: string
  content?: unknown
}

/**
 * Fold the reminder into the payload, `note.depth` messages from the end.
 *
 * The message at that depth takes it when it is a user turn with text.
 * Otherwise the nearest such turn before it does, and when there is none
 * before it, the nearest one after it. A payload without any user text turn
 * gets it behind its system prompt. Returns the same array when there is no
 * reminder; the input is never changed.
 */
export function injectPersonaNote<T extends NoteMessage>(messages: T[], note: PersonaNote | null): T[] {
  if (!note || !note.text) return messages
  const takes = (m: T | undefined) => m?.role === 'user' && typeof m.content === 'string'
  const body: number[] = []
  messages.forEach((m, i) => { if (m.role !== 'system') body.push(i) })
  const at = Math.max(0, body.length - 1 - clampNoteDepth(note.depth))
  let target = -1
  for (let k = Math.min(at, body.length - 1); k >= 0 && target < 0; k--) if (takes(messages[body[k]])) target = body[k]
  for (let k = at + 1; k < body.length && target < 0; k++) if (takes(messages[body[k]])) target = body[k]
  const out = messages.slice()
  if (target >= 0) {
    const content = out[target].content as string
    out[target] = { ...out[target], content: content ? `${content}\n\n${note.text}` : note.text }
    return out
  }
  const sys = messages.findIndex((m) => m.role === 'system' && typeof m.content === 'string')
  if (sys >= 0) {
    out[sys] = { ...out[sys], content: `${out[sys].content as string}\n\n${note.text}` }
    return out
  }
  return [...out, { role: 'user', content: note.text } as T]
}
