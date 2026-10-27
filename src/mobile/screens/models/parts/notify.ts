/**
 * The question for notifications at the first download (Android 13 and
 * newer), and the switch for it on the storage page.
 *
 * A download goes on while LU is not on the screen, and Android shows its
 * progress in a notification, if the user allowed notifications. Until round
 * 16 nobody asked (acceptance android-4gb, F9): the download ran in the
 * background and nothing outside the app showed it.
 *
 * The rule:
 *  - The first download says in one sentence what the notification is for,
 *    and only then the question of the system comes.
 *  - "Not now" and a no to the system are both a no. It stands: the app does
 *    not ask again, at no later download.
 *  - The switch on the storage page shows the state. Where the app may not
 *    ask (again), it leads to the settings of the system, the only place
 *    that can change it.
 *  - The download never waits for the answer of the system.
 */
import { useCallback, useEffect, useState } from 'react'
import { nav } from '../../../nav'
import { askForNotifications, notifyStatus, onLifecycle, openSystemSettings, type NotifyStatus } from '../../../platform'
import { NOTIFY_OFFERED_VAULT_ID, loadDecision, saveDecision } from '../../../policy/decision-vault'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { toast } from '../../../ui'

/**
 * Set once the app has put its own sentence in front of the user, whatever the answer was.
 * Kept in localStorage and in the native layer (policy/decision-vault.ts): at a full phone
 * localStorage lost it once and the question came again (round 30, B3).
 */
export const NOTIFY_OFFERED_KEY = 'lu-mobile-notify-offered'

function offeredBefore(): boolean {
  try {
    return localStorage.getItem(NOTIFY_OFFERED_KEY) === '1'
  } catch {
    // No storage: better never to ask than to ask at every download.
    return true
  }
}

function noteOffered(): void {
  try {
    localStorage.setItem(NOTIFY_OFFERED_KEY, '1')
  } catch {
    /* see offeredBefore */
  }
  void saveDecision(NOTIFY_OFFERED_VAULT_ID, '1')
}

let deviceSync: Promise<void> | null = null

/**
 * Hold localStorage and the native layer together, once per start: the note
 * on one side counts for both. Never throws.
 */
export function syncNotifyOfferedWithDevice(): Promise<void> {
  if (deviceSync) return deviceSync
  deviceSync = loadDecision(NOTIFY_OFFERED_VAULT_ID)
    .then(async (device) => {
      if (device === undefined) return
      const local = offeredBefore()
      if (device === '1' && !local) {
        try {
          localStorage.setItem(NOTIFY_OFFERED_KEY, '1')
        } catch {
          /* see offeredBefore */
        }
      } else if (local && device !== '1') {
        await saveDecision(NOTIFY_OFFERED_VAULT_ID, '1')
      }
    })
    .catch(() => {})
  return deviceSync
}

/** Only for tests. */
export function __resetNotifySyncForTests(): void {
  deviceSync = null
}

/** Pure: is this the moment for the sentence and the question. */
export function shouldOffer(status: NotifyStatus, offered: boolean): boolean {
  return status === 'open' && !offered
}

/** The status, or 'not-needed' when native code does not answer in time: a download never hangs on this. */
async function statusSoon(ms = 1500): Promise<NotifyStatus> {
  return Promise.race([notifyStatus(), new Promise<NotifyStatus>((resolve) => setTimeout(() => resolve('not-needed'), ms))])
}

/**
 * Before the first download: one sentence, then the question of the system.
 * Resolves when the user has answered the sentence; the answer to the system
 * is not waited for.
 */
export async function offerNotifications(): Promise<void> {
  if (offeredBefore()) return
  // A note the native layer kept counts as well (the start asked it already, or asks now).
  await syncNotifyOfferedWithDevice()
  if (offeredBefore()) return
  if (!shouldOffer(await statusSoon(), false)) return
  // Written first: a question that was shown counts, also when the app is closed over it.
  noteOffered()
  const yes = await nav.confirm({
    title: S.notify.title,
    text: S.notify.text,
    confirmLabel: S.notify.confirm,
    cancelLabel: S.notify.cancel,
    // The next thing on the screen is a dialog of the system.
    risk: 'leaves-app',
    testid: 'notify',
  })
  if (!yes) return
  void askForNotifications().catch(() => false)
}

/** What a tap on the switch does in each state. Pure. */
export function switchAction(status: NotifyStatus): 'ask' | 'system-settings' {
  return status === 'open' ? 'ask' : 'system-settings'
}

export interface NotifySwitch {
  /** null while unknown, and where the system has no such question: the row is not shown. */
  status: NotifyStatus | null
  toggle: () => Promise<void>
}

/** The state for the row on the storage page. It is read again whenever the app comes back to the screen. */
export function useNotifySwitch(): NotifySwitch {
  const [status, setStatus] = useState<NotifyStatus | null>(null)
  const refresh = useCallback(async () => setStatus(await notifyStatus()), [])
  useEffect(() => {
    let alive = true
    const read = () => void notifyStatus().then((next) => alive && setStatus(next))
    read()
    // The user comes back from the settings of the system.
    const off = onLifecycle({ onForeground: read })
    return () => {
      alive = false
      off()
    }
  }, [])
  const toggle = useCallback(async () => {
    const now = await notifyStatus()
    if (switchAction(now) === 'ask') {
      noteOffered()
      await askForNotifications()
    } else {
      const opened = await openSystemSettings()
      if (!opened.opened) toast(S.notify.settingsFailed, { tone: 'error', testid: 'notify-settings-failed' })
    }
    await refresh()
  }, [refresh])
  return { status, toggle }
}
