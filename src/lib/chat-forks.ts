import type { ChatFork, Conversation, Message } from '../types/chat'

/**
 * Kept versions of a chat (GH #172, #174).
 *
 * A resend after an edit and a regenerate used to delete the question and
 * everything after it. Now the old continuation moves into
 * `Conversation.forks`, keyed by the message it follows, and the new one is
 * written into `messages` as before. `messages` therefore stays the single
 * thread that the payload, the search, the export and the Code view read,
 * and no reader outside this file has to know that versions exist.
 *
 * Every function here is pure and returns the same object when nothing
 * changes, so the store can hand the result straight to `set`.
 */

/** The key of a fork that replaces the very first message of the chat. */
export const FORK_ROOT = '@start'

type ForkMap = Record<string, ChatFork>

/** The key under which the continuation starting at `index` is kept. */
export function forkKeyAt(messages: readonly Message[], index: number): string {
  return index <= 0 ? FORK_ROOT : messages[index - 1].id
}

/** Where the continuation after `key` starts in `messages`, or -1 when the
 *  key message is not in the shown thread (it sits in another version). */
export function forkStart(messages: readonly Message[], key: string): number {
  if (key === FORK_ROOT) return 0
  const at = messages.findIndex((m) => m.id === key)
  return at < 0 ? -1 : at + 1
}

function withForks(conv: Conversation, forks: ForkMap): Conversation {
  const next: Conversation = { ...conv, forks }
  if (Object.keys(forks).length === 0) delete next.forks
  return next
}

/**
 * Take `messageId` and everything after it out of the shown thread and keep
 * it as a version. The new continuation the caller writes next becomes the
 * newest version and the shown one.
 */
export function forkFrom(conv: Conversation, messageId: string): Conversation {
  const at = conv.messages.findIndex((m) => m.id === messageId)
  if (at < 0) return conv
  const key = forkKeyAt(conv.messages, at)
  const tail = conv.messages.slice(at)
  const before = conv.forks?.[key]
  const versions: (Message[] | null)[] = before
    ? before.versions.map((v) => (v === null ? tail : v))
    : [tail]
  versions.push(null)
  return withForks({ ...conv, messages: conv.messages.slice(0, at) }, { ...conv.forks, [key]: { versions } })
}

/**
 * Show version `target` of the fork at `key`. The shown continuation goes
 * back into its slot; an empty one (a resend that never got to write its
 * question) is dropped instead of kept as a blank version.
 */
export function switchFork(conv: Conversation, key: string, target: number): Conversation {
  const fork = conv.forks?.[key]
  if (!fork) return conv
  const current = fork.versions.indexOf(null)
  if (current < 0 || target < 0 || target >= fork.versions.length || target === current) return conv
  const start = forkStart(conv.messages, key)
  if (start < 0) return conv
  const shown = conv.messages.slice(start)
  const picked = fork.versions[target]
  if (!picked) return conv
  const versions: (Message[] | null)[] = fork.versions.slice()
  versions[target] = null
  versions[current] = shown
  if (shown.length === 0) versions.splice(current, 1)
  const forks: ForkMap = { ...conv.forks }
  if (versions.length < 2) delete forks[key]
  else forks[key] = { versions }
  return withForks({ ...conv, messages: [...conv.messages.slice(0, start), ...picked] }, forks)
}

/**
 * After a resend that wrote nothing (the send path refused it), go back to
 * the version that was shown before, so the person is not left looking at a
 * chat that simply ends.
 */
export function restoreEmptyFork(conv: Conversation, key: string): Conversation {
  const fork = conv.forks?.[key]
  const start = forkStart(conv.messages, key)
  if (!fork || start < 0 || conv.messages.length > start) return conv
  for (let i = fork.versions.length - 1; i >= 0; i--) {
    if (fork.versions[i]) return switchFork(conv, key, i)
  }
  return conv
}

/**
 * One message is deleted from the shown thread. A fork keyed by it would be
 * keyed by nothing; it moves to the message before, and when that one has a
 * fork of its own the kept versions join it.
 */
export function forgetForkKey(conv: Conversation, messageId: string): Conversation {
  const fork = conv.forks?.[messageId]
  if (!fork) return conv
  const at = conv.messages.findIndex((m) => m.id === messageId)
  if (at < 0) return conv
  const key = forkKeyAt(conv.messages, at)
  const forks: ForkMap = { ...conv.forks }
  delete forks[messageId]
  const kept = fork.versions.filter((v): v is Message[] => !!v && v.length > 0)
  const there = forks[key]
  if (there) {
    const versions = there.versions.slice()
    versions.splice(versions.indexOf(null), 0, ...kept)
    forks[key] = { versions }
  } else if (kept.length > 0) {
    forks[key] = { versions: [...kept, null] }
  }
  return withForks(conv, forks)
}

export interface ForkMark {
  key: string
  /** 0-based position of the shown version. */
  index: number
  total: number
}

const shownText = (m: Message | undefined): string | null =>
  m && m.role === 'user' ? (m.displayContent ?? m.content) : null

const isVisible = (m: Message): boolean => (m.role !== 'system' || !!m.notice) && !m.hidden

/**
 * Which visible message carries the "< 1/2 >" of which fork.
 *
 * An edit changed the question, so the switch sits on the question. A
 * regenerate asked the same question again and only the answer differs, so
 * there it sits on the answer, where people look for it.
 */
export function forkMarks(conv: Pick<Conversation, 'messages' | 'forks'>): Map<string, ForkMark> {
  const out = new Map<string, ForkMark>()
  if (!conv.forks) return out
  for (const [key, fork] of Object.entries(conv.forks)) {
    const index = fork.versions.indexOf(null)
    const total = fork.versions.length
    if (index < 0 || total < 2) continue
    const start = forkStart(conv.messages, key)
    if (start < 0) continue
    const tail = conv.messages.slice(start).filter(isVisible)
    if (tail.length === 0) continue
    const question = shownText(tail[0])
    const sameQuestion = question !== null && fork.versions.every((v) => v === null || shownText(v[0]) === question)
    const carrier = sameQuestion ? (tail.find((m) => m.role === 'assistant') ?? tail[0]) : tail[0]
    if (!out.has(carrier.id)) out.set(carrier.id, { key, index, total })
  }
  return out
}

/**
 * The chat as a new, independent conversation (GH #174).
 *
 * Without `endAt` it is a full copy, the kept versions included.
 * With it, the copy ends with that message ("Branch from here"): only the
 * shown thread up to there, no versions, and only the compactions whose cut
 * lies inside the copy. Settings that live on the conversation (persona
 * switch, system prompt, group members and their personas, sampling, memory
 * project) come along because they are fields of it.
 */
export function copyConversation(
  conv: Conversation,
  newId: string,
  opts: { endAt?: string; title: string; now: number },
): Conversation | null {
  const copy: Conversation = structuredClone(conv)
  copy.id = newId
  copy.title = opts.title
  copy.createdAt = opts.now
  copy.updatedAt = opts.now
  if (opts.endAt !== undefined) {
    const at = copy.messages.findIndex((m) => m.id === opts.endAt)
    if (at < 0) return null
    copy.messages = copy.messages.slice(0, at + 1)
    delete copy.forks
    const ids = new Set(copy.messages.map((m) => m.id))
    const compactions = (copy.compactions ?? []).filter((r) => ids.has(r.upToMessageId))
    if (compactions.length > 0) copy.compactions = compactions
    else delete copy.compactions
  }
  return copy
}
