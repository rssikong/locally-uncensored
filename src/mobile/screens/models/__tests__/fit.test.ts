import { describe, expect, it } from 'vitest'
import { MOBILE_CHAT_MODELS } from '../../../data/mobile-models'
import type { FitDevice } from '../../../lib/device-fit'
import { DEFAULT_FILTERS, contextChoices, deviceLine, filterCatalog, fitOfCatalogModel, fitView, starterModels } from '../parts/fit'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { screenFit } from '../parts/bits'

const phone = (ramGb: number): FitDevice => ({ platform: 'android', ramGb })
const GIB = 1_073_741_824
const smallest = [...MOBILE_CHAT_MODELS].sort((a, b) => a.sizeBytes - b.sizeBytes)[0]
const largest = [...MOBILE_CHAT_MODELS].sort((a, b) => b.sizeBytes - a.sizeBytes)[0]

describe('fit verdict in the words of the screens', () => {
  it('says "unknown" with a reason when the phone is unknown, and never locks then', () => {
    const view = fitOfCatalogModel(largest, null)
    expect(view.level).toBe('unknown')
    expect(view.long).toBe(S.fit.unknownDeviceLong)
  })

  it('says "unknown" when the file has no size', () => {
    expect(fitView({}, phone(8)).level).toBe('unknown')
  })

  it('the smallest model runs on a 4 GB phone, the largest does not', () => {
    expect(fitOfCatalogModel(smallest, phone(4)).level).toBe('fits')
    const view = fitOfCatalogModel(largest, phone(4))
    expect(view.level).toBe('too-large')
    expect(view.short).toContain('Needs about')
    expect(view.long).toContain('LU will not download it')
    expect(view.needBytes).toBeGreaterThan(view.usableBytes)
  })

  it('a larger phone locks fewer models', () => {
    const locked = (ram: number) => MOBILE_CHAT_MODELS.filter((m) => fitOfCatalogModel(m, phone(ram)).level === 'too-large').length
    expect(locked(12)).toBeLessThan(locked(8))
    expect(locked(8)).toBeLessThan(locked(4))
  })

  it('a search hit of 18 GB is too large for an 8 GB phone', () => {
    expect(fitView({ fileBytes: 18 * GIB }, phone(8)).level).toBe('too-large')
  })

  it('names memory and free storage in the device line', () => {
    expect(deviceLine(phone(8), 40 * GIB, true)).toBe('This phone: 8 GB memory, 40.0 GB storage free.')
    expect(deviceLine(phone(8), null, true)).toBe('This phone: 8 GB memory.')
    expect(deviceLine(null, 40 * GIB)).toBe(S.device.unknown)
  })
})

describe('catalogue filters', () => {
  it('"Fits this phone" is on by default and hides what is too large', () => {
    const shown = filterCatalog(MOBILE_CHAT_MODELS, phone(4), DEFAULT_FILTERS)
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.every((m) => fitOfCatalogModel(m, phone(4)).level !== 'too-large')).toBe(true)
    expect(filterCatalog(MOBILE_CHAT_MODELS, phone(4), { ...DEFAULT_FILTERS, fitsOnly: false }).length).toBe(MOBILE_CHAT_MODELS.length)
  })

  it('the kind chips narrow to their kind, both or none mean both', () => {
    const off = { fitsOnly: false, mainstream: false, unfiltered: false, vision: false }
    expect(filterCatalog(MOBILE_CHAT_MODELS, phone(8), { ...off, unfiltered: true }).every((m) => m.uncensored)).toBe(true)
    expect(filterCatalog(MOBILE_CHAT_MODELS, phone(8), { ...off, mainstream: true }).every((m) => !m.uncensored)).toBe(true)
    expect(filterCatalog(MOBILE_CHAT_MODELS, phone(8), { ...off, mainstream: true, unfiltered: true }).length).toBe(MOBILE_CHAT_MODELS.length)
  })

  it('an unknown phone shows everything', () => {
    expect(filterCatalog(MOBILE_CHAT_MODELS, null, DEFAULT_FILTERS).length).toBe(MOBILE_CHAT_MODELS.length)
  })
})

describe('starter models of the onboarding', () => {
  for (const ram of [3, 4, 6, 8, 12, 16]) {
    for (const uncensored of [false, true]) {
      it(`${ram} GB, ${uncensored ? 'unfiltered' : 'mainstream'}: the proposal runs and stands first`, () => {
        const list = starterModels(phone(ram), uncensored)
        expect(list.anyRuns).toBe(true)
        expect(list.recommended).not.toBeNull()
        // The smallest class has no mainstream model that answers correctly and fits comfortably: its proposal is tight
        // (data/mobile-models.ts TIGHT_RECOMMENDATIONS). Every class and both platforms: starter-classes.test.ts.
        expect(fitOfCatalogModel(list.recommended!, phone(ram)).level).toBe(ram === 3 && !uncensored ? 'tight' : 'fits')
        expect(list.models[0].id).toBe(list.recommended!.id)
        expect(list.models.every((m) => m.uncensored === uncensored)).toBe(true)
      })
    }
  }

  it('a small and a large phone get another proposal', () => {
    expect(starterModels(phone(4), false).recommended!.id).not.toBe(starterModels(phone(12), false).recommended!.id)
    expect(starterModels(phone(12), false).recommended!.sizeBytes).toBeGreaterThan(starterModels(phone(4), false).recommended!.sizeBytes)
  })

  it('too large models come last', () => {
    const list = starterModels(phone(4), false)
    const levels = list.models.map((m) => fitOfCatalogModel(m, phone(4)).level)
    const firstLocked = levels.indexOf('too-large')
    expect(firstLocked).toBeGreaterThan(0)
    expect(levels.slice(firstLocked).every((l) => l === 'too-large')).toBe(true)
  })

  it('without a model that runs it says so instead of proposing one', () => {
    const list = starterModels(phone(1), false)
    expect(list.anyRuns).toBe(false)
    expect(list.recommended).toBeNull()
  })

  it('takes a narrowed catalogue (store policy)', () => {
    const mainstreamOnly = MOBILE_CHAT_MODELS.filter((m) => !m.uncensored)
    expect(starterModels(phone(8), true, mainstreamOnly).models).toEqual([])
    expect(starterModels(phone(8), false, mainstreamOnly).recommended).not.toBeNull()
  })
})

describe('context sizes of the engine page', () => {
  it('offers only what the phone carries', () => {
    expect(contextChoices(4096)).toEqual([1024, 2048, 4096])
    expect(contextChoices(2048)).toEqual([1024, 2048])
    expect(contextChoices(512)).toEqual([])
  })
})

describe('how the screen fits its text', () => {
  it('a phone held upright with normal text is neither short nor narrow', () => {
    expect(screenFit(390, 844, 16)).toEqual({ short: false, narrow: false })
    expect(screenFit(320, 568, 16)).toEqual({ short: false, narrow: false })
    expect(screenFit(430, 932, 24)).toEqual({ short: false, narrow: false })
  })

  it('the smallest phone at 200 percent is both', () => {
    expect(screenFit(320, 568, 32)).toEqual({ short: true, narrow: true })
  })

  it('a phone on its side is short and wide', () => {
    expect(screenFit(844, 390, 16)).toEqual({ short: true, narrow: false })
  })

  it('a current phone at 200 percent is narrow and still high enough', () => {
    expect(screenFit(390, 844, 32)).toEqual({ short: false, narrow: true })
  })

  it('does not divide by zero', () => {
    expect(screenFit(390, 844, 0)).toEqual({ short: false, narrow: false })
  })
})
