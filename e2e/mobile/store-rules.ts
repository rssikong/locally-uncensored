/**
 * What a store build must not show, as rules a test can ask.
 *
 * Two readers share this file, so both judge by the same list:
 *  - e2e/mobile/store-waechter.mobile.ts draws every route and every sheet in
 *    a store preset and hands the text on screen to storeFindings(),
 *  - src/mobile/__tests__/store-woerter.test.ts hands it every text of
 *    src/mobile/strings/, as it reads in that preset.
 *
 * No import from @playwright/test and none from src: plain text in, findings out.
 * The reasons for each word are in mobile-docs/STORE-BAUSTEINE.md, section 6.
 */
export type GuardedPreset = 'appstore' | 'play'

/**
 * The support address. Contact details are a duty in both stores, and this
 * address is the wanted contact of the app (decided 10.10.2026), so it may
 * stand although it names the website. WHERE it may stand is the business of
 * the reader: the guard over the pages allows it at exactly one place
 * (CONTACT_PLACE below), a reader of loose texts has no place to ask for.
 */
export const SUPPORT_EMAIL = 'hello@lu-labs.ai'

/**
 * The ONE place of the app the support address is shown at: the contact row
 * of the page About. The guard over the pages (store-waechter.mobile.ts)
 * takes the address out there and nowhere else, so the same address on
 * another page, or a second time on About, is a finding like every other
 * mention of the website.
 */
export const CONTACT_PLACE = { where: 'route /settings/about', testid: 'm-settings-about-contact' } as const

/**
 * The imagined build with `purchase: 'in-app'` (round 17, in no preset): credits
 * as an in-app purchase of the system. Words about buying are allowed in the
 * sheet "Add credits" and on the three buttons that open it, and nowhere
 * else. A link to the outside and a pointer to the website stay a finding
 * everywhere, in the sheet too.
 */
export const IAP_PLACE = {
  where: 'sheet settings-add-credits',
  openers: ['m-account-add-credits', 'm-cloud-add-credits', 'm-credits-add'],
} as const

/** The ONE sentence about buying a Play build may show, without a link (Google: Payments, "consumption only" apps). */
export const PLAY_SENTENCE = 'Plans and credits are available on lu-labs.ai.'

/**
 * The three places a Play build shows the sentence at without an account. These are the ones a walk on a device
 * reaches (it cannot sign in), and the ones check 4 on Android reported.
 */
export const PLAY_SENTENCE_PLACES_SIGNED_OUT: readonly string[] = ['route /cloud', 'route /create/showcase', 'sheet credits']

/**
 * The places of the app a Play build shows that sentence at (decided 10.10.2026, reversible: `purchase: 'none'`
 * in the preset play takes it out everywhere). The guard over the pages allows the sentence at these places and
 * nowhere else, so the same sentence on another page is a finding like every other mention of the website. The
 * guard on a device (mobile-tests/checks/storeworte.mjs, ERLAUBTE_SAETZE) keeps the same sentence and the same
 * places; a test holds the two lists against each other. Signed in, three more places say it where the account
 * has no plan or no credits left: the gate of Create, the page Account and the Cloud tab of the model sheet.
 */
export const PLAY_SENTENCE_PLACES: readonly string[] = [...PLAY_SENTENCE_PLACES_SIGNED_OUT, 'route /create', 'route /settings/account', 'sheet model']

/** Pure: is this place of the walk (a route, a sheet, one of their states or payloads) one the Play sentence may stand at. */
export function isPlaySentencePlace(where: string): boolean {
  return PLAY_SENTENCE_PLACES.some((place) => where === place || where.startsWith(`${place} `))
}

/**
 * The name of the product spelled out. Decided 10.10.2026: in both stores the
 * app is called "LU" and nothing else, so no store build shows the long name,
 * in no spelling (switch unfilteredMarketing, texts through `marketed`).
 */
export const FULL_NAME = 'Locally Uncensored'

/** Every spelling of it: "Locally Uncensored", "LocallyUncensored", "locally-uncensored", "locally_uncensored", "locallyuncensored". */
export const FULL_NAME_SPELLINGS = /locally[\s_.-]*uncensored/i

/** The four addresses a store build may open by itself (policy/links.ts LEGAL_LINKS). */
export const LEGAL_LINKS: readonly string[] = ['https://lu-labs.ai/privacy', 'https://lu-labs.ai/terms', `mailto:${SUPPORT_EMAIL}`, 'https://lu-labs.ai/delete-account']

interface WordRule {
  name: string
  re: RegExp
}

