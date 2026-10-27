/**
 * "Sign in with my computer" on the page Account (LU 3.0.7, PROTOKOLL 15).
 *
 * Shown only when all of this holds: the build has Create over the
 * computer (store switch remoteCreate), the way is switched on
 * (SIGNIN_WITH_COMPUTER_ENABLED, off until lu-labs.ai has it live), and a
 * computer is paired over the sealed channel, connected, and names `signin`
 * in its signed in status. The phone gets its own session; the computer's
 * stays where it is.
 */
import { useEffect, useRef, useState } from 'react'
import { Monitor } from 'lucide-react'
import { supabaseCloud } from '../../../../api/cloud/supabase'
import { probeAccount } from '../../../../hooks/useCloudAuth'
import { useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import { remoteCreateOffered } from '../../../policy/gates'
import { ComputerSigninError, computerSigninOffered, signInWithComputer } from '../../../remote/computerSignin'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { Button, Notice, toast } from '../../../ui'
import { remote, useRemote } from '../../remote/parts/session'
import { Block, Hint } from './layout'

const T = SETTINGS_STRINGS.account

/**
 * Until when the computer said to wait (`retry-after` of its 429), ms. Kept
 * for the life of the app, not in storage: leaving the page and coming back
 * does not unlock the button early.
 */
let waitUntil = 0

export function ComputerSignIn({ disabled }: { disabled?: boolean }) {
  return remoteCreateOffered() ? <Offered disabled={disabled} /> : null
}

function Offered({ disabled }: { disabled?: boolean }) {
  const status = useRemote((s) => s.status)
  const pinned = useRemote((s) => !!s.connection?.pin)
  const features = useRemote((s) => s.features)
  const name = useRemote((s) => s.connection?.pin?.name || s.connection?.hostName || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const waiting = Math.max(0, Math.ceil((waitUntil - now) / 1000))
  useEffect(() => {
    if (waiting <= 0) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [waiting])
  if (status !== 'connected' || !pinned || !computerSigninOffered(features)) return null

  const go = async () => {
    const ch = remote().desktopChannel()
    if (!ch || busy || waitUntil > Date.now()) return
    const ctrl = new AbortController()
    abort.current = ctrl
    setBusy(true)
    setError(null)
    try {
      await signInWithComputer({
        channel: ch,
        fetch: (url, init) => globalThis.fetch(url, init),
        verifyOtp: (args) => supabaseCloud().auth.verifyOtp(args),
        signal: ctrl.signal,
      })
      await probeAccount()
      if (useCloudAuthStore.getState().status === 'signed-in') toast(T.signedInToast, { testid: 'signed-in' })
    } catch (err) {
      if (ctrl.signal.aborted) return
      if (err instanceof ComputerSigninError && err.retryAfterSeconds) {
        waitUntil = Date.now() + err.retryAfterSeconds * 1000
        setNow(Date.now())
      }
      setError(err instanceof ComputerSigninError ? err.message : String((err as Error)?.message ?? err))
    } finally {
      if (abort.current === ctrl) abort.current = null
      setBusy(false)
    }
  }

  return (
    <Block testid="m-account-computer">
      <Button
        block
        icon={Monitor}
        busy={busy}
        disabled={disabled || waiting > 0}
        disabledReason={waiting > 0 ? T.computerWait(waiting) : undefined}
        onPress={() => void go()}
        testid="m-account-computer-signin"
      >
        {busy ? T.computerWaiting : T.computer}
      </Button>
      <Hint>{T.computerSub(name)}</Hint>
      {busy ? (
        <Button compact variant="quiet" onPress={() => abort.current?.abort()} testid="m-account-computer-cancel">
          {T.computerCancel}
        </Button>
      ) : null}
      {error ? (
        <Notice variant="error" testid="m-account-computer-error">
          {error}
        </Notice>
      ) : null}
    </Block>
  )
}
