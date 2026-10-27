import { useEffect, useState } from 'react'
import { isTauri } from '../../api/backend'
import { useRemoteStore, type PairRequest } from '../../stores/remoteStore'
import { Modal } from '../ui/Modal'
import { ModalActions, ModalButton } from '../ui/ModalActions'

/** "432554" reads as "432 554", the way the phone shows it. */
export function spacedCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code
}

/**
 * The question at the desktop for every new phone of the sealed channel
 * (REMOTE-PROTOKOLL v2, 5.1 and 5.2): "Allow '<name>' to use LU on this
 * computer?". Without Allow the pairing has no effect; closing the dialog
 * counts as Deny. On both paths the six digits of the comparison
 * code stand in the question, so a stranger in the same network shows up.
 */
/** After the question changes, Allow and Deny wait this long, so a click
 *  meant for one phone never lands on the next. */
export const PROMPT_ARM_MS = 1000

/** True once `key` has stood still for `ms`. */
export function useArmedAfter(key: string, ms: number = PROMPT_ARM_MS): boolean {
  const [armed, setArmed] = useState<string | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setArmed(key), ms)
    return () => clearTimeout(t)
  }, [key, ms])
  return armed === key
}

export function RemotePairPrompt() {
  const requests = useRemoteStore((s) => s.pairRequests)
  const decide = useRemoteStore((s) => s.decidePairing)
  const current0 = requests[0]
  const armed = useArmedAfter(current0 ? `${current0.requestId}|${current0.name}|${current0.comparisonCode ?? ''}` : '')

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    const unlisten: (() => void)[] = []
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event')
      const store = useRemoteStore.getState()
      const offRequest = await listen<Partial<PairRequest>>('remote-pair-request', (event) => {
        const p = event.payload ?? {}
        if (typeof p.requestId !== 'string') return
        useRemoteStore.getState().addPairRequest({
          requestId: p.requestId,
          name: typeof p.name === 'string' ? p.name : '',
          platform: typeof p.platform === 'string' ? p.platform : '',
          comparisonCode: typeof p.comparisonCode === 'string' ? p.comparisonCode : null,
          fingerprint: typeof p.fingerprint === 'string' ? p.fingerprint : '',
        })
        // A code pairing uses its code up: show the new one.
        void useRemoteStore.getState().refreshStatus()
      })
      const offResolved = await listen<{ requestId?: string }>('remote-pair-resolved', (event) => {
        const id = event.payload?.requestId
        if (typeof id === 'string') useRemoteStore.getState().removePairRequest(id)
      })
      const offDevices = await listen('remote-devices-changed', () => {
        void useRemoteStore.getState().refreshPairedDevices()
      })
      // The address directory took (or refused) this computer's address.
      const offAnnounce = await listen('remote-announce-changed', () => {
        void useRemoteStore.getState().refreshPairedDevices()
      })
      // A code was used up or failed too often: show the new one.
      const offCode = await listen('remote-passcode-changed', () => {
        void useRemoteStore.getState().refreshStatus()
      })
      unlisten.push(offRequest, offResolved, offDevices, offAnnounce, offCode)
      if (cancelled) unlisten.forEach((f) => f())
      // A request that came in before this window (re)loaded.
      void store.loadPairRequests()
    })()
    return () => {
      cancelled = true
      unlisten.forEach((f) => f())
    }
  }, [])

  const current = requests[0]
  if (!current) return null
  const name = current.name || 'A phone'
  return (
    <Modal open onClose={() => void decide(current.requestId, false)} title="Pair a phone">
      <div className="space-y-2">
        <p className="t-body text-gray-700 dark:text-gray-200">
          Allow '<bdi>{name}</bdi>' to use LU on this computer?
        </p>
        {current.fingerprint && (
          <p className="t-micro text-gray-500">
            Device ID <span className="t-mono">{current.fingerprint}</span>, the same as on the phone.
          </p>
        )}
        {requests.length > 1 && (
          <p role="status" className="t-micro text-red-500 dark:text-red-400">
            {requests.length - 1 === 1 ? 'One more phone asks' : `${requests.length - 1} more phones ask`} to pair right now. Allow only the phone you hold in your hand.
          </p>
        )}
        {current.comparisonCode && (
          <p className="t-body text-gray-700 dark:text-gray-200">
            Check that the phone shows <span className="t-mono font-bold">{spacedCode(current.comparisonCode)}</span>. If it shows other digits, deny.
          </p>
        )}
        <p className="t-micro text-gray-500">
          The phone can then chat with your models and use web tools. Files, terminal and Create stay off until you turn them on in Settings, Remote Access.
        </p>
        <ModalActions>
          <ModalButton variant="quiet" disabled={!armed} onClick={() => void decide(current.requestId, false)}>
            Deny
          </ModalButton>
          <ModalButton variant="primary" disabled={!armed} onClick={() => void decide(current.requestId, true)}>
            Allow
          </ModalButton>
        </ModalActions>
      </div>
    </Modal>
  )
}
