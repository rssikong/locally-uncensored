// @vitest-environment jsdom
/**
 * Round 6, acceptance on Android 8 GB: N1 "in another shape", B14 and B17.
 *
 * SmolLM3 3B as IQ2_M (1.0 GB) on a phone with 8 GB: the catalogue said
 * "Tight fit, needs about 1.9 GB", the list "Installed" said "Runs well,
 * needs about 2.1 GB" under the name of the file and without marks, and the
 * detail page of the catalogue kept saying "Tight fit". Round 5 gave every
 * file one verdict (variant-verdict.test.ts walks all models, packings and
 * RAM classes for it). This file takes the two files of the report and walks
 * the PLACES: catalogue card, detail page of the catalogue, list "Installed",
 * detail page of the file, the downloads list, the model sheet of the chat,
 * the line above an answer, and the onboarding. Same name, same size, same
 * verdict, same memory figure, same marks, each from one source.
 *
 * Run: npx vitest run src/mobile/screens/models/__tests__/same-file-everywhere.dom.test.tsx
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { BundledModel } from '../../../../api/engine'
import { formatBytes } from '../../../../lib/formatters'
import { MOBILE_CHAT_MODELS, type MobileModel } from '../../../data/mobile-models'
import { assessFit, fitModelOfFile, type FitDevice } from '../../../lib/device-fit'
import { deviceFileLabel, factsOfChatModel } from '../../../lib/model-facts'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { modelLabel } from '../../agent/parts/model-names'
import { chatModelLabel } from '../../chat/parts/model-name'
import { cardOfCatalog, cardOfCatalogWith, cardOfFile, catalogCardState, fitOfFile, fitOfNamedFile, fitOfVariant, packingInFlight } from '../parts/catalog'
import { fitOfCatalogModel } from '../parts/fit'
import { chatModelId, displayName } from '../parts/installed'
import { ModelCard, type CardModel } from '../parts/ModelCard'
import type { EngineView } from '../parts/engine'

afterEach(cleanup)

const src = (path: string) => readFileSync(join(__dirname, '../../../../..', path), 'utf8')
const model = (id: string): MobileModel => MOBILE_CHAT_MODELS.find((m) => m.id === id)!

/** The two files of the report, with the sizes the phone showed. */
// Round 12, F8: a 2 bit packing of a model up to 4 billion parameters is never "Runs well". Both files carry
// "Packed very small, answers may be poor" in every place (before: "Tight fit, may be slow" and "Runs well on this phone").
const CASES = [
  { catalogue: model('smollm3-3b'), filename: 'HuggingFaceTB_SmolLM3-3B-IQ2_M.gguf', bytes: 1_090_519_040, name: 'SmolLM3 3B IQ2_M', level: 'tight', word: S.fit.coarse },
  { catalogue: model('qwen3.5-2b'), filename: 'Qwen3.5-2B-UD-IQ2_M.gguf', bytes: 860_048_588, name: 'Qwen 3.5 2B IQ2_M', level: 'tight', word: S.fit.coarse },
] as const

const PHONE: FitDevice = { platform: 'android', ramGb: 8 }
const DEVICES: FitDevice[] = [PHONE, { platform: 'android', ramGb: 4 }, { platform: 'android', ramGb: 6 }, { platform: 'ios', ramGb: 4 }, { platform: 'ios', ramGb: 8 }]

const onPhone = (c: (typeof CASES)[number]): BundledModel => ({ name: c.filename.replace(/\.gguf$/, ''), path: `/models/${c.filename}`, size: c.bytes, ctx_train: null }) as BundledModel
const marksOf = (card: Pick<CardModel, 'thinking' | 'tools' | 'uncensored' | 'vision'>) => ({ thinking: !!card.thinking, tools: !!card.tools, uncensored: !!card.uncensored, vision: !!card.vision })
const ENGINE = { loadedPath: null, status: null } as unknown as EngineView
const noop = () => undefined

