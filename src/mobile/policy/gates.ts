/**
 * What the store switches close: whole pages and sheets, and the three
 * choices of wording a text can hang on.
 *
 * A closed page is not an error. Whoever still gets there (a saved stack
 * from an earlier build, a link, a button nobody thought of) sees the page
 * "Not part of this version" (policy/UnavailablePage.tsx), because the table
 * of loaders hands out that file in place of the real one (nav/loaders.ts).
 * So one line here closes a page for good, whatever leads to it.
 *
 * Imports the switches and nothing else, so nav and the texts may import it.
 */
import { outwardPurchase, storePolicy, type StorePolicy } from './storePolicy'

/** The switch that closes something. */
export type GateSwitch = 'externalProviders' | 'remoteDesktop'

const ROUTE_GATES: ReadonlyArray<{ test: (route: string) => boolean; gate: GateSwitch }> = [
  { test: (route) => route === '/settings/providers' || route.startsWith('/settings/providers/'), gate: 'externalProviders' },
  { test: (route) => route === '/settings/remote' || route.startsWith('/remote/'), gate: 'remoteDesktop' },
]

const SHEET_GATES: ReadonlyArray<{ test: (sheet: string) => boolean; gate: GateSwitch }> = [
  { test: (sheet) => sheet.startsWith('remote-') || sheet === 'link-offer', gate: 'remoteDesktop' },
]

type Switches = Pick<StorePolicy, GateSwitch>

/** Pure: the switch that closes this route in this policy, or null when the route is open. Takes a route id or a path. */
export function routeGate(route: string, policy: Switches = storePolicy()): GateSwitch | null {
  for (const entry of ROUTE_GATES) if (entry.test(route) && !policy[entry.gate]) return entry.gate
  return null
}

/** Pure: the switch that closes this sheet in this policy, or null. */
export function sheetGate(sheet: string, policy: Switches = storePolicy()): GateSwitch | null {
  for (const entry of SHEET_GATES) if (entry.test(sheet) && !policy[entry.gate]) return entry.gate
  return null
}

/** Is Remote desktop part of this build. */
export function remoteDesktopOffered(): boolean {
  return storePolicy().remoteDesktop
}

/**
 * Is Create over the desktop part of this build ("My computer" in Create,
 * "Sign in with my computer"). Needs Remote desktop as well: a build
 * without Remote has no computer to create on.
 */
export function remoteCreateOffered(): boolean {
  const p = storePolicy()
  return p.remoteDesktop && p.remoteCreate
}

/** May the user bring a key of his own for the web search (Brave, Tavily). */
export function webSearchKeysOffered(): boolean {
  return storePolicy().webSearchKeys
}

/** Are providers with the user's own key part of this build. */
export function externalProvidersOffered(): boolean {
  return storePolicy().externalProviders
}

/**
 * A text in two wordings: the one of the product, and the one for a build
 * that must not speak of buying (plan, price, subscription). Asked when the
 * text is read, so a text file can hold both next to each other:
 *
 *   get title() { return priced('Price of this answer', 'Credits for this answer') },
 */
export function priced<T>(open: T, store: T): T {
  return storePolicy().pricingWords ? open : store
}

/** The same choice for advertising answers without refusals. */
export function marketed<T>(open: T, store: T): T {
  return storePolicy().unfilteredMarketing ? open : store
}

/**
 * The same choice for a text that names the model hub. A build that lets the
 * user search the hub names it; a build with the fixed catalogue only says
 * "the download server".
 */
export function hubNamed<T>(open: T, store: T): T {
  return storePolicy().customModelUrl ? open : store
}

/** The same choice for a text that names the website or sends the user there. */
export function linked<T>(open: T, store: T): T {
  return storePolicy().externalLinks === 'all' ? open : store
}

/**
 * The same choice for a text that, read in a build with no word about
 * buying, would still point at getting more: "yet", "this period". A build
 * that links to plans or names the one sentence keeps the wording of the
 * product; a build that shows nothing towards buying (App Store) says the
 * same fact without the hint.
 */
export function buyHinted<T>(open: T, store: T): T {
  return outwardPurchase(storePolicy().purchase) === 'none' ? store : open
}
