/**
 * What a store demands of the app, as switches a screen can ask.
 *
 * One build carries one preset. It comes from the Vite variable
 * VITE_LU_STORE_PRESET, read when the bundle is built, and is `open` when the
 * variable is missing or holds something else. Nothing at run time changes
 * it: no setting, no address, no saved value, no link. Two builds are the
 * exception, and neither of them is a build a customer gets:
 *  - the developer server (import.meta.env.DEV) takes ?store=play,
 *  - the acceptance build (VITE_LU_ABNAHME=1) lets its test hook pick one.
 * In every other build setStorePresetForTests and applyDevStorePreset do
 * nothing at all (policy/__tests__/preset-build.test.ts builds and asks).
 *
 * The presets are a proposal (mobile-docs/STORE-BAUSTEINE.md). A screen never
 * asks for the preset, it asks for the one switch it needs:
 *
 *   if (storePolicy().purchase === 'links') ...
 *
 * This file imports nothing, so everything may import it.
 */
export type StorePreset = 'open' | 'play' | 'appstore'

export interface StorePolicy {
  preset: StorePreset
  /** A report button on every AI answer and every generated medium. */
  reportContent: boolean
  /** Deleting the account inside the app. */
  accountDeletion: boolean
  /** A way to contact the maker, in About. */
  contactInfo: boolean
  /** Ask before content is sent to LU Cloud for the first time. */
  aiDisclosureConsent: boolean
  ageGate: 'none' | 'declare-18'
  /** Content policy: every level / without "Off" / a fixed filter without a switch. */
  contentLevels: 'all' | 'no-off' | 'fixed-filter'
  /**
   * Buying: links to the pricing page / one sentence without a link / nothing
   * at all / credits as an in-app purchase of the system (StoreKit, iOS only).
   *
   * `in-app` is built and in no preset (round 17, mobile-docs/r17/in-app-kauf-gebaut.md).
   * Towards the outside it is `none`: no link, no sentence about another place
   * to buy, no price of the app's own (outwardPurchase below). On top of that
   * it has the sheet "Add credits", and only where the build also names the
   * address that credits a purchase (lib/iap.ts, iapOffered). Putting a preset
   * on `in-app` is David's decision; policy/__tests__/in-app.test.ts holds that
   * none stands there by accident.
   */
  purchase: 'links' | 'text-only' | 'none' | 'in-app'
  /**
   * Offer catalogue models that do not refuse. On in the open build only:
   * off in both store presets, for `play` decided 18.10.2026 (r56).
   */
  unfilteredCatalog: boolean
  /**
   * Files from outside the catalogue: the other packings of a repository the
   * catalogue lists, and a model file the user brings in from the phone
   * ("Import a model file"). Off: only the files the catalogue names.
   * On in the open build only: off in both store presets, for `play`
   * decided 18.10.2026 (r56).
   */
  customModelUrl: boolean
  /**
   * The open search at the model hub on the page Models: a field that asks
   * the hub for any repository, and the page of such a repository. Off: the
   * field is gone, a search that was typed asks nobody, and the page of a
   * repository outside the catalogue says "not offered"
   * (screens/models/parts/policy.ts, hubSearchOffered and repoOffered). The
   * catalogue with its filters stays.
   *
   * A switch of its own and not part of `customModelUrl`: what the hub
   * answers is named by strangers, and a list of spellings
   * (policy/unfiltered-names.ts) is a net, not a wall. A file the user
   * brings in himself is his own, so a build can close the search and keep
   * the import. Never on without `customModelUrl`. Off in both store presets,
   * decided 10.10.2026 for `play`, and turned back by the one line there.
   */
  hubSearch: boolean
  /**
   * Bring your own key: the page Providers with its hosted providers and the
   * custom endpoint. Off: the page is gone and a provider that was saved
   * before answers nothing (policy/gates.ts, boot/providers.ts).
   */
  externalProviders: boolean
  /** Remote desktop: the segment of the chat list, the row in Settings, the link lu://remote and the scanner. */
  remoteDesktop: boolean
  /**
   * Create over the desktop (LU 3.0.7): the source "My computer" next to LU
   * Cloud in Create, where a paired computer makes images and videos with
   * its own engines, and "Sign in with my computer" on the page Account.
   * Never on without `remoteDesktop`. Off: Create offers LU Cloud only,
   * whatever the computer says (screens/create/parts/computer-source.ts).
   *
   * Decided by David (E5, E6, E7): on in `play`, with the prompt check of
   * the app before anything is sent and the report button on every result;
   * off in the App Store preset, where Remote is off.
   */
  remoteCreate: boolean
  /**
   * The user's own keys for the web search (Brave, Tavily) on the page Web
   * search. Off: the two key fields and the choice of a provider are gone, a
   * key an earlier build saved is never sent, and every search is the free
   * one (boot/providers.ts, enforceSearchKeyPolicy).
   *
   * A switch of its own and not part of `externalProviders`: that one closes
   * model providers, where prompts and answers go to a third party. A search
   * key sends a search query to a search engine the free search asks anyway.
   * Off in the App Store preset, decided 10.10.2026 (acceptance on the large
   * iPhone, G4: a field named "API key" reads like a provider of one's own),
   * and turned back by the one line `webSearchKeys` in the preset below.
   */
  webSearchKeys: boolean
  /**
   * Signing in through somebody else's account: the buttons "Continue with
   * Google" and "Continue with GitHub" on the page Account. Off: the page
   * does not offer them and no such sign in can be started
   * (screens/settings/parts/auth.ts).
   *
   * Apple's rule 4.8 asks an app that offers a sign in through a third party
   * for an equivalent one that asks for little, in practice "Sign in with
   * Apple". That is the switch `appleSignIn` below, built in round 15. On in
   * every preset since then, decided by David on 10.10.2026: most accounts
   * were made with Google or GitHub, and their owners must get in on an
   * iPhone too. Never on in the App Store preset without `appleSignIn`
   * (policy/__tests__/policy.test.ts holds that).
   */
  thirdPartySignIn: boolean
  /**
   * "Sign in with Apple" on the page Account. The button exists on iOS only,
   * whatever this switch says: the sheet is the one of the system
   * (plugin lu-native, AppleSignIn.swift), and Android has none. Off: no
   * button and no such sign in on any phone (screens/settings/parts/auth.ts).
   * On in every preset.
   */
  appleSignIn: boolean
  /**
   * The field for a Hugging Face token (models that ask for a sign in there).
   * Follows `customModelUrl`: a build with the fixed catalogue loads nothing
   * that needs a token (data/mobile-models.ts: none of the repos is gated).
   * Never on without `customModelUrl` (policy/__tests__/policy.test.ts).
   */
  gatedModelToken: boolean
  /** Advertising for answers without refusals: counters, claims, tags and the name spelled out. */
  unfilteredMarketing: boolean
  /**
   * The words "Unfiltered" and "Abliterated" as a plain designation, not as
   * advertising: the name of a model that carries one of them, the filter
   * "Unfiltered" of the catalogue and the tab "Unfiltered" of the onboarding.
   * Off: none of them is shown, and a model that can only be shown under such
   * a name is not listed (policy/unfiltered.ts).
   *
   * Only read where `unfilteredMarketing` is off; a build that advertises
   * shows the words anyway. Decided 10.10.2026: off in both store presets,
   * no store package shows the words, not as a name, a filter, a tab or a
   * tag. Turning it on is the one line `unfilteredWords` in a preset below,
   * and the guard (e2e/mobile/store-rules.ts) reads it there.
   */
  unfilteredWords: boolean
  /**
   * The mark "Direct" for a LU Cloud model whose name says that it does not
   * refuse. On, in a build that lists such models and may not show the words:
   * the word is taken out of the name the build shows, the server's name
   * stays what it is, and the model carries the mark "Direct" (a small tag,
   * "D" where there is no room). A tap on the mark shows one sentence
   * (policy/unfiltered.ts, DIRECT_SENTENCE). Off: such a model is not listed
   * at all while the words may not be shown.
   *
   * Only read with `unfilteredCatalog` on and the words off: the open build
   * shows the words themselves, and a build without the catalogue lists no
   * such model. It is set in the App Store preset too, so that the
   * one line `unfilteredCatalog` there brings the models with the mark and
   * never with the word. Decided 10.10.2026, turned back by the one line.
   * Off in `play` since 18.10.2026 (r56), where the catalogue is off too.
   */
  directBadge: boolean
  /** Personas whose prompt tells the model to drop its limits ("No Filter"). */
  unfilteredPersonas: boolean
  /**
   * Built in personas that carry the name of a real person, speak as one, or
   * play on a brand name ("Morgan Freeman", "Chef Ramsay", "ChadGPT"). Off:
   * they are not listed, and one that was active falls back to the default
   * (policy/personas.ts, which also says for every built in persona which
   * kind it is). A store listing with the name of a living person or of
   * somebody's product in it is a risk the open build can take and a store
   * build should not (second check on Android, F11). Decided 10.10.2026,
   * and turned back by the one line in the preset below.
   */
  realPersonPersonas: boolean
  /**
   * Links the app itself opens in the browser. `legal-only`: privacy policy,
   * terms of use, support and deleting the account, nothing else. Links
   * inside an answer or a message are content and not meant here.
   */
  externalLinks: 'all' | 'legal-only' | 'none'
  /**
   * Words about buying anywhere in the app: plan, price, subscription,
   * buying credits. Off: none of them. The one sentence a store allows
   * without a link belongs to `purchase: 'text-only'`.
   */
  pricingWords: boolean
}

