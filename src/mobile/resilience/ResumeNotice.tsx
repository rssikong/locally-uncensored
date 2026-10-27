/**
 * G8 the notice after a return. Owned by strand 6 (Remote and resilience).
 *
 * Two things can have happened while LU was away, and both are said once:
 *
 *   an answer was cut   The system closed LU in the middle of an answer.
 *                       The logic layer labels that answer at the next start
 *                       (lib/interrupted-runs.ts, finishReason
 *                       'interrupted'); this notice finds the labelled
 *                       answers and leads to the chat. It stays until it is
 *                       dismissed or the chat was opened from it, and it
 *                       goes by itself when the answer is asked again.
 *   a render went on    Cloud jobs that were booked before LU was closed are
 *                       picked up again by the logic layer
 *                       (lib/cloud-job-resume.ts). A toast says how many.
 *                       The result itself is announced by the scaffold
 *                       ("Your result is in the gallery").
 *
 * Nothing here starts a run, a recovery or a poll: the scaffold does that
 * once in boot/wiring.ts. This file only reads what they left behind.
 *
 * DESIGN.md 5.5 offers "Continue answer". With one cut answer the button
 * says exactly that and goes through `continueInterruptedReply` below, which
 * asks the chat strand to ask the model again (`continueReply` in
 * screens/chat/parts/controller.ts). The chat is opened by that call.
 * With several cut answers there is no single answer to continue, so the
 * button stays "Open chat".
 *
 *   - **G8 Hinweis nach Beenden durch das System**, siehe 5.5. Kasten in der Variante warn: ruhiges Grau
 *     (`--m-warn`, `--m-warn-soft`) mit Warnsymbol, kein Gelb.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { continuesInPlace } from '../../lib/continue-answer'
import { isGroupChat } from '../../lib/group-chat'
import { INTERRUPTED_EMPTY_TEXT, INTERRUPTED_FINISH_REASON } from '../../lib/interrupted-runs'
import { pendingCloudJobs, type PendingCloudJob } from '../../lib/pending-cloud-jobs'
import { useAgentModeStore } from '../../stores/agentModeStore'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import type { Conversation } from '../../types/chat'
import { useStorageAlerts } from '../lib/storage-alerts'
import { viewAnswer } from '../screens/chat/parts/adapters/run-error'
import { navApi } from '../nav/api'
import { useNavStore } from '../nav/store'
import { useAppLifecycle } from '../platform/lifecycle'
import { REMOTE_STRINGS } from '../strings/remote'
import { Button, Notice, toast } from '../ui'

const S = REMOTE_STRINGS.resume

export const RESUME_SEEN_KEY = 'lu-mobile-resume-seen'
/** More ids than this are never remembered, the oldest go first. */
export const RESUME_SEEN_MAX = 60
/** An answer that was cut longer ago than this is history, not news. */
export const RESUME_MAX_AGE_MS = 48 * 60 * 60 * 1000
/** A return after less than this does not count as "picked up again". */
export const JOBS_AWAY_MIN_MS = 30_000
/** The toast about jobs waits this long after the start, so it does not land under the first frame. */
const JOBS_TOAST_DELAY_MS = 1200

export interface InterruptedReply {
  conversationId: string
  messageId: string
  title: string
  /** Something of the answer is there. False: the app was closed before its first word. */
  partial: boolean
}

type ConversationLike = Pick<Conversation, 'id' | 'title' | 'messages'>

/**
 * Pure: the answers a kill cut short that the user has not been told about.
 * Only the last visible message of a chat counts; once the chat went on,
 * the cut answer is no longer where the chat stands.
 */
export function interruptedReplies(conversations: readonly ConversationLike[], seen: ReadonlySet<string>, now: number): InterruptedReply[] {
  const out: InterruptedReply[] = []
  for (const conversation of conversations) {
    let last = undefined
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      if (!conversation.messages[i].hidden) {
        last = conversation.messages[i]
        break
      }
    }
    if (!last || last.role !== 'assistant' || last.finishReason !== INTERRUPTED_FINISH_REASON) continue
    if (seen.has(last.id)) continue
    if (typeof last.timestamp === 'number' && last.timestamp > 0 && now - last.timestamp > RESUME_MAX_AGE_MS) continue
    // The text a reader gets of it (the adapter of the chat): a mark of the template, a control tag or a note of
    // the app is not a part of the answer. Read from the stored text, they made this notice say "saved up to
    // that point" where the box under the answer said that nothing was saved (check 4 on Android, F3 and F4).
    const text = viewAnswer(last).body.trim()
    // The same question the box under the answer asks (screens/chat/parts/MessageItem.tsx): is there text of the
    // answer, or a thought. A step the agent ran is neither. Counted as a part, it made this notice say "saved up
    // to that point" above a box that said "had not started yet" (round 9, N9 on Android: closed while a page was read).
    const answerInBlocks = (last.agentBlocks ?? []).some((block) => block.phase === 'answer' && (block.content ?? '').trim() !== '')
    const partial = (text !== '' && text !== INTERRUPTED_EMPTY_TEXT) || (last.thinking ?? '').trim() !== '' || answerInBlocks
    out.push({ conversationId: conversation.id, messageId: last.id, title: conversation.title, partial })
  }
  return out
}

