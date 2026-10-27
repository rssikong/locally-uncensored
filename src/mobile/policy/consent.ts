/**
 * Consent before content goes to LU Cloud (Apple 5.1.2(i), switch
 * aiDisclosureConsent).
 *
 *   if (!(await ensureAiConsent())) return   // before the first cloud send
 *
 * The first call shows the sheet "ai-consent" once. Agreeing is saved on the
 * phone and never asked again until it is taken back (revokeAiConsent) or
 * the text changes (CONSENT_VERSION). Declining, closing the sheet or going
 * back all count as "no", save nothing, and the next send asks again.
 *
 * The decision also goes into the native layer (decision-vault.ts), so a
 * localStorage that lost it at a full phone gets it back at the next start
 * (round 30, B3). Taking it back is saved as a decision of its own, with its
 * time, not as an empty key: an empty key is what a lost storage looks like,
 * and the newer of the two decisions wins on both sides. A consent counts
 * only when one of the two sides holds an "agreed" from this user; when
 * neither can be read, the sheet asks again.
 */
import { useSyncExternalStore } from 'react'
import { navApi } from '../nav/api'
import { useNavStore } from '../nav/store'
import { CONSENT_VAULT_ID, loadDecision, saveDecision } from './decision-vault'
import { onSavedChange, readSaved, writeSaved } from './saved'
import { storePolicy } from './storePolicy'

export const AI_CONSENT_KEY = 'lu-mobile-ai-consent'
/** Raise when the text of the sheet changes in substance: everyone is asked again. */
export const CONSENT_VERSION = 2
export const AI_CONSENT_SHEET = 'ai-consent'

interface SavedConsent {
  v: number
  agreedAt: string
}

/** Taking the consent back, kept with its time so it can win against an older "agreed". */
interface SavedWithdrawal {
  v: number
  withdrawnAt: string
}

interface Decision {
  kind: 'agreed' | 'withdrawn'
  at: number
}

/** Pure: what a saved value says, or null for none or one that cannot be read. */
export function consentDecisionOf(raw: string | null | undefined): Decision | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SavedConsent & SavedWithdrawal>
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.withdrawnAt === 'string') {
      const at = Date.parse(parsed.withdrawnAt)
      return Number.isFinite(at) ? { kind: 'withdrawn', at } : null
    }
    if (typeof parsed.agreedAt === 'string') {
      const at = Date.parse(parsed.agreedAt)
      return Number.isFinite(at) ? { kind: 'agreed', at } : null
    }
    return null
  } catch {
    return null
  }
}

/**
 * Pure: hold the value of localStorage and the one of the native layer
 * together. The newer decision wins; at the same moment taking back wins.
 * `device` undefined: the native layer did not answer, nothing is changed.
 */
export function reconcileConsent(local: string | null, device: string | null | undefined): { local?: string; device?: string } {
  if (device === undefined) return {}
  const mine = consentDecisionOf(local)
  const theirs = consentDecisionOf(device)
  if (!mine && !theirs) return {}
  if (mine && !theirs) return { device: local as string }
  if (!mine && theirs) return { local: device as string }
  if (local === device) return {}
  const a = mine as Decision
  const b = theirs as Decision
  const localWins = a.at > b.at || (a.at === b.at && a.kind === 'withdrawn')
  return localWins ? { device: local as string } : { local: device as string }
}

function saved(): SavedConsent | null {
  const raw = readSaved(AI_CONSENT_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SavedConsent>
    return parsed && parsed.v === CONSENT_VERSION && typeof parsed.agreedAt === 'string' ? (parsed as SavedConsent) : null
  } catch {
    return null
  }
}

/** Has the user agreed. True as well in a build whose policy does not ask. */
export function hasAiConsent(): boolean {
  if (!storePolicy().aiDisclosureConsent) return true
  return saved() !== null
}

/** When the user agreed, as an ISO time, or null. */
export function aiConsentGivenAt(): string | null {
  return saved()?.agreedAt ?? null
}

/** Take the consent back. The next cloud send asks again. */
export function revokeAiConsent(): void {
  const value = JSON.stringify({ v: CONSENT_VERSION, withdrawnAt: new Date().toISOString() } satisfies SavedWithdrawal)
  writeSaved(AI_CONSENT_KEY, value)
  void saveDecision(CONSENT_VAULT_ID, value)
}

let deviceSync: Promise<void> | null = null
let deviceSyncDone = false

/**
 * Hold localStorage and the native layer together, once per start. Puts a
 * decision back that localStorage lost, and hands the native layer one it
 * does not have yet (a consent from before round 30, a write that failed).
 * Never throws.
 */
export function syncAiConsentWithDevice(): Promise<void> {
  if (deviceSync) return deviceSync
  deviceSync = loadDecision(CONSENT_VAULT_ID)
    .then(async (device) => {
      const change = reconcileConsent(readSaved(AI_CONSENT_KEY), device)
      if (change.local !== undefined) writeSaved(AI_CONSENT_KEY, change.local)
      if (change.device !== undefined) await saveDecision(CONSENT_VAULT_ID, change.device)
    })
    .catch(() => {})
    .finally(() => {
      deviceSyncDone = true
    })
  return deviceSync
}

let pending: Promise<boolean> | null = null
let settle: ((agreed: boolean) => void) | null = null

/** Used by the sheet: the user tapped one of its two buttons. */
export function answerAiConsent(agreed: boolean): void {
  if (agreed) {
    const value = JSON.stringify({ v: CONSENT_VERSION, agreedAt: new Date().toISOString() } satisfies SavedConsent)
    writeSaved(AI_CONSENT_KEY, value)
    void saveDecision(CONSENT_VAULT_ID, value)
  }
  const done = settle
  settle = null
  pending = null
  done?.(agreed)
}

/**
 * Resolve true when content may go to LU Cloud. Shows the sheet when the
 * user has not agreed yet. Several calls while the sheet is open share its
 * one answer.
 */
export function ensureAiConsent(): Promise<boolean> {
  if (hasAiConsent()) return Promise.resolve(true)
  if (pending) return pending
  // The start is still asking the native layer: a consent it brings back must not be asked for again.
  if (deviceSync && !deviceSyncDone) return deviceSync.then(() => ensureAiConsent())
  pending = new Promise<boolean>((resolve) => {
    settle = resolve
  })
  const waiting = pending
  navApi.openSheet(AI_CONSENT_SHEET)
  const opened = useNavStore.getState().overlays.at(-1)
  const key = opened?.kind === 'sheet' && opened.sheet === AI_CONSENT_SHEET ? opened.key : null
  if (!key) {
    // The sheet did not open: nothing was agreed to.
    answerAiConsent(false)
    return waiting
  }
  // Closed by the scrim, by a pull, by back or by a page change: that is a no.
  const stop = useNavStore.subscribe((state) => {
    if (state.overlays.some((overlay) => overlay.key === key)) return
    stop()
    if (pending === waiting) answerAiConsent(false)
  })
  void waiting.then(() => stop())
  return waiting
}

/** For a settings row: is the consent given, live. */
export function useAiConsent(): boolean {
  return useSyncExternalStore(onSavedChange, hasAiConsent, hasAiConsent)
}

/** Only for tests. */
export function __resetAiConsentForTests(): void {
  settle = null
  pending = null
  deviceSync = null
  deviceSyncDone = false
}
