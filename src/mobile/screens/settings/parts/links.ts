/**
 * Every address this strand opens in the system browser, and the one way to
 * open it. Buying and managing a plan happen on the website, never in the
 * app. A forgotten password is reset inside the app (ForgotPasswordSheet).
 */
import { CLOUD_BASE } from '../../../../api/cloud/config'
import { PRICING_URL } from '../../../../lib/credits-exhausted'
import { LEGAL_LINKS, SUPPORT_EMAIL, SUPPORT_MAILTO, openAppLink } from '../../../policy/links'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { toast } from '../../../ui'

/** The support address lives with the legal links (policy/links.ts), at that ONE place. */
export { SUPPORT_EMAIL, SUPPORT_MAILTO }

export type PlanSlug = 'hosted' | 'hosted-pro' | 'hosted-max'

export const LINKS = {
  pricing: PRICING_URL,
  account: `${CLOUD_BASE}/account`,
  privacy: LEGAL_LINKS.privacy,
  terms: LEGAL_LINKS.terms,
  website: CLOUD_BASE,
  /** Where an account is deleted without the app: the deletion page of the website (policy/links.ts). */
  deleteAccount: LEGAL_LINKS.deleteAccount,
  source: 'https://github.com/purpledoubled/locally-uncensored',
  /** HEAD resolves to the default branch, whatever it is called. */
  licenses: 'https://github.com/purpledoubled/locally-uncensored/blob/HEAD/LICENSE',
} as const

/** Checkout of one plan. `src` tells the website the visit came from the phone app. */
export function checkoutUrl(plan: PlanSlug): string {
  return `${CLOUD_BASE}/checkout/start?plan=${encodeURIComponent(plan)}&src=mobile`
}

/**
 * Open a link in the system browser, through the one door for links of the
 * app (policy/links.ts): a build whose store allows the legal links only
 * opens those and no other. A link that could not be opened says so in a
 * toast; nothing pretends it worked.
 */
export async function openLink(url: string): Promise<boolean> {
  const result = await openAppLink(url)
  if (result.opened) return true
  toast(result.reason === 'blocked' || result.reason === 'store' ? SETTINGS_STRINGS.common.linkBlocked : SETTINGS_STRINGS.common.linkFailed, {
    tone: 'error',
    testid: 'link-failed',
  })
  return false
}
