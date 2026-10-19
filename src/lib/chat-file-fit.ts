/**
 * How much of an attached text file goes to the model (GH #171).
 *
 * THE DEFECT. A long Markdown file (one day of a story, tens of thousands of
 * Japanese characters) reached a model with a 262,144 token window as its
 * first 4000 characters. The cut was made when the file was attached, before
 * anyone knew the model, at a fixed length, and nobody was told: not the
 * user, and not the model, which then said the text stops midway.
 *
 * THE RULE NOW. The chat holds the whole text (chat-files.ts, up to
 * TEXT_HOLD_CHARS). At send time this module decides, against the model the
 * message goes to:
 *
 *   - the whole file goes out when it fits;
 *   - otherwise as much of its start as fits, the model is told how much of
 *     how much and why (cutTextSummary), and the user gets a line above the
 *     transcript (fileCutNotice) and a mark on the chip that stays.
 *
 * WHAT "FITS" MEANS. The room is the send budget of the model, the same number
 * the history is held to (effectiveSendWindow: 0.8 of its real window, which
 * leaves the rest for the answer, and never more than a send limit set for
 * the model), minus what the rest of the request already
 * takes: system prompt, history, the typed text. A limit the user set in
 * Settings (attachmentTokenLimit) caps it further.
 *
 * Token counts come from `estimateTokens` in context-compaction.ts and from
 * nowhere else, so this module agrees with the counter and the compaction
 * about what a text costs, CJK included, whatever that estimate becomes.
 *
 * Pure: the window is resolved by the caller (resolveModelContext).
 */
import type { FileAttachment } from '../types/chat'
import { estimateTokens } from './context-compaction'
import { cutTextSummary, fileBlock, heldText, type FileCutReason } from './chat-files'
import { WINDOW_SHARE } from './send-window'

export interface FileRoom {
  /** Tokens the attached files may take together. */
  tokens: number
  /** What sets the room, should a file not fit. */
  reason: Exclude<FileCutReason, 'size'>
  /** The model's context window, for the line the user reads. */
  window: number
  /** The send budget, when it is a send limit and not the window. */
  sendLimit?: number
  /** The user's limit, when it is the one that holds. */
  setting?: number
}

export interface FileRoomInput {
  /** The model's real context window (resolveModelContext().contextWindow). */
  window: number
  /** What one request to it may carry (effectiveSendWindow on that window). */
  payloadBudget: number
  /** Estimated tokens of everything else in the request. */
  otherTokens: number
  /** settings.attachmentTokenLimit; 0 or less is no limit of its own. */
  limit?: number
}

export function fileRoom(input: FileRoomInput): FileRoom {
  const window = Math.max(0, Math.floor(input.window))
  const budget = Math.max(0, Math.floor(input.payloadBudget))
  const free = Math.max(0, budget - Math.max(0, Math.ceil(input.otherTokens)))
  // A send budget below the plain share of the window is a send limit
  // set for the model, and the user should be told that one, not the window.
  const limited = budget < Math.floor(window * WINDOW_SHARE)
  const room: FileRoom = limited
    ? { tokens: free, reason: 'send-limit', window, sendLimit: budget }
    : { tokens: free, reason: 'context', window }
  const limit = input.limit && input.limit > 0 ? Math.floor(input.limit) : 0
  if (limit > 0 && limit < free) return { tokens: limit, reason: 'setting', window, setting: limit }
  return room
}

/** The tighter of two rooms. A group round sends one user line to every
 *  speaker, so the file has to fit the smallest of them. */
export function tighterRoom(a: FileRoom | null, b: FileRoom): FileRoom {
  return !a || b.tokens < a.tokens ? b : a
}

/**
 * The longest start of `text` whose estimate stays within `tokens`. A binary
 * search over the length, so it holds for any estimate that grows with the
 * text, and costs a few dozen estimates rather than one per character.
 */
