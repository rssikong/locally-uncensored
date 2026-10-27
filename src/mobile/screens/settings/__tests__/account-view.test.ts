/** Plan name, credit bar and the states of the Cloud gate. */
import { describe, expect, it } from 'vitest'
import type { CloudQuota } from '../../../../lib/render/cloud-jobs'
import { creditsView, gateState, planName } from '../parts/account-view'
import { priceView } from '../parts/price'

function quota(limit: number, used: number, topup?: number): CloudQuota {
  return {
    tier: 'hosted',
    period: '2026-10',
    limits: { credits: limit },
    costs: { image: 1, video: 10 },
    used: { credits_used: used },
    remaining: { credits: Math.max(0, limit - used) },
    ...(topup !== undefined ? { topup: { credits: topup } } : {}),
  }
}

describe('planName', () => {
  it('writes a slug as a name', () => {
    expect(planName('some-new_tier')).toBe('Some New Tier')
    expect(planName(null)).toBeNull()
    expect(planName('')).toBeNull()
  })
})

describe('creditsView', () => {
  it('is null without a quota', () => {
    expect(creditsView(null)).toBeNull()
  })

  it('works out share and what is left', () => {
    const view = creditsView(quota(1000, 250))
    expect(view?.share).toBe(0.25)
    expect(view?.leftNumber).toBe(750)
    expect(view?.empty).toBe(false)
    expect(view?.topup).toBeNull()
  })

  it('is empty only when plan credits and bought credits are both gone', () => {
    expect(creditsView(quota(1000, 1000))?.empty).toBe(true)
    expect(creditsView(quota(1000, 1000, 50))?.empty).toBe(false)
    expect(creditsView(quota(1000, 1000, 50))?.topup).not.toBeNull()
  })

  it('never shows more than a full bar', () => {
    expect(creditsView(quota(100, 400))?.share).toBe(1)
    expect(creditsView(quota(0, 0))?.share).toBe(0)
  })
})

describe('gateState', () => {
  const base = { status: 'signed-in' as const, user: { id: 'u' }, offline: false, licenseActive: true, access: true, pastDue: false, quota: quota(1000, 0) }

  it('walks the states in the order the gate checks them', () => {
    expect(gateState({ ...base, status: 'probing' })).toBe('probing')
    expect(gateState({ ...base, status: 'signed-out', user: null })).toBe('signed-out')
    expect(gateState({ ...base, offline: true })).toBe('offline')
    expect(gateState({ ...base, licenseActive: false })).toBe('no-plan')
    expect(gateState({ ...base, licenseActive: false, pastDue: true })).toBe('past-due')
    expect(gateState({ ...base, access: false })).toBe('gated')
    expect(gateState({ ...base, quota: null })).toBe('no-quota')
    expect(gateState({ ...base, quota: quota(0, 0) })).toBe('no-budget')
    expect(gateState(base)).toBe('ready')
  })
})

describe('priceView', () => {
  const flash = { dailyTokens: 50000, defaultMaxOutput: 1024, requestSeconds: 60, billingKey: 'k' }

  it('says nothing costs on this phone', () => {
    expect(priceView({ model: null, paidPlan: null, creditsLeft: null })).toEqual({ kind: 'none' })
    expect(priceView({ model: { provider: 'openai' }, paidPlan: true, creditsLeft: 10 })).toEqual({ kind: 'local' })
    expect(priceView({ model: { provider: 'anthropic' }, paidPlan: true, creditsLeft: 10 })).toEqual({ kind: 'other' })
  })

  it('bills a cloud model without Flash in credits', () => {
    expect(priceView({ model: { provider: 'lu-cloud' }, paidPlan: true, creditsLeft: 12 })).toEqual({ kind: 'credits', creditsLeft: 12 })
  })

  it('promises the Flash allowance only to an account the server said yes to', () => {
    const model = { provider: 'lu-cloud', flash }
    expect(priceView({ model, paidPlan: null, creditsLeft: 5 }).kind).toBe('credits')
    expect(priceView({ model, paidPlan: false, creditsLeft: 5 }).kind).toBe('flash-unpaid')
    expect(priceView({ model, paidPlan: true, creditsLeft: 5 })).toEqual({ kind: 'flash-free', dailyTokens: 50000, left: null })
    expect(priceView({ model, paidPlan: true, notice: { billing: 'flash', remaining: 1200 }, creditsLeft: 5 })).toEqual({ kind: 'flash-free', dailyTokens: 50000, left: 1200 })
  })

  it('says so when today is used up', () => {
    const model = { provider: 'lu-cloud', flash }
    expect(priceView({ model, paidPlan: true, notice: { billing: 'credits', remaining: 0 }, creditsLeft: 5 }).kind).toBe('flash-used-up')
    expect(priceView({ model, paidPlan: true, notice: { billing: 'flash', remaining: 0 }, creditsLeft: 5 }).kind).toBe('flash-used-up')
  })
})
