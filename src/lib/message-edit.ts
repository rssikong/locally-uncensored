import type { Message } from '../types/chat'

/**
 * The text the edit field of a user message starts with: what the person
 * typed, never the file summaries or the expanded slash command the model
 * received in `content`.
 */
export function editableText(message: Pick<Message, 'content' | 'displayContent'>): string {
  return message.displayContent || message.content
}

/**
 * "Save" on an edited user message (GH #172): the fields that change, and
 * nothing is sent.
 *
 * `content` is what the model reads on the next turn, so it has to follow the
 * edit. When the typed text is the start of `content` (attached files, the
 * Create note for attachments), only that start is swapped and the rest the
 * model received stays. Any other `displayContent` is a label over a different
 * instruction (a slash command, a /loop pass); the edit replaces the
 * instruction with exactly what was typed, so the model reads what is shown.
 */
export function savedUserEdit(
  message: Pick<Message, 'content' | 'displayContent'>,
  typed: string,
): Pick<Message, 'content' | 'displayContent'> {
  const shown = message.displayContent
  if (shown === undefined) return { content: typed, displayContent: undefined }
  if (shown !== '' && message.content.startsWith(shown)) {
    return { content: typed + message.content.slice(shown.length), displayContent: typed }
  }
  return { content: typed, displayContent: undefined }
}
