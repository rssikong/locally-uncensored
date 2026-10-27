/**
 * Delete account. Sheet "settings-delete-account", opened from the Account
 * page, strand 5 (Account, cloud, settings). Both stores demand a way to
 * delete the account inside the app (STORE-RISIKO.md section 5).
 *
 * It says first what goes and what stays, and that a running subscription
 * ends with the account. Then the word DELETE has to be typed. The server
 * deletes (api/cloud/account.ts); only when it confirmed does the phone sign
 * out. A deletion that failed changes nothing and says which of three things
 * happened: no network, the session has expired, or the server declined.
 *
 * On an iPhone, an account that uses Sign in with Apple first gets the Apple
 * sheet once more (parts/auth.ts, appleBeforeDelete): its one-time code lets
 * the server end the link at Apple inside the deletion. Closing that sheet
 * deletes nothing and offers "Delete without Apple". When the code did not
 * reach the server, the account is still deleted, and the sheet stays open
 * to say that the Apple link was not ended and where to end it. It never
 * says the link was ended: the server does that without telling the phone.
 */
import { useState } from 'react'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'
import { nav, useSheet } from '../../nav'
import { isOnline } from '../../platform'
import { SETTINGS_STRINGS } from '../../strings/settings'
import { Button, Notice, Sheet, toast } from '../../ui'
import { DeleteAccountError, deleteAccount, type DeleteAccountFailure } from '../../../api/cloud/account'
import { appleBeforeDelete, refreshAccount, signOutAfterDeletion, type AppleBeforeDelete } from './parts/auth'
import { Block, Heading, Hint } from './parts/layout'
import { SUPPORT_EMAIL } from './parts/links'

const T = SETTINGS_STRINGS.account

export default function DeleteAccountSheet() {
  const { close } = useSheet()
  const user = useCloudAuthStore((s) => s.user)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ reason: DeleteAccountFailure; text: string } | null>(null)
  // The Apple sheet was closed: nothing deleted, "Delete without Apple" offered.
  const [appleCancelled, setAppleCancelled] = useState(false)
  // Deleted, but the Apple link could not be handed over: the sheet stays and says so.
  const [appleLeft, setAppleLeft] = useState(false)
  const who = user?.email ?? user?.id ?? ''

  const remove = async (apple: AppleBeforeDelete) => {
    try {
      await deleteAccount(isOnline)
    } catch (why) {
      const reason: DeleteAccountFailure = why instanceof DeleteAccountError ? why.reason : 'server'
      setError({ reason, text: reason === 'offline' ? T.deleteOffline : reason === 'not-signed-in' ? T.deleteExpired : T.deleteFailed(SUPPORT_EMAIL) })
      setBusy(false)
      return
    }
    // The account is gone on the server. Whatever the sign out answers now, this phone forgets the session.
    await signOutAfterDeletion()
    setBusy(false)
    if (apple === 'not-handed') {
      setAppleLeft(true)
      return
    }
    toast(T.deleteDone, { testid: 'account-deleted' })
    close()
  }

  const withoutApple = async () => {
    if (busy) return
    setBusy(true)
    setAppleCancelled(false)
    setError(null)
    await remove('not-handed')
  }

  const run = async () => {
    if (busy) return
    const yes = await nav.confirm({
      title: T.deleteQuestion,
      text: T.deleteQuestionText(who),
      confirmLabel: T.deleteConfirm,
      cancelLabel: T.deleteKeep,
      tone: 'danger',
      requireText: T.deleteWord,
      testid: 'account-delete',
    })
    if (!yes) return
    setBusy(true)
    setError(null)
    setAppleCancelled(false)
    const apple = await appleBeforeDelete()
    if (apple === 'cancelled') {
      setAppleCancelled(true)
      setBusy(false)
      return
    }
    await remove(apple)
  }

  // The server no longer takes this session. Reading the account again makes the phone see that too:
  // it shows signed out, and "Please sign in again" (G6) leads back to the form.
  const signInAgain = () => {
    close()
    void refreshAccount()
  }

  if (appleLeft) {
    return (
      <Sheet
        title={T.deleteTitle}
        footer={
          <Button block onPress={close} testid="m-account-delete-close">
            {T.deleteClose}
          </Button>
        }
      >
        <Notice variant="warn" testid="m-account-delete-apple-left">
          {T.deleteAppleLeft}
        </Notice>
      </Sheet>
    )
  }

  return (
    <Sheet
      title={T.deleteTitle}
      footer={
        <div className="m-stackv" style={{ gap: 'var(--m-s2)' }}>
          <Button variant="danger" block busy={busy} label={busy ? T.deleteWorking : undefined} onPress={() => void run()} risk="destructive" testid="m-account-delete-go-delete">
            {T.deleteGo}
          </Button>
          <Button variant="quiet" block disabled={busy} onPress={close} testid="m-account-delete-keep">
            {T.deleteKeep}
          </Button>
        </div>
      }
    >
      <Block lead testid="m-account-delete-explain">
        <Hint strong>{T.deleteLead}</Hint>
        <Heading>{T.deleteGoneTitle}</Heading>
        <ul style={{ margin: 0, paddingLeft: '1.2em', color: 'var(--m-t2)', display: 'flex', flexDirection: 'column', gap: 'var(--m-s1)' }}>
          {T.deleteGone.map((line) => (
            <li key={line} style={{ overflowWrap: 'anywhere' }}>
              {line}
            </li>
          ))}
        </ul>
        <Heading>{T.deleteStaysTitle}</Heading>
        <Hint strong>{T.deleteStays}</Hint>
        <Hint>{T.deleteBilling}</Hint>
      </Block>
      {appleCancelled ? (
        <Notice
          testid="m-account-delete-apple-cancelled"
          actions={
            <Button compact variant="danger" disabled={busy} onPress={() => void withoutApple()} risk="destructive" testid="m-account-delete-without-apple">
              {T.deleteWithoutApple}
            </Button>
          }
        >
          {T.deleteAppleCancelled}
        </Notice>
      ) : null}
      {error ? (
        <div data-testid="m-account-delete-error-state" data-reason={error.reason}>
          <Notice
            variant="error"
            testid="m-account-delete-error"
            actions={
              error.reason === 'not-signed-in' ? (
                <Button compact onPress={signInAgain} testid="m-account-delete-signin-again">
                  {T.deleteSignInAgain}
                </Button>
              ) : undefined
            }
          >
            {error.text}
          </Notice>
        </div>
      ) : null}
    </Sheet>
  )
}
