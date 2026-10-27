/**
 * The onboarding proposal for every memory class of both platforms and for
 * every store preset. Pins what ENGINE-NACHZUG.md section 8 point 3 asked
 * for: a proposal of the table is taken when it is "tight" too, a model that
 * must not be proposed never stands in, and a build without the unfiltered
 * catalogue proposes a model with `unfiltered: false`.
 */
import { describe, expect, it } from 'vitest'
import { RAM_CLASSES, type MobilePlatform } from '../../../data/device-memory'
import { MOBILE_CHAT_MODELS, MOBILE_RECOMMENDATIONS, NOT_RECOMMENDED, TIGHT_RECOMMENDATIONS, mayBeRecommended, mobileModelById } from '../../../data/mobile-models'
import type { FitDevice } from '../../../lib/device-fit'
import { STORE_PRESETS, STORE_PRESET_IDS } from '../../../policy'
import { fitOfCatalogModel, starterModels } from '../parts/fit'
import { offeredCatalog, startersFor, listsUnfiltered } from '../parts/policy'

const CLASSES = [2, 3, 4, 6, 8, 12, 16] as const
const PLATFORMS: MobilePlatform[] = ['ios', 'android']
const phone = (platform: MobilePlatform, ramGb: number): FitDevice => ({ platform, ramGb })

describe('onboarding proposal per memory class', () => {
  it('the classes of the test are the classes of the table', () => {
    expect(RAM_CLASSES.ios).toEqual([...CLASSES])
    expect(RAM_CLASSES.android).toEqual(CLASSES.filter((gb) => gb !== 2))
  })

  for (const platform of PLATFORMS) {
    for (const ramGb of CLASSES) {
      const row = MOBILE_RECOMMENDATIONS[platform][ramGb]
      const device = phone(platform, ramGb)

      if (!row) {
        it(`${platform} ${ramGb} GB: below the smallest class nothing runs and nothing is proposed`, () => {
          for (const uncensored of [false, true]) {
            const list = starterModels(device, uncensored)
            expect(list.recommended).toBeNull()
            expect(list.anyRuns).toBe(false)
          }
        })
        continue
      }

      for (const kind of ['mainstream', 'uncensored'] as const) {
        it(`${platform} ${ramGb} GB, ${kind}: proposes the line of the table`, () => {
          const list = starterModels(device, kind === 'uncensored')
          expect(list.recommended?.id).toBe(row[kind])
          const model = list.recommended!
          expect(model.uncensored).toBe(kind === 'uncensored')
          expect(model.unfiltered).toBe(kind === 'uncensored')
          expect(mayBeRecommended(model.id)).toBe(true)
          const level = fitOfCatalogModel(model, device).level
          const tight = TIGHT_RECOMMENDATIONS.has(`${platform}:${ramGb}:${kind}`)
          expect(level).toBe(tight ? 'tight' : 'fits')
          expect(list.models[0].id).toBe(model.id)
          expect(list.anyRuns).toBe(true)
        })
      }
    }
  }

  it('the smallest class gets Qwen 3.5 0.8B although it is tight, and not SmolLM2 360M', () => {
    for (const device of [phone('ios', 2), phone('android', 3)]) {
      const list = starterModels(device, false)
      expect(list.recommended?.id).toBe('qwen3.5-0.8b')
      expect(fitOfCatalogModel(list.recommended!, device).level).toBe('tight')
      // The model that would stand in by size alone is the one that must not be proposed.
      const comfortable = MOBILE_CHAT_MODELS.filter((m) => !m.uncensored && fitOfCatalogModel(m, device).level === 'fits').map((m) => m.id)
      expect(comfortable).toEqual(['smollm2-360m'])
      expect(mayBeRecommended('smollm2-360m')).toBe(false)
    }
  })
})

