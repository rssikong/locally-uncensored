/**
 * Pure rules of the chat list C1: which chats belong to this phone, how the
 * search matches, what the second line of a row says and how a time reads.
 * No store and no DOM in here, so the rules are tested in node.
 */
import type { Conversation, Message } from '../../../../../types/chat'
import { CHAT_STRINGS } from '../../../../strings/chat'
import { typedText } from '../../../../../lib/reader-text'
import { answerBody } from '../adapters/run-error'

const S = CHAT_STRINGS.list

/** Chats of the local list. Remote sessions and the desktop agent modes have their own places. */
export function phoneChats(conversations: readonly Conversation[]): Conversation[] {
  return conversations.filter((c) => !c.mode || c.mode === 'lu').sort((a, b) => b.updatedAt - a.updatedAt)
}

/** What a user reads of a message: the typed text, not the attachment block the model gets. */
export function shownText(message: Pick<Message, 'role' | 'content' | 'displayContent'>): string {
  // A message that lost its `displayContent` (an import, an older build) still carries the frame in `content`.
  if (message.role === 'user') return typedText(message)
  return message.content
}

/** Search over title and content, every word must be found (C1.3). An empty search keeps all. */
export function matchChats(chats: readonly Conversation[], query: string): Conversation[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...chats]
  return chats.filter((chat) => {
    const title = chat.title.toLowerCase()
    // An answer is searched by its own text: the sentence a failed run left in it is not something the model said (G8).
    return words.every((word) => title.includes(word) || chat.messages.some((m) => !m.hidden && m.role !== 'system' && m.role !== 'tool' && (m.role === 'assistant' ? answerBody(m) : shownText(m)).toLowerCase().includes(word)))
  })
}

/** Markdown marks at the start of a line say nothing in a one line preview. */
export function plainLine(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !/^(```|---|\*\*\*|===)/.test(l))
  if (!line) return ''
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^([-*+]|\d+[.)])\s+/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A few lines of a message without its Markdown marks, for the quote on top of a sheet. */
export function plainExcerpt(text: string, max = 280): string {
  const flat = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^(```|~~~|---|\*\*\*|===)/.test(l) && !/^\|?[\s:|-]+\|?$/.test(l))
    .map((l) =>
      l
        .replace(/^#{1,6}\s+/, '')
        .replace(/^>\s?/, '')
        .replace(/^([-*+]|\d+[.)])\s+/, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/(\*\*|__|~~|`)/g, '')
        .replace(/^\||\|$/g, '')
        .replace(/\s*\|\s*/g, ', ')
        .trim(),
    )
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}...` : flat
}

/** Second line of a row: the first line of the last answer, else of the last message of the user. */
export function previewLine(chat: Pick<Conversation, 'messages'>): string {
  const shown = chat.messages.filter((m) => !m.hidden && (m.role === 'user' || m.role === 'assistant'))
  for (let i = shown.length - 1; i >= 0; i--) {
    const m = shown[i]
    if (m.role !== 'assistant') continue
    const line = plainLine(answerBody(m))
    if (line) return line
  }
  // No answer with text (none yet, or only a failed one): the last words of the user, never the raw error.
  const last = [...shown].reverse().find((m) => m.role === 'user')
  if (!last) return S.noMessages
  const line = plainLine(shownText(last))
  if (line && line !== '(file)') return line
  if (last.images?.length) return S.photo
  if (last.files?.length) return S.file
  return S.noMessages
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

function startOfDay(at: number): number {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** "Just now", "12 min ago", "3 h ago", "Yesterday", "4 Oct", "4 Oct 2025". */
export function relativeTime(at: number, now: number): string {
  const diff = now - at
  if (diff < MINUTE) return S.justNow
  if (diff < HOUR) return S.minutes(Math.floor(diff / MINUTE))
  const today = startOfDay(now)
  if (at >= today) return S.hours(Math.floor(diff / HOUR))
  if (at >= today - DAY) return S.yesterday
  const d = new Date(at)
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`
  return d.getFullYear() === new Date(now).getFullYear() ? day : `${day} ${d.getFullYear()}`
}

/** A title is never empty on screen. */
export function chatTitle(chat: Pick<Conversation, 'title'> | undefined): string {
  const title = chat?.title.trim()
  return title ? title : S.untitled
}

/**
 * Pure: a title that was cut from a longer text, ended at a whole word.
 *
 * A chat is named after the first 50 characters of its first message, wherever
 * that falls: "What should I name my dog cal". Shown like this, the title ends
 * at the last whole word and says that there was more (acceptance on Android, N6).
 * A title the user wrote, or one that is the whole message, stays as it is.
 */
export function wholeWordTitle(title: string, source: string): string {
  const from = source.trimStart()
  if (!title || from.length <= title.length || !from.startsWith(title)) return title
  const midWord = /\S/.test(title.slice(-1)) && /\S/.test(from.charAt(title.length))
  if (!midWord) return `${title.trimEnd()}…`
  const lastSpace = title.lastIndexOf(' ')
  // One long word, or almost nothing left: the cut text is the better title.
  if (lastSpace < 12) return `${title}…`
  return `${title.slice(0, lastSpace).replace(/[\s,;:]+$/, '')}…`
}

/** The title as lists and headers show it: never empty, never ending in half a word. */
export function chatTitleShown(chat: Pick<Conversation, 'title' | 'messages'> | undefined): string {
  const title = chatTitle(chat)
  const first = chat?.messages.find((m) => m.role === 'user')
  if (!first) return title
  return wholeWordTitle(wholeWordTitle(title, first.content), first.displayContent ?? '')
}
