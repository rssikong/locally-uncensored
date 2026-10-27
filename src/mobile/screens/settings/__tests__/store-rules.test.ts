/** The store switches, preset by preset: buying, content levels, consent, account deletion. */
import { afterEach, describe, expect, it } from 'vitest'
import { STORE_PRESETS, setStorePresetForTests, storePolicy } from '../../../policy'
import { parseStorePreset } from '../../../policy/storePolicy'
import { buyHint, creditsCopyFor, levelName, offeredLevels, showsBuyLinks, showsBuyText } from '../parts/store-rules'
import { priceCopy, priceInvitesBuying, type PriceView } from '../parts/price'
import { SETTINGS_STRINGS } from '../../../strings/settings'

afterEach(() => setStorePresetForTests(null))

describe('presets', () => {
  it('is open unless the build says otherwise', () => {
    expect(storePolicy().preset).toBe('open')
    expect(parseStorePreset('play')).toBe('play')
    expect(parseStorePreset('PLAY')).toBeNull()
    expect(parseStorePreset(undefined)).toBeNull()
  })

  it('demands account deletion, contact and the consent in every preset', () => {
    for (const preset of Object.values(STORE_PRESETS)) {
      expect(preset.accountDeletion, preset.preset).toBe(true)
      expect(preset.contactInfo, preset.preset).toBe(true)
      expect(preset.aiDisclosureConsent, preset.preset).toBe(true)
    }
  })

  it('can be set for a test and goes back', () => {
    setStorePresetForTests('appstore')
    expect(storePolicy().purchase).toBe('none')
    setStorePresetForTests(null)
    expect(storePolicy().purchase).toBe('links')
  })
})

describe('buying, per value', () => {
  it('links: buttons and sentences', () => {
    expect(showsBuyLinks('links')).toBe(true)
    expect(showsBuyText('links')).toBe(true)
    expect(buyHint('links')).toBeNull()
  })

  it('text-only: the one sentence, no button, and no other word about buying', () => {
    expect(showsBuyLinks('text-only')).toBe(false)
    expect(showsBuyText('text-only')).toBe(false)
    expect(buyHint('text-only')).toBe('Plans and credits are available on lu-labs.ai.')
  })

  it('none: no word about buying', () => {
    expect(showsBuyLinks('none')).toBe(false)
    expect(showsBuyText('none')).toBe(false)
    expect(buyHint('none')).toBeNull()
  })

  it('maps the three presets', () => {
    expect(STORE_PRESETS.open.purchase).toBe('links')
    expect(STORE_PRESETS.play.purchase).toBe('text-only')
    expect(STORE_PRESETS.appstore.purchase).toBe('none')
  })
})

describe('credits empty, per value', () => {
  it('keeps the texts of the design where the build links to the plans', () => {
    expect(creditsCopyFor('credits', 'links').text).toContain('Bought credits never expire')
    expect(creditsCopyFor('trainings', 'links').title).toBe('Top up to keep training')
  })

  it('names no buying at all in the two other modes: text-only adds its one sentence elsewhere (buyHint)', () => {
    for (const purchase of ['text-only', 'none'] as const) {
      for (const reason of ['credits', 'video_budget', 'trainings', undefined]) {
        const copy = creditsCopyFor(reason, purchase)
        expect(`${copy.title} ${copy.text}`, `${purchase} ${String(reason)}`).not.toMatch(/bought|buy|top up|pack|plan|pric|renew/i)
      }
    }
  })
})

describe('content levels, per value', () => {
  it('all: three levels', () => {
    expect(offeredLevels('all')).toEqual(['strict', 'soft', 'off'])
  })

  it('no-off: "Off" is not offered', () => {
    expect(offeredLevels('no-off')).toEqual(['strict', 'soft'])
  })

  it('fixed-filter: nothing to choose', () => {
    expect(offeredLevels('fixed-filter')).toEqual([])
  })

  it('names the level the server holds', () => {
    expect([levelName('strict'), levelName('soft'), levelName('off')]).toEqual(['Strict', 'Standard', 'Off'])
  })
})

