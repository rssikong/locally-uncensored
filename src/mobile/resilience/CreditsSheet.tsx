/**
 * G5 You're out of credits. Sheet "credits", opened with nav.openSheet('credits'),
 * strand 5 (Account, cloud, settings).
 *
 * The frame opens it when a paid call was refused (window event
 * `lu:credits-exhausted`), with the event detail as props. It never opens on
 * a plain start of the app. Title and text follow the cap that said no.
 * Plans and packs are on the website; nothing is bought inside the app, and
 * whether the sheet may point there at all is the store's call (parts/store-rules.ts).
 */
import { ExternalLink } from 'lucide-react'
import { iapOfferedToAccount } from '../lib/iap'
import { nav, useSheet } from '../nav'
import { leaveCloud } from '../screens/settings/parts/cloud-mode'
import { Block, Hint } from '../screens/settings/parts/layout'
import { LINKS, openLink } from '../screens/settings/parts/links'
import { storePolicy } from '../screens/settings/parts/policy'
import { buyHint, creditsCopyFor, showsBuyLinks } from '../screens/settings/parts/store-rules'
import { SETTINGS_STRINGS } from '../strings/settings'
import { Button, Sheet } from '../ui'

const T = SETTINGS_STRINGS.credits

export default function CreditsSheet() {
  const { props, close } = useSheet<{ reason?: unknown } | null | undefined>()
  // What the store allows: a link to plans and packs, one sentence without a link, or no word about buying.
  const purchase = storePolicy().purchase
  const copy = creditsCopyFor(props?.reason, purchase)
  const hint = buyHint(purchase)
  // "Switch to an on device model" makes sense where a chat is waiting, not in Create.
  const inChat = nav.getState().tab === 'chat' && !nav.getState().flow

  return (
    <Sheet
      title={copy.title}
      testid="m-account-credits-empty"
      footer={
        <div className="m-stackv" style={{ gap: 'var(--m-s2)' }}>
          {showsBuyLinks(purchase) ? (
            <Button variant="primary" block icon={ExternalLink} onPress={() => void openLink(LINKS.pricing)} risk="paid" testid="m-credits-plans" el="G5.1">
              {T.plans}
            </Button>
          ) : null}
          {/* Round 17, store switch purchase 'in-app' (iOS, in no preset): the way to the sheet "Add credits". */}
          {iapOfferedToAccount() ? (
            <Button
              variant="primary"
              block
              onPress={() => {
                close()
                nav.openSheet('settings-add-credits')
              }}
              testid="m-credits-add"
            >
              {SETTINGS_STRINGS.iap.open}
            </Button>
          ) : null}
          {inChat ? (
            <Button
              block
              onPress={() => {
                close()
                leaveCloud()
                nav.openSheet('model')
              }}
              testid="m-credits-on-device"
              el="G5.2"
            >
              {T.onDevice}
            </Button>
          ) : null}
          <Button variant="quiet" block onPress={close} testid="m-credits-not-now" el="G5.3">
            {T.notNow}
          </Button>
        </div>
      }
    >
      <Block lead>
        <div data-testid="m-credits-reason" data-reason={copy.reason}>
          <Hint strong>{copy.text}</Hint>
        </div>
        {hint ? <Hint testid="m-credits-plans-text">{hint}</Hint> : null}
        <Hint>{T.kept}</Hint>
      </Block>
    </Sheet>
  )
}