export function prefixThatFits(text: string, tokens: number): number {
  if (tokens <= 0) return 0
  if (estimateTokens(text) <= tokens) return text.length
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (estimateTokens(text.slice(0, mid)) <= tokens) lo = mid
    else hi = mid - 1
  }
  // Never split a surrogate pair: half an emoji or a rare CJK character is
  // not text.
  const code = text.charCodeAt(lo - 1)
  return lo > 0 && code >= 0xd800 && code <= 0xdbff ? lo - 1 : lo
}

export interface FittedFiles {
  /** The files as they go out and are stored. Untouched when nothing was cut. */
  files: FileAttachment[] | undefined
  /** The files that went out shorter than they came in. */
  cut: FileAttachment[]
}

/**
 * Fit the text files of one message into the room, in the order attached. A
 * binary, or a text stored before 3.0.7, keeps its summary: it is a few
 * kilobytes and has nothing left to cut.
 */
export function fitFiles(
  files: readonly FileAttachment[] | undefined,
  room: FileRoom,
  surface: 'chat' | 'workspace' = 'chat',
): FittedFiles {
  if (!files?.length) return { files: files ? [...files] : undefined, cut: [] }
  let left = room.tokens
  const out: FileAttachment[] = []
  const cut: FileAttachment[] = []
  for (const file of files) {
    const text = heldText(file)
    if (text === null) {
      out.push(file)
      left -= estimateTokens(fileBlock(file, surface))
      continue
    }
    // The lines around the text (name, type, hash, the header) cost too.
    const frame = estimateTokens(fileBlock({ ...file, summary: cutTextSummary('', file.textChars, 'context') }, surface))
    const fits = prefixThatFits(text, left - frame)
    if (fits >= text.length) {
      out.push(file)
      left -= frame + estimateTokens(text)
      continue
    }
    const kept = text.slice(0, fits)
    const shorter: FileAttachment = {
      ...file,
      summary: cutTextSummary(kept, file.textChars, room.reason),
      includedChars: kept.length,
    }
    out.push(shorter)
    cut.push(shorter)
    left -= frame + estimateTokens(kept)
  }
  return { files: out, cut }
}

const count = (n: number): string => n.toLocaleString('en-US')

const tokensLabel = (n: number): string => (n >= 1024 ? `${count(Math.round(n / 1024))}K` : count(n))

/** Why, in the words the USER reads, and what to change. */
function reasonForUser(room: FileRoom): string {
  if (room.reason === 'setting') {
    return `the limit for attached files in Settings is ${count(room.setting ?? room.tokens)} tokens`
  }
  if (room.reason === 'send-limit') {
    return `the send limit for this model is ${tokensLabel(room.sendLimit ?? room.tokens)} tokens. Raise it in the Context menu of the chat header to send more`
  }
  return `the model's context window is ${tokensLabel(room.window)} tokens, and the conversation and the answer need room too. A larger context window, or a new chat, lets more of it through`
}

/** The line above the transcript when a file went out shorter, or null. */
export function fileCutNotice(cut: readonly FileAttachment[], room: FileRoom): string | null {
  if (cut.length === 0) return null
  const parts = cut.map((file) => {
    const sent = file.includedChars ?? 0
    return file.textChars === undefined
      ? `"${file.name}": the first ${count(sent)} characters`
      : `"${file.name}": ${count(sent)} of ${count(file.textChars)} characters`
  })
  return `Only part of the attached text reached the model. ${parts.join('; ')}, because ${reasonForUser(room)}.`
}

/** The short mark on a chip whose file went out shorter, or null. */
export function chipCutLabel(file: FileAttachment): string | null {
  if (file.includedChars === undefined) return null
  const share = file.textChars ? Math.floor((file.includedChars / file.textChars) * 100) : null
  return share === null ? `first ${count(file.includedChars)} characters sent` : `${share}% sent (${count(file.includedChars)} of ${count(file.textChars!)} characters)`
}

