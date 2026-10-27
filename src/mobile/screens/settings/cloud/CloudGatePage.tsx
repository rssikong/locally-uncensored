/**
 * E3 LU Cloud. Route /cloud, page, strand 5 (Account, cloud, settings).
 *
 * The gate in front of Cloud and the sales page in one. What it shows
 * follows the account: signed out, signed in without a plan, payment open,
 * plan found. Plans are bought on the website in the system browser; when
 * the user comes back, "check again" reads the account anew.
 *
 * Round 51 (mobile-docs/plaene/LU-CLOUD-SEITE.md, rounds 1 and 2): the title
 * stands once, in the header. At the top the number band: one large total
 * and the parts small below it (parts/cloud-counts.ts, counted by one rule).
 * The one filled button of every state stands in the fixed footer of the
 * page, so it is on screen without scrolling on every phone and at every
 * text size; next to it at most one quiet second button. Per store:
 *  - open: "Get LU Cloud" opens the sheet of the three plans, the plans also
 *    stand as rows on the page;
 *  - play: "Create account", the one sentence about buying, without a link;
 *  - appstore: "Sign in", no price, no plan, no other place to buy, and no
 *    number before sign in (decision D2).
 */
import { useState, type ReactNode } from 'react'
import { Check, ExternalLink, LogIn, Plus, RefreshCw, UserPlus, WifiOff } from 'lucide-react'
import { pastDueLine } from '../../../../lib/past-due'
import { useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import { useCloudCatalogStore } from '../../../../stores/cloudCatalogStore'
import { useModelStore } from '../../../../stores/modelStore'
import { useSettingsStore } from '../../../../stores/settingsStore'
import { iapOfferedToAccount } from '../../../lib/iap'
import { nav } from '../../../nav'
import { useAppLifecycle } from '../../../platform'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { Button, Icon, Monogram, Notice, Page, Progress } from '../../../ui'
import { offeredCreateModels } from '../../create/parts/policy'
import { startAccountOnSignUp } from '../parts/account-start'
import { gateState } from '../parts/account-view'
import { refreshAccount } from '../parts/auth'
import { cloudCountsFor, cloudCountsSeen, measuredWithoutRefusals, type CloudCounts } from '../parts/cloud-counts'
import { enterCloud, leaveCloud } from '../parts/cloud-mode'
import { Block, Hint } from '../parts/layout'
import { LINKS, openLink } from '../parts/links'
import { storePolicy } from '../parts/policy'
import { buyHint, showsBuyLinks, showsBuyText } from '../parts/store-rules'
import { CloudShowcase } from './CloudShowcase'
import { FROM_PRICE, PagePlans } from './plans'
import './cloud-page.css'

const T = SETTINGS_STRINGS.cloud

/** The address of the website as one word: a line never breaks at its hyphen. */
function withAddress(text: string): ReactNode {
  const at = text.indexOf('lu-labs.ai')
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <span className="m-nobr">lu-labs.ai</span>
      {text.slice(at + 'lu-labs.ai'.length)}
    </>
  )
}

/** The number band: the total large, the parts small, as one sentence for a screen reader. */
function CountBand(props: { counts: CloudCounts | null; measured: number | null }) {
  const { counts, measured } = props
  return (
    <section className="m-pad m-cloud-band" data-testid="m-cloud-count">
      {counts ? (
        <>
          <p className="m-sr">{T.countSentence(counts.total, counts.chat, counts.image, counts.video)}</p>
          <div className="m-cloud-band-head" aria-hidden="true">
            <Monogram size={32} />
            <span className="m-cloud-total" data-testid="m-cloud-count-total">
              {counts.total}
            </span>
            <span className="m-cloud-total-label">{T.countLabel}</span>
          </div>
          <ul className="m-cloud-split" aria-hidden="true" data-testid="m-cloud-count-split">
            <li>
              <b>{counts.chat}</b> {T.countChat}
            </li>
            <li>
              <b>{counts.image}</b> {T.countImage}
            </li>
            <li>
              <b>{counts.video}</b> {T.countVideo}
            </li>
          </ul>
          {measured !== null ? (
            <ul className="m-cloud-split">
              <li className="m-cloud-tag" data-testid="m-cloud-measured">
                {T.measuredTag(measured)}
              </li>
            </ul>
          ) : null}
        </>
      ) : (
        <div className="m-cloud-band-head">
          <Monogram size={32} />
          <span className="m-cloud-total-label">{T.benefitUncounted}</span>
        </div>
      )}
      <p className="m-cloud-say">{T.say}</p>
    </section>
  )
}

function Benefits() {
  return (
    <Block testid="m-cloud-benefits">
      {[T.benefitSameApp, T.benefitFree].map((line) => (
        <div key={line} className="m-cloud-benefit">
          <span>
            <Icon icon={Check} small />
          </span>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{line}</span>
        </div>
      ))}
    </Block>
  )
}