/** On in every preset: both stores demand them, and they are right without a store too. */
const ALWAYS = { reportContent: true, accountDeletion: true, contactInfo: true, aiDisclosureConsent: true } as const

export const STORE_PRESETS: Readonly<Record<StorePreset, StorePolicy>> = {
  open: {
    preset: 'open',
    ...ALWAYS,
    ageGate: 'none',
    contentLevels: 'all',
    purchase: 'links',
    unfilteredCatalog: true,
    customModelUrl: true,
    hubSearch: true,
    externalProviders: true,
    remoteDesktop: true,
    remoteCreate: true,
    webSearchKeys: true,
    thirdPartySignIn: true,
    appleSignIn: true,
    gatedModelToken: true,
    unfilteredMarketing: true,
    unfilteredWords: true,
    // Without effect here: this build shows the words themselves (policy/unfiltered.ts, directMarkShown).
    directBadge: true,
    unfilteredPersonas: true,
    realPersonPersonas: true,
    externalLinks: 'all',
    pricingWords: true,
  },
  play: {
    preset: 'play',
    ...ALWAYS,
    ageGate: 'declare-18',
    contentLevels: 'no-off',
    purchase: 'text-only',
    // Decided 18.10.2026 (r56): the Play package offers the models of the App Store package. Google's policy
    // forbids apps that make sexual content, and the risk falls on the whole developer account. The open APK
    // from the website keeps everything. `true` brings the catalogue models that do not refuse back.
    unfilteredCatalog: false,
    // Decided 18.10.2026 (r56): only the files the catalogue names, no other packing and no import of a model
    // file. `true` brings both back; `hubSearch` never on without it.
    customModelUrl: false,
    // Decided 10.10.2026: off. Never on without `customModelUrl`.
    hubSearch: false,
    externalProviders: true,
    remoteDesktop: true,
    // E5 and E6, decided by David: local images and videos over the computer, with the prompt check and the report button. `false` keeps Create on LU Cloud only.
    remoteCreate: true,
    webSearchKeys: true,
    thirdPartySignIn: true,
    appleSignIn: true,
    // Follows `customModelUrl` (r56, 18.10.2026): the fixed catalogue names no repository that asks for a sign in.
    gatedModelToken: false,
    unfilteredMarketing: false,
    // Decided 10.10.2026: no store package shows "Unfiltered" or "Abliterated". `true` brings the words back as a plain designation.
    unfilteredWords: false,
    // Decided 18.10.2026 (r56): off, together with `unfilteredCatalog`. No LU Cloud model that is named by such a word is listed.
    directBadge: false,
    unfilteredPersonas: false,
    realPersonPersonas: false,
    externalLinks: 'legal-only',
    pricingWords: false,
  },
  appstore: {
    preset: 'appstore',
    ...ALWAYS,
    ageGate: 'declare-18',
    contentLevels: 'fixed-filter',
    purchase: 'none',
    unfilteredCatalog: false,
    customModelUrl: false,
    hubSearch: false,
    externalProviders: false,
    remoteDesktop: false,
    // E7: Remote is off here, and with it "My computer" in Create. Never on without `remoteDesktop`.
    remoteCreate: false,
    // G4, decided 10.10.2026: `true` brings the key fields for Brave and Tavily back into this build.
    webSearchKeys: false,
    // Rule 4.8, decided by David on 10.10.2026: Google and GitHub stay, with "Sign in with Apple" next to them. Never the first line without the second.
    thirdPartySignIn: true,
    appleSignIn: true,
    gatedModelToken: false,
    unfilteredMarketing: false,
    unfilteredWords: false,
    // Prepared: without effect while `unfilteredCatalog` is off here. With it on, the models come with the mark "Direct".
    directBadge: true,
    unfilteredPersonas: false,
    realPersonPersonas: false,
    externalLinks: 'legal-only',
    pricingWords: false,
  },
}

