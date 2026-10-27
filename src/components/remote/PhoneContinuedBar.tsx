import { Smartphone } from 'lucide-react'
import { useDeskGateStore, openWaitingTurn } from '../../lib/remote-desk-gate'

/**
 * "Your phone continued <Chat>. Open": a phone turn waits because someone
 * types at the desktop in another chat (lib/remote-desk-gate.ts). Open runs
 * it now and shows the chat; otherwise it runs after a quiet minute.
 */
export function PhoneContinuedBar() {
  const waiting = useDeskGateStore((s) => s.waiting)
  if (waiting.length === 0) return null
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-1.5 items-center pointer-events-none" role="status" aria-live="polite">
      {waiting.slice(-3).map((w) => (
        <div key={w.key} className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1e1e1e] shadow-lg max-w-[90vw]">
          <Smartphone size={13} className="text-gray-500 shrink-0" />
          <span className="t-micro text-gray-700 dark:text-gray-300 truncate">
            Your phone continued <bdi className="font-medium">{w.title || 'a chat'}</bdi>.
          </span>
          <button
            onClick={() => openWaitingTurn(w.key)}
            className="t-micro px-2 py-0.5 rounded border border-blue-500/40 text-blue-500 dark:text-blue-400 hover:bg-blue-500/10 shrink-0"
          >
            Open
          </button>
        </div>
      ))}
    </div>
  )
}
