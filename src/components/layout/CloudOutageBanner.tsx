import { X } from 'lucide-react'
import { useCloudOutageStore } from '../../stores/cloudOutageStore'
import { useCloudAuthStore } from '../../stores/cloudAuthStore'
import { HINWEIS_TEXT, HINWEIS_ZEILE } from '../../lib/hinweis'

/**
 * 3.0.8, A28: the line for an LU Cloud outage the server announced
 * (lib/cloud-outage.ts). Only for somebody signed in to LU Cloud, a purely
 * local app has nothing that could fail.
 *
 * Same quiet-row form as StaleModelsBanner: the app works, local models too,
 * so no filled warning colour, and `role="status"` so a screen reader is not
 * interrupted. Closing it holds for this sentence, a new one shows again.
 */
export function CloudOutageBanner() {
  const { active, message, dismissedMessage, dismiss } = useCloudOutageStore()
  const signedIn = useCloudAuthStore((s) => s.status === 'signed-in')

  if (!signedIn || !active || !message || dismissedMessage === message) return null

  return (
    <div role="status" data-testid="cloud-outage-banner" className={`${HINWEIS_ZEILE} ${HINWEIS_TEXT.ruhig} px-3 py-1`}>
      <span className="flex-1 min-w-0 self-center">{message}</span>
      <button
        onClick={dismiss}
        className="self-center shrink-0 rounded p-[1px] opacity-70 hover:opacity-100 transition-opacity"
        aria-label="Dismiss. It comes back when LU Cloud posts a new update."
        title="Dismiss. It comes back when LU Cloud posts a new update."
      >
        <X size={11} />
      </button>
    </div>
  )
}