/** Buying: plan, price, subscription and what belongs to them. */
const PRICING: readonly WordRule[] = [
  { name: 'plan', re: /\bplans?\b/i },
  { name: 'upgrade', re: /\bupgrad\w*/i },
  { name: 'buy', re: /\b(buy|buys|buying|bought)\b/i },
  { name: 'subscribe', re: /\bsubscri\w+/i },
  { name: 'pricing', re: /\bpricing\b/i },
  { name: 'price', re: /\b(price|prices|priced)\b/i },
  { name: 'invoice', re: /\binvoices?\b/i },
  { name: 'checkout', re: /\bcheckout\b/i },
  { name: 'billing', re: /\b(bill|bills|billed|billing)\b/i },
  { name: 'purchase', re: /\bpurchas\w*/i },
  { name: 'pay', re: /\b(pay|pays|paid|paying|payment|payments)\b/i },
  { name: 'top up', re: /\btop[ -]?ups?\b/i },
  // Round 15 (Apple 3.1.3(f): no purchasing and no call to action for purchase outside of the app).
  { name: 'get more', re: /\bget more\b/i },
  { name: 'premium', re: /\bpremium\b|\bmemberships?\b|\bfree trial\b/i },
  { name: 'money', re: /[$\u20ac\u00a3]\s?\d|\b\d+(?:[.,]\d+)?\s?(?:usd|eur|dollars?|euros?)\b/i },
  { name: 'per month', re: /\b(?:per|a|each|every) (?:month|year)\b|\bmonthly\b|\byearly\b|\bannual(?:ly)?\b|\/mo\b/i },
  { name: 'offer', re: /\b(?:redeem\w*|coupons?|discounts?|promo codes?|refunds?|refunded)\b/i },
  { name: 'charge', re: /\b(?:charge|charges|charged)\b/i },
  { name: 'renewal', re: /\brenew\w*/i },
]

/** The long name of the product, in every spelling. */
const PRODUCT_NAME: readonly WordRule[] = [{ name: 'product name', re: FULL_NAME_SPELLINGS }]

/**
 * The id of a model as the app routes it ("openai::Qwen3.5-0.8B-Q4_K_M",
 * "lu-cloud::maker/model"). A person reads the name of a model, never this:
 * the id of a Cloud model is the one place a word can stand that its neutral
 * name was chosen to avoid.
 */
const RAW_ID: readonly WordRule[] = [{ name: 'raw model id', re: /\b[a-z][\w-]*::[\w./-]+/i }]

/** The website as a place to go. */
const WEBSITE: readonly WordRule[] = [{ name: 'lu-labs.ai', re: /lu-labs\.ai/i }]
const WEBSITE_WORD: readonly WordRule[] = [{ name: 'website', re: /\bwebsites?\b/i }]

/** Answers without limits, as a promise or as a technical term. */
const UNCENSORED: readonly WordRule[] = [
  { name: 'uncensored', re: /uncensor\w*/i },
  { name: 'nsfw', re: /\bnsfw\b/i },
  // The other spellings a hub uses for it (F10). The list of the app is src/mobile/policy/unfiltered-names.ts;
  // src/mobile/__tests__/store-regeln.test.ts holds these two rules and the one below against its samples.
  { name: 'uncensored, other spellings', re: /\b(de|un)-censor\w*|\bdecensor\w*|\bjail-?br(oken|eak\w*)\b|\bde-?restrict\w*/i },
  { name: 'adult content', re: /\berp\b|\berotic\w*|\blewd\w*|\bsmut\b|\bhentai\b|\bporn\w*|\bxxx\b/i },
]
/** The promise and the mark: no store build shows them, wherever they stand. */
const NO_REFUSALS: readonly WordRule[] = [
  { name: 'no refusals', re: /\b(no|without|few) refus\w+/i },
  { name: 'no filter', re: /\bno filters?\b/i },
]
/** The two words as a plain designation of a model (store switch unfilteredWords). */
const DESIGNATION: readonly WordRule[] = [
  { name: 'unfiltered', re: /\bunfilter\w*/i },
  { name: 'abliterated', re: /abliterat\w*/i },
  { name: 'abliterated, other spellings', re: /\b\w*ablat(ed|ion)\b|\babl\b|\bobliterat\w*|\borthogonal\w*|\bortho\b|\bheretic\w*|\bun-filter\w*|\bno-?refus\w*|\bnofilter\b|\brefusal[\s-]?(free|removed)\b|\b(zero|non)[\s-]?refus\w*|\bunrefus\w*/i },
]
const HUB: readonly WordRule[] = [{ name: 'hugging face', re: /hugging\s?face/i }]

