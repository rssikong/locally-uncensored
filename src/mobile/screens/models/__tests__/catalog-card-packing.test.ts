/**
 * The card of a catalogue model says which packing of it is on the phone or
 * on its way (acceptance on the large iPhone, G3 and G11).
 *
 * Qwen 3.5 2B was on the phone as IQ2_XXS. Its catalogue card still offered
 * "Download 1.2 GB" and said nothing of the file, and while the packing was
 * loading the card showed nothing of that either.
 *
 * Run: npx vitest run src/mobile/screens/models/__tests__/catalog-card-packing.test.ts
 */
import { describe, expect, it } from 'vitest'
import type { BundledModel } from '../../../../api/engine'
import { MOBILE_CHAT_MODELS, modelFileStem } from '../../../data/mobile-models'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { catalogCardState, installedCardTransfers, modelsInFlight, packingInFlight } from '../parts/catalog'
import { chatModelId } from '../parts/installed'

const QWEN = MOBILE_CHAT_MODELS.find((m) => modelFileStem(m.filename) === 'qwen3.5-2b')!
const OTHER = MOBILE_CHAT_MODELS.find((m) => m.id !== QWEN.id)!
const MIB = 1_048_576
const file = (name: string, mb: number): BundledModel => ({ name, path: `/models/${name}.gguf`, size: Math.round(mb * MIB), ctx_train: null }) as BundledModel
const XXS = file('Qwen3.5-2B-UD-IQ2_XXS', 732.7)
const M = file('Qwen3.5-2B-UD-IQ2_M', 820)
const LISTED = file(QWEN.filename.replace(/\.gguf$/, ''), QWEN.sizeBytes / MIB)

describe('G11: what the card of a catalogue model stands for', () => {
  it('nothing on the phone and nothing on its way: the card offers its download as before', () => {
    expect(catalogCardState(QWEN, [], '')).toEqual({ transfer: undefined })
    expect(catalogCardState(QWEN, [file(OTHER.filename.replace(/\.gguf$/, ''), 300)], '')).toEqual({ transfer: undefined })
  })

  it('the listed file is on the phone: it is the card, whatever else is there', () => {
    expect(catalogCardState(QWEN, [XXS, LISTED], 'Qwen3.5-2B-UD-IQ2_M.gguf').file).toBe(LISTED)
    expect(catalogCardState(QWEN, [XXS, LISTED], 'Qwen3.5-2B-UD-IQ2_M.gguf').packing).toBeUndefined()
    // Alone on the phone and nothing on its way: exactly as before, the plain "Installed".
    expect(catalogCardState(QWEN, [LISTED], '')).toEqual({ file: LISTED })
  })

  it('the case of the report: only the smallest packing is there, and the card names it', () => {
    const state = catalogCardState(QWEN, [XXS], '')
    expect(state.file).toBe(XXS)
    expect(state.packing).toEqual({ quant: 'IQ2_XXS', name: 'Qwen 3.5 2B IQ2_XXS', sizeText: '732.7 MB', more: 0 })
    expect(S.models.installedPacking('IQ2_XXS', '732.7 MB', 0)).toBe('Installed: IQ2_XXS, 732.7 MB')
  })

  it('several packings: the loaded one stands for the model, then the chat model, then the largest', () => {
    expect(catalogCardState(QWEN, [XXS, M], '').file).toBe(M)
    expect(catalogCardState(QWEN, [XXS, M], '').packing?.more).toBe(1)
    expect(catalogCardState(QWEN, [XXS, M], '', { activeChatModel: chatModelId(XXS.name) }).file).toBe(XXS)
    expect(catalogCardState(QWEN, [XXS, M], '', { activeChatModel: chatModelId(XXS.name), loadedPath: M.path }).file).toBe(M)
    expect(S.models.installedPacking('IQ2_M', '820.0 MB', 1)).toBe('Installed: IQ2_M, 820.0 MB and 1 more')
  })

  it('a packing of ANOTHER model never stands for this one', () => {
    expect(catalogCardState(OTHER, [XXS, M], '')).toEqual({ transfer: undefined })
  })

  it('a packing on its way is found by its file name, for this model only', () => {
    const rows = { 'Qwen3.5-2B-UD-IQ2_XXS.gguf': { status: 'downloading' } }
    expect(packingInFlight(QWEN, rows)).toBe('Qwen3.5-2B-UD-IQ2_XXS.gguf')
    expect(packingInFlight(OTHER, rows)).toBe('')
    expect(catalogCardState(QWEN, [], 'Qwen3.5-2B-UD-IQ2_XXS.gguf').transfer).toEqual({ id: 'Qwen3.5-2B-UD-IQ2_XXS.gguf', name: 'Qwen 3.5 2B IQ2_XXS', quant: 'IQ2_XXS' })
    expect(S.models.packingOnItsWay('IQ2_XXS')).toBe('Downloading IQ2_XXS')
  })

  it('paused and failed count as on its way, finished does not, and the listed file is the card\'s own download', () => {
    expect(packingInFlight(QWEN, { 'Qwen3.5-2B-UD-IQ2_XXS.gguf': { status: 'paused' } })).not.toBe('')
    expect(packingInFlight(QWEN, { 'Qwen3.5-2B-UD-IQ2_XXS.gguf': { status: 'error' } })).not.toBe('')
    expect(packingInFlight(QWEN, { 'Qwen3.5-2B-UD-IQ2_XXS.gguf': { status: 'complete' } })).toBe('')
    expect(packingInFlight(QWEN, { [QWEN.filename]: { status: 'downloading' } })).toBe('')
    expect(packingInFlight(QWEN, { 'Something-Else-Q4_K_M.gguf': { status: 'downloading' } })).toBe('')
  })

  it('without internet the card of a model whose packing loads stays in sight', () => {
    const rows = { 'Qwen3.5-2B-UD-IQ2_XXS.gguf': { status: 'paused' } }
    expect(modelsInFlight(MOBILE_CHAT_MODELS, rows).map((m) => m.id)).toEqual([QWEN.id])
  })

  it('the sentences are English and carry no dashes', () => {
    for (const text of [S.models.installedPacking('IQ2_XXS', '732.7 MB', 2), S.models.packingOnItsWay('IQ2_XXS')]) expect(text).not.toMatch(/[–—]/)
  })
})

