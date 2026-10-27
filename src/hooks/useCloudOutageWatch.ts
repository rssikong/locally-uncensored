import { useEffect } from 'react'
import { useCloudAuthStore } from '../stores/cloudAuthStore'
import { refreshOutage, setOutageWatching } from '../lib/cloud-outage-watch'
import { OUTAGE_POLL_MS } from '../lib/cloud-outage'

/**
 * Asks about an LU Cloud outage while somebody is signed in: once the sign in
 * is known, then every three minutes (lib/cloud-outage.ts). Mounted once, in
 * AppShell. Signing out stops the asking and takes the line away.
 */
export function useCloudOutageWatch(): void {
  const signedIn = useCloudAuthStore((s) => s.status === 'signed-in')

  useEffect(() => {
    if (!signedIn) {
      setOutageWatching(false)
      return
    }
    setOutageWatching(true)
    void refreshOutage()
    const timer = setInterval(() => void refreshOutage(), OUTAGE_POLL_MS)
    return () => {
      clearInterval(timer)
      setOutageWatching(false)
    }
  }, [signedIn])
}