describe('the two files of the report, in every place', () => {
  for (const c of CASES) {
    const file = onPhone(c)
    const id = chatModelId(file.name)

    it(`${c.name}: one name`, () => {
      // Installed and the detail page of the file, the downloads list, the catalogue card ("Installed: ..."), the chat, the agent pages.
      expect(displayName(file)).toBe(c.name)
      expect(cardOfFile(file).name).toBe(c.name)
      expect(deviceFileLabel(c.filename)).toBe(c.name)
      expect(catalogCardState(c.catalogue, [file], '').packing?.name).toBe(c.name)
      expect(chatModelLabel([], id)).toBe(c.name)
      expect(modelLabel(id, [])).toBe(c.name)
      // While it is on its way, the catalogue card names it the same way.
      expect(catalogCardState(c.catalogue, [], c.filename).transfer?.name).toBe(c.name)
    })

    it(`${c.name}: one size`, () => {
      const size = formatBytes(c.bytes)
      expect(cardOfFile(file).sizeText).toBe(size)
      const state = catalogCardState(c.catalogue, [file], '')
      expect(state.packing?.sizeText).toBe(size)
      // The head of the catalogue card shows the size of the file its verdict is about, not of the listed file.
      expect(cardOfCatalogWith(c.catalogue, state.packing).sizeText).toBe(size)
      expect(cardOfCatalogWith(c.catalogue, state.packing).sizeText).not.toBe(formatBytes(c.catalogue.sizeBytes))
      expect(cardOfCatalogWith(c.catalogue, undefined)).toEqual(cardOfCatalog(c.catalogue))
    })

    it(`${c.name}: one verdict and one memory figure, on every phone`, () => {
      for (const device of DEVICES) {
        const where = `${device.platform} ${device.ramGb} GB`
        // Detail page of the catalogue: the row of the variant, before the download.
        const offered = fitOfNamedFile(c.filename, c.bytes, device)
        const variant = fitOfVariant({ quant: 'IQ2_M', files: [{ filename: c.filename, url: '', sizeBytes: c.bytes }], totalBytes: c.bytes, sharded: false }, device)
        // Installed, the detail page of the file, and the catalogue card that stands for it.
        const installed = fitOfFile(file, device)
        // Model sheet of the chat.
        const sheet = assessFit({ device, model: fitModelOfFile(file.name, c.bytes) }).verdict
        for (const view of [variant, installed]) {
          expect(view.level, where).toBe(offered.level)
          expect(view.needBytes, where).toBe(offered.needBytes)
          expect(view.long, where).toBe(offered.long)
          expect(view.maxContext, where).toBe(offered.maxContext)
        }
        expect(sheet, where).toBe(offered.level)
      }
      // The numbers of the report, on its phone: tight stays tight and runs well stays runs well, after the download as before.
      expect(fitOfFile(file, PHONE).level).toBe(c.level)
      expect(fitOfNamedFile(c.filename, c.bytes, PHONE).level).toBe(c.level)
    })

    it(`${c.name}: the same marks in every place`, () => {
      // The model drives tools. This file of it is packed with 2 bits and does not carry the mark, in no place
      // (check on Android with 4 GB, F3). Everything else is the model's.
      expect(marksOf(cardOfCatalog(c.catalogue)).tools).toBe(true)
      const marks = { ...marksOf(cardOfCatalog(c.catalogue)), tools: false }
      expect(marks.thinking).toBe(true)
      expect(marksOf(cardOfFile(file))).toEqual(marks)
      expect(marksOf(cardOfCatalogWith(c.catalogue, catalogCardState(c.catalogue, [file], '').packing))).toEqual(marks)
      const facts = factsOfChatModel(id)
      expect({ thinking: facts?.thinking, tools: facts?.tools }).toEqual({ thinking: marks.thinking, tools: marks.tools })
    })

    it(`${c.name}: the two cards a user sees say the same`, () => {
      // The card in "Installed".
      render(<ModelCard model={cardOfFile(file)} fit={fitOfFile(file, PHONE)} file={file} engine={ENGINE} chatModel={false} onDownload={noop} onUseInChat={noop} onLoad={noop} onUnload={noop} />)
      const installedCard = screen.getByTestId('m-models-item')
      const read = (card: HTMLElement) => ({
        fit: within(card).getByTestId('m-models-item-fit').textContent,
        thinking: within(card).queryAllByTestId('m-models-item-thinking').length,
        tools: within(card).queryAllByTestId('m-models-item-tools').length,
        size: card.textContent?.includes(formatBytes(c.bytes)),
        listedSize: card.textContent?.includes(formatBytes(c.catalogue.sizeBytes)),
      })
      const a = read(installedCard)
      // No Tools mark: the file is packed with 2 bits (check on Android with 4 GB, F3).
      expect(a).toEqual({ fit: c.word, thinking: 1, tools: 0, size: true, listedSize: false })
      expect(installedCard.textContent).toContain(c.name)
      cleanup()

      // The card of the model in "Get new", which stands for the same file.
      const state = catalogCardState(c.catalogue, [file], '')
      render(<ModelCard model={cardOfCatalogWith(c.catalogue, state.packing)} fit={fitOfFile(file, PHONE)} file={state.file} packing={state.packing} engine={ENGINE} chatModel={false} onDownload={noop} onUseInChat={noop} onLoad={noop} onUnload={noop} />)
      const catalogueCard = screen.getByTestId('m-models-item')
      expect(read(catalogueCard)).toEqual(a)
      expect(within(catalogueCard).getByTestId('m-models-item-installed').textContent).toBe(S.models.installedPacking('IQ2_M', formatBytes(c.bytes), 0))
      // B17: no offer to download the listed file next to the file that is there.
      expect(within(catalogueCard).queryByTestId('m-models-download')).toBeNull()
    })

    it(`${c.name}: B17, on its way the catalogue card shows that download and not "Download ${formatBytes(c.catalogue.sizeBytes)}"`, () => {
      const rows = { [c.filename]: { status: 'downloading' } }
      expect(packingInFlight(c.catalogue, rows)).toBe(c.filename)
      const state = catalogCardState(c.catalogue, [], packingInFlight(c.catalogue, rows))
      expect(state.file).toBeUndefined()
      expect(state.transfer).toEqual({ id: c.filename, name: c.name, quant: 'IQ2_M' })
      // Finished and gone from the rows: nothing is on its way any more.
      expect(packingInFlight(c.catalogue, { [c.filename]: { status: 'complete' } })).toBe('')
    })
  }
})

