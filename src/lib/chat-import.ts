// D26 (3.0.8): turn parsed export conversations into real LU chats.
//
// Before this every imported conversation became a markdown document in the
// RAG store of whichever chat happened to be open. Now each one is its own
// chat in the normal chat store, with its title, its original dates and its
// visible thread, so it persists, backs up and searches like any other chat.
//
// Re-import: the chat id is derived from the export's own conversation id
// (see NormalisedConversation.id), so the second import of the same export
// finds the chat it made the first time. Three cases:
//   * the chat is still as imported and the export has nothing newer: skip;
//   * the chat is still as imported and the export is newer (the user went
//     on in ChatGPT): replace it with the newer copy;
//   * the chat was changed in LU (messages added, edited or deleted, told by
//     the fingerprint stored at import): never replace it. A newer export
//     comes in as a second chat, "<title> (from export)", next to it.

import type { Conversation, Message } from '../types/chat'
import { stableHash, type NormalisedConversation } from './parsers/chatbot-export'

/** Chat id of an imported conversation. */
export function importedChatId(conv: NormalisedConversation): string {
  return `import-${conv.id}`
}

/** Last change of the export's copy, in epoch milliseconds. */
function exportVersion(conv: NormalisedConversation): number {
  return conv.updatedAt ?? conv.createdAt ?? 0
}

/**
 * Id of the second chat a newer export becomes when the first one was
 * continued in LU. It carries the export's version, so importing the same
 * export again finds this copy too instead of adding a third chat.
 */
export function separateChatId(conv: NormalisedConversation): string {
  return `${importedChatId(conv)}~export-${exportVersion(conv)}`
}

export const SEPARATE_TITLE_SUFFIX = ' (from export)'

/** Hash of a chat's messages, role and text. Any added, edited or deleted message changes it. */
export function messagesFingerprint(messages: ReadonlyArray<Pick<Message, 'role' | 'content'>>): string {
  return `${messages.length}:${stableHash(messages.map(m => `${m.role}\u0000${m.content}`).join('\u0001'))}`
}

/**
 * True when the chat no longer holds what the import put there. A chat
 * without a stored fingerprint cannot prove it is untouched, so it counts as
 * changed: keeping it is the safe side.
 */
export function changedInLu(chat: Pick<Conversation, 'messages' | 'importedFrom'>): boolean {
  const stored = chat.importedFrom?.fingerprint
  return !stored || stored !== messagesFingerprint(chat.messages)
}

/**
 * 'new': not in LU yet. 'present': imported before and the export has nothing
 * newer (or its separate copy is already there). 'newer': imported before,
 * untouched in LU, and the export's copy was updated since, so importing
 * replaces it. 'continued': imported before and continued or edited in LU,
 * and the export is newer, so importing adds a separate chat.
 */
export type ImportState = 'new' | 'present' | 'newer' | 'continued'

type ExistingChat = Pick<Conversation, 'updatedAt' | 'messages' | 'importedFrom'>

export function importState(conv: NormalisedConversation, existing: ReadonlyMap<string, ExistingChat>): ImportState {
  const have = existing.get(importedChatId(conv))
  if (!have) return 'new'
  if (exportVersion(conv) <= (have.updatedAt || 0) && !changedInLu(have)) return 'present'
  if (!changedInLu(have)) return 'newer'
  // Changed in LU. Its own updatedAt moved with the LU messages, so the
  // export is compared with the version that was imported instead.
  if (exportVersion(conv) <= (have.importedFrom?.version ?? 0)) return 'present'
  if (existing.has(separateChatId(conv))) return 'present'
  return 'continued'
}

/** The LU chat for one parsed conversation. Pure, so the tests can call it. */
export function toChatConversation(
  conv: NormalisedConversation,
  model: string,
  now: number = Date.now(),
  opts: { separate?: boolean } = {},
): Conversation {
  const id = opts.separate ? separateChatId(conv) : importedChatId(conv)
  const createdAt = conv.createdAt ?? conv.updatedAt ?? now
  const updatedAt = Math.max(conv.updatedAt ?? createdAt, createdAt)
  const messages: Message[] = conv.messages.map((m, i) => ({
    id: `${id}-m${i}`,
    role: m.role,
    content: m.content,
    timestamp: m.timestamp ?? createdAt,
  }))
  return {
    id,
    title: opts.separate ? `${conv.title}${SEPARATE_TITLE_SUFFIX}` : conv.title,
    messages,
    model,
    systemPrompt: '',
    mode: 'lu',
    // Same default as a chat made with the New Chat button.
    personaEnabled: false,
    importedFrom: { fingerprint: messagesFingerprint(messages), version: exportVersion(conv) },
    createdAt,
    updatedAt,
  }
}

export interface ImportProgress { done: number; total: number }

export interface ImportAsChatsOptions {
  /** Model the chats start with: the one picked in the chat view. */
  model: string
  /** The chats in the store right now (useChatStore.getState().conversations). */
  getConversations: () => ReadonlyArray<Conversation>
  /** Store action that merges chats in (useChatStore.getState().importConversations). */
  importConversations: (incoming: Conversation[], mode?: 'merge' | 'replace') => { added: number; skipped: number }
  onProgress?: (p: ImportProgress) => void
  /** Chats per store update. */
  batchSize?: number
  /** Gives the page a frame between batches. */
  yieldToUi?: () => Promise<void>
}

export interface ImportAsChatsResult {
  /** New chats, plus untouched chats replaced by a newer export. */
  added: number
  /** Already there with nothing newer; left as they are. */
  skipped: number
  /** Continued in LU, so the newer export became a second chat. */
  separate: number
}

const nextFrame = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/**
 * Add the conversations to the chat store in batches, yielding between them
 * so a few thousand chats neither freeze the window nor arrive in a single
 * store update. The chat store writes to disk coalesced (at most every 2 s),
 * so batching does not multiply the writes by the batch count.
 *
 * Each conversation is checked against the store as it is at its batch, not
 * as it was when the preview was drawn, and only 'new' and 'newer' ever
 * reach a chat id that exists. The store's merge alone would replace any
 * chat whose updatedAt is older than the export, including one the user
 * went on with in LU.
 */
export async function importAsChats(convs: NormalisedConversation[], opts: ImportAsChatsOptions): Promise<ImportAsChatsResult> {
  const batchSize = Math.max(1, opts.batchSize ?? 100)
  const yieldToUi = opts.yieldToUi ?? nextFrame
  let added = 0
  let skipped = 0
  let separate = 0
  const now = Date.now()
  opts.onProgress?.({ done: 0, total: convs.length })
  for (let i = 0; i < convs.length; i += batchSize) {
    const existing = new Map(opts.getConversations().map(c => [c.id, c]))
    const batch: Conversation[] = []
    for (const c of convs.slice(i, i + batchSize)) {
      const state = importState(c, existing)
      if (state === 'present') { skipped++; continue }
      const chat = toChatConversation(c, opts.model, now, { separate: state === 'continued' })
      // A repeat inside the same run (the same conversation picked twice).
      if (batch.some(b => b.id === chat.id)) { skipped++; continue }
      batch.push(chat)
      if (state === 'continued') separate++
    }
    if (batch.length > 0) {
      const r = opts.importConversations(batch, 'merge')
      added += r.added
      skipped += r.skipped
    }
    opts.onProgress?.({ done: Math.min(convs.length, i + batchSize), total: convs.length })
    await yieldToUi()
  }
  // `added` from the store counts the separate copies too.
  return { added: added - separate, skipped, separate }
}
