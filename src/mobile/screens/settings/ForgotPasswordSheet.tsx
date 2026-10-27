/**
 * Forgot password. Sheet "settings-forgot-password", opened from the Account
 * page with the address that is already typed, strand 5 (Account, cloud,
 * settings).
 *
 * One field and one button. The auth server answers the same for an address
 * with an account and for one without, so the sheet never says "sent": it
 * says that a mail is on its way IF the address has an account, and what to
 * do next. The link in that mail leads back into this app, where "Choose a
 * new password" comes up (NewPasswordSheet.tsx).
 *
 * When the user comes back to the app after the mail and no link came with
 * him, the sheet asks whether the link opened a web page instead (round 43):
 * the account server leads there when it does not know the way back into the
 * app. A link that comes later is still taken.
 */
import { useState } from 'react'
import { MailCheck, WifiOff } from 'lucide-react'
import { requestPasswordReset } from '../../../api/cloud/supabase'
import { useSheet } from '../../nav'
import { isOnline } from '../../platform'
import { useOnline } from '../../resilience/useOnline'
import { SETTINGS_STRINGS } from '../../strings/settings'
import { Button, Field, Notice, Sheet } from '../../ui'
import { Block, Hint } from './parts/layout'
import { useNoLinkBack } from './parts/no-link-back'
import { resetRequestFailure, validResetEmail, type ResetRequestFailure } from './parts/password-reset'

const T = SETTINGS_STRINGS.reset
const A = SETTINGS_STRINGS.account

const FAILURE: Record<ResetRequestFailure, string> = {
  offline: T.errOffline,
  'too-many': T.errTooMany,
  'email-invalid': T.errEmail,
  failed: T.errFailed,
}

export default function ForgotPasswordSheet() {
  const { props, close } = useSheet<{ email?: string } | undefined>()
  const online = useOnline()
  const [email, setEmail] = useState(typeof props?.email === 'string' ? props.email : '')
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<{ text: string; field: boolean } | null>(null)
  /** When the last link was asked for. The look on the return to the app starts from here. */
  const [sentAt, setSentAt] = useState<number | null>(null)
  const [notBack, setNotBack] = useState(false)

  useNoLinkBack(sentAt, () => setNotBack(true))

  const send = async () => {
    if (busy) return
    if (!validResetEmail(email)) {
      setError({ text: T.errEmail, field: true })
      return
    }
    if (!isOnline()) {
      setError({ text: T.errOffline, field: false })
      return
    }
    setBusy(true)
    setError(null)
    setNotBack(false)
    try {
      await requestPasswordReset(email)
      setSentTo(email.trim())
      setSentAt(Date.now())
    } catch (err) {
      const why = resetRequestFailure(err, isOnline())
      setError({ text: FAILURE[why], field: why === 'email-invalid' })
    } finally {
      setBusy(false)
    }
  }

  const sent = sentTo !== null

  return (
    <Sheet
      title={T.title}
      footer={
        <div className="m-stackv" style={{ gap: 'var(--m-s2)' }}>
          {sent ? (
            <>
              <Button variant="primary" block onPress={close} testid="m-account-reset-done">
                {T.done}
              </Button>
              <Button variant="quiet" block busy={busy} label={busy ? T.sending : undefined} onPress={() => void send()} risk="destructive" testid="m-account-reset-again">
                {T.again}
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" block busy={busy} label={busy ? T.sending : undefined} onPress={() => void send()} risk="destructive" testid="m-account-reset-send">
                {T.send}
              </Button>
              <Button variant="quiet" block disabled={busy} onPress={close} testid="m-account-reset-cancel">
                {T.cancel}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div data-testid="m-account-reset-state" data-state={sent ? 'sent' : busy ? 'sending' : 'form'}>
        {!online ? (
          <Notice variant="warn" icon={WifiOff} testid="m-account-reset-offline">
            {T.errOffline}
          </Notice>
        ) : null}
        {sent ? (
          <>
            <Notice icon={MailCheck} title={T.sentTitle} testid="m-account-reset-sent">
              {T.sent}
            </Notice>
            {notBack && !busy ? (
              <Notice
                variant="warn"
                testid="m-account-reset-not-back"
                actions={
                  <Button compact variant="primary" onPress={() => void send()} risk="destructive" testid="m-account-reset-not-back-retry">
                    {T.retry}
                  </Button>
                }
              >
                {T.notBack}
              </Notice>
            ) : null}
            <Block>
              <Hint strong>{sentTo}</Hint>
              <Hint strong>{T.sentNext}</Hint>
              <Hint>{T.sentSpam}</Hint>
            </Block>
          </>
        ) : (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <Block lead>
              <Hint strong>{T.intro}</Hint>
              <Field
                label={A.email}
                type="email"
                inputMode="email"
                autoComplete="username"
                placeholder={A.emailPlaceholder}
                value={email}
                onChange={(value) => {
                  setEmail(value)
                  setError(null)
                }}
                error={error?.field ? error.text : undefined}
                disabled={busy}
                onSubmit={() => void send()}
                testid="m-account-reset-email"
              />
            </Block>
          </form>
        )}
        {error && !error.field ? (
          <Notice variant="error" testid="m-account-reset-error">
            {error.text}
          </Notice>
        ) : null}
      </div>
    </Sheet>
  )
}
