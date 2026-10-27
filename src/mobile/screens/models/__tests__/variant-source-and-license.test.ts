/**
 * Round 10, point 7: the detail page of another quantization of a catalogue
 * model showed no source and no license.
 *
 * The page looked both up by the exact file name only. A file like
 * "Qwen3.5-2B-UD-IQ2_M" is not the listed file, so the source row fell back
 * to the file name, the license row was gone and so was the link to the
 * model hub. Repository and license belong to the model: the catalogue has
 * them for the model this file is a build of.
 *
 * Run: npx vitest run src/mobile/screens/models/__tests__/variant-source-and-license.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MOBILE_CHAT_MODELS } from '../../../data/mobile-models'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { catalogKinOf, catalogModelOf } from '../parts/installed'
import { modelBehindFile, type StorePolicy } from '../parts/policy'

const OPEN: StorePolicy = { unfilteredCatalog: true, unfilteredMarketing: true, unfilteredWords: true, customModelUrl: true, hubSearch: true, ageGate: 'none' }
const NARROW: StorePolicy = { ...OPEN, unfilteredCatalog: false, unfilteredMarketing: false, unfilteredWords: false, customModelUrl: false, hubSearch: false }
const QWEN = MOBILE_CHAT_MODELS.find((m) => m.id === 'qwen3.5-2b')!
const UNFILTERED = MOBILE_CHAT_MODELS.find((m) => m.uncensored)!

/** What the page computes for a file on the phone. */
function behind(name: string, policy: StorePolicy) {
  const file = { name }
  return modelBehindFile(policy, catalogModelOf(file), catalogKinOf(file)?.model)
}

describe('the model behind a file that is another build of a catalogue model', () => {
  it('another quantization carries the repository and the license of its model', () => {
    const model = behind('Qwen3.5-2B-UD-IQ2_M', OPEN)
    expect(model?.id).toBe(QWEN.id)
    expect(model?.repo).toBe(QWEN.repo)
    expect(model?.license).toBe(QWEN.license)
    expect(model?.repo).toMatch(/^[\w.-]+\/[\w.-]+$/)
  })

  it('the listed file needs no second lookup: the page has its entry', () => {
    expect(behind(QWEN.filename.replace(/\.gguf$/i, ''), OPEN)).toBeUndefined()
  })

  it('a file the catalogue does not know stays without source and license', () => {
    expect(behind('Some-Unknown-Thing-Q5_K_M', OPEN)).toBeUndefined()
  })

  it('a model the store policy does not offer is not linked through one of its builds', () => {
    const other = UNFILTERED.filename.replace(/\.gguf$/i, '').replace(UNFILTERED.quant, 'Q8_0')
    expect(catalogKinOf({ name: other })?.model.id).toBe(UNFILTERED.id)
    expect(behind(other, OPEN)?.id).toBe(UNFILTERED.id)
    expect(behind(other, NARROW)).toBeUndefined()
  })
})

describe('the page', () => {
  const page = readFileSync(resolve(__dirname, '../ModelDetailPage.tsx'), 'utf8')
  const line = (testid: string) => page.split('\n').find((l) => l.includes(`testid="${testid}"`)) ?? ''

  it('the source row, the license row and the link read the model behind the file too', () => {
    expect(line('m-models-detail-source')).toContain('value={hub ??')
    expect(line('m-models-detail-source')).toContain('S.detail.sourceOfModel')
    expect(line('m-models-detail-license')).toContain('licensed.license')
    expect(line('m-models-detail-hf')).toContain('hubPage(hub)')
  })

  it('the link out of the app carries the mark that keeps a sweep off it', () => {
    expect(line('m-models-detail-hf')).toContain('risk="leaves-app"')
  })

  it('the other files of a repository are still only asked for where the page did before', () => {
    expect(page).toContain("useVariants(!policy.customModelUrl || closedRepo || (ref.kind === 'file' && !known) ? null : repo)")
  })

  it('the sentence under the source says what the repository is, in English and without dashes', () => {
    expect(S.detail.sourceOfModel).toBe('The repository of this model. This file is another build of it.')
    expect(S.detail.sourceOfModel).not.toMatch(/[–—]/)
  })
})
