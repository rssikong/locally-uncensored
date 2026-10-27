/**
 * The links the app itself opens in the browser, and the one door for them.
 *
 * `externalLinks` decides: every link, only the legal ones, or none. The
 * legal ones are four, and a store asks for each of them: the privacy
 * policy, the terms of use, a way to reach support, and the place where an
 * account is deleted without the app.
 *
 * A link inside an answer or inside a message the user wrote is content. It
 * does not go through this door (ui/Markdown.tsx, screens/chat/LinkSheet.tsx
 * ask the user and open what he tapped).
 */
import { CLOUD_BASE } from '../../api/cloud/config'
import { openExternal, type OpenResult } from '../platform/open-external'
import { storePolicy, type StorePolicy } from './storePolicy'

/** The support address, at this ONE place. It is the address the website and the repository already name. */
export const SUPPORT_EMAIL = 'hello@lu-labs.ai'
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`

export const LEGAL_LINKS = {
  privacy: `${CLOUD_BASE}/privacy`,
  terms: `${CLOUD_BASE}/terms`,
  support: SUPPORT_MAILTO,
  /**
   * Where an account is deleted without the app: the page of the website for exactly that (live since
   * 14.10.2026). It names the app, the steps and what is kept, and needs no sign in to be read (Play, Pruefersicht R7).
   */
  deleteAccount: `${CLOUD_BASE}/delete-account`,
} as const

const LEGAL = new Set<string>(Object.values(LEGAL_LINKS))

function sameAddress(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Pure: is this address one of the four legal ones. Exact, no page below one of them counts. */
export function isLegalLink(url: string): boolean {
  return LEGAL.has(sameAddress(url))
}

/** Pure: may the app open this address by itself in this policy. */
export function appLinkAllowed(url: string, policy: Pick<StorePolicy, 'externalLinks'> = storePolicy()): boolean {
  if (policy.externalLinks === 'all') return true
  if (policy.externalLinks === 'none') return false
  return isLegalLink(url)
}

export type AppLinkResult = OpenResult | { opened: false; reason: 'store' }

/**
 * Open a link of the app. A link this build does not carry is not opened
 * and answers `store`; the caller hides such a link, this is the second lock.
 */
export async function openAppLink(url: string): Promise<AppLinkResult> {
  if (!appLinkAllowed(url)) return { opened: false, reason: 'store' }
  return openExternal(url)
}
