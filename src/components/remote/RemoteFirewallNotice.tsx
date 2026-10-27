import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { backendCall, isTauri } from '../../api/backend'
import { useRemoteStore } from '../../stores/remoteStore'
import { HINWEIS_TEXT } from '../../lib/hinweis'

/** What Rust says about the Windows Firewall (commands/win_firewall.rs). */
export interface FirewallStatus {
  checked: boolean
  blocked: boolean
  reason: 'blocked' | 'no_allow' | null
  profile: 'private' | 'public' | 'domain' | null
}

export const FIREWALL_TEXT = 'Windows Firewall blocks LU on this network, so your phone cannot reach this computer on Wi-Fi.'
export const PUBLIC_NETWORK_TEXT = 'Windows treats this Wi-Fi as a public network. If it is your home network, set it to Private in Windows Settings, Network & internet.'

/** A status from Rust, checked field by field. Pure + exported for tests. */
export function normalizeFirewallStatus(raw: unknown): FirewallStatus {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const reason = r.reason === 'blocked' || r.reason === 'no_allow' ? r.reason : null
  const profile = r.profile === 'private' || r.profile === 'public' || r.profile === 'domain' ? r.profile : null
  return { checked: r.checked === true, blocked: r.blocked === true, reason, profile }
}

/**
 * The line in the Remote panel when Windows drops the Wi-Fi way for LU:
 * "Allow LU" puts in one allow rule for this exe (one Windows question,
 * nothing without the click); the internet link is the way around it.
 */
export function RemoteFirewallNotice() {
  const enabled = useRemoteStore((s) => s.enabled)
  const [status, setStatus] = useState<FirewallStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isTauri() || !enabled) return
    let off: (() => void) | null = null
    let gone = false
    void backendCall<unknown>('remote_firewall_status').then((s) => { if (!gone) setStatus(normalizeFirewallStatus(s)) }).catch(() => {})
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen<unknown>('remote-firewall', (e) => setStatus(normalizeFirewallStatus(e.payload))))
      .then((u) => { if (gone) u(); else off = u })
      .catch(() => {})
    return () => { gone = true; off?.() }
  }, [enabled])

  if (!enabled || !status?.blocked) return null

  const allow = async () => {
    setBusy(true)
    setError(null)
    try {
      const s = normalizeFirewallStatus(await backendCall<unknown>('remote_firewall_allow'))
      setStatus(s)
      if (s.blocked) setError('Windows still blocks LU on this network.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const switchToInternet = async () => {
    const store = useRemoteStore.getState()
    await store.setAnywhere(true)
    if (!useRemoteStore.getState().tunnelActive) await useRemoteStore.getState().startTunnel()
  }

  return (
    <div className="w-full rounded border border-red-500/30 px-2 py-1.5 space-y-1.5" role="alert" data-testid="remote-firewall-notice">
      <div className="flex items-start gap-1.5">
        <ShieldAlert size={12} className={`shrink-0 mt-px ${HINWEIS_TEXT.fehler}`} />
        <p className="t-micro leading-snug text-gray-700 dark:text-gray-300">{FIREWALL_TEXT}</p>
      </div>
      {status.profile === 'public' && (
        <p className={`t-micro leading-snug ${HINWEIS_TEXT.ruhig}`}>{PUBLIC_NETWORK_TEXT}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => void allow()}
          disabled={busy}
          className="t-micro px-2 py-0.5 rounded border border-gray-300 dark:border-white/15 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-50"
          title="Windows asks once for permission. LU adds one rule that allows only this program."
        >
          {busy ? 'Waiting for Windows…' : 'Allow LU'}
        </button>
        <button
          onClick={() => void switchToInternet()}
          className="t-micro px-2 py-0.5 rounded border border-gray-300 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5"
        >
          Use the internet link instead
        </button>
      </div>
      {error && <p className={`t-micro ${HINWEIS_TEXT.fehler}`}>{error}</p>}
    </div>
  )
}
