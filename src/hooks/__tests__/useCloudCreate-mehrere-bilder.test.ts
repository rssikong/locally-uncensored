/**
 * Mehrere Bilder pro Lauf und mehrere Fotos pro Referenz (02.10.2026, Web-
 * Paritaet; Vorlage: the web app).
 *
 * Nichts wird erzeugt: Absenden, Hochladen, Abholen, Abbrechen und die Preis-
 * bestaetigung sind gemockt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('react', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, useCallback: (fn: unknown) => fn }
})

type Payload = { kind: string; model: string; prompt: string; params: Record<string, unknown> }
const hoisted = vi.hoisted(() => {
  class FakeCloudJobError extends Error {
    status: number
    code?: string
    constructor(message: string, status: number, meta?: { code?: string }) {
      super(message)
      this.status = status
      this.code = meta?.code
    }
  }
  class FakeQuoteChanged extends FakeCloudJobError {
    credits: number
    constructor(message: string, credits: number) {
      super(message, 409, { code: 'quote_changed' })
      this.credits = credits
    }
  }
  const plan = {
    booked: undefined as number | undefined,
    stopped: undefined as 'credits_exhausted' | 'error' | undefined,
    oldServer: false,
    outcome: {} as Record<string, 'succeeded' | 'failed'>,
    upload: 0,
    cancel409: new Set<string>(),
  }
  return {
    FakeCloudJobError,
    FakeQuoteChanged,
    plan,
    submitted: [] as Payload[],
    abgebrochen: [] as string[],
    hochgeladen: [] as string[],
    quote: vi.fn(async (..._a: unknown[]) => ({ credits: 5000 })),
  }
})
const { submitted, abgebrochen, hochgeladen, plan } = hoisted

vi.mock('../useContentPolicy', () => ({
  contentPolicySnapshot: () => 'off' as const,
  loadContentPolicy: async () => 'off' as const,
}))
vi.mock('../../api/cloud/jobs', () => ({
  uploadInput: vi.fn(async (_b: unknown, slot: string) => { hochgeladen.push(slot); return `user-1/staged-${slot}-${++plan.upload}.png` }),
  getJob: vi.fn(),
  cancelJob: vi.fn(async (id: string) => {
    if (plan.cancel409.has(id)) throw new hoisted.FakeCloudJobError('running', 409)
    abgebrochen.push(id)
    return { status: 'canceled' }
  }),
  submitCloudJob: vi.fn(async (payload: Payload) => {
    submitted.push(payload)
    const asked = (payload.params.count as number | undefined) ?? 1
    const booked = plan.booked ?? asked
    const ids = Array.from({ length: booked }, (_, i) => `job-${i}`)
    if (asked === 1 || plan.oldServer) return { id: ids[0], quota: { cost: 300 } }
    return {
      id: ids[0], quota: { cost: 300 },
      jobs: ids.map((id) => ({ id, status: 'queued', cost: 300 })), requested: asked,
      ...(plan.stopped ? { stopped: plan.stopped } : {}),
    }
  }),
  pollJob: vi.fn(async (id: string) => {
    const status = plan.outcome[id] ?? 'succeeded'
    return {
      id, kind: 'image', model: 'flux-schnell', status,
      result_url: status === 'succeeded' ? `https://storage.example/${id}.png` : null,
      error: status === 'failed' ? 'provider said no' : null,
      created_at: new Date().toISOString(), params: {},
    }
  }),
  CloudJobError: hoisted.FakeCloudJobError,
  QuoteChangedError: hoisted.FakeQuoteChanged,
}))
vi.mock('../../api/cloud/studio', () => ({
  studioQuote: hoisted.quote,
  StudioQuoteChangedError: hoisted.FakeQuoteChanged,
}))

import { useCloudCreate } from '../useCloudCreate'
import { useCreateStore } from '../../stores/createStore'
import { useCloudCatalogStore } from '../../stores/cloudCatalogStore'
import { neuerServer } from '../../lib/render/__tests__/fixtures/test-catalogs'

const BILD = { filename: 'a.png', url: 'data:image/png;base64,AA', width: 512, height: 512 }
const FOTO = (n: number) => ({ filename: `p${n}.png`, url: `data:image/png;base64,P${n}`, width: 64, height: 64 })

beforeEach(() => {
  submitted.length = 0; abgebrochen.length = 0; hochgeladen.length = 0
  plan.booked = undefined; plan.stopped = undefined; plan.oldServer = false; plan.outcome = {}; plan.upload = 0; plan.cancel409.clear()
  hoisted.quote.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) })))
  useCreateStore.setState({
    isGenerating: false, error: null, backend: 'cloud', source: null, mask: null, references: [],
    gallery: [], cloudStudioOptions: {}, cloudStudioCredits: null, cloudImageCount: 1,
  })
  useCreateStore.getState().setPrompt('a neutral placeholder line')
  useCloudCatalogStore.setState({ models: neuerServer() })
})

describe('Anzahl der Bilder pro Lauf', () => {
  it('ohne Anzahl schickt der Start kein count und bucht ein Bild', async () => {
    useCreateStore.getState().setIntent('image')
    useCreateStore.getState().setCloudImageModel('flux-schnell')
    await useCloudCreate().generate()
    expect(submitted).toHaveLength(1)
    expect(submitted[0].params.count).toBeUndefined()
    expect(useCreateStore.getState().gallery).toHaveLength(1)
    expect(useCreateStore.getState().error).toBeNull()
  })

  it('drei Bilder gehen als ein Start mit count 3 und landen alle in der Galerie', async () => {
    const s = useCreateStore.getState()
    s.setIntent('image'); s.setCloudImageModel('flux-schnell'); s.setCloudImageCount(3)
    await useCloudCreate().generate()
    expect(submitted).toHaveLength(1)
    expect(submitted[0].params.count).toBe(3)
    expect(useCreateStore.getState().gallery.map((g) => g.jobId).sort()).toEqual(['job-0', 'job-1', 'job-2'])
    expect(useCreateStore.getState().error).toBeNull()
    expect(useCreateStore.getState().isGenerating).toBe(false)
  })

  it('jedes Bild zeigt den Keim, mit dem es entstand', async () => {
    const s = useCreateStore.getState()
    s.setIntent('image'); s.setCloudImageModel('flux-schnell'); s.setCloudImageCount(3); s.setSeed(100)
    await useCloudCreate().generate()
    expect(submitted[0].params.seed).toBe(100)
    const seeds = Object.fromEntries(useCreateStore.getState().gallery.map((g) => [g.jobId, g.seed]))
    expect(seeds).toEqual({ 'job-0': 100, 'job-1': 101, 'job-2': 102 })
  })

  it('Bearbeiten kennt die Anzahl auch, und das Quellbild geht nur einmal hoch', async () => {
    const s = useCreateStore.getState()
    s.setIntent('edit'); s.setCloudImageModel('qwen-image-2.1-edit'); s.setCloudImageCount(2)
    useCreateStore.setState({ source: BILD })
    await useCloudCreate().generate()
    expect(submitted[0].params.count).toBe(2)
    expect(hochgeladen.filter((x) => x === 'source')).toHaveLength(1)
    expect(useCreateStore.getState().gallery).toHaveLength(2)
  })

  it('jede andere Unterkategorie startet ohne Anzahl, auch wenn sie im Speicher steht', async () => {
    const s = useCreateStore.getState()
    s.setCloudImageCount(4)
    s.setIntent('video'); s.setCloudVideoModel('wan-2.2-720p')
    await useCloudCreate().generate()
    expect(submitted[0].params.count).toBeUndefined()
  })

  it('der bestaetigte Preis und der Deckel gelten je Bild', async () => {
    const s = useCreateStore.getState()
    s.setIntent('image'); s.setCloudImageModel('qwen-image-2.1'); s.setCloudImageCount(3)
    useCreateStore.setState({ cloudStudioCredits: 5000 })
    await useCloudCreate().generate()
    expect(submitted[0].params.max_credits).toBe(5000)
    expect(submitted[0].params.count).toBe(3)
  })

  it('ein hoeherer bestaetigter Preis je Bild haelt den ganzen Lauf an, bevor etwas gebucht wird', async () => {
    hoisted.quote.mockResolvedValueOnce({ credits: 9000 })
    const s = useCreateStore.getState()
    s.setIntent('image'); s.setCloudImageModel('qwen-image-2.1'); s.setCloudImageCount(3)
    useCreateStore.setState({ cloudStudioCredits: 5000 })
    await useCloudCreate().generate()
    expect(submitted).toHaveLength(0)
    expect(useCreateStore.getState().error).toMatch(/price changed/i)
  })

  it('reicht das Guthaben nur fuer zwei, landen zwei und die Meldung nennt es', async () => {
    plan.booked = 2; plan.stopped = 'credits_exhausted'
    const s = useCreateStore.getState()
    s.setIntent('image'); s.setCloudImageModel('flux-schnell'); s.setCloudImageCount(4)
    await useCloudCreate().generate()
    expect(useCreateStore.getState().gallery).toHaveLength(2)
    expect(useCreateStore.getState().error).toMatch(/Started 2 of 4 images/)
    expect(useCreateStore.getState().error).toMatch(/not enough credits/)
  })

  it('scheitert ein Bild, kommen die anderen an und die Meldung sagt, dass es erstattet ist', async () => {
    plan.outcome = { 'job-1': 'failed' }
    const s = useCreateStore.getState()
    s.setIntent('image'); s.setCloudImageModel('flux-schnell'); s.setCloudImageCount(3)
    await useCloudCreate().generate()
    expect(useCreateStore.getState().gallery.map((g) => g.jobId).sort()).toEqual(['job-0', 'job-2'])
    expect(useCreateStore.getState().error).toMatch(/1 of 3 images failed/)
    expect(useCreateStore.getState().error).toMatch(/refunded/)
  })

  it('ein Server ohne Anzahl bucht ein Bild: genau das landet und der Kunde erfaehrt es', async () => {
    plan.oldServer = true
    const s = useCreateStore.getState()
    s.setIntent('image'); s.setCloudImageModel('flux-schnell'); s.setCloudImageCount(3)
    await useCloudCreate().generate()
    expect(useCreateStore.getState().gallery).toHaveLength(1)
    expect(useCreateStore.getState().error).toMatch(/one image per run/)
  })

  it('Cancel bricht jeden Auftrag des Laufs einzeln ab', async () => {
    plan.booked = 3
    const s = useCreateStore.getState()
    s.setIntent('image'); s.setCloudImageModel('flux-schnell'); s.setCloudImageCount(3)
    const hook = useCloudCreate()
    // Der Lauf haelt im Poll an, bis Cancel kommt: wir rufen cancel mitten drin.
    const api = await import('../../api/cloud/jobs')
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    vi.mocked(api.pollJob).mockImplementation(async (id: string) => {
      await gate
      return { id, kind: 'image', model: 'x', status: 'canceled', result_url: null, error: null, created_at: '', params: {} } as never
    })
    const run = hook.generate()
    await vi.waitFor(() => expect(submitted).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 0))
    await hook.cancel()
    release()
    await run
    expect(abgebrochen.sort()).toEqual(['job-0', 'job-1', 'job-2'])
  })
})

describe('mehrere Fotos aus der Referenzleiste', () => {
  it('Bearbeiten: das Standbild ist das erste Foto, die Leiste liefert die weiteren in Reihenfolge', async () => {
    const s = useCreateStore.getState()
    s.setIntent('edit'); s.setCloudImageModel('qwen-image-2.1-edit')
    useCreateStore.setState({ source: BILD, references: [FOTO(1), FOTO(2), FOTO(3)] })
    await useCloudCreate().generate()
    expect(submitted[0].params.image_paths).toEqual([
      'user-1/staged-source-1.png', 'user-1/staged-source-2.png', 'user-1/staged-source-3.png', 'user-1/staged-source-4.png',
    ])
    expect(submitted[0].params.source_path).toBeUndefined()
    // Die bestaetigte Zahl fragt mit allen Fotos.
    expect((hoisted.quote.mock.calls[0][2] as { image_paths: string[] }).image_paths).toHaveLength(4)
  })

  it('Animate mit Referenzmodell: bis zur Grenze, hier fuenf Fotos', async () => {
    const s = useCreateStore.getState()
    s.setIntent('animate'); s.setCloudVideoModel('minimax-h3-ref')
    useCreateStore.setState({ source: BILD, references: [FOTO(1), FOTO(2), FOTO(3), FOTO(4)] })
    await useCloudCreate().generate()
    expect((submitted[0].params.image_paths as string[])).toHaveLength(5)
  })

  it('ein Modell mit kleiner Grenze bekommt nicht mehr, als es liest', async () => {
    const s = useCreateStore.getState()
    s.setIntent('edit'); s.setCloudImageModel('qwen-image-3-edit')
    useCreateStore.setState({ source: BILD, references: [FOTO(1), FOTO(2), FOTO(3)] })
    await useCloudCreate().generate()
    expect((submitted[0].params.image_paths as string[])).toHaveLength(3)
    expect(hochgeladen).toHaveLength(3)
  })

  it('ohne Leistenfotos bleibt es bei dem einen Standbild, wie bisher', async () => {
    const s = useCreateStore.getState()
    s.setIntent('edit'); s.setCloudImageModel('qwen-image-2.1-edit')
    useCreateStore.setState({ source: BILD, references: [] })
    await useCloudCreate().generate()
    expect(submitted[0].params.image_paths).toEqual(['user-1/staged-source-1.png'])
  })

  it('Fotos aus einer anderen Unterkategorie gehen nie mit', async () => {
    const s = useCreateStore.getState()
    s.setIntent('upscale')
    useCreateStore.setState({ source: BILD, references: [FOTO(1)] })
    await useCloudCreate().generate()
    expect(submitted[0].params.image_paths).toBeUndefined()
  })

  it('die Fotos gehen als eigene Pfade, nie als Adresse', async () => {
    const s = useCreateStore.getState()
    s.setIntent('edit'); s.setCloudImageModel('qwen-image-2.1-edit')
    useCreateStore.setState({ source: BILD, references: [FOTO(1)] })
    await useCloudCreate().generate()
    for (const p of submitted[0].params.image_paths as string[]) expect(p).not.toMatch(/^https?:|^data:/)
  })
})

// D9 (3.0.7): der Eintrag haelt fest, was der Lauf geschickt hat. Die Galerie
// zeigt Schritte, CFG und negativen Prompt (lib/render/run-settings.ts), und
// ein Lauf, der sie nicht schickte, darf sie nicht mitbringen.
describe('was der Galerie-Eintrag ueber die Regler sagt', () => {
  beforeEach(async () => {
    // Der Abbruch-Test weiter oben haelt pollJob an; hier wird wieder fertig.
    const api = await import('../../api/cloud/jobs')
    vi.mocked(api.pollJob).mockImplementation(async (id: string) => ({
      id, kind: 'image', model: 'flux-schnell', status: 'succeeded',
      result_url: `https://storage.example/${id}.png`, error: null, created_at: '', params: {},
    }) as never)
  })

  it('ein klassischer Lauf schreibt Schritte, CFG, Sampler und negativen Prompt, wie sie gingen', async () => {
    const s = useCreateStore.getState()
    s.setIntent('image'); s.setCloudImageModel('flux-schnell')
    s.setSteps(13); s.setCfgScale(4); s.setNegativePrompt('blurry')
    await useCloudCreate().generate()
    expect(useCreateStore.getState().error).toBeNull()
    expect(submitted[0].params).toMatchObject({ steps: 13, cfg: 4, negative_prompt: 'blurry' })
    const entry = useCreateStore.getState().gallery[0]
    expect(entry.steps).toBe(13)
    expect(entry.cfgScale).toBe(4)
    expect(entry.negativePrompt).toBe('blurry')
  })

  it('ein Lauf ohne die Regler (Freistellen) schreibt keine', async () => {
    useCreateStore.setState({ source: BILD })
    const s = useCreateStore.getState()
    s.setIntent('removebg')
    s.setSteps(13); s.setCfgScale(4); s.setNegativePrompt('blurry')
    await useCloudCreate().generate()
    expect(submitted[0].params.steps).toBeUndefined()
    const entry = useCreateStore.getState().gallery[0]
    expect(entry.steps).toBe(0)
    expect(entry.cfgScale).toBe(0)
    expect(entry.sampler).toBe('')
    expect(entry.negativePrompt).toBe('')
  })
})
