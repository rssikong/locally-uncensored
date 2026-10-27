/**
 * Back in the app, but the browser did not send the link.
 *
 * Google, GitHub and the mail of "Forgot password?" end in the browser of the
 * system, and the browser hands lu://oauth/callback back to the app. When the
 * account server does not lead there (the address is not on its list, or the
 * mail was opened on another device), the browser stays on a web page and the
 * user comes back to LU by hand. Before round 43 the page then went on waiting
 * for up to five minutes, with a busy button and nothing to do (check on the
 * Android phone, 15.10.2026).
 *
 * This hook watches for that return. When the app is on screen again while a
 * link is awaited, it waits a short while (the link itself also wakes the app,
 * and it is handed over a moment after the return) and then asks the logic
 * layer whether a link came. If none did, `onMissing` runs once.
 *
 * A link that comes later is still taken: the logic layer keeps expecting it
 * (api/cloud/supabase.ts, expectOAuthCallback) and finishes it by itself.
 */
import { useEffect, useRef } from 'react'
import { oauthCallbackSeenSince } from '../../../../api/cloud/supabase'
import { useAppLifecycle } from '../../../platform/lifecycle'

/** How long after the return the link may still come before the page speaks. */
export const NO_LINK_BACK_GRACE_MS = 2000

/**
 * `since`: when the wait for the link began (Date.now()), or null when no link
 * is awaited. `onMissing` runs when the user is back, the grace is over and no
 * link came since then. It is read when the grace ends, so it may check what
 * holds at that moment.
 */
export function useNoLinkBack(since: number | null, onMissing: () => void): void {
  const sinceRef = useRef(since)
  const missing = useRef(onMissing)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    sinceRef.current = since
    missing.current = onMissing
  })

  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  // A wait that ends, or a page that goes, takes its timer along.
  useEffect(() => stop, [since])

  useAppLifecycle({
    onForeground: () => {
      const start = sinceRef.current
      if (start === null) return
      stop()
      timer.current = setTimeout(() => {
        timer.current = null
        if (sinceRef.current !== start) return
        if (oauthCallbackSeenSince(start)) return
        missing.current()
      }, NO_LINK_BACK_GRACE_MS)
    },
  })
}
