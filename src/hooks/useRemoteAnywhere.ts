import { useEffect } from 'react'
import { isTauri } from '../api/backend'
import { useRemoteStore } from '../stores/remoteStore'

/**
 * "Reach this computer from anywhere": when LU starts and at least one phone
 * is paired over the sealed channel, Remote and the tunnel come up again by
 * themselves. The tunnel address is then announced, signed with this
 * computer's key, to the address directory on lu-labs.ai, so a paired phone
 * finds the computer away from home (commands/remote_sealed.rs).
 */
export function useRemoteAnywhere(): void {
  useEffect(() => {
    if (!isTauri()) return
    void (async () => {
      const store = useRemoteStore.getState()
      await store.refreshPairedDevices()
      const { sealedInfo, pairedDevices } = useRemoteStore.getState()
      if (!sealedInfo.available || !sealedInfo.anywhere || pairedDevices.length === 0) return
      await store.refreshStatus()
      try {
        if (!useRemoteStore.getState().enabled) await useRemoteStore.getState().startServer()
        // Nobody stands at the computer: no QR panel.
        useRemoteStore.getState().hideQr()
        if (!useRemoteStore.getState().tunnelActive) await useRemoteStore.getState().startTunnel()
      } catch {
        // The error is in the store and shows in the Remote panel.
      }
    })()
  }, [])
}
