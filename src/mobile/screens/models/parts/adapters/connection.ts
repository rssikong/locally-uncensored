/**
 * Is the phone on mobile data right now, as something a screen can watch.
 *
 * The system is asked through the native layer (platform `connectionKind`). There is
 * no event for "left the Wi-Fi", so while a screen watches, the question is
 * asked again every few seconds, on every change the browser reports and on
 * the return to the app. Nobody watching means no timer.
 */
import { useSyncExternalStore } from 'react'
import { connectionKind, onLifecycle, onNetworkChange } from '../../../../platform'

export const CONNECTION_RECHECK_MS = 5000

let cellular = false
const listeners = new Set<() => void>()
let stop: (() => void) | null = null

async function refresh(): Promise<void> {
  let next = false
  try {
    next = (await connectionKind()) === 'cellular'
  } catch {
    next = false
  }
  if (next === cellular) return
  cellular = next
  for (const fn of [...listeners]) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  if (!stop) {
    const timer = setInterval(() => void refresh(), CONNECTION_RECHECK_MS)
    const offNet = onNetworkChange(() => void refresh())
    const offLife = onLifecycle({ onForeground: () => void refresh() })
    stop = () => {
      clearInterval(timer)
      offNet()
      offLife()
    }
    void refresh()
  }
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && stop) {
      stop()
      stop = null
    }
  }
}

/** True while the phone says it is on mobile data. Unknown counts as not. */
export function useOnMobileData(): boolean {
  return useSyncExternalStore(subscribe, () => cellular, () => false)
}

/**
 * Pure: a download that stands still because of "Download on Wi-Fi only".
 * A row that moves is never called waiting, whatever the switch says (the
 * user may have allowed this one on mobile data).
 */
export function heldForWifi(row: { status: string; speed?: number }, wifiOnly: boolean, onMobileData: boolean): boolean {
  if (!wifiOnly || !onMobileData) return false
  if (row.status !== 'connecting' && row.status !== 'downloading') return false
  return !(typeof row.speed === 'number' && row.speed > 0)
}