describe('the stand-in when the line of the table does not run here', () => {
  it('never is a model that must not be proposed', () => {
    // A catalogue without the line of the table: the stand-in has to come from what is left.
    for (const platform of PLATFORMS) {
      for (const ramGb of RAM_CLASSES[platform]) {
        const device = phone(platform, ramGb)
        const row = MOBILE_RECOMMENDATIONS[platform][ramGb]
        for (const uncensored of [false, true]) {
          const without = MOBILE_CHAT_MODELS.filter((m) => m.id !== row.mainstream && m.id !== row.uncensored)
          const list = starterModels(device, uncensored, without)
          if (list.recommended) {
            expect(mayBeRecommended(list.recommended.id), `${platform} ${ramGb} ${list.recommended.id}`).toBe(true)
            expect(fitOfCatalogModel(list.recommended, device).level).not.toBe('too-large')
          }
        }
      }
    }
  })

  it('on the smallest class there is no proposal rather than SmolLM2 360M', () => {
    const without = MOBILE_CHAT_MODELS.filter((m) => m.id !== 'qwen3.5-0.8b')
    for (const device of [phone('ios', 2), phone('android', 3)]) {
      const list = starterModels(device, false, without)
      expect(list.recommended?.id).not.toBe('smollm2-360m')
      // SmolLM2 360M still runs and can be picked by hand.
      expect(list.anyRuns).toBe(true)
      expect(list.models.some((m) => m.id === 'smollm2-360m')).toBe(true)
    }
  })

  it('takes the largest model that runs well when only the catalogue is narrowed', () => {
    const device = phone('android', 8)
    const row = MOBILE_RECOMMENDATIONS.android[8]
    const without = MOBILE_CHAT_MODELS.filter((m) => m.id !== row.mainstream)
    const list = starterModels(device, false, without)
    const well = without.filter((m) => !m.uncensored && mayBeRecommended(m.id) && fitOfCatalogModel(m, device).level === 'fits').sort((a, b) => b.sizeBytes - a.sizeBytes)
    expect(list.recommended?.id).toBe(well[0].id)
  })

  it('every model that must not be proposed is still in the catalogue', () => {
    for (const id of Object.keys(NOT_RECOMMENDED)) expect(mobileModelById(id), id).toBeDefined()
  })
})

describe('onboarding proposal per store preset', () => {
  for (const preset of STORE_PRESET_IDS) {
    const policy = STORE_PRESETS[preset]
    for (const platform of PLATFORMS) {
      for (const ramGb of RAM_CLASSES[platform]) {
        const device = phone(platform, ramGb)
        const row = MOBILE_RECOMMENDATIONS[platform][ramGb]

        it(`${preset}, ${platform} ${ramGb} GB: the first proposal is not listed as unfiltered`, () => {
          const list = startersFor(policy, device, false)
          expect(list.recommended?.id).toBe(row.mainstream)
          expect(list.recommended?.unfiltered).toBe(false)
          expect(list.models.every((m) => !m.unfiltered)).toBe(true)
        })

        it(`${preset}, ${platform} ${ramGb} GB: asked for the unfiltered kind`, () => {
          const list = startersFor(policy, device, true)
          // The unfiltered kind is proposed only where the build lists it: with the catalogue, and in a store build
          // only while it may show the words (policy/unfiltered.ts). Both store builds have the catalogue off (Play since r56).
          if (listsUnfiltered(policy)) {
            expect(list.recommended?.id).toBe(row.uncensored)
            expect(list.recommended?.unfiltered).toBe(true)
            expect(list.models.every((m) => m.unfiltered)).toBe(true)
          } else {
            // A build that does not list them answers with the same list as before, whatever was asked.
            expect(list.recommended?.id).toBe(row.mainstream)
            expect(list.recommended?.unfiltered).toBe(false)
            expect(list.models.some((m) => m.unfiltered)).toBe(false)
            expect(list.models.length).toBe(offeredCatalog(policy).length)
          }
        })
      }
    }
  }

  it('both store presets switch the unfiltered catalogue off (Play since r56, 18.10.2026)', () => {
    expect(STORE_PRESET_IDS.filter((id) => !STORE_PRESETS[id].unfilteredCatalog)).toEqual(['play', 'appstore'])
  })

  it('only the open build lists the unfiltered kind, and the Play build does so again only with the catalogue line and the words', () => {
    expect(STORE_PRESET_IDS.filter((id) => listsUnfiltered(STORE_PRESETS[id]))).toEqual(['open'])
    // The words alone do not open what the catalogue switch closes, in Play as in the App Store build.
    expect(listsUnfiltered({ ...STORE_PRESETS.play, unfilteredWords: true })).toBe(false)
    expect(listsUnfiltered({ ...STORE_PRESETS.play, unfilteredCatalog: true, unfilteredWords: true })).toBe(true)
    // The switch does not open what the catalogue switch closes.
    expect(listsUnfiltered({ ...STORE_PRESETS.appstore, unfilteredWords: true })).toBe(false)
  })
})
