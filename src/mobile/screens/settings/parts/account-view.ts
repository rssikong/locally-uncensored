/**
 * What the account card shows, worked out from the account state. Pure.
 */
import { formatCount } from '../../../../lib/formatters'
import { PLAN_NAMES } from '../../../../lib/past-due'
import type { CloudQuota } from '../../../../lib/render/cloud-jobs'

export interface CreditsView {
  /** 0 to 1, share of the period's credits that is used. */
  share: number
  used: string
  limit: string
  left: string
  leftNumber: number
  empty: boolean
  topup: string | null
}

const TIER_NAMES: Record<string, string> = {
  ...PLAN_NAMES,
  starter: 'Starter',
  'self-host': 'Self host',
}

/** "hosted-pro" becomes "Hosted Pro"; an unknown slug is shown as it is, with capitals. */
export function planName(tier: string | null | undefined): string | null {
  if (!tier) return null
  if (TIER_NAMES[tier]) return TIER_NAMES[tier]
  return tier
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function creditsView(quota: CloudQuota | null): CreditsView | null {
  if (!quota) return null
  const limit = Math.max(0, Number(quota.limits?.credits) || 0)
  const used = Math.max(0, Number(quota.used?.credits_used) || 0)
  const remaining = Number(quota.remaining?.credits)
  const left = Number.isFinite(remaining) ? Math.max(0, remaining) : Math.max(0, limit - used)
  const topup = Math.max(0, Number(quota.topup?.credits) || 0)
  return {
    share: limit > 0 ? Math.min(1, used / limit) : 0,
    used: formatCount(used),
    limit: formatCount(limit),
    left: formatCount(left),
    leftNumber: left,
    empty: left <= 0 && topup <= 0,
    topup: topup > 0 ? formatCount(topup) : null,
  }
}

export type GateState = 'probing' | 'signed-out' | 'offline' | 'past-due' | 'no-plan' | 'gated' | 'no-quota' | 'no-budget' | 'ready'

/** Which of the states of E3 the account is in. The order is the order the desktop gate checks them. */
export function gateState(a: {
  status: 'probing' | 'signed-out' | 'signed-in'
  user: unknown
  offline: boolean
  licenseActive: boolean
  access: boolean
  pastDue: boolean
  quota: CloudQuota | null
}): GateState {
  if (a.status === 'probing') return 'probing'
  if (a.status === 'signed-out' || !a.user) return 'signed-out'
  if (a.offline) return 'offline'
  if (!a.licenseActive) return a.pastDue ? 'past-due' : 'no-plan'
  if (!a.access) return 'gated'
  if (a.quota === null) return 'no-quota'
  if ((a.quota.limits?.credits ?? 0) <= 0) return a.pastDue ? 'past-due' : 'no-budget'
  return 'ready'
}
