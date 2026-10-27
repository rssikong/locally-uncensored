/**
 * Deep links (lu://...) as a seam.
 *
 * Every link the system hands to the app goes through ONE door of the logic
 * layer, reportIncomingUrl (src/lib/incoming-url.ts):
 *  - `lu://oauth/callback?...` is the return from signing in. The logic layer
 *    finishes it there (handleOAuthCallbackUrl): the user started that sign
 *    in himself a moment ago, so nothing is asked again.
 *  - every other link reaches receiveDeepLink below, registered through
 *    onIncomingUrl. Such a link never runs an action by itself. It leaves an
 *    OFFER, the shell shows it as the sheet "link-offer" (G14), and the offer
 *    expires after 5 minutes (DESIGN.md section 3).
 *
 * Ways a link comes in, because none of them is reliable alone:
 *  1. the plugin lu-native through its bridge: onDeepLink delivers the link
 *     the app was started with and every later one, each exactly once,
 *  2. without the bridge: the DOM event `lu:deep-link` while the app runs,
 *     and the command `pending_deep_link` at start and on every return to
 *     the foreground. Measured in the iOS simulator: when a link starts the
 *     app cold, Tauri's getCurrent() answers null and the address is lost.
 *     The native layer has to keep it and hand it out here.
 *  3. no link at all: the sign in flow checks the account again on the next
 *     start and on return (MobileRoot refreshes useCloudAuth). So a lost
 *     link costs one look at the account page, not the sign in.
 */
import { create } from 'zustand'
import { onIncomingUrl, reportIncomingUrl } from '../../lib/incoming-url'
import { navApi } from './api'
import { useNavStore } from './store'
import { parsePairingInput } from '../remote/pairingLink'
import { parseNoticeUrl } from '../remote/noticeLink'
import { nativeBridge } from '../platform/bridge'
import { callNative } from '../platform/native'
import { NATIVE_EVENTS } from '../platform/contract'
import { onLifecycle } from '../platform/lifecycle'
import { remoteDesktopOffered } from '../policy/gates'

export const LINK_OFFER_TTL_MS = 5 * 60 * 1000

/**
 * What a link can offer. Today that is one thing: a desktop to pair with.
 * A sign in link is never an offer: the real one (lu://oauth/callback) is
 * finished by the logic layer before it gets here, and nothing else can be
 * finished at all, so offering it only led to "could not be finished"
 * (review N3).
 */
export type LinkOffer = { kind: 'remote'; url: string; address: string }

export interface StoredOffer {
  offer: LinkOffer
  expiresAt: number
}

/**
 * Pure: what a link offers, or null when it is not one of ours.
 *
 * A desktop link is read by the ONE reader of pairing data
 * (remote/pairingLink.ts, parsePairingInput), the same one the Connect page
 * and the scanner use. So a link that becomes an offer is a link the Connect
 * page can read, and the other way round.
 */
