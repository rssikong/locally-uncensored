// @vitest-environment jsdom
/**
 * Mehrere Bilder pro Lauf und die Referenzleiste (02.10.2026, Web-Paritaet;
 * Vorlage: the web app):
 * was der Kunde sieht und was der
 * Startknopf daraus rechnet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor, renderHook } from '@testing-library/react'

const ctx = vi.hoisted(() => ({
  quota: {
    tier: 'hosted-max', period: '2026-10-01', renewsAt: '2026-11-01T00:00:00.000Z',
    limits: { credits: 500000 }, costs: { image: 300, video: 10000 }, used: { credits_used: 0 }, remaining: { credits: 700 },
    topup: { credits: 0 }, video: { limit: 500000, used: 0, remaining: 500000 }, trainings: { limit: 3, used: 0, remaining: 3 },
  },
  quote: vi.fn(),
  mlx: false,
}))
vi.mock('../CreateContext', () => ({
  useCreateExp: () => ({
    generate: vi.fn(), cancel: vi.fn(), makeVoice: vi.fn(), quota: ctx.quota,
    samplerList: [], schedulerList: [], loraList: [], vaeList: [], refreshModelLists: vi.fn(),
  }),
}))
vi.mock('../loadImage', () => ({
  loadImageRef: vi.fn(async (f: File) => ({ filename: f.name, url: `data:image/png;base64,${f.name}`, width: 64, height: 64 })),
}))
vi.mock('../../../../api/mlx-image', () => ({ isMlxImageHost: () => ctx.mlx }))
vi.mock('../../../../api/comfyui', () => ({ classifyModel: () => 'sdxl', isI2VModel: () => false, isT2VCapable: () => true }))
vi.mock('../../../../api/backend', () => ({ openExternal: vi.fn() }))
vi.mock('../../../../hooks/useGraphicsMemory', () => ({ useGraphicsCardGb: () => null }))
vi.mock('../../../../api/cloud/studio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../api/cloud/studio')>()),
  studioQuote: ctx.quote,
}))

import { ParamGroups } from '../ParamGroups'
import { ImageCount } from '../ImageCount'
import { AdvancedDrawer } from '../AdvancedDrawer'
import { ReferenceStrip } from '../ReferenceStrip'
import { CreditsMeter } from '../CreditsMeter'
import { useStudioPrice } from '../useStudioPrice'
import { useCreateStore } from '../../../../stores/createStore'
import { useCloudCatalogStore } from '../../../../stores/cloudCatalogStore'
import { neuerServer } from '../../../../lib/render/__tests__/fixtures/test-catalogs'
import { studioPickFor } from '../../../../lib/render/create-studio'

const BILD = { filename: 'a.png', url: 'data:image/png;base64,AA', width: 512, height: 512 }
const FOTO = (n: number) => ({ filename: `p${n}.png`, url: `data:image/png;base64,P${n}`, width: 64, height: 64 })

beforeEach(() => {
  ctx.quota.remaining.credits = 700
  ctx.mlx = false
  ctx.quote.mockReset()
  ctx.quote.mockRejectedValue(new Error('offline'))
  useCloudCatalogStore.setState({ models: neuerServer() })
  useCreateStore.setState({
    backend: 'cloud', isGenerating: false, error: null, source: null, mask: null, references: [],
    gallery: [], cloudStudioOptions: {}, cloudStudioCredits: null, cloudImageCount: 1,
  })
  useCreateStore.getState().setPrompt('a neutral placeholder line')
})
afterEach(() => { cleanup() })

describe('Regler Images', () => {
  const range = (c: HTMLElement) => [...c.querySelectorAll('input[type=range]')].find((el) => (el as HTMLInputElement).max === '4') as HTMLInputElement

  it('steht in der Cloud bei Bild und Bearbeiten, von 1 bis 4', () => {
    useCreateStore.getState().setIntent('image')
    const { container } = render(<><ImageCount /><ParamGroups /></>)
    expect(screen.getAllByText('Images')).toHaveLength(1)
    expect(screen.queryByText('Batch size')).toBeNull()
    expect(range(container).min).toBe('1')
    fireEvent.change(range(container), { target: { value: '3' } })
    expect(useCreateStore.getState().cloudImageCount).toBe(3)
  })

  it('der Speicher haelt die Zahl zwischen 1 und 4', () => {
    const s = useCreateStore.getState()
    s.setCloudImageCount(9); expect(useCreateStore.getState().cloudImageCount).toBe(4)
    s.setCloudImageCount(0); expect(useCreateStore.getState().cloudImageCount).toBe(1)
    s.setCloudImageCount(2.7); expect(useCreateStore.getState().cloudImageCount).toBe(2)
  })

  it('Bearbeiten hat ihn, Video nicht', () => {
    useCreateStore.getState().setIntent('edit')
    const edit = render(<ImageCount />)
    expect(screen.getByText('Images')).toBeTruthy()
    edit.unmount()
    useCreateStore.getState().setIntent('video')
    render(<ImageCount />)
    expect(screen.queryByText('Images')).toBeNull()
  })

  it('lokal bleibt es bei Batch size', () => {
    useCreateStore.setState({ backend: 'local' })
    useCreateStore.getState().setIntent('image')
    render(<><ImageCount /><ParamGroups /></>)
    expect(screen.getByText('Batch size')).toBeTruthy()
    expect(screen.queryByText('Images')).toBeNull()
  })

  // Fund F1 (05.10.2026): bei einem Studio-Modell zeigte die Klappe nur dessen
  // eigene Felder, der Regler fehlte, die Zahl galt aber weiter.
  it('ein Studio-Modell in Bearbeiten und in Bild hat den Regler in der Klappe', () => {
    for (const [intent, model, studio] of [['edit', 'qwen-image-2.1-edit', true], ['image', 'qwen-image-2.1', true], ['image', 'flux-schnell', false]] as const) {
      const s = useCreateStore.getState()
      s.setIntent(intent); s.setCloudImageModel(model)
      useCreateStore.setState({ source: BILD })
      const pick = studioPickFor(intent, useCreateStore.getState())
      expect(!!pick, `${intent} ${model}`).toBe(studio)
      const { container, unmount } = render(<AdvancedDrawer open onClose={() => {}} studioModel={pick} />)
      expect(screen.getAllByText('Images'), `${intent} ${model}`).toHaveLength(1)
      fireEvent.change(range(container), { target: { value: '2' } })
      expect(useCreateStore.getState().cloudImageCount).toBe(2)
      unmount()
    }
  })

  it('die Zahl wandert nicht in eine andere Unterkategorie mit', () => {
    const s = useCreateStore.getState()
    s.setIntent('image'); s.setCloudImageCount(4)
    s.setIntent('image')
    expect(useCreateStore.getState().cloudImageCount).toBe(4)
    s.setIntent('edit')
    expect(useCreateStore.getState().cloudImageCount).toBe(1)
  })

  it('schliesst der Wechsel auf lokal die Unterkategorie, geht die Zahl mit ihr', () => {
    const s = useCreateStore.getState()
    s.setIntent('image'); s.setCloudImageCount(4)
    s.setBackend('local'); s.setBackend('cloud')
    expect(useCreateStore.getState().cloudImageCount).toBe(4)
    // Auf einem Mac kennt die lokale Spur kein Bearbeiten: der Wechsel macht
    // aus Edit Image, und die vier Bilder von Edit gelten dort nicht.
    ctx.mlx = true
    s.setIntent('edit'); s.setCloudImageCount(4)
    s.setBackend('local'); s.setBackend('cloud')
    expect(useCreateStore.getState().intent()).toBe('image')
    expect(useCreateStore.getState().cloudImageCount).toBe(1)
  })

  it('ueber einem Bild nennen Regler und Leiste die Summe des Laufs, sichtbar und nicht nur im Tooltip', () => {
    const s = useCreateStore.getState()
    s.setIntent('image'); s.setCloudImageModel('flux-schnell'); s.setCloudImageCount(2)
    render(<><CreditsMeter /><ImageCount /></>)
    expect(screen.getByText('2 images, 600 credits')).toBeTruthy()
    expect(screen.getByText('2, 600 credits in all')).toBeTruthy()
    cleanup()
    s.setCloudImageCount(1)
    render(<><CreditsMeter /><ImageCount /></>)
    expect(screen.queryByText(/images, \d+ credits/)).toBeNull()
    expect(screen.getByText(/≈2 images/)).toBeTruthy() // 700 / 300 je Bild
  })

  it('die Zahl wird nie gespeichert: ein fremder Blob belegt sie nicht vor', () => {
    const persisted = useCreateStore.persist.getOptions().partialize!(useCreateStore.getState()) as Record<string, unknown>
    expect('cloudImageCount' in persisted).toBe(false)
    expect('references' in persisted).toBe(false)
  })
})

describe('Zaehler und Preis mit Anzahl', () => {
  it('drei Bilder zu 300 Einheiten brauchen 900, bei 700 Guthaben nennt der Zaehler die Summe', () => {
    const s = useCreateStore.getState()
    s.setIntent('image'); s.setCloudImageModel('flux-schnell'); s.setCloudImageCount(3)
    render(<CreditsMeter />)
    expect(screen.getByText(/Needs 900 credits \(700 left\)/)).toBeTruthy()
  })

  it('zwei Bilder (600) passen ins Guthaben', () => {
    const s = useCreateStore.getState()
    s.setIntent('image'); s.setCloudImageModel('flux-schnell'); s.setCloudImageCount(2)
    render(<CreditsMeter />)
    expect(screen.queryByText(/Needs/)).toBeNull()
  })

  it('ein Studio-Bild (5.000 je Bild) geht mal Anzahl ein', () => {
    ctx.quota.remaining.credits = 15000
    const s = useCreateStore.getState()
    s.setIntent('edit'); s.setCloudImageModel('qwen-image-2.1-edit'); s.setCloudImageCount(4)
    useCreateStore.setState({ source: BILD, cloudStudioCredits: 5000 })
    render(<CreditsMeter />)
    expect(screen.getByText(/Needs 20000 credits \(15000 left\)/)).toBeTruthy()
    cleanup()
    s.setCloudImageCount(3)
    render(<CreditsMeter />)
    expect(screen.queryByText(/Needs/)).toBeNull()
  })

  it('die Fotos der Leiste gehen in die Schaetzung ein, wo der Anbieter einen Aufpreis nennt', () => {
    ctx.quota.remaining.credits = 4000
    const s = useCreateStore.getState()
    s.setIntent('edit'); s.setCloudImageModel('qwen-image-2.1-edit')
    useCreateStore.setState({ source: BILD, references: [], cloudStudioCredits: null })
    const a = render(<CreditsMeter />)
    expect(screen.queryByText(/Needs/)).toBeNull() // 1 Foto: 3.000
    a.unmount()
    useCreateStore.setState({ references: [FOTO(1), FOTO(2), FOTO(3), FOTO(4)] }) // 5 Fotos: 3.000 + 4 x 2.000
    render(<CreditsMeter />)
    expect(screen.getByText(/Needs 11000 credits \(4000 left\)/)).toBeTruthy()
  })

  it('der Vorab-Preis fragt mit der echten Bildzahl, hoechstens bis zur Grenze des Modells', async () => {
    ctx.quote.mockResolvedValue({ credits: 5000 })
    const a = renderHook(() => useStudioPrice('qwen-image-2.1-edit', {}, 'x', undefined, 3))
    await waitFor(() => expect(a.result.current?.live).toBe(true), { timeout: 3000 })
    expect(ctx.quote.mock.calls[0][3]).toBe(4)
    ctx.quote.mockClear()
    const b = renderHook(() => useStudioPrice('qwen-image-3-edit', {}, 'x', undefined, 4))
    await waitFor(() => expect(b.result.current?.live).toBe(true), { timeout: 3000 })
    expect(ctx.quote.mock.calls[0][3]).toBe(3)
  })
})

describe('Referenzleiste', () => {
  const tiles = () => screen.queryAllByAltText(/^image \d$/)

  function edit(model: string) {
    const s = useCreateStore.getState()
    s.setIntent('edit'); s.setCloudImageModel(model)
    useCreateStore.setState({ source: BILD })
  }

  it('zeigt bei einem Mehrbild-Editor den Hinweis mit der Grenze des Modells', () => {
    edit('qwen-image-2.1-edit')
    render(<ReferenceStrip />)
    expect(screen.getByTestId('reference-strip')).toBeTruthy()
    expect(screen.getByText(/Add up to 5 photos of your character/)).toBeTruthy()
  })

  it('die Grenze folgt dem Modell: Qwen Image 3.0 nimmt drei', () => {
    edit('qwen-image-3-edit')
    render(<ReferenceStrip />)
    expect(screen.getByText(/Add up to 3 photos/)).toBeTruthy()
  })

  it('Animate mit einem Referenzmodell zeigt sie auch', () => {
    const s = useCreateStore.getState()
    s.setIntent('animate'); s.setCloudVideoModel('minimax-h3-ref')
    useCreateStore.setState({ source: BILD })
    render(<ReferenceStrip />)
    expect(screen.getByText(/Add up to 5 photos/)).toBeTruthy()
  })

  it('fehlt bei Modellen mit einem Bildfeld und bei anderen Unterkategorien', () => {
    edit('flux-dev')
    const a = render(<ReferenceStrip />)
    expect(screen.queryByTestId('reference-strip')).toBeNull()
    a.unmount()
    useCreateStore.getState().setIntent('upscale')
    render(<ReferenceStrip />)
    expect(screen.queryByTestId('reference-strip')).toBeNull()
  })

  it('Fotos kommen per Auswahl hinein, werden nummeriert und lassen sich entfernen', async () => {
    edit('qwen-image-2.1-edit')
    const { container } = render(<ReferenceStrip />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' }), new File(['x'], 'b.png', { type: 'image/png' })] } })
    await waitFor(() => expect(useCreateStore.getState().references).toHaveLength(2))
    expect(tiles()).toHaveLength(2)
    // The tile carries the name the prompt uses (Discord help-18, 23.10.2026).
    expect(screen.getByText('Image 2')).toBeTruthy()
    expect(screen.getByText('Image 3')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Remove photo 2'))
    expect(useCreateStore.getState().references).toHaveLength(1)
  })

  it('nimmt nicht mehr Fotos an, als das Modell liest, und bietet dann keinen Plus-Knopf mehr', async () => {
    edit('qwen-image-3-edit') // 3 Fotos, also 2 weitere neben dem Standbild
    const { container } = render(<ReferenceStrip />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: ['a', 'b', 'c'].map((n) => new File(['x'], `${n}.png`, { type: 'image/png' })) } })
    await waitFor(() => expect(useCreateStore.getState().references).toHaveLength(2))
    expect(tiles()).toHaveLength(2)
    expect(screen.queryByTitle('Add another photo of your character')).toBeNull()
  })

  it('eine Datei, die kein Bild ist, wird abgewiesen', async () => {
    edit('qwen-image-2.1-edit')
    const { container } = render(<ReferenceStrip />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } })
    await waitFor(() => expect(useCreateStore.getState().error).toMatch(/not supported/))
    expect(useCreateStore.getState().references).toHaveLength(0)
  })

  it('der Speicher haelt hoechstens neun weitere Fotos (lokal Qwen-Image 2.1), die Cloud zeigt davon nur ihre vier', () => {
    for (let i = 1; i <= 12; i++) useCreateStore.getState().addReference(FOTO(i))
    expect(useCreateStore.getState().references).toHaveLength(9)
  })

  it('ein Modellwechsel auf eines mit weniger Platz blendet nur aus, was nicht mehr passt', () => {
    edit('qwen-image-2.1-edit')
    useCreateStore.setState({ references: [FOTO(1), FOTO(2), FOTO(3)] })
    const { rerender } = render(<ReferenceStrip />)
    expect(tiles()).toHaveLength(3)
    useCreateStore.getState().setCloudImageModel('qwen-image-3-edit')
    rerender(<ReferenceStrip />)
    expect(tiles()).toHaveLength(2)
    expect(useCreateStore.getState().references).toHaveLength(3)
  })
})