describe('every place asks the one source', () => {
  it('the verdict of a file: fitModelOfFile, through the helpers of parts/catalog.ts', () => {
    expect(src('src/mobile/screens/models/ModelsPage.tsx')).toContain('fit={packing && file ? fitOfFile(file, device) : fit}')
    expect(src('src/mobile/screens/models/ModelsPage.tsx')).toContain('model={cardOfCatalogWith(model, packing)}')
    expect(src('src/mobile/screens/models/ModelsPage.tsx')).toContain('fit={fitOfFile(file, device)}')
    expect(src('src/mobile/screens/models/ModelDetailPage.tsx')).toContain('const fit = fitOfNamedFile(filename, variant.totalBytes > 0 ? variant.totalBytes : undefined, device)')
    expect(src('src/mobile/screens/models/ModelDetailPage.tsx')).toContain('fit: fitOfFile(fileOnPhone, device)')
    expect(src('src/mobile/screens/chat/ModelSheet.tsx')).toContain('const result = assessFit({ device, model: fitModelOfFile(displayModelName(name), size) })')
    expect(src('src/mobile/screens/models/parts/catalog.ts')).toContain('return fitView(fitModelOfFile(filename, sizeBytes), device)')
  })

  it('the name of a file: deviceFileLabel', () => {
    expect(src('src/mobile/screens/models/parts/installed.ts')).toContain('return deviceFileLabel(file.name) ?? file.name')
    expect(src('src/mobile/screens/chat/parts/model-name.ts')).toContain('deviceFileLabel(displayModelName(name))')
    expect(src('src/mobile/screens/agent/parts/model-names.ts')).toContain('deviceFileLabel(displayModelName(name))')
    expect(src('src/mobile/screens/models/DownloadsPage.tsx')).toContain('return deviceFileLabel(filename) ?? bare')
    expect(src('src/mobile/screens/chat/ModelSheet.tsx')).toContain('title={deviceFileLabel(d.filename) ??')
  })

  it('the marks of a file: the catalogue model behind it', () => {
    expect(src('src/mobile/screens/chat/ModelSheet.tsx')).toContain('const facts = factsOfChatModel(model.name)')
    expect(src('src/mobile/screens/chat/ModelSheet.tsx')).toContain('data-testid="m-chat-model-local-tools"')
    expect(src('src/mobile/screens/models/parts/catalog.ts')).toContain('return kin ? { ...cardOfCatalog(kin.model), ...own, tools: toolsInPacking(kin.model, own.quant) } : own')
  })
})

describe('B14: the onboarding and the catalogue say the same about a model', () => {
  it('the starter card shows Tools where the catalogue card does', () => {
    const page = src('src/mobile/screens/onboarding/SetupModelPage.tsx')
    expect(page).toContain("{model.agent === true ? (")
    expect(page).toContain('data-testid="m-onboarding-model-tools"')
    // Same field, same word.
    expect(cardOfCatalog(model('qwen3-1.7b')).tools).toBe(true)
    expect(model('qwen3-1.7b').agent).toBe(true)
    expect(page).toContain('<Tag>{S.models.tagTools}</Tag>')
    // Size and verdict of the starter card are the catalogue's.
    expect(page).toContain('fit={fitOfCatalogModel(item, device)}')
    expect(page).toContain('<MonoLine parts={[formatBytes(model.sizeBytes)]} />')
  })

  it('the memory figure is the same in both, and it is not a function of the file size alone', () => {
    // The report read "1.0 GB needs about 2.0 GB" next to "1.2 GB needs about 1.8 GB" as a mismatch. Both are
    // right: the working memory of a model (its KV cache) depends on how the model is built, not on its file.
    const q17 = model('qwen3-1.7b')
    const q35 = model('qwen3.5-2b')
    expect(q17.sizeBytes).toBeLessThan(q35.sizeBytes)
    expect(q17.kvBytesPerToken).toBeGreaterThan(q35.kvBytesPerToken * 5)
    expect(formatBytes(fitOfCatalogModel(q17, PHONE).needBytes)).toBe('2.0 GB')
    expect(formatBytes(fitOfCatalogModel(q35, PHONE).needBytes)).toBe('1.8 GB')
  })
})