export const STORE_PRESET_IDS = Object.keys(STORE_PRESETS) as StorePreset[]

export const DEFAULT_STORE_PRESET: StorePreset = 'open'

/** Pure: the preset a text names, or null. */
export function parseStorePreset(value: unknown): StorePreset | null {
  return typeof value === 'string' && (STORE_PRESET_IDS as string[]).includes(value) ? (value as StorePreset) : null
}

function builtPreset(): StorePreset {
  let raw: unknown
  try {
    raw = import.meta.env.VITE_LU_STORE_PRESET
  } catch {
    raw = undefined
  }
  return parseStorePreset(raw) ?? DEFAULT_STORE_PRESET
}

/**
 * Pure: the upper limit a build puts on the content policy of an account.
 * `all` has none. A build without "Off" and a build with a fixed filter both
 * stop at the standard filter ('soft'), whatever the account says on the
 * website; an account that is stricter stays stricter (lib/content-policy-cap.ts).
 */
export function contentPolicyCapFor(levels: StorePolicy['contentLevels']): 'soft' | null {
  return levels === 'all' ? null : 'soft'
}

/**
 * May this build show another preset than the one it was built with. Both
 * constants are replaced when the app is built, so in a store build this is
 * the literal `false` and the bundler drops what hangs on it.
 */
