import { beforeEach, describe, expect, it } from 'vitest'

import { REPORT_EXCERPT_MAX, canReport, purchaseHint, reportForAnswer, type PurchaseTexts } from '../parts/logic/policy'
import * as seam from '../parts/policy'
import * as scaffold from '../../../policy'
import { setStorePresetForTests } from '../../../policy'

beforeEach(() => {
  setStorePresetForTests(null)
})

const TEXTS: PurchaseTexts = { title: 'Out of credits', text: 'Until there are credits again.', action: 'See plans', textOnly: 'Plans are managed on lu-labs.ai.', neutralTitle: 'Cloud cannot answer', neutralText: 'Not available right now.' }

describe('the one import point', () => {
  it('hands on exactly the three functions of the contract', () => {
    expect(Object.keys(seam).sort()).toEqual(['ensureAiConsent', 'openReport', 'storePolicy'])
  })
  it('they are the functions of the scaffold, not a copy', () => {
    expect(seam.storePolicy).toBe(scaffold.storePolicy)
    expect(seam.openReport).toBe(scaffold.openReport)
    expect(seam.ensureAiConsent).toBe(scaffold.ensureAiConsent)
  })
})

describe('storePolicy', () => {
  it('is the open preset unless a build says otherwise', () => {
    expect(seam.storePolicy()).toMatchObject({ preset: 'open', reportContent: true, aiDisclosureConsent: true, purchase: 'links' })
  })
  it('asks for reports and consent in every preset and tightens buying', () => {
    setStorePresetForTests('play')
    expect(seam.storePolicy()).toMatchObject({ reportContent: true, aiDisclosureConsent: true, purchase: 'text-only' })
    setStorePresetForTests('appstore')
    expect(seam.storePolicy()).toMatchObject({ reportContent: true, aiDisclosureConsent: true, purchase: 'none' })
  })
})

describe('purchaseHint', () => {
  it('links: title, text and the button, as before', () => {
    expect(purchaseHint('links', TEXTS)).toEqual({ title: 'Out of credits', text: 'Until there are credits again.', action: 'See plans' })
  })
  it('text-only: the neutral statement, then the one allowed sentence, and no button', () => {
    expect(purchaseHint('text-only', TEXTS)).toEqual({ title: 'Cloud cannot answer', text: 'Not available right now. Plans are managed on lu-labs.ai.', action: null })
  })
  it('none: the neutral statement, no button, no word about buying', () => {
    const hint = purchaseHint('none', TEXTS)
    expect(hint).toEqual({ title: 'Cloud cannot answer', text: 'Not available right now.', action: null })
    expect(`${hint.title} ${hint.text}`).not.toMatch(/credit|plan|buy/i)
  })
})

describe('reports', () => {
  it('only an answer can be reported, and only when the policy asks for it', () => {
    expect(canReport('assistant', true)).toBe(true)
    expect(canReport('user', true)).toBe(false)
    expect(canReport('system', true)).toBe(false)
    expect(canReport('assistant', false)).toBe(false)
  })
  it('carry id, model, source and a cut excerpt', () => {
    expect(reportForAnswer({ id: 'm1', modelId: 'lu-cloud::x' }, '  Hello  ', true)).toEqual({ kind: 'message', id: 'm1', model: 'lu-cloud::x', source: 'cloud', excerpt: 'Hello' })
    const long = reportForAnswer({ id: 'm2', modelId: undefined }, 'a'.repeat(900), false, 'openai::qwen')
    expect(long).toMatchObject({ model: 'openai::qwen', source: 'local' })
    expect(long.excerpt).toHaveLength(REPORT_EXCERPT_MAX)
    expect(reportForAnswer({ id: 'm3', modelId: 'x' }, '   ', false)).not.toHaveProperty('excerpt')
  })
})