/**
 * Pure: the answers the notice speaks about. The ones of which a part is
 * saved, all of them. When nothing is saved of any, the one that was cut
 * last, alone and without a count.
 *
 * The notice counted every cut answer, also those of which nothing had
 * arrived, and with every kill one more ("7 answers were cut short. What had
 * arrived of them is saved", checks on Android with 4 GB, F7, and on the
 * iPhone, M4). A number is a promise about saved text, so only saved text is
 * counted.
 */
export function resumeShown(found: readonly InterruptedReply[]): InterruptedReply[] {
  const saved = found.filter((reply) => reply.partial)
  return saved.length > 0 ? saved : found.slice(0, 1)
}

/**
 * Pure: the cut answers the user has in front of them without the notice,
 * because their chat is the page on screen. The box under the answer says
 * there what happened, so the notice is done with them.
 */
export function seenByOpening(found: readonly InterruptedReply[], openChatId: string): string[] {
  return openChatId ? found.filter((reply) => reply.conversationId === openChatId).map((reply) => reply.messageId) : []
}

/** A chat title longer than this is cut in the notice, which has to stay slim. */
export const RESUME_TITLE_MAX = 40

/**
 * Pure: what the notice says. With one cut answer and a DIFFERENT chat on
 * the screen it names the chat it is about: the notice stands above every
 * page, and above an open chat it read as news about that chat (acceptance
 * Android, re-run, N13).
 */
export function resumeText(found: readonly InterruptedReply[], openChatId: string): string {
  if (found.length === 0) return ''
  // Several: the caller hands in the ones a part is saved of (`resumeShown`), and the number is theirs.
  if (found.length > 1) return S.closedTextMany(found.length)
  const first = found[0]
  const text = first.partial ? S.closedText : S.closedTextNothing
  if (!openChatId || openChatId === first.conversationId) return text
  const title = first.title.trim()
  return `${text} ${S.closedElsewhere(title.length > RESUME_TITLE_MAX ? `${title.slice(0, RESUME_TITLE_MAX - 3).trimEnd()}...` : title)}`
}

/** Pure: the ids to keep after `ids` were seen. */
export function withSeen(seen: readonly string[], ids: readonly string[]): string[] {
  const next = [...seen.filter((id) => !ids.includes(id)), ...ids]
  return next.slice(-RESUME_SEEN_MAX)
}

/**
 * Pure: the jobs that were booked before `since` and have not been
 * mentioned yet. `since` is the start of this session, or the moment the app
 * left the screen.
 */
export function pickedUpJobs(jobs: readonly PendingCloudJob[], said: ReadonlySet<string>, since: number): PendingCloudJob[] {
  return jobs.filter((job) => job.startedAt < since && !said.has(job.id))
}