function buildMayForce(): boolean {
  try {
    return import.meta.env.DEV === true || import.meta.env.VITE_LU_ABNAHME === '1'
  } catch {
    return false
  }
}

/** May a test hand in a value in place of what the build carries. False in every build a customer gets. */
export function testOverridesAllowed(): boolean {
  return buildMayForce()
}

let forced: StorePreset | null = null
let forcedPurchase: StorePolicy['purchase'] | null = null

/** The policy of this build. */
export function storePolicy(): StorePolicy {
  const preset = STORE_PRESETS[(buildMayForce() ? forced : null) ?? builtPreset()]
  // Only a developer or an acceptance build can carry a forced value; everywhere else this is the preset itself.
  if (buildMayForce() && forcedPurchase !== null && forcedPurchase !== preset.purchase) return { ...preset, purchase: forcedPurchase }
  return preset
}

/**
 * Pure: what the switch `purchase` means towards the outside, for every
 * surface that links to plans or names another place to buy. `in-app` is
 * `none` there: a build that sells through the system shows no link and no
 * pointer to anywhere else.
 */
export function outwardPurchase(purchase: StorePolicy['purchase']): 'links' | 'text-only' | 'none' {
  return purchase === 'in-app' ? 'none' : purchase
}

/** Pure: a value of the switch `purchase` a text names, or null. */
export function parsePurchase(value: unknown): StorePolicy['purchase'] | null {
  return value === 'links' || value === 'text-only' || value === 'none' || value === 'in-app' ? value : null
}

/**
 * Hand in a value of the one switch `purchase` for a test, on top of whatever
 * preset is shown; null goes back to the preset. This is how a test looks at
 * `in-app`, which no preset carries. Without effect in a build that is
 * neither a developer nor an acceptance build.
 */
export function setPurchaseForTests(purchase: StorePolicy['purchase'] | null): void {
  if (!buildMayForce()) return
  forcedPurchase = purchase
}

/**
 * Hand in a preset for a test, null to go back to the one of the build.
 * Without effect in a build that is neither a developer nor an acceptance build.
 */
export function setStorePresetForTests(p: StorePreset | null): void {
  if (!buildMayForce()) return
  forced = p
}

/**
 * The developer switch ?store=play. Takes effect in a developer build only:
 * a shipped app must not be talked out of its preset by an address.
 */
export function applyDevStorePreset(search: string, isDevBuild: boolean): StorePreset | null {
  if (!isDevBuild || !buildMayForce()) return null
  const params = new URLSearchParams(search)
  const wanted = parseStorePreset(params.get('store'))
  if (wanted) forced = wanted
  // ?purchase=in-app next to it: the one switch no preset carries (round 17), for the developer server and its tests.
  const purchase = parsePurchase(params.get('purchase'))
  if (purchase) forcedPurchase = purchase
  return wanted
}

// On the developer server the address is read as this file loads, before any
// screen or text asks for a switch. boot/index.tsx asks again, which changes nothing.
try {
  if (import.meta.env.DEV === true && typeof location !== 'undefined') applyDevStorePreset(location.search, true)
} catch {
  /* no address to read */
}