// Every surface that touches buying, in each of the three modes of storePolicy().purchase.
describe.each(['links', 'text-only', 'none'] as const)('buying surfaces with purchase = %s', (purchase) => {
  const count = (n: number) => String(n)
  const BUY_WORDS = /\bplan\b|\bplans\b|bought|\bpack|pricing|renew|subscri|top up|lu-labs\.ai/i

  const views: PriceView[] = [
    { kind: 'none' },
    { kind: 'local' },
    { kind: 'other' },
    { kind: 'credits', creditsLeft: 120 },
    { kind: 'credits', creditsLeft: 0 },
    { kind: 'flash-unpaid', creditsLeft: 40 },
    { kind: 'flash-used-up', creditsLeft: 40 },
    { kind: 'flash-free', dailyTokens: 50000, left: 1200 },
  ]

  it('price sheet: a button only with links, one sentence only with text-only, nothing with none', () => {
    for (const view of views) {
      const copy = priceCopy(view, purchase, count)
      const invites = priceInvitesBuying(view)
      expect(copy.lines.length, view.kind).toBeGreaterThan(0)
      expect(copy.buyLink, view.kind).toBe(purchase === 'links' && invites)
      expect(copy.hint, view.kind).toBe(purchase === 'text-only' && invites ? SETTINGS_STRINGS.store.plansOnWebsite : null)
    }
  })

  it('price sheet: without purchase no sentence names a plan or buying', () => {
    for (const view of views) {
      const copy = priceCopy(view, purchase, count)
      // The sentences themselves are free of it in both modes; 'text-only' carries its one sentence in `hint`.
      if (purchase !== 'links') expect(copy.lines.join(' '), view.kind).not.toMatch(BUY_WORDS)
      if (purchase === 'none') expect(copy.hint, view.kind).toBeNull()
    }
  })

  it('price sheet: the facts stay the same in every mode', () => {
    expect(priceCopy({ kind: 'local' }, purchase, count).lines).toEqual([SETTINGS_STRINGS.price.local])
    expect(priceCopy({ kind: 'credits', creditsLeft: 120 }, purchase, count).lines).toEqual([SETTINGS_STRINGS.price.credits, '120 credits left this period.'])
    expect(priceCopy({ kind: 'credits', creditsLeft: 0 }, purchase, count).lines).toContain(SETTINGS_STRINGS.price.creditsNone)
    expect(priceCopy({ kind: 'flash-free', dailyTokens: 50000, left: 1200 }, purchase, count).lines.join(' ')).toContain('1200 of 50000 free tokens left today.')
  })

  it('credits sheet: title and text per cap, and without purchase no word about buying', () => {
    for (const reason of ['credits', 'video_budget', 'trainings'] as const) {
      const copy = creditsCopyFor(reason, purchase)
      expect(copy.reason).toBe(reason)
      if (purchase !== 'links') expect(`${copy.title} ${copy.text}`, reason).not.toMatch(BUY_WORDS)
    }
    expect(showsBuyLinks(purchase)).toBe(purchase === 'links')
    expect(buyHint(purchase)).toBe(purchase === 'text-only' ? SETTINGS_STRINGS.store.plansOnWebsite : null)
  })

  it('session sheet: says nothing about buying in any mode, so no mode has to change it', () => {
    const S = SETTINGS_STRINGS.session
    expect([S.title, S.text, S.kept, S.signIn, S.onDevice, S.nowOnDevice].join(' ')).not.toMatch(BUY_WORDS)
  })

  it('cloud page: the sentences used without purchase name no plan', () => {
    const C = SETTINGS_STRINGS.cloud
    if (purchase !== 'links') expect([C.noPlanPlain, C.footerPlain, SETTINGS_STRINGS.account.pausedPlain].join(' ')).not.toMatch(BUY_WORDS)
    expect(showsBuyText(purchase)).toBe(purchase === 'links')
  })
})

describe('the presets map onto the three modes', () => {
  it('open links, play says it in a sentence, appstore says nothing', () => {
    expect(STORE_PRESETS.open.purchase).toBe('links')
    expect(STORE_PRESETS.play.purchase).toBe('text-only')
    expect(STORE_PRESETS.appstore.purchase).toBe('none')
  })

  it('content levels: all, without Off, fixed', () => {
    expect(offeredLevels(STORE_PRESETS.open.contentLevels)).toEqual(['strict', 'soft', 'off'])
    expect(offeredLevels(STORE_PRESETS.play.contentLevels)).toEqual(['strict', 'soft'])
    expect(offeredLevels(STORE_PRESETS.appstore.contentLevels)).toEqual([])
  })
})
