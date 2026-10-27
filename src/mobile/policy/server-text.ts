/**
 * A sentence the phone did not write, as a store build may show it.
 *
 * Errors of LU Cloud and of the logic layer arrive as English sentences, and
 * some are shown as they are: the reason under a failed answer, the reason of
 * a failed run in Create. Such a sentence can say what a store build must not
 * say: where to buy ("Top up at lu-labs.ai/pricing"), a price, the website,
 * the id of a model, a word about answers without refusals. The texts of the
 * app are held by the guards (src/mobile/__tests__/store-woerter.test.ts); a
 * sentence from outside is held here, when it is shown.
 *
 * Sentence by sentence: one that carries such a word is left out, the rest
 * stays. The open build shows every sentence as it came.
 *
 * Apple 3.1.3(f): no purchasing inside the app and no call to action for
 * purchase outside of it. A sentence of the server is no exception.
 */
import { storePolicy, type StorePolicy } from './storePolicy'
import { carriesUnfilteredWord } from './unfiltered-names'

type Switches = Pick<StorePolicy, 'pricingWords' | 'externalLinks' | 'unfilteredCatalog' | 'unfilteredMarketing' | 'unfilteredWords'>

/** Buying, as e2e/mobile/store-rules.ts lists it (held against each other by policy/__tests__/server-text.test.ts). */
const BUYING =
  /\b(?:plans?|upgrad\w*|buy|buys|buying|bought|subscri\w+|pricing|price|prices|priced|invoices?|checkout|bill|bills|billed|billing|purchas\w*|pay|pays|paid|paying|payments?|top[ -]?ups?|get more|premium|memberships?|free trial|monthly|yearly|annual(?:ly)?|redeem\w*|coupons?|discounts?|promo codes?|refunds?|refunded|charge|charges|charged|renew\w*|refill\w*)\b|\b(?:per|a|each|every) (?:month|year)\b|[$\u20ac\u00a3]\s?\d|\b\d+(?:[.,]\d+)?\s?(?:usd|eur|dollars?|euros?)\b|\b(?:add|adds|get|gets|need|needs)\s+(?:\w+\s+){0,2}credits?\b|\bmore credits\b|\baccount with credits\b/i
/** The website and every other address: a store build opens the four legal links itself and names no other place. */
const PLACE = /lu-labs\.ai|\bhttps?:\/\/|\bwww\.|\bwebsites?\b|\bweb ?app\b|\bdashboard\b/i
/** The routed id of a model, and the id of a hosted model as its maker writes it ("maker/Model-8B"). */
const MODEL_ID = /\b[a-z][\w-]*::[\w./-]+|\b[a-z][\w.-]*\/[\w.-]*\d[\w.-]*/i

function sentences(text: string): string[] {
  // No lookbehind (an old WebView does not know it): the end of a sentence becomes a line break, and a line is a sentence.
  return text
    .replace(/([.!?])\s+/g, '$1\n')
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Pure: may a store build with these switches show this one sentence. */
export function sentenceAllowed(sentence: string, policy: Switches = storePolicy()): boolean {
  if (!policy.pricingWords && BUYING.test(sentence)) return false
  if (policy.externalLinks !== 'all' && PLACE.test(sentence)) return false
  const words = policy.unfilteredCatalog && (policy.unfilteredMarketing || policy.unfilteredWords)
  if (!words && (carriesUnfilteredWord(sentence) || MODEL_ID.test(sentence))) return false
  return true
}

/**
 * Pure: the sentences of `text` this build may show, joined again. Empty
 * when none is left; the caller then says its own sentence, or nothing.
 */
export function storeSentence(text: string | null | undefined, policy: Switches = storePolicy()): string {
  if (!text) return ''
  if (policy.pricingWords && policy.externalLinks === 'all' && policy.unfilteredCatalog && policy.unfilteredMarketing) return text
  return sentences(text)
    .filter((sentence) => sentenceAllowed(sentence, policy))
    .join(' ')
}
