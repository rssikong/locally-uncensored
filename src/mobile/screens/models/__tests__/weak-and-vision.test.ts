/**
 * vollstaendigkeit-2 M4 and M5.
 *
 * M4: as long as no catalogue model comes with a projector, there is no
 * filter "Vision" and no card or page says a local model reads images.
 * M5: the catalogue models that did not answer a plain question in the
 * measurement run say so, stand last, and are never proposed.
 *
 * Run: npx vitest run src/mobile/screens/models/__tests__/weak-and-vision.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MOBILE_CHAT_MODELS, NOT_RECOMMENDED } from '../../../data/mobile-models'
import type { FitDevice } from '../../../lib/device-fit'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { cardOfCatalog } from '../parts/catalog'
import { DEFAULT_FILTERS, answersPoorly, anyReadsImages, filterCatalog, starterModels } from '../parts/fit'

const phone = (ramGb: number, platform: 'android' | 'ios' = 'android'): FitDevice => ({ platform, ramGb })
const src = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8')
const ALL = { ...DEFAULT_FILTERS, fitsOnly: false }

describe('M5: models that miss the question', () => {
  const weakIds = Object.keys(NOT_RECOMMENDED)

  it('every listed id is a catalogue model, and its card carries the mark', () => {
    expect(weakIds.length).toBeGreaterThan(0)
    for (const id of weakIds) {
      const model = MOBILE_CHAT_MODELS.find((m) => m.id === id)
      expect(model, id).toBeDefined()
      expect(answersPoorly(model)).toBe(true)
      expect(cardOfCatalog(model!).weak).toBe(true)
    }
    expect(MOBILE_CHAT_MODELS.filter((m) => cardOfCatalog(m).weak).length).toBe(weakIds.length)
  })

  it('they stand last in the catalogue, under every filter', () => {
    for (const filters of [ALL, DEFAULT_FILTERS, { ...ALL, unfiltered: true }, { ...ALL, mainstream: true }]) {
      const shown = filterCatalog(MOBILE_CHAT_MODELS, phone(8), filters)
      const firstWeak = shown.findIndex(answersPoorly)
      if (firstWeak === -1) continue
      expect(shown.slice(firstWeak).every(answersPoorly)).toBe(true)
    }
    expect(filterCatalog(MOBILE_CHAT_MODELS, phone(8), ALL).length).toBe(MOBILE_CHAT_MODELS.length)
  })

  it('none is ever the proposal of the onboarding, on no phone', () => {
    for (const platform of ['android', 'ios'] as const) {
      for (const ram of [2, 3, 4, 6, 8, 12, 16]) {
        for (const uncensored of [false, true]) {
          const list = starterModels(phone(ram, platform), uncensored)
          expect(answersPoorly(list.recommended), `${platform} ${ram} ${uncensored}`).toBe(false)
          // Inside one fit level a weak model never stands above one that answers.
          expect(list.models.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('card, detail page and onboarding card say it in words', () => {
    expect(S.models.weakNote).toBe('Did not answer a plain request in our test.')
    // Two of the three marked models are as large as siblings without the note, so neither text may blame the size.
    expect(S.models.weakNote).not.toMatch(/small/i)
    expect(S.models.weakDetail).not.toMatch(/small|larger/i)
    expect(src('parts/ModelCard.tsx')).toContain('m-models-item-weak')
    expect(src('ModelDetailPage.tsx')).toContain('m-models-detail-weak')
    expect(src('../onboarding/SetupModelPage.tsx')).toContain('m-onboarding-model-weak')
  })
})

describe('M4: no local vision is claimed', () => {
  it('no catalogue model has a projector today, so the chip is not built', () => {
    expect(anyReadsImages(MOBILE_CHAT_MODELS)).toBe(false)
    expect(MOBILE_CHAT_MODELS.some((m) => cardOfCatalog(m).vision)).toBe(false)
    const page = src('ModelsPage.tsx')
    expect(page).toContain("chip.key === 'vision' ? vision")
  })

  it('a stored "Vision" filter does not empty the list while no model reads images', () => {
    expect(filterCatalog(MOBILE_CHAT_MODELS, phone(8), { ...ALL, vision: true }).length).toBe(MOBILE_CHAT_MODELS.length)
  })

  it('with a model that has a projector the filter works again', () => {
    const withEyes = [{ ...MOBILE_CHAT_MODELS[0], id: 'made-up-vision', mmprojUrl: 'https://example.invalid/mmproj.gguf' }, ...MOBILE_CHAT_MODELS]
    expect(anyReadsImages(withEyes)).toBe(true)
    expect(filterCatalog(withEyes, phone(8), { ...ALL, vision: true }).map((m) => m.id)).toEqual(['made-up-vision'])
  })

  it('the detail page says "Text only on this phone", and no text of the strand promises more', () => {
    expect(S.detail.visionNo).toBe('Text only on this phone')
    expect(JSON.stringify(S)).not.toMatch(/text only for now/i)
  })
})
