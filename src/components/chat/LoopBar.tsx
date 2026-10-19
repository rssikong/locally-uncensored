// The running /loop, above the composer, with the brake.
//
// A loop has no pass ceiling unless the user sets one, so it can genuinely run
// all night. That is only honest if it is visible the whole time and one click
// from stopping. An endless job you cannot see is not a feature, it is a bill.

import { useEffect, useState } from 'react'
import { RefreshCw, Square } from 'lucide-react'
import { useConversationLoop } from '../../stores/agentLoopStore'
import { useChatStore } from '../../stores/chatStore'
import { COMPOSER_MAX_W } from './composer-width'

interface Props {
  /** Stops the run AND the pending pass. */
  onStop: () => void
}

/**
 * The seconds until the next pass, as the bar shows them.
 *
 * `now` is the clock of the last tick, and until the first tick after a pass
 * was armed it is older than the arming: the clock of the mount, or of the
 * tick before. Read plainly that gave "next in 36s" for a pause of 30 s. A
 * pass is never further away than the pause itself, so that is the ceiling.
 */
export function loopCountdownSecs(loop: { nextAt: number; intervalMs: number }, now: number): number {
  const left = Math.ceil((loop.nextAt - now) / 1000)
  return Math.max(0, Math.min(left, Math.ceil(loop.intervalMs / 1000)))
}

export function LoopBar({ onStop }: Props) {
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  // Only the ACTIVE conversation's own loop, never a foreign one (B2): the
  // store now holds one per conversation, and a loop running elsewhere must
  // not paint this bar or steal its Stop button.
  const loop = useConversationLoop(activeConversationId)
  // The clock the countdown divides by, read once a second in the interval
  // instead of on every render. Reading `Date.now()` down in the render body
  // was impure (React 19 `purity`) AND it made the countdown depend on
  // something re-rendering this bar, which is not what "counts down" means.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!loop) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [loop])

  if (!loop) return null

  const secs = loopCountdownSecs(loop, now)
  const passLabel = loop.cap > 0 ? `pass ${loop.pass} of ${loop.cap}` : `pass ${loop.pass}`

  return (
    <div className={`w-full ${COMPOSER_MAX_W} mx-auto px-3 pb-1 flex justify-center`}>
      <div className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md border border-blue-500/25 bg-blue-500/[0.05]">
        <RefreshCw size={9} className="text-blue-400 shrink-0 animate-spin" style={{ animationDuration: '3s' }} />
        <span className="text-[0.55rem] uppercase tracking-wider text-gray-500 shrink-0">loop</span>
        <span className="t-micro text-gray-700 dark:text-gray-300 shrink-0">{passLabel}</span>
        <span className="flex-1 min-w-0 truncate t-micro text-gray-500" title={loop.task}>
          {loop.task}
        </span>
        <span className="text-[0.55rem] text-gray-500 shrink-0 tabular-nums">
          {secs > 0 ? `next in ${secs}s` : 'running'}
        </span>
        <button
          // Called bare: the click event is not an argument of Stop (GH #140).
          onClick={() => onStop()}
          title="Stop the loop"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.55rem] text-gray-600 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-white/10 transition-colors shrink-0"
        >
          <Square size={8} /> stop
        </button>
      </div>
    </div>
  )
}
