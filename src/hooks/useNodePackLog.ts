import { useCallback, useEffect, useRef, useState } from 'react'
import { readNodeLog } from '../api/custom-node-packs'

const POLL_MS = 800
const KEEP = 300

/**
 * The log of one node pack action (install, update, remove), read from the
 * backend while it runs. `start` marks where this action's lines begin, so a
 * second action never shows the lines of the first one.
 */
export function useNodePackLog() {
  const [lines, setLines] = useState<string[]>([])
  const mark = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const reading = useRef(false)

  const poll = useCallback(async () => {
    if (mark.current === null || reading.current) return
    reading.current = true
    try {
      const next = await readNodeLog(mark.current)
      if (next.lines.length > 0) setLines((prev) => [...prev, ...next.lines].slice(-KEEP))
      mark.current = next.next
    } catch {
      // No log to read (browser preview): the action still runs and reports its result.
    } finally {
      reading.current = false
    }
  }, [])

  const clear = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }

  const start = useCallback(async () => {
    clear()
    setLines([])
    try {
      mark.current = (await readNodeLog()).next
    } catch {
      mark.current = null
      return
    }
    timer.current = setInterval(() => { void poll() }, POLL_MS)
  }, [poll])

  const stop = useCallback(async () => {
    clear()
    // Let a read that is still under way land first, then pick up the last lines.
    for (let i = 0; reading.current && i < 20; i++) await new Promise((r) => setTimeout(r, 50))
    await poll()
  }, [poll])

  useEffect(() => clear, [])

  return { lines, start, stop }
}