function readSeen(): string[] {
  try {
    const raw = localStorage.getItem(RESUME_SEEN_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeSeen(ids: string[]): void {
  try {
    localStorage.setItem(RESUME_SEEN_KEY, JSON.stringify(ids))
  } catch {
    /* a full storage shows the notice once more, nothing else */
  }
}

/** Can the cut answer of this chat be gone on with in place (lib/continue-answer.ts)? Asked when the notice is drawn. */
function canGoOn(conversationId: string): boolean {
  const conversation = useChatStore.getState().conversations.find((c) => c.id === conversationId)
  return continuesInPlace({
    model: useModelStore.getState().activeModel,
    agentOn: useAgentModeStore.getState().isActive(conversationId),
    group: !!conversation && isGroupChat(conversation.groupModels),
  })
}

/**
 * "Continue answer": the chat strand opens the chat and asks again for the
 * answer that was cut. Where it has nothing to ask again (the chat is gone,
 * an answer is running, the error is one that asking again does not repair)
 * the chat is opened and the user goes on there. `askAgain: false` only opens
 * the chat (several cut answers: there is no single one to continue).
 */
export async function continueInterruptedReply(reply: Pick<InterruptedReply, 'conversationId'>, askAgain = true): Promise<void> {
  const open = () => navApi.resetTo('chat', [{ route: '/chat/:id', params: { id: reply.conversationId } }])
  if (!askAgain) return open()
  try {
    // Loaded on the press: the chat controller is not part of the frame.
    const { continueReply } = await import('../screens/chat/parts/controller')
    const outcome = continueReply(reply.conversationId)
    if (outcome !== 'continued' && outcome !== 'opened') open()
  } catch {
    open()
  }
}

/** When this session started. Jobs booked before it come from an earlier run of the app. */
const SESSION_STARTED_AT = Date.now()
const saidJobs = new Set<string>()

function sayPickedUpJobs(since: number): void {
  const jobs = pickedUpJobs(pendingCloudJobs(), saidJobs, since)
  if (jobs.length === 0) return
  for (const job of jobs) saidJobs.add(job.id)
  toast(`${S.jobsPicked(jobs.length)} ${S.jobsWhere}`, {
    testid: 'cloud-picked',
    action: { label: S.openGallery, onPress: () => navApi.resetTo('create', [{ route: '/create/gallery' }]) },
  })
}

/** The cut answers whose chat was on screen in this session. They are in the saved list as well; this one is read while drawing. */
const openedHere = new Set<string>()

export function ResumeNotice() {
  const [seen, setSeen] = useState<string[]>(readSeen)
  // The selector hands back a text, so a chat that is streaming does not repaint this component with every token.
  const key = useChatStore((s) => {
    const found = interruptedReplies(s.conversations, new Set(seen), Date.now())
    return found.length === 0 ? '' : JSON.stringify(found)
  })
  const all = useMemo<InterruptedReply[]>(() => (key ? (JSON.parse(key) as InterruptedReply[]) : []), [key])
  const inFlow = useNavStore((s) => s.flow !== null)
  const openChatId = useNavStore((s) => {
    if (s.flow) return ''
    const top = s.stacks[s.tab].at(-1)
    return top?.route === '/chat/:id' ? (top.params.id ?? '') : ''
  })
  const { losingData } = useStorageAlerts()

  useEffect(() => {
    const timer = window.setTimeout(() => sayPickedUpJobs(SESSION_STARTED_AT), JOBS_TOAST_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  useAppLifecycle({
    onForeground: (awayMs) => {
      if (awayMs >= JOBS_AWAY_MIN_MS) sayPickedUpJobs(Date.now() - awayMs)
    },
  })

  const markSeen = useCallback(
    (ids: string[]) => {
      const next = withSeen(withSeen(readSeen(), seen), ids)
      writeSeen(next)
      setSeen(next)
    },
    [seen],
  )

  const hidden = inFlow || losingData
  // The chat of a cut answer is on screen: the box under the answer says it there, the notice is done with it,
  // now and after the chat was left again (`openedHere` is filled by the effect below).
  const rest = useMemo(() => all.filter((reply) => reply.conversationId !== openChatId && !openedHere.has(reply.messageId)), [all, openChatId])
  const found = useMemo(() => resumeShown(rest), [rest])
  const allIds = useMemo(() => rest.map((reply) => reply.messageId), [rest])

  // Said once per start: what the notice has shown is remembered for the NEXT start at once, so a notice nobody
  // tapped away does not come back after every start and count up. In this session it stays where it is.
  useEffect(() => {
    if (hidden || allIds.length === 0) return
    writeSeen(withSeen(readSeen(), allIds))
  }, [hidden, allIds])

  useEffect(() => {
    const opened = seenByOpening(all, openChatId)
    if (opened.length === 0) return
    for (const id of opened) openedHere.add(id)
    writeSeen(withSeen(readSeen(), opened))
  }, [all, openChatId])

  // "Not saved" is the more urgent line, and the two share the place above the pages.
  if (found.length === 0 || hidden) return null

  const first = found[0]
  const alreadyThere = found.length === 1 && openChatId === first.conversationId
  // One cut answer: the button names what it is for. Several: it only leads to the first chat.
  const single = found.length === 1
  // Round 10: "Continue answer" only where the answer really goes on (the engine of this phone, a plain chat).
  // Anywhere else the step under the answer is "Regenerate", which throws the part away. That is not a thing
  // to do from a notice above another page: the button then only opens the chat.
  const goesOn = single && first.partial && canGoOn(first.conversationId)
  const acts = single && (goesOn || !first.partial)
  const open = () => {
    markSeen(allIds)
    void continueInterruptedReply(first, acts)
  }

  return (
    // order: mounted at the end of the frame, shown above the pages. The class brings the top safe area.
    // m-resume-alert: while the keyboard is open the box folds away and gives its room to the chat (styles/base.css).
    <div className="m-storage-alert m-storage-alert--slim m-resume-alert" style={{ order: -1, paddingTop: 'calc(var(--m-safe-top) + var(--m-s2))' }}>
      <Notice
        variant="warn"
        title={S.closedTitle}
        testid="m-app-resume"
        el="G8"
        actions={
          <>
            {alreadyThere ? null : (
              <Button compact variant="primary" onPress={open} testid="m-app-resume-open" el="G8.1">
                {acts ? (first.partial ? S.continueAnswer : S.askAgain) : S.openChat}
              </Button>
            )}
            <Button compact onPress={() => markSeen(allIds)} testid="m-app-resume-dismiss" el="G8.2">
              {S.dismiss}
            </Button>
          </>
        }
      >
        {resumeText(found, openChatId)}
      </Notice>
    </div>
  )
}
