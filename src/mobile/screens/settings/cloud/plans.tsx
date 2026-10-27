/**
 * The three plans of LU Cloud as compact rows (round 51, plan 3.2): name,
 * price, one sentence. The whole row is the target and opens the checkout in
 * the system browser. Shown by the page LU Cloud and by the sheet of its main
 * button, in a build with buy links only.
 */
import { ExternalLink } from 'lucide-react'
import { CLOUD_PITCH, CLOUD_SUBSCRIBER_LINE } from '../../../../lib/cloud-pitch'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { Icon, ListGroup, Row } from '../../../ui'
import { Block, Hint } from '../parts/layout'
import { checkoutUrl, openLink, type PlanSlug } from '../parts/links'

const T = SETTINGS_STRINGS.cloud

interface Plan {
  slug: PlanSlug
  name: string
  price: number
  text: string
}

// Monthly prices in EUR as the website shows them; the first comes from lib/cloud-pitch.ts.
const PLANS: readonly Plan[] = [
  { slug: 'hosted', name: T.planHosted, price: CLOUD_PITCH.hostedMonthlyEUR, text: T.planHostedText },
  { slug: 'hosted-pro', name: T.planPro, price: 49, text: T.planProText },
  { slug: 'hosted-max', name: T.planMax, price: 99, text: T.planMaxText },
]

/** The lowest monthly price, for the line under the main button. */
export const FROM_PRICE = Math.min(...PLANS.map((p) => p.price))

const choose = (plan: Plan, after?: () => void) => () => {
  void openLink(checkoutUrl(plan.slug))
  after?.()
}

const rowFacts = (plan: Plan) => ({
  title: plan.name,
  value: `${plan.price} EUR ${T.perMonth}`,
  end: <Icon icon={ExternalLink} small />,
  chevron: false,
  label: `${T.planRow(plan.name, plan.price, plan.text)} ${SETTINGS_STRINGS.common.onLuLabs}.`,
})

/** The sentence of the plan, and where the row leads: the checkout opens in the browser. */
const planLine = (plan: Plan) => `${plan.text} ${SETTINGS_STRINGS.common.onLuLabs}.`

function Subscribers() {
  return (
    <Block lead>
      <Hint>{CLOUD_SUBSCRIBER_LINE}</Hint>
    </Block>
  )
}

/** The rows on the page. */
export function PagePlans() {
  return (
    <div data-testid="m-cloud-plans" data-m-risk="paid">
      <ListGroup>
        {PLANS.map((plan) => (
          <Row key={plan.slug} {...rowFacts(plan)} subtitle={planLine(plan)} onPress={choose(plan)} risk="paid" testid={`m-cloud-plan-${plan.slug}`} />
        ))}
      </ListGroup>
      <Subscribers />
    </div>
  )
}

/** The same rows in the sheet "Choose a plan"; ids of their own, the page lies under the sheet. */
export function SheetPlans(props: { onPicked: () => void }) {
  return (
    <div>
      <ListGroup>
        {PLANS.map((plan) => (
          <Row key={plan.slug} {...rowFacts(plan)} subtitle={planLine(plan)} onPress={choose(plan, props.onPicked)} risk="paid" testid={`m-cloud-sheet-plan-${plan.slug}`} />
        ))}
      </ListGroup>
      <Subscribers />
    </div>
  )
}
