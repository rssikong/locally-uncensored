/**
 * Choose a new password. Sheet "settings-new-password", strand 5 (Account,
 * cloud, settings).
 *
 * Comes up by itself when the link of a reset mail brought the user back
 * into the app (parts/password-reset.ts): the link has signed them in, for
 * the purpose of this one step. Saving sets the password on the account.
 * "Not now" keeps the old password and says so; the user stays signed in on
 * this phone either way, because the link already did that.
 */
import { useState } from 'react'
import { setNewPassword } from '../../../api/cloud/supabase'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'
import { useSheet } from '../../nav'
import { isOnline } from '../../platform'
import { SETTINGS_STRINGS } from '../../strings/settings'
import { Button, Notice, Sheet, toast } from '../../ui'
import { Block, Hint } from './parts/layout'
import { NEW_PASSWORD_MIN, newPasswordFailure, type NewPasswordFailure } from './parts/password-reset'
import { SecretField } from './parts/PasswordField'

const T = SETTINGS_STRINGS.newPassword

const FAILURE: Record<NewPasswordFailure, string> = {
  short: T.errShort,
  same: T.errSame,
  weak: T.errWeak,
  expired: T.errExpired,
  offline: T.errOffline,
  failed: T.errFailed,
}

export default function NewPasswordSheet() {
  const { close } = useSheet()
  const user = useCloudAuthStore((s) => s.user)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ why: NewPasswordFailure; text: string } | null>(null)

  const save = async () => {
    if (busy) return
    if (password.length < NEW_PASSWORD_MIN) {
      setError({ why: 'short', text: T.errShort })
      return
    }
    if (!isOnline()) {
      setError({ why: 'offline', text: T.errOffline })
      return
    }
    setBusy(true)
    setError(null)
    try {
      await setNewPassword(password)
      // The typed password leaves the page at once.
      setPassword('')
      toast(T.saved, { testid: 'password-changed' })
      close()
    } catch (err) {
      const why = newPasswordFailure(err, isOnline())
      setError({ why, text: FAILURE[why] })
    } finally {
      setBusy(false)
    }
  }

  const inField = error && (error.why === 'short' || error.why === 'same' || error.why === 'weak')

  return (
    <Sheet
      title={T.title}
      footer={
        <div className="m-stackv" style={{ gap: 'var(--m-s2)' }}>
          <Button variant="primary" block busy={busy} label={busy ? T.saving : undefined} onPress={() => void save()} testid="m-account-new-password-save">
            {T.save}
          </Button>
          <Button variant="quiet" block disabled={busy} onPress={close} testid="m-account-new-password-not-now">
            {T.notNow}
          </Button>
        </div>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <Block lead>
          <Hint strong testid="m-account-new-password-text">
            {T.text(user?.email ?? '')}
          </Hint>
          <SecretField
            label={T.label}
            autoComplete="new-password"
            value={password}
            onChange={(value) => {
              setPassword(value)
              setError(null)
            }}
            onSubmit={() => void save()}
            error={inField ? error.text : undefined}
            hint={T.hint}
            disabled={busy}
            testid="m-account-new-password"
            showTestid="m-account-new-password-show"
          />
          <Hint>{T.notNowHint}</Hint>
        </Block>
      </form>
      {error && !inField ? (
        <Notice variant="error" testid="m-account-new-password-error">
          {error.text}
        </Notice>
      ) : null}
    </Sheet>
  )
}