/**
 * "plan" also means two things that have nothing to do with buying: the list
 * of steps an agent works through, and the mobile data plan of the phone.
 * And "Get more models" is the way to the catalogue of models for this
 * phone, where nothing is bought.
 * These wordings are taken out before the word is looked for.
 */
const NOT_BUYING: readonly RegExp[] = [/\bdata plan\b/gi, /\bUpdate the plan\b/g, /\bClear plan\b/g, /\bPlan, \d+ of \d+ done\b/g, /\bGet more models\b/g]

/**
 * Credits as something to get, not as how many are left or used: "Add
 * credits", "bought credits", "More credits each month", "an account with
 * credits", credits that refill, renew or expire.
 */
const GETTING_CREDITS: readonly RegExp[] = [
  /\b(buy|buys|bought|get|gets|add|adds|need|needs)\s+(?:\w+\s+){0,2}credits?\b/i,
  /\bmore credits\b/i,
  /\baccount with credits\b/i,
  /\bcredits?\b[^.]*\b(refill|refills|renew\w*|expire\w*)\b/i,
]

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export interface GuardOptions {
  /** The text comes from a place where a model is picked (onboarding, catalogue, model sheet). */
  picker?: boolean
  /**
   * The switch `unfilteredWords` of the build (policy/storePolicy.ts). Only
   * with it, and only where a model is picked, may a Play build show the
   * words "Unfiltered" and "Abliterated": as the name of what a model is.
   * Without it they are a finding everywhere, the same as in an App Store
   * build. The mark "No Filter" and every promise are a finding either way
   * (acceptance Android 8 GB, B3: the old rule let all of it pass in a picker).
   */
  designation?: boolean
  /**
   * False: the support address is a pointer to the website like any other.
   * For a reader that knows where a text stands and has taken the address out
   * at the place it belongs to (CONTACT_PLACE). Default true: a loose text
   * (src/mobile/strings/, the store listings) may name the address.
   */
  supportAddress?: boolean
  /**
   * False: the sentence of a Play build about plans (PLAY_SENTENCE) is a pointer to the website like any other.
   * For a reader that knows where a text stands and found it at none of PLAY_SENTENCE_PLACES. Default true: a
   * loose text (src/mobile/strings/) has no place to ask for.
   */
  playSentence?: boolean
}

/**
 * Pure: what in this text a store build must not show. Empty when the text is fine.
 * Each finding names the rule and quotes the sentence it was found in.
 */
export function storeFindings(text: string, preset: GuardedPreset, options: GuardOptions = {}): string[] {
  let cleaned = options.supportAddress === false ? text : text.split(SUPPORT_EMAIL).join(' ')
  for (const allowed of NOT_BUYING) cleaned = cleaned.replace(allowed, ' ')
  if (preset === 'play' && options.playSentence !== false) cleaned = cleaned.split(PLAY_SENTENCE).join(' ')
  const rules: WordRule[] = [...PRICING, ...WEBSITE, ...PRODUCT_NAME, ...UNCENSORED, ...RAW_ID]
  rules.push(...NO_REFUSALS)
  if (preset === 'appstore') rules.push(...WEBSITE_WORD, ...DESIGNATION, ...HUB)
  else if (!(options.picker && options.designation)) rules.push(...DESIGNATION)

  const found: string[] = []
  for (const sentence of sentences(cleaned)) {
    for (const rule of rules) {
      if (rule.re.test(sentence)) found.push(`${rule.name}: "${sentence.slice(0, 140)}"`)
    }
    if (GETTING_CREDITS.some((re) => re.test(sentence))) found.push(`credits as something to get: "${sentence.slice(0, 140)}"`)
  }
  return [...new Set(found)]
}

/** The names of the rules about buying, as storeFindings() writes them in front of a finding. */
const BUYING_RULES: readonly string[] = [...PRICING.map((rule) => rule.name), 'credits as something to get']

/** Pure: is this finding one about buying (plan, price, purchase, credits as something to get), and not about the website, a name or a link. */
export function isBuyingFinding(finding: string): boolean {
  return BUYING_RULES.some((name) => finding.startsWith(`${name}: `))
}

/** Pure: is this address of a link element fine in a store build. Addresses inside the app are, and the four legal ones. */
export function linkAllowed(href: string): boolean {
  const url = href.trim()
  if (url === '' || url.startsWith('#') || url.startsWith('/') || url.startsWith('blob:') || url.startsWith('data:')) return true
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)) return true
  return LEGAL_LINKS.includes(url.replace(/\/+$/, ''))
}