export default function CloudGatePage() {
  const status = useCloudAuthStore((s) => s.status)
  const user = useCloudAuthStore((s) => s.user)
  const offline = useCloudAuthStore((s) => s.offline)
  const licenseActive = useCloudAuthStore((s) => s.licenseActive)
  const access = useCloudAuthStore((s) => s.access)
  const pastDue = useCloudAuthStore((s) => s.pastDue)
  const pastDueTier = useCloudAuthStore((s) => s.pastDueTier)
  const quota = useCloudAuthStore((s) => s.quota)
  const cloudOn = useSettingsStore((s) => s.settings.appMode === 'cloud')
  const chatList = useModelStore((s) => s.models)
  const catalogue = useCloudCatalogStore((s) => (s.fetchedAt === null ? null : s.models))
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)

  const state = gateState({ status, user, offline, licenseActive, access, pastDue, quota })
  const policy = storePolicy()
  // Signed in with both lists loaded: the count of what this account really sees. Before that: the count of the build, or none.
  const counts = (user ? cloudCountsSeen(chatList, catalogue ? offeredCreateModels(catalogue) : null, policy) : null) ?? cloudCountsFor(policy)
  // Buying happens on the website. Whether this page may link there, say so, or keep quiet is the store's call.
  const purchase = storePolicy().purchase
  const links = showsBuyLinks(purchase)
  const hint = buyHint(purchase)
  const sales = state === 'signed-out' || state === 'no-plan'
  const plans = links ? (
    <PagePlans />
  ) : hint ? (
    <Block testid="m-cloud-plans-text">
      <Hint strong>{withAddress(hint)}</Hint>
    </Block>
  ) : null

  const recheck = async () => {
    if (checking) return
    setChecking(true)
    try {
      await refreshAccount()
      setChecked(true)
    } finally {
      setChecking(false)
    }
  }

  // Coming back from the checkout in the browser: look at the account without being asked.
  useAppLifecycle({
    onForeground: () => {
      if (state !== 'ready' && state !== 'signed-out') void recheck()
    },
  })

  const openPlans = () => nav.openSheet('settings-cloud-plans')
  const recheckButton = (label: string, main: boolean) => (
    <Button variant={main ? 'primary' : 'default'} block icon={RefreshCw} busy={checking} label={checking ? T.rechecking : undefined} onPress={() => void recheck()} testid="m-cloud-recheck" el="E3.3">
      {label}
    </Button>
  )
  const signIn = (main: boolean) => (
    <Button variant={main ? 'cloud' : 'default'} block icon={LogIn} onPress={() => nav.push('/settings/account')} testid="m-cloud-signin" el="E3.2">
      {T.signIn}
    </Button>
  )
  const checkAgain = SETTINGS_STRINGS.common.checkAgain

  /** The fixed footer: the ONE filled button of this state, and at most one quiet second one. */
  const footer = (() => {
    if (state === 'signed-out') {
      if (links) {
        return (
          <>
            <Button variant="cloud" block onPress={openPlans} testid="m-cloud-get" el="E3.1">
              {T.getCloud}
            </Button>
            <p className="m-cap m-cloud-note" data-testid="m-cloud-from-price">
              {T.fromPrice(FROM_PRICE)}
            </p>
            {signIn(false)}
          </>
        )
      }
      // App Store: "Sign in" alone. An account made here cannot use LU Cloud without a purchase elsewhere (risk A2, D3).
      if (outwardNone(purchase)) return signIn(true)
      return (
        <>
          <Button variant="cloud" block icon={UserPlus} onPress={() => {
              startAccountOnSignUp()
              nav.push('/settings/account')
            }} testid="m-cloud-create-account" el="E3.6">
            {T.createAccount}
          </Button>
          {signIn(false)}
        </>
      )
    }
    if (state === 'offline') return recheckButton(checkAgain, true)
    if (state === 'no-plan') {
      if (!links) return recheckButton(checkAgain, true)
      return (
        <>
          <Button variant="cloud" block onPress={openPlans} testid="m-cloud-see-plans" el="E3.1">
            {T.seePlans}
          </Button>
          {recheckButton(T.recheck, false)}
        </>
      )
    }
    if (state === 'past-due') {
      if (!links) return recheckButton(checkAgain, true)
      return (
        <>
          <Button variant="cloud" block icon={ExternalLink} onPress={() => void openLink(LINKS.account)} risk="paid" testid="m-cloud-pay-invoice" el="E3.4">
            {T.payInvoice}
          </Button>
          {recheckButton(T.recheckPaid, false)}
        </>
      )
    }
    if (state === 'gated' || state === 'no-quota' || state === 'no-budget') {
      return (
        <>
          {recheckButton(checkAgain, true)}
          {state === 'no-budget' && links ? (
            <Button block icon={ExternalLink} onPress={() => void openLink(LINKS.account)} risk="paid" testid="m-cloud-open-account">
              {T.openAccount}
            </Button>
          ) : null}
        </>
      )
    }
    if (state === 'ready') {
      return cloudOn ? (
        <Button variant="primary" block onPress={leaveCloud} testid="m-cloud-turn-off">
          {T.turnOff}
        </Button>
      ) : (
        <Button
          variant="cloud"
          block
          onPress={() => {
            void enterCloud().then((on) => {
              if (on) void nav.back()
            })
          }}
          testid="m-cloud-turn-on"
        >
          {T.turnOn}
        </Button>
      )
    }
    return null
  })()

  const who = user?.email ?? user?.id ?? ''

  return (
    <Page title={T.title} screen="cloud" needsNetwork footer={footer ? <div className="m-stackv" style={{ gap: 'var(--m-s2)' }}>{footer}</div> : undefined}>
      <div data-testid="m-cloud-state" data-state={state}>
        <CountBand counts={counts} measured={measuredWithoutRefusals(policy)} />
        {/* The moving preview only where the page sells (signed out, no plan); elsewhere the button is the point. */}
        {sales ? <CloudShowcase counts={counts} /> : null}

        {state === 'probing' ? (
          <Block testid="m-cloud-checking">
            <Progress label={T.rechecking} detail={T.rechecking} />
          </Block>
        ) : null}

        {state === 'signed-out' ? (
          <>
            <Benefits />
            {plans}
            {showsBuyText(purchase) ? (
              <Block>
                <Hint>{T.signInSub}</Hint>
              </Block>
            ) : null}
          </>
        ) : null}

        {state === 'offline' ? (
          <Notice variant="warn" icon={WifiOff} testid="m-cloud-offline">
            {T.offline}
          </Notice>
        ) : null}

        {state === 'no-plan' ? (
          <>
            <Block>
              <Hint strong>
                {T.signedInAs(who)} {showsBuyText(purchase) ? T.noPlan : T.noPlanPlain}
              </Hint>
            </Block>
            {checked && !checking ? <Notice testid="m-cloud-recheck-result">{T.recheckNothing}</Notice> : null}
            <Benefits />
            {plans}
          </>
        ) : null}

        {state === 'past-due' ? (
          <>
            <Block>
              <Hint strong>{T.signedInAs(who)}</Hint>
            </Block>
            <Notice variant="error" title={showsBuyText(purchase) ? SETTINGS_STRINGS.account.pastDueTitle : undefined} testid="m-cloud-past-due">
              {showsBuyText(purchase) ? pastDueLine(pastDueTier) : SETTINGS_STRINGS.account.pausedPlain}
            </Notice>
          </>
        ) : null}

        {state === 'gated' || state === 'no-quota' || state === 'no-budget' ? (
          <Notice testid="m-cloud-wait">{state === 'gated' ? T.gated : state === 'no-quota' ? T.noQuota : showsBuyText(purchase) ? T.noBudget : T.noPlanPlain}</Notice>
        ) : null}

        {state === 'ready' ? (
          <>
            <Notice title={T.readyTitle} testid="m-cloud-ready">
              {T.readyText}
            </Notice>
            {cloudOn ? (
              <Block>
                <Hint strong>{T.alreadyOn}</Hint>
              </Block>
            ) : null}
          </>
        ) : null}

        {/* Round 17, store switch purchase 'in-app' (iOS, in no preset): credits through the store of the system, for a signed in account. */}
        {user && state !== 'probing' && state !== 'offline' && state !== 'signed-out' && iapOfferedToAccount() ? (
          <Block>
            <Button block icon={Plus} onPress={() => nav.openSheet('settings-add-credits')} testid="m-cloud-add-credits">
              {SETTINGS_STRINGS.iap.open}
            </Button>
          </Block>
        ) : null}

        <Block>
          <Button variant="quiet" block onPress={() => void nav.back()} testid="m-cloud-not-now" el="E3.5">
            {T.notNow}
          </Button>
          {/* In the sales states the benefits already say that on device stays free; the open build adds how to cancel. */}
          {sales ? (showsBuyText(purchase) ? <Hint>{withAddress(T.footerOpen)}</Hint> : null) : <Hint>{withAddress(showsBuyText(purchase) ? T.footer : T.footerPlain)}</Hint>}
        </Block>
      </div>
    </Page>
  )
}

/** The App Store build: no buying of any kind towards the outside (no link, no sentence). */
function outwardNone(purchase: ReturnType<typeof storePolicy>['purchase']): boolean {
  return !showsBuyLinks(purchase) && buyHint(purchase) === null
}
