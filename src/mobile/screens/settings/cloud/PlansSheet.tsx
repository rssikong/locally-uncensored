/**
 * E3 "Choose a plan". Sheet "settings-cloud-plans", strand 5 (Account, cloud,
 * settings), round 51, decision D4.
 *
 * The main button "Get LU Cloud" of the page LU Cloud opens it: the three
 * plans as rows, each one opens the checkout in the system browser. Only a
 * build with buy links has that button (store switch purchase 'links'); in
 * every other build this sheet says "Not part of this version" and names no
 * plan, no price and no other place to buy.
 */
import { useSheet } from '../../../nav'
import { POLICY } from '../../../strings/policy'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { Button, Sheet } from '../../../ui'
import { Block, Hint } from '../parts/layout'
import { storePolicy } from '../parts/policy'
import { showsBuyLinks } from '../parts/store-rules'
import { SheetPlans } from './plans'

const T = SETTINGS_STRINGS.cloud

export default function PlansSheet() {
  const { close } = useSheet()

  if (!showsBuyLinks(storePolicy().purchase)) {
    return (
      <Sheet
        title={POLICY.unavailableTitle}
        footer={
          <Button block onPress={close} testid="m-unavailable-close">
            {POLICY.unavailableClose}
          </Button>
        }
      >
        <p className="m-pad" data-testid="m-unavailable">
          {POLICY.unavailableText}
        </p>
      </Sheet>
    )
  }

  return (
    <Sheet
      title={T.plansTitle}
      footer={
        <Button variant="quiet" block onPress={close} testid="m-cloud-sheet-close">
          {T.notNow}
        </Button>
      }
    >
      <SheetPlans onPicked={close} />
      <Block>
        <Hint>{T.footerOpen}</Hint>
      </Block>
    </Sheet>
  )
}
