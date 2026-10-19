import { useEffect, useState } from 'react'
import { Check, CircleDashed } from 'lucide-react'
import { ModalButton } from '../ui/ModalActions'
import {
  getComputerPermissions,
  requestComputerPermission,
  resetComputerPermission,
  type ComputerPermission,
  type ComputerPermissions as Granted,
} from '../../api/computer'

/** How often the granted permissions are read while the rows are on screen. */
export const PERMISSION_POLL_MS = 1000

const ROWS: { permission: ComputerPermission; name: string; what: string }[] = [
  { permission: 'accessibility', name: 'Accessibility', what: 'To move the pointer, click and type.' },
  { permission: 'screen_recording', name: 'Screen Recording', what: 'To see the screen.' },
]

export function permissionGranted(granted: Granted, permission: ComputerPermission): boolean {
  return permission === 'accessibility' ? granted.accessibility : granted.screenRecording
}

/** Everything computer control needs from the system is there. */
export function allPermissionsGranted(granted: Granted | null): boolean {
  return !!granted && (!granted.needed || (granted.accessibility && granted.screenRecording))
}

/**
 * What the system has granted, read again every second while `active`. Null
 * until the first answer. macOS tells nobody when the user flips the switch,
 * so asking is the only way to notice.
 */
export function useComputerPermissions(active: boolean): Granted | null {
  const [granted, setGranted] = useState<Granted | null>(null)
  useEffect(() => {
    if (!active) return
    let gone = false
    const read = () => {
      void getComputerPermissions()
        .then((answer) => { if (!gone && answer.ok) setGranted(answer.permissions) })
        .catch(() => undefined)
    }
    read()
    const poll = setInterval(read, PERMISSION_POLL_MS)
    return () => {
      gone = true
      clearInterval(poll)
    }
  }, [active])
  return active ? granted : null
}

interface Props {
  granted: Granted | null
  className?: string
}

/**
 * The two permissions macOS wants for computer control, each with its state
 * and the one button that leads to it: the request makes macOS show its own
 * prompt and puts LU into the list, and the list opens in System Settings.
 *
 * While a row is missing it offers "Reset and ask again". That is the way out
 * when the list shows LU and switching it on changes nothing: the entry
 * belongs to a copy of LU with another signature, an older test build (the
 * owner's Mac on 07.10.2026 had two such entries from August, and one more on
 * 12.10.2026). It is there from the start, not only after Open System
 * Settings in the same view: the hint under the rows names it, and after a
 * restart of LU the row is missing again with nothing asked yet.
 */
export function ComputerPermissionRows({ granted, className = '' }: Props) {
  // Asked for in this view. Screen Recording then usually waits for a restart.
  const [asked, setAsked] = useState<ComputerPermission[]>([])
  const open = (permission: ComputerPermission) => {
    setAsked((before) => (before.includes(permission) ? before : [...before, permission]))
    void requestComputerPermission(permission).catch(() => undefined)
  }
  // The permission whose reset macOS turned down, with what to do instead.
  const [resetFailed, setResetFailed] = useState<{ permission: ComputerPermission; message: string } | null>(null)
  const reset = (permission: ComputerPermission) => {
    setResetFailed(null)
    void resetComputerPermission(permission)
      .then((answer) => { if (!answer.ok) setResetFailed({ permission, message: answer.refusal.message }) })
      .catch(() => undefined)
  }
  return (
    <ul className={`space-y-2 ${className}`} data-testid="computer-permissions">
      {ROWS.map((row) => {
        const ok = granted ? permissionGranted(granted, row.permission) : false
        return (
          <li key={row.permission} data-permission={row.permission} data-granted={ok} className="flex items-center gap-3 rounded-md border border-gray-200 dark:border-white/10 px-3 py-2">
            {ok
              ? <Check size={14} className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              : <CircleDashed size={14} className="shrink-0 text-gray-400" aria-hidden="true" />}
            <div className="min-w-0 flex-1">
              <p className="t-body text-gray-900 dark:text-white">{row.name}</p>
              <p className="t-micro leading-relaxed text-gray-500 dark:text-gray-400">
                {ok
                  ? 'Granted.'
                  : !asked.includes(row.permission)
                    ? row.what
                    : row.permission === 'screen_recording'
                      ? 'Switch LU on in the list. macOS applies this one after LU was quit and opened again.'
                      : 'Switch LU on in the list. LU notices by itself.'}
              </p>
              {!ok && granted !== null && (
                <button
                  type="button"
                  onClick={() => reset(row.permission)}
                  aria-label={`Reset and ask again for ${row.name}`}
                  className="t-micro text-gray-500 underline underline-offset-2 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                >
                  Reset and ask again
                </button>
              )}
              {resetFailed?.permission === row.permission && (
                <p className="t-micro leading-relaxed text-red-600 dark:text-red-400" role="alert">{resetFailed.message}</p>
              )}
            </div>
            {!ok && (
              <ModalButton className="shrink-0" onClick={() => open(row.permission)} aria-label={`Open System Settings for ${row.name}`}>
                Open System Settings
              </ModalButton>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** What to do when the list already shows LU switched on. Happens when the
 *  entry belongs to a copy of LU with another signature: the released app keeps
 *  its signature, and with it the permission, across updates. */
export const PERMISSION_STALE_HINT =
  'LU is switched on in the list, and this still says it is missing? Click Reset and ask again. macOS ties a permission to the exact copy of LU it was given to, so an entry left by an older test copy does not count for this one. If LU is not in the list afterwards, add it with the plus button.'
