import { useEffect, useRef } from 'react'

/** The shortest gap between two re-reads triggered by coming back to the app. */
export const REREAD_MIN_INTERVAL_MS = 30_000

/**
 * Runs `reread` when the user comes back to the app (window focus, or the page
 * turning visible again), at most once per `minIntervalMs`.
 *
 * Built for Create (box run d307-b, H3): a model file copied into a ComfyUI
 * folder by hand fires no in-app event, so Create kept the list it read when it
 * opened and only saw the new file after a visit to another page remounted it.
 * Coming back from the file manager is a focus change, which is exactly the
 * moment a re-read is worth one request.
 *
 * The mount counts as a read: the caller already reads its lists when it opens,
 * so a focus event right after that is skipped. Focus and visibilitychange
 * often fire together; the interval makes that a single read. `skip` lets the
 * caller hold back while something heavy is running.
 */
export function useRereadOnReturn(
  reread: () => void,
  opts: { minIntervalMs?: number; skip?: () => boolean } = {},
): void {
  const minIntervalMs = opts.minIntervalMs ?? REREAD_MIN_INTERVAL_MS
  const rereadRef = useRef(reread)
  const skipRef = useRef(opts.skip)
  useEffect(() => {
    rereadRef.current = reread
    skipRef.current = opts.skip
  })

  useEffect(() => {
    let lastRead = Date.now()
    const onReturn = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (Date.now() - lastRead < minIntervalMs) return
      if (skipRef.current?.()) return
      lastRead = Date.now()
      rereadRef.current()
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [minIntervalMs])
}
