/**
 * The contract of the sheet "chat-options" (C5).
 *
 *   nav.openSheet('chat-options', { chatId, section })
 *
 * `chatId` is the id of the chat, or the key "new" for a chat that has no id
 * yet. `section` opens the sheet at a place: a sub page, or a row of the
 * first page that is then scrolled into view.
 */
export type OptionsSection =
  | 'agent'
  | 'thinking'
  | 'persona'
  | 'caveman'
  | 'workflows'
  | 'sampling'
  | 'context'
  | 'permissions'
  | 'goal'
  | 'loop'

export interface ChatOptionsProps {
  chatId?: string
  section?: OptionsSection
}

/** The sections that are sub pages of the sheet. The others are rows of its first page. */
export const SUB_PAGES = ['agent-intro', 'persona', 'caveman', 'workflows', 'sampling', 'context', 'permissions', 'goal', 'loop'] as const
export type OptionsSub = (typeof SUB_PAGES)[number]

export function isOptionsSub(value: string | null | undefined): value is OptionsSub {
  return !!value && (SUB_PAGES as readonly string[]).includes(value)
}

/** Pure: the sub page a section opens on, or null when the section is a row of the first page. */
export function subPageOf(section: OptionsSection | undefined): OptionsSub | null {
  if (!section || section === 'agent' || section === 'thinking') return null
  return section
}
