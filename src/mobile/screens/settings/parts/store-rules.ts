/**
 * What the store switches mean for the screens of this strand. Pure, so
 * every preset value is a unit test.
 */
import type { ContentPolicy } from '../../../../api/cloud/jobs'
import { CLOUD_PITCH, cloudSalesLines } from '../../../../lib/cloud-pitch'
import { directMarkShown, unfilteredWordsShown, type UnfilteredSwitches } from '../../../policy/unfiltered'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import type { StorePolicy } from './policy'

type Purchase = StorePolicy['purchase']
type Levels = StorePolicy['contentLevels']

const C = SETTINGS_STRINGS.credits
const S = SETTINGS_STRINGS.store

/** May a button or a link lead to plans, packs, the invoice, the subscription. */
export function showsBuyLinks(purchase: Purchase): boolean {
  return purchase === 'links'
}

/**
 * May the app speak of plans, payments and subscriptions in its own words.
 * Only a build that may link to them does (switch pricingWords, which is on
 * exactly where purchase is 'links'; policy.test.ts holds the two together).
 * A build with 'text-only' says the neutral wording and adds the ONE sentence
 * of buyHint(), nothing else.
 */
export function showsBuyText(purchase: Purchase): boolean {
  return purchase === 'links'
}

/** The one sentence that stands in for a buy button, or null when there is a button or nothing at all. */
export function buyHint(purchase: Purchase): string | null {
  return purchase === 'text-only' ? S.plansOnWebsite : null
}

/**
 * Does this build list the whole LU Cloud catalogue: every chat model, the
 * ones marked as answering without refusals too (under their name or under
 * the mark "Direct"), and every model of Create, the `adult` ones too
 * (policy/unfiltered.ts cloudModelListed, create/parts/policy.ts
 * offeredCreateModels). Only such a build may name the counts of the
 * catalogue: they are counts of what it lists.
 */
export function listsWholeCloudCatalogue(policy: UnfilteredSwitches): boolean {
  return policy.unfilteredCatalog && (unfilteredWordsShown(policy) || directMarkShown(policy))
}

/**
 * The lines under the headline of the LU Cloud page.
 *
 *  - A build that advertises (switch unfilteredMarketing): the counts of the
 *    models without refusals (lib/cloud-pitch.ts cloudSalesLines).
 *  - A build that lists the whole catalogue: the catalogue, counted, and no
 *    more.
 *  - A build that leaves models out (App Store, apple 2.3.1): one line
 *    WITHOUT a number. The counts of lib/cloud-pitch.ts are counts of the
 *    whole catalogue; this build lists fewer, and how many is not counted
 *    anywhere (mobile-docs/plaene/LU-CLOUD-SEITE.md 3.5, D2). A number here
 *    would say more models than the user finds.
 */
export function cloudBenefitLines(policy: UnfilteredSwitches & Pick<StorePolicy, 'unfilteredMarketing'>): string[] {
  if (policy.unfilteredMarketing) return cloudSalesLines()
  const B = SETTINGS_STRINGS.cloud
  if (!listsWholeCloudCatalogue(policy)) return [B.benefitUncounted]
  return [B.benefitChat(CLOUD_PITCH.chatModels), B.benefitVideo(CLOUD_PITCH.videoModels), B.benefitImage(CLOUD_PITCH.imageModels)]
}

/** The content policy levels this build offers as choices. Empty: the level is shown, not chosen. */
export function offeredLevels(levels: Levels): ContentPolicy[] {
  if (levels === 'fixed-filter') return []
  if (levels === 'no-off') return ['strict', 'soft']
  return ['strict', 'soft', 'off']
}

export function levelName(policy: ContentPolicy): string {
  const T = SETTINGS_STRINGS.contentPolicy
  return policy === 'strict' ? T.strict : policy === 'off' ? T.off : T.standard
}

export interface CreditsCopy {
  reason: 'credits' | 'video_budget' | 'trainings'
  title: string
  text: string
}

/** Title and text of "credits empty" for the cap that refused. Only a build with buy links speaks of plans and bought credits. */
export function creditsCopyFor(reason: unknown, purchase: Purchase): CreditsCopy {
  const plain = !showsBuyText(purchase)
  if (reason === 'video_budget') return { reason, title: C.titleVideo, text: plain ? C.textVideoPlain : C.textVideo }
  if (reason === 'trainings') return { reason, title: plain ? C.titleTrainPlain : C.titleTrain, text: plain ? C.textTrainPlain : C.textTrain }
  return { reason: 'credits', title: C.titleCredits, text: plain ? C.textCreditsPlain : C.textCredits }
}
