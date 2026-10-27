/**
 * "Try again" on a page that says there is no internet (M1, A2).
 *
 * THE ONE PLACE that asks the network monitor to look again:
 * `recheckOnline()` of resilience/useOnline.ts asks the system through the
 * native layer and tells every useOnline(). The button shows "Checking"
 * while the answer is out and answers in words either way.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { isOnline } from '../../../platform'
import { recheckOnline as askMonitor } from '../../../resilience/useOnline'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { toast } from '../../../ui'

/**
 * How long "Checking" stays at least. The system answers within a few
 * milliseconds; without the pause the button would not be seen to react.
 */
export const RECHECK_PAUSE_MS = 600
/** How long the button shows "Checking" at least, in milliseconds. */
export const CHECKING_SHOWN_MS = 450

/** Look again. True when the phone has a network now. Never throws. */
export async function recheckOnline(): Promise<boolean> {
  const shown = new Promise<void>((done) => setTimeout(done, RECHECK_PAUSE_MS))
  let online: boolean
  try {
    online = (await askMonitor()) === true
  } catch {
    online = isOnline()
  }
  await shown
  return online
}

/**
 * The button "Try again": `checking` while the answer is out, and a toast
 * when the phone is still offline. When it is online again the page shows
 * its content by itself, which is the answer.
 */
export function useRecheck(): { checking: boolean; recheck: () => void } {
  const [checking, setChecking] = useState(false)
  const alive = useRef(true)
  const running = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const recheck = useCallback(() => {
    if (running.current) return
    running.current = true
    setChecking(true)
    // The system answers within a blink. The word "Checking" stays long enough to be read, so the
    // tap is seen to have done something before the answer comes.
    const seen = new Promise<void>((done) => setTimeout(done, CHECKING_SHOWN_MS))
    void Promise.all([recheckOnline(), seen]).then(([online]) => {
      running.current = false
      if (!alive.current) return
      setChecking(false)
      if (!online) toast(S.detail.stillOffline, { testid: 'still-offline' })
    })
  }, [])
  return { checking, recheck }
}
