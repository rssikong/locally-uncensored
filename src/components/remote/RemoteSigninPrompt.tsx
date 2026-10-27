import { useEffect } from 'react'
import { isTauri } from '../../api/backend'
import { useRemoteStore, normalizeSigninRequest } from '../../stores/remoteStore'
import { useCloudAuthStore } from '../../stores/cloudAuthStore'
import { Modal } from '../ui/Modal'
import { ModalActions, ModalButton } from '../ui/ModalActions'
import { useArmedAfter } from './RemotePairPrompt'

/** The question text. Pure + exported for tests. */
export function signinQuestion(account: string | null | undefined): string {
  const who = account && account.trim() ? account.trim() : 'your account'
  return `Sign this phone in to your LU account (${who})?`
}

/**
 * "Sign in with my computer" (REMOTE-PROTOKOLL v2, section 15): a paired
 * phone asks to be signed in to the account of this computer. Without Allow
 * the phone gets no code; closing the dialog counts as Deny. On Allow this
 * window fetches a one-time code for the phone's key with its own session
 * and hands only the code to the desktop side. When this computer is not
 * signed in, the phone hears that right away and nothing is shown.
 */
export function RemoteSigninPrompt() {
  const requests = useRemoteStore((s) => s.signinRequests)
  const decide = useRemoteStore((s) => s.decideSignin)
  const email = useCloudAuthStore((s) => s.user?.email)
  const authStatus = useCloudAuthStore((s) => s.status)

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    const unlisten: (() => void)[] = []
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event')
      const offRequest = await listen<unknown>('remote-signin-request', (event) => {
        const request = normalizeSigninRequest(event.payload)
        if (request) useRemoteStore.getState().addSigninRequest(request)
      })
      const offResolved = await listen<{ requestId?: string }>('remote-signin-resolved', (event) => {
        const id = event.payload?.requestId
        if (typeof id === 'string') useRemoteStore.getState().removeSigninRequest(id)
      })
      unlisten.push(offRequest, offResolved)
      if (cancelled) unlisten.forEach((f) => f())
      void useRemoteStore.getState().loadSigninRequests()
    })()
    return () => {
      cancelled = true
      unlisten.forEach((f) => f())
    }
  }, [])

  const current = requests[0]
  const signedOut = authStatus === 'signed-out'
  // A click meant for one question never lands on the next.
  const armed = useArmedAfter(current ? current.requestId : '')

  // Nothing to allow without an account here: the phone is told so at once.
  useEffect(() => {
    if (current && signedOut) void decide(current.requestId, true, true)
  }, [current, signedOut, decide])

  if (!current || signedOut) return null
  const name = current.name || 'A phone'
  return (
    <Modal open onClose={() => void decide(current.requestId, false)} title="Sign in a phone">
      <div className="space-y-2">
        <p className="t-body text-gray-700 dark:text-gray-200">{signinQuestion(email)}</p>
        <p className="t-micro text-gray-500">
          '<bdi>{name}</bdi>'{current.fingerprint ? <> (device ID <span className="t-mono">{current.fingerprint}</span>)</> : null} asked for it. The phone gets a one-time code for its own sign-in; this computer stays signed in as it is.
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
