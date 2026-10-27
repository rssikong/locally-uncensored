/**
 * Turning an export of another chat app into chats of LU (E16.3). Pure.
 *
 * The parser of the logic layer (lib/parsers/chatbot-export.ts) reads the
 * export and hands back one markdown text per conversation, in a fixed
 * layout: a title line, an optional date line, then per message the line
 * "**You**" or "**Assistant**", an empty line, the text, an empty line. This
 * file splits that text back into messages so the chat shows up in the chat
 * list like any other.
 */
import type { NormalisedConversation } from '../../../../lib/parsers/chatbot-export'
import type { Conversation, Message } from '../../../../types/chat'

const HEADINGS: Record<string, 'user' | 'assistant'> = { '**You**': 'user', '**Assistant**': 'assistant' }

export interface ImportedMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Split the markdown of one conversation into its messages. */
export function markdownToMessages(markdown: string): ImportedMessage[] {
  const lines = markdown.split('\n')
  const out: ImportedMessage[] = []
  let current: { role: 'user' | 'assistant'; lines: string[] } | null = null
  const flush = () => {
    if (!current) return
    const content = current.lines.join('\n').trim()
    if (content) out.push({ role: current.role, content })
    current = null
  }
  for (let i = 0; i < lines.length; i++) {
    const role = HEADINGS[lines[i]]
    // A heading stands alone and is followed by an empty line. Anything else is text.
    if (role && (lines[i + 1] ?? '') === '') {
      flush()
      current = { role, lines: [] }
      continue
    }
    if (current) current.lines.push(lines[i])
  }
  flush()
  return out
}

function stamp(iso: string | null, fallback: number): number {
  if (!iso) return fallback
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * One chat of LU per conversation of the export. The ids are derived from
 * platform and title, so importing the same file twice adds nothing twice;
 * two conversations with the same title in one file get a running number.
 */
export function toConversations(source: readonly NormalisedConversation[], now: number, titleOf: (c: NormalisedConversation) => string): Conversation[] {
  const seen = new Map<string, number>()
  const out: Conversation[] = []
  for (const conv of source) {
    // The parser hands the thread over as messages since 3.0.7;
    // a message without text is left out, as the markdown split did.
    const parts = conv.messages.filter((m) => m.content.trim() !== '')
    if (parts.length === 0) continue
    const base = `imported-${conv.platform}-${conv.id}`
    const nth = seen.get(base) ?? 0
    seen.set(base, nth + 1)
    const id = nth === 0 ? base : `${base}-${nth + 1}`
    const at = stamp(conv.timestamp, now)
    const messages: Message[] = parts.map((part, index) => ({
      id: `${id}-m${index}`,
      role: part.role,
      content: part.content.trim(),
      timestamp: part.timestamp ?? at + index,
    }))
    out.push({ id, title: titleOf(conv), messages, model: '', systemPrompt: '', mode: 'lu', createdAt: at, updatedAt: at, personaEnabled: false })
  }
  return out
}
