/**
 * G6 Please sign in again. Sheet "session", opened with nav.openSheet('session'),
 * strand 5 (Account, cloud, settings).
 *
 * Comes up when the account went from signed in to signed out without the
 * user asking (screens/settings/parts/services.ts). The logic layer has
 * already tried to renew the token by then. Nothing on the phone is touched:
 * chats, models and the text in the message box stay. Signing in leads to
 * the Account page on top of the page the user was on, so back returns to
 * the same place; the refused action is not repeated silently.
 */
import { LogIn } from 'lucide-react'
import { nav, useSheet } from '../nav'
import { leaveCloud } from '../screens/settings/parts/cloud-mode'
import { goToAccount } from '../screens/settings/parts/go'
import { Block, Hint } from '../screens/settings/parts/layout'
import { SETTINGS_STRINGS } from '../strings/settings'
import { Button, Sheet, toast } from '../ui'

const T = SETTINGS_STRINGS.session

export default function SessionSheet() {
  const { close } = useSheet()
  return (
    <Sheet
      title={T.title}
      testid="m-account-session-expired"
      footer={
        <div className="m-stackv" style={{ gap: 'var(--m-s2)' }}>
          <Button
            variant="primary"
            block
            icon={LogIn}
            onPress={() => {
              close()
              goToAccount()
            }}
            testid="m-session-signin"
            el="G6.1"
          >
            {T.signIn}
          </Button>
          <Button
            block
            onPress={() => {
              close()
              // Through the one door, so the press is counted (or not, as Privacy says). The sheet has its own words.
              leaveCloud({ quiet: true })
              toast(T.nowOnDevice, { testid: 'session-on-device' })
              nav.openSheet('model')
            }}
            testid="m-session-on-device"
            el="G6.2"
          >
            {T.onDevice}
          </Button>
        </div>
      }
    >
      <Block lead>
        <Hint strong>{T.text}</Hint>
        <Hint>{T.kept}</Hint>
      </Block>
    </Sheet>
  )
}