// Round 12, F13 (3) of the second check on Android: in the list "Installed" the card showed no progress while a
// second packing of the same model was loading. "Get new" did.
describe('the list "Installed" shows the download of a further packing', () => {
  const OTHER_FILE = file(OTHER.filename.replace(/\.gguf$/, ''), 300)

  it('on the card of the packing that is on the phone', () => {
    const shown = installedCardTransfers([OTHER_FILE, XXS], { 'Qwen3.5-2B-UD-IQ2_M.gguf': { status: 'downloading' } })
    expect(Object.keys(shown)).toEqual([XXS.path])
    expect(shown[XXS.path]).toEqual({ id: 'Qwen3.5-2B-UD-IQ2_M.gguf', name: 'Qwen 3.5 2B IQ2_M', quant: 'IQ2_M' })
  })

  it('the listed file of the catalogue loads while a packing is here: the same', () => {
    const shown = installedCardTransfers([XXS], { [QWEN.filename]: { status: 'paused' } })
    expect(shown[XXS.path]?.id).toBe(QWEN.filename)
  })

  it('once per model: two packings on the phone do not show the same bar twice', () => {
    const shown = installedCardTransfers([XXS, M], { [QWEN.filename]: { status: 'downloading' } })
    expect(Object.keys(shown)).toEqual([XXS.path])
  })

  it('nothing for a finished download, a download of another model, or the row of a file that is in the list', () => {
    expect(installedCardTransfers([XXS], { 'Qwen3.5-2B-UD-IQ2_M.gguf': { status: 'complete' } })).toEqual({})
    expect(installedCardTransfers([XXS], { [OTHER.filename]: { status: 'downloading' } })).toEqual({})
    expect(installedCardTransfers([XXS], { 'Qwen3.5-2B-UD-IQ2_XXS.gguf': { status: 'downloading' } })).toEqual({})
    expect(installedCardTransfers([], { [QWEN.filename]: { status: 'downloading' } })).toEqual({})
  })

  it('the page hands it to the card', () => {
    const page = readFileSync(join(__dirname, '..', 'ModelsPage.tsx'), 'utf8')
    expect(page).toContain('installedCardTransfers(chat, st.downloads)')
    expect(page).toContain('transfer={transfers[file.path]}')
  })
})
