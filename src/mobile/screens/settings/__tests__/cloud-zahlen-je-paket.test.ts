/**
 * The model counts of the LU Cloud page (E3), per store preset.
 *
 * The counts in lib/cloud-pitch.ts are counts of the WHOLE catalogue. A build
 * that leaves models out (App Store, and Play since r56: no model marked as
 * answering without refusals, no `adult` model of Create) would name more models than its user
 * finds: Apple 2.3.1, finding A1 of mobile-docs/plaene/LU-CLOUD-SEITE.md.
 * So a build names a count only where it lists the whole catalogue, and this
 * is checked against the functions that really decide what is listed, not
 * against a second switch.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { storeFindings } from '../../../../../e2e/mobile/store-rules'
import { cloudSalesLines } from '../../../../lib/cloud-pitch'
import { cloudModelListed } from '../../../policy/unfiltered'
import { STORE_PRESETS, STORE_PRESET_IDS, setStorePresetForTests, type StorePreset } from '../../../policy/storePolicy'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { offeredCreateModels } from '../../create/parts/policy'
import { cloudCountsFor } from '../parts/cloud-counts'
import { cloudBenefitLines, listsWholeCloudCatalogue } from '../parts/store-rules'

afterEach(() => setStorePresetForTests(null))

/** Rows of the kinds a store build may leave out. */
const MARKED_CHAT = [
  { name: 'lu-cloud::maker/model-a', displayName: 'Model A', unfiltered: 'full' },
  { name: 'lu-cloud::maker/model-b', displayName: 'Model B', unrestricted: true },
  { name: 'lu-cloud::maker/model-c-abliterated', displayName: 'Model C Abliterated' },
]
const ADULT_CREATE = [
  { id: 'video-a', label: 'Video A', adult: true },
  { id: 'image-b', label: 'Image B', adult: true },
]

/** Does this preset really list every row of the catalogue, asked of the functions that list. */
function listsEverything(preset: StorePreset): boolean {
  setStorePresetForTests(preset)
  const policy = STORE_PRESETS[preset]
  const chat = MARKED_CHAT.every((m) => cloudModelListed(m, policy))
  const create = offeredCreateModels(ADULT_CREATE).length === ADULT_CREATE.length
  return chat && create
}

const hasNumber = (lines: string[]) => /\d/.test(lines.join('\n'))

describe('model counts on the LU Cloud page, per preset', () => {
  for (const preset of STORE_PRESET_IDS) {
    it(`${preset}: a count stands only where the build lists the whole catalogue`, () => {
      const lines = cloudBenefitLines(STORE_PRESETS[preset])
      expect(listsWholeCloudCatalogue(STORE_PRESETS[preset])).toBe(listsEverything(preset))
      if (hasNumber(lines)) expect(listsEverything(preset)).toBe(true)
    })
  }

  // Play since r56 (18.10.2026): the catalogue without refusals is off there too, so it names no count either.
  for (const store of ['play', 'appstore'] as const) {
    it(`${store}: no number at all, one neutral line, no word about buying`, () => {
      const lines = cloudBenefitLines(STORE_PRESETS[store])
      expect(listsEverything(store)).toBe(false)
      expect(lines).toEqual([SETTINGS_STRINGS.cloud.benefitUncounted])
      expect(hasNumber(lines)).toBe(false)
      expect(lines.join('\n')).not.toMatch(/plan|price|credit|EUR|subscri|lu-labs|buy|free/i)
      for (const line of lines) expect(storeFindings(line, store)).toEqual([])
    })
  }

  it('open: unchanged, the counts of the models without refusals', () => {
    expect(cloudBenefitLines(STORE_PRESETS.open)).toEqual(cloudSalesLines())
  })

  // Round 51: the page shows one number band (parts/cloud-counts.ts) instead of the three lines; the rule above holds for it too.
  for (const preset of STORE_PRESET_IDS) {
    it(`${preset}: the number band names a count only where the build lists the whole catalogue`, () => {
      const counts = cloudCountsFor(STORE_PRESETS[preset])
      if (counts) expect(listsEverything(preset)).toBe(true)
      else expect(listsEverything(preset)).toBe(false)
    })
  }

  it('play and appstore: the number band names no count before sign in', () => {
    expect(cloudCountsFor(STORE_PRESETS.play)).toBeNull()
    expect(cloudCountsFor(STORE_PRESETS.appstore)).toBeNull()
  })

  it('the page takes its counts from cloud-counts.ts only, never typed or read from the pitch itself', () => {
    const page = readFileSync(resolve(__dirname, '../cloud/CloudGatePage.tsx'), 'utf8')
    expect(page).not.toMatch(/CLOUD_PITCH/)
    expect(page).not.toMatch(/\d+\s+(chat|image|video|AI)\s+models/i)
    expect(page).toMatch(/cloudCountsFor\(policy\)/)
    expect(page).not.toMatch(/cloudBenefitLines/)
  })
})
