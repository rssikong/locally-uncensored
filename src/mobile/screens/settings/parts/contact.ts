/**
 * "Contact support": the mail app, or the address in the clipboard.
 *
 * A phone answers "opened" to a mailto link even when no mail app is set
 * up; then nothing comes to the front and the user is left with a button
 * that did nothing (acceptance iOS, M3). So the app does not trust the
 * answer. It watches whether it really left the foreground. If it did not,
 * no mail app took the link: the address is copied and the caller says so.
 */
import { copyText } from '../../../platform'
import { lifecycleState, onLifecycle } from '../../../platform/lifecycle'
import { SUPPORT_EMAIL, SUPPORT_MAILTO, openAppLink } from '../../../policy/links'

/** How long a mail app gets to come to the front. */
export const MAIL_APP_WAIT_MS = 1500

/** mail-app: a mail app took over. copied: none did, the address is in the clipboard. shown: none did and copying failed too. */
export type ContactOutcome = 'mail-app' | 'copied' | 'shown'

export interface ContactDeps {
  open: (url: string) => Promise<{ opened: boolean }>
  copy: (text: string) => Promise<boolean>
  /** Resolves true when the app left the foreground within the time, false when it stayed. */
  leftForeground: (ms: number) => Promise<boolean>
}

function leftForeground(ms: number): Promise<boolean> {
  if (lifecycleState() === 'background') return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    let done = false
    const finish = (left: boolean) => {
      if (done) return
      done = true
      off()
      clearTimeout(timer)
      resolve(left)
    }
    const off = onLifecycle({ onBackground: () => finish(true) })
    const timer = setTimeout(() => finish(false), ms)
  })
}

const REAL: ContactDeps = { open: openAppLink, copy: copyText, leftForeground }

export async function contactSupport(deps: ContactDeps = REAL): Promise<ContactOutcome> {
  // Start watching before the link is handed over: a mail app can be in front before the call returns.
  const left = deps.leftForeground(MAIL_APP_WAIT_MS)
  const result = await deps.open(SUPPORT_MAILTO).catch(() => ({ opened: false }))
  if (result.opened && (await left)) return 'mail-app'
  return (await deps.copy(SUPPORT_EMAIL).catch(() => false)) ? 'copied' : 'shown'
}
