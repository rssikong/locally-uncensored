// @vitest-environment jsdom
/**
 * Re-check Android 8 GB, A-05: loading a second packing of a model whose
 * listed file is on the phone already.
 *
 * Qwen 3.5 2B was installed as Q4_K_M. While IQ2_M was loading, and after it
 * had arrived, the catalogue card kept saying "Installed | Load | Use in
 * chat" and nothing else: no "Downloading IQ2_M", no progress, no word that
 * a second packing is there. And the toast at the end named the file
 * ("Qwen3.5-2B-UD-IQ2_M installed") where every other place shows the name
 * of the catalogue with the packing.
 *
 * Run: npx vitest run src/mobile/screens/models/__tests__/second-packing.dom.test.tsx
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { BundledModel } from '../../../../api/engine'
import { useDownloadStore } from '../../../../stores/downloadStore'
import { MOBILE_CHAT_MODELS, MOBILE_EMBED_MODEL } from '../../../data/mobile-models'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { cardOfCatalogWith, catalogCardState, packingInFlight } from '../parts/catalog'
import type { EngineView } from '../parts/engine'
import { fitOfCatalogModel } from '../parts/fit'
import { ModelCard } from '../parts/ModelCard'
import { downloadLabel } from '../parts/watch'

const QWEN = MOBILE_CHAT_MODELS.find((m) => m.id === 'qwen3.5-2b')!
const MIB = 1_048_576
const file = (name: string, mb: number): BundledModel => ({ name, path: `/models/${name}.gguf`, size: Math.round(mb * MIB), ctx_train: null }) as BundledModel
const LISTED = file(QWEN.filename.replace(/\.gguf$/, ''), QWEN.sizeBytes / MIB)
const M = file('Qwen3.5-2B-UD-IQ2_M', 820)
const XXS = file('Qwen3.5-2B-UD-IQ2_XXS', 732.7)
const M_FILE = 'Qwen3.5-2B-UD-IQ2_M.gguf'
const ENGINE = { loadedPath: null, status: null } as unknown as EngineView
const noop = () => undefined

function show(files: BundledModel[], rows: Record<string, { status: string }>): HTMLElement {
  const state = catalogCardState(QWEN, files, packingInFlight(QWEN, rows))
  render(
    <ModelCard
      model={cardOfCatalogWith(QWEN, state.packing)}
      fit={fitOfCatalogModel(QWEN, { platform: 'android', ramGb: 8 })}
      file={state.file}
      packing={state.packing}
      transfer={state.transfer}
      beside={state.beside}
      engine={ENGINE}
      chatModel={false}
      onDownload={noop}
      onUseInChat={noop}
      onLoad={noop}
      onUnload={noop}
    />,
  )
  return screen.getByTestId('m-models-item')
}

afterEach(() => {
  cleanup()
  useDownloadStore.setState({ downloads: {}, downloadMeta: {} })
})

describe('A-05 (a): the listed file is installed and a second packing loads', () => {
  it('the state carries the download of the other packing next to the listed file', () => {
    const state = catalogCardState(QWEN, [LISTED], M_FILE)
    expect(state.file).toBe(LISTED)
    expect(state.packing).toBeUndefined()
    expect(state.transfer).toEqual({ id: M_FILE, name: 'Qwen 3.5 2B IQ2_M', quant: 'IQ2_M' })
    expect(state.beside).toBeUndefined()
  })

  it('while it loads the card shows "Downloading IQ2_M" with the bar, and keeps Load and Use in chat', () => {
    useDownloadStore.setState({
      downloads: { [M_FILE]: { progress: 86 * MIB, total: 820 * MIB, speed: 2 * MIB, filename: M_FILE, status: 'downloading' } },
      downloadMeta: {},
    })
    const card = show([LISTED], { [M_FILE]: { status: 'downloading' } })
    expect(card.getAttribute('data-state')).toBe('installed')
    expect(within(card).getByTestId('m-models-item-packing-loading').textContent).toBe('Downloading IQ2_M')
    const bar = within(card).getByTestId('m-models-progress')
    expect(bar.textContent).toContain('10%')
    expect(within(card).getByTestId('m-models-load')).toBeTruthy()
    expect(within(card).getByTestId('m-models-use')).toBeTruthy()
    // The listed file is there: no second offer to download it.
    expect(within(card).queryByTestId('m-models-download')).toBeNull()
  })

  it('a paused download of the packing stays on the card', () => {
    useDownloadStore.setState({
      downloads: { [M_FILE]: { progress: 86 * MIB, total: 820 * MIB, speed: 0, filename: M_FILE, status: 'paused' } },
      downloadMeta: {},
    })
    const card = show([LISTED], { [M_FILE]: { status: 'paused' } })
    expect(within(card).getByTestId('m-models-item-packing-loading')).toBeTruthy()
  })

  it('after it arrived the card names both packings', () => {
    const state = catalogCardState(QWEN, [LISTED, M], '')
    expect(state.file).toBe(LISTED)
    expect(state.beside).toEqual({ listed: 'Q4_K_M', others: ['IQ2_M'] })
    const card = show([LISTED, M], {})
    expect(within(card).getByTestId('m-models-item-installed').textContent).toBe('Installed: Q4_K_M and IQ2_M')
    expect(within(card).getByTestId('m-models-item-installed').getAttribute('data-m-packing')).toBe('Q4_K_M IQ2_M')
    expect(within(card).queryByTestId('m-models-item-packing-loading')).toBeNull()
  })

  it('more packings are counted, largest first', () => {
    expect(catalogCardState(QWEN, [XXS, LISTED, M], '').beside).toEqual({ listed: 'Q4_K_M', others: ['IQ2_M', 'IQ2_XXS'] })
    expect(S.models.installedPackings('Q4_K_M', ['IQ2_M', 'IQ2_XXS'])).toBe('Installed: Q4_K_M, IQ2_M and IQ2_XXS')
    expect(S.models.installedPackings('Q4_K_M', ['IQ2_M', 'IQ2_XXS', 'Q8_0'])).toBe('Installed: Q4_K_M, IQ2_M, IQ2_XXS and 1 more')
  })

  it('the listed file alone: the plain word, as before', () => {
    const card = show([LISTED], {})
    expect(within(card).getByTestId('m-models-item-installed').textContent).toBe(S.common.installed)
    expect(within(card).getByTestId('m-models-item-installed').getAttribute('data-m-packing')).toBeNull()
  })

  it('the sentences are English and carry no dashes', () => {
    expect(S.models.installedPackings('Q4_K_M', ['IQ2_M'])).not.toMatch(/[–—]/)
  })
})

describe('A-05 (b): the toast names the download as the rest of the app does', () => {
  it('a packing of a catalogue model: the name of the model with the packing, not the file name', () => {
    expect(S.download.installedToast(downloadLabel('Qwen3.5-2B-UD-IQ2_M.gguf'))).toBe('Qwen 3.5 2B IQ2_M installed')
    expect(S.download.installedToast(downloadLabel('HuggingFaceTB_SmolLM3-3B-IQ2_M.gguf'))).toBe('SmolLM3 3B IQ2_M installed')
  })

  it('the listed file keeps the plain name, the document model its own, an unknown file its file name', () => {
    expect(downloadLabel(QWEN.filename)).toBe(QWEN.name)
    expect(downloadLabel(MOBILE_EMBED_MODEL.filename)).toBe(S.models.documentModel)
    expect(downloadLabel('Some-Unknown-Thing-Q5_K_M.gguf')).toBe('Some-Unknown-Thing-Q5_K_M')
  })
})
