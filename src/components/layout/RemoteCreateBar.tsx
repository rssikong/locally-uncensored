import { useState } from 'react'
import { Smartphone, X } from 'lucide-react'
import { useRemoteCreateStore, cancelRemoteCreateJob } from '../../lib/remote-create-runner'
import { HINWEIS_TEXT, HINWEIS_ZEILE } from '../../lib/hinweis'

/**
 * "Your phone is creating": the one visible line while a paired phone has
 * this computer render (lib/remote-create-runner.ts). Same quiet row as
 * BackgroundShutdownBanner; Cancel ends the job in the engine, exactly as a
 * cancel from the phone does.
 */
export function RemoteCreateBar() {
  const running = useRemoteCreateStore((s) => s.running)
  const queued = useRemoteCreateStore((s) => s.queued)
  const [stopping, setStopping] = useState<string | null>(null)

  if (!running) return null

  const what = running.kind === 'video' || running.kind === 'image-to-video' ? 'a video' : running.count > 1 ? `${running.count} images` : 'an image'
  const pct = Math.round(Math.min(1, Math.max(0, running.progress)) * 100)
  const waiting = queued > 0 ? `, ${queued} more waiting` : ''

  const cancel = () => {
    setStopping(running.id)
    void cancelRemoteCreateJob(running.id).catch(() => null).finally(() => setStopping(null))
  }

  return (
    <div role="status" className={`${HINWEIS_ZEILE} ${HINWEIS_TEXT.ruhig} px-3 py-1`}>
      <Smartphone size={11} className="self-center shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-0 self-center truncate" title={running.prompt}>
        Your phone is creating {what} on this computer{running.step_text ? `: ${running.step_text}` : ''} ({pct}%){waiting}
      </span>
      <button
        onClick={cancel}
        disabled={stopping === running.id}
        className="self-center shrink-0 inline-flex items-center gap-1 rounded px-1 t-micro opacity-80 hover:opacity-100 disabled:opacity-40 transition-opacity"
        aria-label="Cancel the phone's job"
        title="Cancel"
      >
        <X size={11} />
        Cancel
      </button>
    </div>
  )
}
