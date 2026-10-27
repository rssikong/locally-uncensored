/**
 * Notices of the computer (A17): "Answer ready", "Render ready", "Approval
 * needed" while LU is not on the screen, as notifications of the system
 * (lu-native local_notify). On the screen a short toast says it instead,
 * unless the user looks at that very chat. A switch in Settings, Remote turns
 * them off.
 *
 * Staying alive: while the phone waits for the computer (an answer, a
 * render, a message in the outbox) the native layer keeps the app running
 * (Android: a foreground service with a quiet notice; iOS: the time of a
 * background task). It is asked for while the app is on the screen, as
 * Android allows a start only then, and let go when nothing waits.
 *
 * Honest limit: without a push service nothing comes once the system has
 * ended LU.
 */
import { create } from 'zustand'
import { noticeUrl, type NoticeTarget } from '../../../remote/noticeLink'
import { tryBridge } from '../../../platform/bridge'
import { lifecycleState } from '../../../platform/lifecycle'
import { notifyStatusOf, type NotifyStatus } from '../../../platform/notifications'
import { REMOTE_STRINGS as S } from '../../../strings/remote'

export const NOTICES_KEY = 'lu-remote-notices'

function readOn(): boolean {
  try {
    return localStorage.getItem(NOTICES_KEY) !== 'off'
  } catch {
    return true
  }
}

interface NoticeSetting {
  on: boolean
  setOn: (on: boolean) => void
}

export const useRemoteNotices = create<NoticeSetting>()((set) => ({
  on: readOn(),
  setOn: (on) => {
    try {
      localStorage.setItem(NOTICES_KEY, on ? 'on' : 'off')
    } catch {
      /* holds for this run */
    }
    set({ on })
  },
}))

export type NoticeKind = 'answer' | 'render' | 'approval'

export interface Notice {
  kind: NoticeKind
  /** Title of the chat, or of the result. */
  about: string
  text: string
  target: NoticeTarget
}

/** Pure: the notice of the system for a notice of the computer. */
export function systemNotice(n: Notice): { id: string; title: string; body: string; url: string } {
  const title = n.kind === 'answer' ? S.notices.answer : n.kind === 'render' ? S.notices.render : S.notices.approval
  const body = [n.about, n.text].filter(Boolean).join(': ').slice(0, 380)
  // One notice per chat and kind: a newer one replaces the older one.
  const id = `${n.kind}_${n.target.id}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)
  return { id, title, body, url: noticeUrl(n.target) }
}

let toastFn: ((text: string) => void) | null = null
let isOpen: (target: NoticeTarget) => boolean = () => false

/** The shell hands in its toast and what is on the screen right now. */
export function setNoticeScreen(opts: { toast: (text: string) => void; isOpen: (target: NoticeTarget) => boolean }): void {
  toastFn = opts.toast
  isOpen = opts.isOpen
}

/** Say it: a notification when LU is away, a toast when it is on the screen and the user looks elsewhere. */
export async function sayNotice(n: Notice): Promise<'system' | 'toast' | 'none'> {
  if (!useRemoteNotices.getState().on) return 'none'
  if (lifecycleState() === 'foreground') {
    if (isOpen(n.target)) return 'none'
    const sys = systemNotice(n)
    toastFn?.(`${sys.title}: ${n.about}`)
    return toastFn ? 'toast' : 'none'
  }
  try {
    const answer = await tryBridge((bridge) => bridge.localNotify?.(systemNotice(n)))
    return answer.ok && answer.value === true ? 'system' : 'none'
  } catch {
    return 'none'
  }
}

/** The question of the system (Android 13+ POST_NOTIFICATIONS, iOS alerts). Put once; after a no only the settings of the system help. */
export async function askForNotices(): Promise<NotifyStatus> {
  try {
    const answer = await tryBridge((bridge) => bridge.remoteNotifyPermission?.(true))
    return answer.ok ? notifyStatusOf(answer.value) : 'not-needed'
  } catch {
    return 'not-needed'
  }
}

/** The state right now, without the question. 'not-needed' when the native layer does not answer in time. */
export async function noticeStatus(ms = 1_500): Promise<NotifyStatus> {
  const read = (async (): Promise<NotifyStatus> => {
    try {
      const answer = await tryBridge((bridge) => bridge.remoteNotifyPermission?.(false))
      return answer.ok ? notifyStatusOf(answer.value) : 'not-needed'
    } catch {
      return 'not-needed'
    }
  })()
  return Promise.race([read, new Promise<NotifyStatus>((resolve) => setTimeout(() => resolve('not-needed'), ms))])
}

/** Set once the app put its own question ("Get notified ...?") in front of the user, whatever the answer was. */
export const NOTICES_OFFERED_KEY = 'lu-remote-notices-offered'

function offeredBefore(): boolean {
  try {
    return localStorage.getItem(NOTICES_OFFERED_KEY) === '1'
  } catch {
    // No storage: better never to ask than to ask at every start.
    return true
  }
}

function noteOffered(): void {
  try {
    localStorage.setItem(NOTICES_OFFERED_KEY, '1')
  } catch {
    /* see offeredBefore */
  }
}

/** Pure: is this the moment for the app's own question. Only while the system could still ask, and once. */
export function shouldOfferNotices(status: NotifyStatus, offered: boolean, on: boolean): boolean {
  return on && !offered && status === 'open'
}

let offering = false

/**
 * After the first pairing and at the first shared chat: one short sheet
 * "Get notified when your computer is done?". "Allow" puts the question of
 * the system, "Not now" leaves it. Either way it does not come again; the
 * switch in Settings, Remote desktop asks later.
 */
export async function offerRemoteNotices(confirm: (spec: { title: string; text: string; confirmLabel: string; cancelLabel: string; risk: 'leaves-app'; testid: string }) => Promise<boolean>): Promise<'asked' | 'declined' | 'skipped'> {
  if (offering || offeredBefore()) return 'skipped'
  offering = true
  try {
    if (!shouldOfferNotices(await noticeStatus(), offeredBefore(), useRemoteNotices.getState().on)) return 'skipped'
    // Written first: a question that was shown counts, also when the app is closed over it.
    noteOffered()
    const yes = await confirm({
      title: S.notices.offerTitle,
      text: S.notices.offerText,
      confirmLabel: S.notices.offerAllow,
      cancelLabel: S.notices.offerNotNow,
      // The next thing on the screen is a dialog of the system.
      risk: 'leaves-app',
      testid: 'remote-notify',
    })
    if (!yes) return 'declined'
    await askForNotices()
    return 'asked'
  } finally {
    offering = false
  }
}

// ── staying alive while the phone waits ──────────────────────────

const waiting = new Map<string, boolean>()
let held = false

/** A source of waiting (the shared chats, the renders) says whether it waits. */
export function setWaiting(source: string, on: boolean, text = ''): void {
  waiting.set(source, on)
  const any = [...waiting.values()].some(Boolean)
  if (any === held) return
  // Android starts the service only while LU is on the screen; a start in the background is not tried.
  if (any && lifecycleState() !== 'foreground') return
  held = any
  void tryBridge((bridge) => bridge.remoteWatch?.(any, text)).catch(() => undefined)
}

/** Test seam. */
export function __resetNoticesForTests(): void {
  waiting.clear()
  held = false
  toastFn = null
  isOpen = () => false
  useRemoteNotices.setState({ on: true })
  offering = false
}
