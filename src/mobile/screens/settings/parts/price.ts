/**
 * What an answer of the picked model costs (G13). Pure, so the wording per
 * case is a unit test. The numbers come from the model row (the Flash policy
 * of the server catalog), from the last answer (the Flash allowance left)
 * and from the account (credits left).
 */
import type { FlashPolicy } from '../../../../lib/flash-ui'
import { placeOfProvider } from '../../../lib/model-place'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import type { StorePolicy } from './policy'
import { buyHint, showsBuyLinks, showsBuyText } from './store-rules'

export interface PriceInput {
  /** The picked model, or null when none is picked. */
  model: { provider?: string; flash?: FlashPolicy } | null
  /** Does the account get the Flash allowance. null: not answered yet. */
  paidPlan: boolean | null
  /** What the last Flash answer said about today's allowance. */
  notice?: { billing: 'flash' | 'credits'; remaining: number } | null
  /** Credits left this period, or null when not loaded. */
  creditsLeft: number | null
}

export type PriceView =
  | { kind: 'none' }
  | { kind: 'local' }
  | { kind: 'other' }
  | { kind: 'credits'; creditsLeft: number | null }
  | { kind: 'flash-unpaid'; creditsLeft: number | null }
  | { kind: 'flash-used-up'; creditsLeft: number | null }
  | { kind: 'flash-free'; dailyTokens: number; left: number | null }

export function priceView(input: PriceInput): PriceView {
  const { model, paidPlan, notice, creditsLeft } = input
  if (!model) return { kind: 'none' }
  const place = placeOfProvider(model.provider)
  if (place === 'own') return { kind: 'other' }
  if (place === 'device') return { kind: 'local' }
  if (!model.flash) return { kind: 'credits', creditsLeft }
  if (paidPlan === false) return { kind: 'flash-unpaid', creditsLeft }
  // An unanswered account promises nothing: it reads as credits until the server said yes.
  if (paidPlan === null) return { kind: 'credits', creditsLeft }
  if (notice && (notice.billing === 'credits' || notice.remaining <= 0)) return { kind: 'flash-used-up', creditsLeft }
  return { kind: 'flash-free', dailyTokens: model.flash.dailyTokens, left: notice ? notice.remaining : null }
}

type Purchase = StorePolicy['purchase']

export interface PriceCopy {
  /** The sentences of the sheet, in order. */
  lines: string[]
  /** A sentence that says where plans are, without a link (store rule "text-only"), or null. */
  hint: string | null
  /** May the sheet show a button that leads to plans and packs (store rule "links"). */
  buyLink: boolean
}

/** Does this view tell the user that paying would change something: no paid plan, or no credits left. */
export function priceInvitesBuying(view: PriceView): boolean {
  if (view.kind === 'flash-unpaid') return true
  return 'creditsLeft' in view && view.creditsLeft !== null && view.creditsLeft <= 0
}

/**
 * The words of the price sheet for one view, under the store rule for buying.
 * `count` formats a number for reading. Pure.
 *
 *  links      every sentence, and a button to plans where paying would help
 *  text-only  no word about plans in the sentences, and the one allowed sentence in place of the button
 *  none       no word about plans or buying, and nothing in its place
 */
export function priceCopy(view: PriceView, purchase: Purchase, count: (n: number) => string): PriceCopy {
  const T = SETTINGS_STRINGS.price
  const plain = !showsBuyText(purchase)
  const lines: string[] = []
  if (view.kind === 'none') lines.push(T.noModel)
  if (view.kind === 'local') lines.push(T.local)
  if (view.kind === 'other') lines.push(T.other)
  if (view.kind === 'credits') lines.push(T.credits)
  if (view.kind === 'flash-unpaid') lines.push(...(plain ? [T.flashUnpaidPlain] : [T.flashUnpaid, T.credits]))
  if (view.kind === 'flash-used-up') lines.push(T.flashUsedUp)
  if (view.kind === 'flash-free') {
    lines.push(plain ? T.flashFreePlain(count(view.dailyTokens)) : T.flashFree(count(view.dailyTokens)))
    if (view.left !== null) lines.push(T.flashLeft(count(view.left), count(view.dailyTokens)))
  }
  if ('creditsLeft' in view && view.creditsLeft !== null) lines.push(view.creditsLeft <= 0 ? T.creditsNone : T.creditsLeft(count(view.creditsLeft)))
  const invites = priceInvitesBuying(view)
  return { lines, hint: invites ? buyHint(purchase) : null, buyLink: invites && showsBuyLinks(purchase) }
}