export function parseDeepLink(url: string): LinkOffer | null {
  if (typeof url !== 'string' || !/^lu:/i.test(url.trim())) return null
  const target = parsePairingInput(url.trim())
  if (!target) return null
  // As a person would type it: Wi-Fi addresses without "http://".
  return { kind: 'remote', url, address: target.baseUrl.replace(/^http:\/\//, '') }
}

export function isOfferAlive(stored: StoredOffer | null, now: number): stored is StoredOffer {
  return !!stored && stored.expiresAt > now
}

interface LinkOfferState {
  stored: StoredOffer | null
  setOffer: (offer: LinkOffer, now?: number) => void
  clear: () => void
}

export const useLinkOfferStore = create<LinkOfferState>((set) => ({
  stored: null,
  setOffer: (offer, now = Date.now()) => set({ stored: { offer, expiresAt: now + LINK_OFFER_TTL_MS } }),
  clear: () => set({ stored: null }),
}))

/** The offer that is still valid, or null. Reading an expired offer drops it. */
export function currentLinkOffer(now: number = Date.now()): LinkOffer | null {
  const { stored, clear } = useLinkOfferStore.getState()
  if (isOfferAlive(stored, now)) return stored.offer
  if (stored) clear()
  return null
}

let sayUnavailable: (() => void) | null = null
/** A build without Remote desktop got a link to one and has not said so yet. Only this is kept: no address, no code. */
let unavailableWaits = false
/** The shell is drawn and can show a notice. */
let shellUp = false

/**
 * How the shell says "this version has no Remote desktop". Set by the boot,
 * for the same reason as the preloader below: this file does not reach the
 * toast of the kit.
 */
export function setLinkUnavailableNotice(say: (() => void) | null): void {
  sayUnavailable = say
}

/**
 * Say "this version has no Remote desktop" once, at a moment the user can
 * read it.
 *
 * The sentence is a toast and stays a few seconds. A link comes from outside
 * the app, so it arrives at the worst moments: with the link that starts the
 * app, before anything is drawn (the start takes the link before the shell
 * stands, and the seconds of the toast ran under the loading page), while the
 * app is still behind the one the link was tapped in, or during the
 * onboarding, where it was dropped without a word. On the phone the App Store
 * build then said nothing at all, warm and cold (acceptance on the large
 * iPhone, G9). So the sentence waits until the shell is drawn, the page is in
 * sight and no flow is on top, and is said then. Several links while it
 * waits are one sentence.
 */
function sayUnavailableWhenSeen(): void {
  if (!unavailableWaits || !sayUnavailable || !shellUp) return
  if (navApi.getState().flow) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  unavailableWaits = false
  sayUnavailable()
}

/** The shell is drawn (MobileRoot, after its first frame): a notice that waited can be said now. */
export function linkNoticesReady(): void {
  shellUp = true
  sayUnavailableWhenSeen()
}

/**
 * A17: the link behind a notice of the computer. It only names a page of
 * the app (a shared chat, a result) and is opened at once: nothing is paired,
 * nothing is sent. A build without Remote desktop takes it and does nothing.
 */
function openNotice(url: string): boolean {
  const target = parseNoticeUrl(url)
  if (!target) return false
  if (!remoteDesktopOffered()) return true
  if (target.kind === 'chat') navApi.push('/remote/shared/:id', { id: target.id })
  else navApi.push('/create/item/:id', { id: target.id })
  return true
}

/** Take a link in. Returns true when it became an offer (or, A17, opened the page of a notice). */
export function receiveDeepLink(url: string): boolean {
  if (openNotice(url)) return true
  const offer = parseDeepLink(url)
  if (!offer) return false
  // A build without Remote desktop takes the link, says so once, and keeps nothing of it:
  // no offer, no address, no page.
  if (!remoteDesktopOffered()) {
    unavailableWaits = true
    sayUnavailableWhenSeen()
    return true
  }
  useLinkOfferStore.getState().setOffer(offer)
  // During the onboarding the offer waits; the account page of the flow picks it up.
  if (!navApi.getState().flow) void openLinkOffer()
  return true
}

let preloadLinkOffer: (() => Promise<unknown>) | null = null

/**
 * How the file of the sheet "link-offer" is loaded ahead. Set by the boot
 * (boot/index.tsx): this file cannot import the table of loaders itself, the
 * table reaches back here through the screens.
 */
export function setLinkOfferPreloader(preload: (() => Promise<unknown>) | null): void {
  preloadLinkOffer = preload
}

/**
 * Open the question about a link with its real text from the first frame.
 * The sheet is a file of its own; opened before that file is there it showed
 * a title "Continue?" over grey rows for a moment (seen on a phone,
 * 08.10.2026), which reads like a request to tap. So the file is loaded
 * first. If it cannot be loaded the sheet opens anyway and says so.
 */
export async function openLinkOffer(): Promise<void> {
  if (preloadLinkOffer) await preloadLinkOffer().catch(() => undefined)
  // The answer may have come meanwhile: the offer ran out, the onboarding began, the sheet is open already.
  if (!currentLinkOffer() || navApi.getState().flow) return
  if (navApi.getState().overlays.some((entry) => entry.kind === 'sheet' && entry.sheet === 'link-offer')) return
  navApi.openSheet('link-offer')
}

/**
 * Hand a link from the system to the logic layer's door. Resolves true when
 * something took it: the sign in, or an offer of the shell. Never throws.
 */
export function deliverIncomingLink(url: string | null | undefined): Promise<boolean> {
  return reportIncomingUrl(url)
}

async function takePending(): Promise<void> {
  try {
    const url = await callNative<string | null>('pending_deep_link')
    if (url) void deliverIncomingLink(url)
  } catch {
    /* command not there yet, or nothing pending */
  }
}

async function listen(): Promise<void> {
  try {
    const bridge = await nativeBridge()
    if (bridge && typeof bridge.onDeepLink === 'function') {
      // Start link and later links, each once. No second way next to it.
      await bridge.onDeepLink((url) => void deliverIncomingLink(url))
      return
    }
  } catch {
    /* no plugin in this build: the older ways below */
  }
  void takePending()
  onLifecycle({ onForeground: () => void takePending() })
}

let installed = false

export function installDeepLinks(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  // Links that are not the sign in callback become an offer.
  onIncomingUrl((url) => receiveDeepLink(url))
  // A notice that waits is said when the page comes into sight and when the onboarding is over.
  document.addEventListener('visibilitychange', sayUnavailableWhenSeen)
  useNavStore.subscribe((state, before) => {
    if (before.flow && !state.flow) sayUnavailableWhenSeen()
  })
  window.addEventListener(NATIVE_EVENTS.deepLink, (event) => {
    const detail = (event as CustomEvent<{ url?: string } | null>).detail
    if (detail && typeof detail.url === 'string') void deliverIncomingLink(detail.url)
  })
  void listen()
}

/** Only for tests. */
export function __resetDeepLinksForTests(): void {
  installed = false
  unavailableWaits = false
  shellUp = false
}
