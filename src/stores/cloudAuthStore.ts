// LU Cloud account state. Deliberately NOT persisted: the session itself
// lives in the OS keychain (api/cloud/supabase.ts storage adapter) and
// user/tier/quota are re-derived from /api/me + /api/jobs/quota on boot —
// a persisted copy could only ever be stale.

import { create } from 'zustand'
import { clearFlashNotices } from '../lib/flash-ui'
import type { CloudQuota } from '../lib/render/cloud-jobs'

export interface CloudUser {
  id: string
  email?: string
}

export interface CloudAccount {
  licenseActive: boolean
  /** Canonical tier slug from /api/me, null while signed out/unknown. */
  tier: string | null
  /** Server-driven access gate. Used by the 2.5.7 Max-only closed beta;
   *  the beta is fully open since, so servers now send true for every
   *  licensed account — kept as a kill-switch the server owns. */
  access: boolean
  /**
   * Hat dieses Konto wirklich bezahlt? `/api/me` fuehrt dafuer dieselbe
   * Funktion aus, nach der der Chat-Vermittler eine Flash-Runde abrechnet.
   * `null` heisst "noch keine Antwort" oder "aelterer Server ohne das Feld",
   * und das verspricht nichts (siehe lib/flash-entitlement).
   */
  paidPlan?: boolean | null
  /** A renewal payment failed and no paid plan is active. Says nothing about
   *  licenseActive: pack credits keep an unpaid account working. */
  pastDue?: boolean
  /** The plan that is waiting for that payment, null otherwise. */
  pastDueTier?: string | null
  quota: CloudQuota | null
}

interface CloudAuthState extends CloudAccount {
  paidPlan: boolean | null
  pastDue: boolean
  pastDueTier: string | null
  /** 'probing' until the keychain session restore + first /api/me resolve. */
  status: 'probing' | 'signed-out' | 'signed-in'
  user: CloudUser | null
  /**
   * Phone only: the first probe after start could not reach the server, and a
   * session is saved on this device. The account is neither confirmed nor
   * gone. `status` is 'signed-in' with the user from the saved session, the
   * licence and quota fields are unknown (false, null), and the app mode is
   * left as the user set it. Cleared by the next probe that gets an answer.
   * Always false on a desktop.
   */
  offline: boolean

  setSignedOut: () => void
  setSignedIn: (user: CloudUser, account: CloudAccount) => void
  /** Phone only: "offline, session kept". See `offline`. */
  setOfflineSessionKept: (user: CloudUser) => void
  setQuota: (quota: CloudQuota | null) => void
}

export const useCloudAuthStore = create<CloudAuthState>()((set) => ({
  status: 'probing',
  user: null,
  offline: false,
  licenseActive: false,
  tier: null,
  access: true,
  paidPlan: null,
  pastDue: false,
  pastDueTier: null,
  quota: null,

  setSignedOut: () =>
    set({
      status: 'signed-out', user: null, offline: false, licenseActive: false, tier: null, access: true,
      paidPlan: null, pastDue: false, pastDueTier: null, quota: null,
    }),
  setSignedIn: (user, account) =>
    set({
      status: 'signed-in', user, offline: false, ...account,
      paidPlan: account.paidPlan ?? null,
      pastDue: account.pastDue === true,
      pastDueTier: account.pastDue === true ? (account.pastDueTier ?? null) : null,
    }),
  setOfflineSessionKept: (user) => set({ status: 'signed-in', user, offline: true }),
  setQuota: (quota) => set({ quota }),
}))

useCloudAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) clearFlashNotices()
})

/** The whole cloud axis in one predicate: signed in, actively licensed,
 *  through the launch gate, and on a tier whose monthly credit budget is > 0
 *  (self-host tiers report 0). */
export function deriveCloudAvailable(state: {
  user: CloudUser | null
  licenseActive: boolean
  access: boolean
  quota: CloudQuota | null
}): boolean {
  return Boolean(state.user && state.licenseActive && state.access && (state.quota?.limits.credits ?? 0) > 0)
}
