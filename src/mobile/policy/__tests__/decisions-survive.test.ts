// @vitest-environment jsdom
/**
 * Round 30, B3: after hard ends at a full phone the consent to LU Cloud and
 * the note of the notification question were gone from localStorage, and the
 * copy in IndexedDB (boot/settings-durable.ts) was gone too. The age answer,
 * which also sits in the native layer, was still there.
 *
 * Now both decisions have that second home as well (decision-vault.ts). The
 * rules: a decision localStorage lost comes back from the native layer; the
 * newer decision wins on both sides, so a consent that was taken back never
 * returns; without an answer of the native layer nothing is assumed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ui', () => ({ toast: () => {} }))
vi.mock('../../nav', () => ({ nav: { confirm: async () => false, push: () => {} } }))

import { NOTIFY_OFFERED_KEY, __resetNotifySyncForTests, syncNotifyOfferedWithDevice } from '../../screens/models/parts/notify'
import { AI_CONSENT_KEY, CONSENT_VERSION, __resetAiConsentForTests, answerAiConsent, ensureAiConsent, hasAiConsent, reconcileConsent, revokeAiConsent, syncAiConsentWithDevice } from '../consent'
import { CONSENT_VAULT_ID, NOTIFY_OFFERED_VAULT_ID, setDecisionVaultForTests, type DecisionVault } from '../decision-vault'
import { setStorePresetForTests } from '../storePolicy'
import { useNavStore } from '../../nav/store'

/** The native layer: a map that outlives localStorage. */
function fakeVault(start: Record<string, string> = {}, opts: { failLoad?: boolean } = {}) {
  const stored = new Map(Object.entries(start))
  const vault: DecisionVault = {
    available: () => true,
    load: vi.fn(async (id: string) => {
      if (opts.failLoad) throw new Error('no answer')
      return stored.get(id) ?? null
    }),
    save: vi.fn(async (id: string, value: string) => {
      stored.set(id, value)
    }),
  }
  return { vault, stored }
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

/** A new start of the app: what ran in memory is gone, localStorage and the native layer stay. */
function restart() {
  __resetAiConsentForTests()
  __resetNotifySyncForTests()
}

beforeEach(() => {
  localStorage.clear()
  setStorePresetForTests('play')
  restart()
  useNavStore.setState({ overlays: [] } as never)
})

afterEach(() => {
  setDecisionVaultForTests(null)
  setStorePresetForTests(null)
})

describe('B3: consent and the note of the notification question survive a lost localStorage', () => {
  it('the consent comes back after localStorage lost it', async () => {
    const native = fakeVault()
    setDecisionVaultForTests(native.vault)
    answerAiConsent(true)
    await settle()
    expect(JSON.parse(native.stored.get(CONSENT_VAULT_ID) ?? '{}')).toMatchObject({ v: CONSENT_VERSION })

    // The hard end at a full phone: localStorage and the copy in IndexedDB are gone.
    localStorage.clear()
    restart()
    expect(hasAiConsent()).toBe(false)
    await syncAiConsentWithDevice()
    expect(hasAiConsent()).toBe(true)
  })

  it('a send right after the start waits for the native layer instead of asking again', async () => {
    const native = fakeVault()
    setDecisionVaultForTests(native.vault)
    answerAiConsent(true)
    await settle()
    localStorage.clear()
    restart()
    void syncAiConsentWithDevice()
    expect(await ensureAiConsent()).toBe(true)
    expect(useNavStore.getState().overlays).toHaveLength(0)
  })

  it('the note of the notification question comes back after localStorage lost it', async () => {
    const native = fakeVault({ [NOTIFY_OFFERED_VAULT_ID]: '1' })
    setDecisionVaultForTests(native.vault)
    expect(localStorage.getItem(NOTIFY_OFFERED_KEY)).toBeNull()
    await syncNotifyOfferedWithDevice()
    expect(localStorage.getItem(NOTIFY_OFFERED_KEY)).toBe('1')
  })

  it('a decision from before this round is handed to the native layer at the next start', async () => {
    const native = fakeVault()
    setDecisionVaultForTests(native.vault)
    localStorage.setItem(AI_CONSENT_KEY, JSON.stringify({ v: CONSENT_VERSION, agreedAt: '2026-10-14T14:34:59.000Z' }))
    localStorage.setItem(NOTIFY_OFFERED_KEY, '1')
    await syncAiConsentWithDevice()
    await syncNotifyOfferedWithDevice()
    expect(native.stored.get(CONSENT_VAULT_ID)).toBe(localStorage.getItem(AI_CONSENT_KEY))
    expect(native.stored.get(NOTIFY_OFFERED_VAULT_ID)).toBe('1')
  })
})

describe('B3: a consent never counts without the user agreeing', () => {
  it('taking it back is kept on both sides and is not undone by a lost localStorage', async () => {
    const native = fakeVault()
    setDecisionVaultForTests(native.vault)
    answerAiConsent(true)
    await settle()
    revokeAiConsent()
    await settle()
    expect(hasAiConsent()).toBe(false)
    localStorage.clear()
    restart()
    await syncAiConsentWithDevice()
    expect(hasAiConsent()).toBe(false)
  })

  it('the newer decision wins; at the same moment taking back wins', () => {
    const agreed = (at: string) => JSON.stringify({ v: CONSENT_VERSION, agreedAt: at })
    const withdrawn = (at: string) => JSON.stringify({ v: CONSENT_VERSION, withdrawnAt: at })
    // localStorage went back to an older "agreed", the native layer knows it was taken back.
    expect(reconcileConsent(agreed('2026-10-14T10:00:00Z'), withdrawn('2026-10-14T11:00:00Z'))).toEqual({ local: withdrawn('2026-10-14T11:00:00Z') })
    // The native write of the withdrawal failed: localStorage carries it there.
    expect(reconcileConsent(withdrawn('2026-10-14T11:00:00Z'), agreed('2026-10-14T10:00:00Z'))).toEqual({ device: withdrawn('2026-10-14T11:00:00Z') })
    expect(reconcileConsent(agreed('2026-10-14T10:00:00Z'), withdrawn('2026-10-14T10:00:00Z'))).toEqual({ local: withdrawn('2026-10-14T10:00:00Z') })
  })

  it('without an answer of the native layer nothing is changed and the sheet asks', async () => {
    setDecisionVaultForTests(fakeVault({}, { failLoad: true }).vault)
    await syncAiConsentWithDevice()
    expect(hasAiConsent()).toBe(false)
    expect(reconcileConsent(null, undefined)).toEqual({})
  })

  it('nothing saved anywhere: nothing is assumed', async () => {
    setDecisionVaultForTests(fakeVault().vault)
    await syncAiConsentWithDevice()
    expect(hasAiConsent()).toBe(false)
    expect(localStorage.getItem(AI_CONSENT_KEY)).toBeNull()
  })

  it('a kept yes to an older text comes back as what it is and does not count', async () => {
    setDecisionVaultForTests(fakeVault({ [CONSENT_VAULT_ID]: JSON.stringify({ v: CONSENT_VERSION - 1, agreedAt: '2026-10-01T00:00:00Z' }) }).vault)
    await syncAiConsentWithDevice()
    expect(hasAiConsent()).toBe(false)
  })

  it('a value of the native layer that cannot be read is ignored', async () => {
    setDecisionVaultForTests(fakeVault({ [CONSENT_VAULT_ID]: 'not json' }).vault)
    await syncAiConsentWithDevice()
    expect(localStorage.getItem(AI_CONSENT_KEY)).toBeNull()
    expect(hasAiConsent()).toBe(false)
  })
})
