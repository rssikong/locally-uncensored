/**
 * Notifications of the system, as far as the shell needs them: the progress
 * of a download while the app is not on the screen (Android).
 *
 * Android 13 and newer show a notification only after the user said yes. The
 * question of the system is put once per installation; native code keeps
 * that (NotifyRule.kt). iOS carries a download itself and LU shows no
 * notification there, so nothing is needed and nothing is asked.
 */
import { tryBridge } from './bridge'

/**
 *   not-needed  this system has no question for it, or there is no native layer
 *   granted     the system shows them
 *   open        not shown, and never asked: the question may be put, once
 *   refused     not shown, and the app cannot ask (again): only the settings of the system change it
 */
export type NotifyStatus = 'not-needed' | 'granted' | 'open' | 'refused'

export interface NotifyAnswer {
  granted?: boolean
  needed?: boolean
  asked?: boolean
}

/** Pure. */
export function notifyStatusOf(answer: NotifyAnswer | null | undefined): NotifyStatus {
  if (!answer) return 'not-needed'
  if (answer.granted !== false) return answer.needed === true ? 'granted' : 'not-needed'
  // Not shown. Where the system has no question (before Android 13) it was switched off in the system settings.
  if (answer.needed !== true) return 'refused'
  return answer.asked === true ? 'refused' : 'open'
}

/** The state right now. Never puts the question. */
export async function notifyStatus(): Promise<NotifyStatus> {
  try {
    const answer = await tryBridge((bridge) => bridge.notificationState?.())
    return answer.ok ? notifyStatusOf(answer.value) : 'not-needed'
  } catch {
    return 'not-needed'
  }
}

/** Put the question of the system. True when notifications are shown afterwards. */
export async function askForNotifications(): Promise<boolean> {
  try {
    const answer = await tryBridge((bridge) => bridge.requestNotificationPermission?.())
    return answer.ok ? answer.value === true : false
  } catch {
    return false
  }
}
