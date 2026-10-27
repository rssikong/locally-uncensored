/**
 * "My computer" (R53): the run from the tap to the gallery, the job book
 * across a restart, the prompt check before anything leaves, cancel.
 * Against fakeDesktop (sealed + create) through the stand in of Rust.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import { installContentPolicyCap } from '../../../../lib/content-policy-cap'
import { useCreateStore } from '../../../../stores/createStore'
import { createRemoteClientStore, type RemoteClientStore } from '../../../remote/remoteClientStore'
import type { RemoteFetch } from '../../../remote/remoteClient'
import { createMemoryTokenVault } from '../../../remote/tokenVault'
import { startFakeDesktop, type FakeDesktop } from '../../../remote/__tests__/fakeDesktop'
import { createFakeSealedPhone } from '../../../remote/__tests__/fakeSealed'
import { __memoryShelfForTests, __setMediaShelfForTests, getComputerMedia, isComputerItem } from '../parts/computer-media'
import {
  COMPUTER_JOBS_KEY,
  __resetComputerRunForTests,
  cancelComputerJob,
  checkComputerPrompt,
  computerBook,
  installComputerRun,
  resumeComputerJobs,
  startComputerJob,
  useComputerRun,
} from '../parts/computer-run'
import { jobBodyOf, summaryOf } from '../parts/computer-form'
import { withUploads } from '../parts/computer-run'
import { __setAgentCreateForTests, runAgentCreate } from '../parts/computer-agent'
import { readCapabilities } from '../../../remote/desktopCreate'

const NET = 'https://quiet-river-lamp.trycloudflare.com'

// The book lives in localStorage; node has none.
if (typeof globalThis.localStorage === 'undefined') {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
    },
  })
}

function memoryStorage(): StateStorage {
  const data = new Map<string, string>()
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) }
}

let desk: FakeDesktop | null = null
let uninstallCap: (() => void) | null = null

beforeEach(() => {
  __resetComputerRunForTests()
  __setMediaShelfForTests(__memoryShelfForTests())
  useCreateStore.setState({ gallery: [] })
})

afterEach(async () => {
  __resetComputerRunForTests()
  uninstallCap?.()
  uninstallCap = null
  await desk?.stop()
  desk = null
})

async function rig(): Promise<{ store: RemoteClientStore; desk: FakeDesktop; plain: string[] }> {
  desk = await startFakeDesktop({ sealed: true, create: true })
  const d = desk
  const plain: string[] = []
  const toDesk = (url: string) => {
    const u = new URL(url)
    if (u.origin !== NET) throw new TypeError('unknown host')
    return `${d.url}${u.pathname}${u.search}`
  }
  const fetchPlain: RemoteFetch = async (url, init) => {
    plain.push(`${init?.method ?? 'GET'} ${url}`)
    return fetch(toDesk(url), init)
  }
  const phone = createFakeSealedPhone(async (url, body) => {
    const res = await fetch(toDesk(url), { method: 'POST', body: Buffer.from(body) })
    return { status: res.status, body: new Uint8Array(await res.arrayBuffer()) }
  })
  const store = createRemoteClientStore({
    storage: memoryStorage(),
    vault: createMemoryTokenVault(),
    autoResume: false,
    persistWaitMs: 60_000,
    fetch: fetchPlain,
    sealed: { invoke: phone.invoke },
    pairPollMs: 5,
    pairWaitMs: 2_000,
  })
  await store.ready
  await store.useStore.getState().connect(d.sealed!.qrLink({ net: NET }))
  d.sealed!.devices.get(phone.deviceId)!.rights.add('create')
  await store.useStore.getState().verifyConnection()
  installComputerRun({ channel: () => store.useStore.getState().desktopChannel(), pollMs: 5 })
  return { store, desk: d, plain }
}

async function until(fn: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('a job on the computer', () => {
  it('from the tap to the gallery: no price, bytes kept on the phone, book empty after', async () => {
    const r = await rig()
    r.desk.create!.imageBytes = 2000
    const ok = await startComputerJob({ media: 'image', body: { kind: 'image', prompt: 'a lighthouse at dusk', count: 2 }, modelName: 'FLUX.1 schnell', uploadLimit: 1e6 })
    expect(ok).toBe(true)
    // Written before the request left.
    expect(computerBook().length).toBe(1)
    expect(computerBook()[0].body.client_request_id).toMatch(/^lu-phone-/)
    await until(() => useComputerRun.getState().view === 'result')
    const run = useComputerRun.getState()
    expect(run.resultIds.length).toBe(2)
    const items = useCreateStore.getState().gallery
    expect(items.length).toBe(2)
    expect(items.every(isComputerItem)).toBe(true)
    expect(items[0]).toMatchObject({ type: 'image', model: 'FLUX.1 schnell', prompt: 'a lighthouse at dusk', filename: '' })
    expect(items[0].jobId).toBeUndefined()
    expect(items[0].remoteUrl).toBeUndefined()
    expect(await getComputerMedia(items[0].id)).not.toBeNull()
    expect(computerBook()).toEqual([])
    for (const call of r.plain) expect(call).toBe(`GET ${NET}/remote-api/status`)
  })

  it('a restart between the tap and the answer: the same client_request_id again, one job only', async () => {
    const r = await rig()
    r.desk.create!.imageBytes = 500
    // The book of the app that went away: the request had left, the answer never arrived.
    const ch = r.store.useStore.getState().desktopChannel()!
    const crid = 'lu-phone-restart'
    const { createJob } = await import('../../../remote/desktopCreate')
    await createJob(ch, { kind: 'image', prompt: 'kept', client_request_id: crid })
    localStorage.setItem(
      COMPUTER_JOBS_KEY,
      JSON.stringify([{ crid, desktopId: ch.pin.desktopId, jobId: null, media: 'image', body: { kind: 'image', prompt: 'kept', client_request_id: crid }, modelName: 'FLUX.1 schnell', createdAt: 1, landed: [] }]),
    )
    expect(resumeComputerJobs()).toBe(1)
    await until(() => useComputerRun.getState().view === 'result')
    expect(r.desk.create!.jobs.length).toBe(1)
    expect(r.desk.create!.bodies.filter((b) => b.client_request_id === crid).length).toBe(2)
    expect(useCreateStore.getState().gallery.length).toBe(1)
  })

  it('a failed job says the computer\'s words, a cancelled one ends on the computer', async () => {
    const r = await rig()
    r.desk.create!.failNext = 'The model ran out of memory on the computer.'
    await startComputerJob({ media: 'image', body: { kind: 'image', prompt: 'x' }, modelName: 'A', uploadLimit: 1e6 })
    await until(() => useComputerRun.getState().view === 'failed')
    expect(useComputerRun.getState().error?.message).toBe('The model ran out of memory on the computer.')

    __resetComputerRunForTests()
    installComputerRun({ channel: () => r.store.useStore.getState().desktopChannel(), pollMs: 5 })
    r.desk.create!.pollsToDone = 1000
    await startComputerJob({ media: 'video', body: { kind: 'video', prompt: 'waves' }, modelName: 'Wan', uploadLimit: 1e6 })
    await until(() => useComputerRun.getState().view === 'running' && useComputerRun.getState().job !== null)
    await cancelComputerJob()
    expect(r.desk.create!.cancels.length).toBe(1)
    expect(useComputerRun.getState().view).toBe('idle')
    expect(computerBook()).toEqual([])
  })

  it('429 and 403 are said as they are, nothing waits in the book', async () => {
    const r = await rig()
    r.desk.create!.enabled = false
    await startComputerJob({ media: 'image', body: { kind: 'image', prompt: 'x' }, modelName: 'A', uploadLimit: 1e6 })
    await until(() => useComputerRun.getState().view === 'failed')
    expect(useComputerRun.getState().error?.code).toBe('forbidden')
    expect(computerBook()).toEqual([])
  })

  it('an image to image job sends the start image first', async () => {
    const r = await rig()
    r.desk.create!.imageBytes = 300
    // Signature and IHDR of a 64 x 64 PNG: the phone reads the size before it sends.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 64, 0, 0, 0, 64, 8, 6, 0, 0, 0])
    await startComputerJob({ media: 'image', body: { kind: 'image-to-image', prompt: 'as a painting' }, modelName: 'SDXL', image: png, uploadLimit: 1e6 })
    await until(() => useComputerRun.getState().view === 'result')
    expect(r.desk.create!.uploads.length).toBe(1)
    expect(r.desk.create!.bodies[0].input_id).toBe(r.desk.create!.uploads[0].id)
  })
})

describe('the prompt check before anything leaves', () => {
  it('play (cap soft) refuses pornography before anything leaves; open keeps only the floor', async () => {
    const r = await rig()
    uninstallCap = installContentPolicyCap(() => 'soft')
    expect(checkComputerPrompt('explicit hardcore porn').blocked).toBe(true)
    const ok = await startComputerJob({ media: 'image', body: { kind: 'image', prompt: 'explicit hardcore porn' }, modelName: 'A', uploadLimit: 1e6 })
    expect(ok).toBe(false)
    expect(useComputerRun.getState().blocked).toBeTruthy()
    expect(r.desk.create!.bodies).toEqual([])
    expect(computerBook()).toEqual([])
    uninstallCap()
    uninstallCap = null
    // Without a cap (open build) the floor that holds in every build, nothing more.
    expect(checkComputerPrompt('explicit hardcore porn').blocked).toBe(false)
    expect(checkComputerPrompt('child porn').blocked).toBe(true)
    expect(checkComputerPrompt('a lighthouse at dusk').blocked).toBe(false)
  })
})

describe('the form', () => {
  it('sends only named fields inside their limits; the summary has no price', () => {
    const caps = readCapabilities({
      tool: 'comfyui',
      kinds: [{ kind: 'image', available: true, models: [{ id: 'm1', name: 'Model one' }], schema: { properties: { negative: { type: 'string' }, width: { type: 'integer', minimum: 256, maximum: 2048, multipleOf: 8, default: 1024 }, height: { type: 'integer', minimum: 256, maximum: 2048, multipleOf: 8, default: 1024 }, count: { type: 'integer', minimum: 1, maximum: 4 } } } }],
    })
    const info = caps.kinds[0]
    const body = jobBodyOf('image', info, { models: {}, values: { width: 5000, height: 513, count: 9, steps: 20 }, negative: ' blur ' }, ' a fox ')
    expect(body).toEqual({ kind: 'image', prompt: 'a fox', model: 'm1', negative: 'blur', width: 2048, height: 512, count: 4 })
    const line = summaryOf(info, { models: {}, values: {} }, 'image').join(' ')
    expect(line).toBe('Model one 1024x1024')
    expect(line).not.toMatch(/credit|price|\$|€|second|minute/i)
  })
})

describe('A17: the whole tool row on the computer', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 64, 0, 0, 0, 64, 8, 6, 0, 0, 0])

  it('edit: every reference and the mask go up first, the body names them in order', async () => {
    const r = await rig()
    r.desk.create!.v2 = true
    r.desk.create!.imageBytes = 300
    await r.store.useStore.getState().verifyConnection()
    await startComputerJob({ media: 'image', tool: 'edit', body: { kind: 'edit', prompt: 'make the sky purple' }, modelName: 'Qwen Image Edit', images: [png, png, png], mask: png, uploadLimit: 1e6 })
    await until(() => useComputerRun.getState().view === 'result')
    const ups = r.desk.create!.uploads.map((u) => u.id)
    expect(ups.length).toBe(4)
    expect(r.desk.create!.bodies[0]).toMatchObject({ kind: 'edit', input_ids: ups.slice(0, 3), mask_id: ups[3] })
    expect(r.desk.create!.bodies[0].input_id).toBeUndefined()
    expect(useCreateStore.getState().gallery[0]).toMatchObject({ type: 'image', intent: 'edit' })
  })

  it('music: a track lands as audio in the gallery; upscale sends one input_id with its factor', async () => {
    const r = await rig()
    r.desk.create!.v2 = true
    r.desk.create!.musicBytes = 2000
    r.desk.create!.imageBytes = 300
    await r.store.useStore.getState().verifyConnection()
    await startComputerJob({ media: 'audio', tool: 'music', body: { kind: 'music', prompt: 'calm piano', lyrics: 'la', duration: 20 }, modelName: 'ACE-Step', uploadLimit: 1e6 })
    await until(() => useComputerRun.getState().view === 'result')
    const track = useCreateStore.getState().gallery[0]
    expect(track).toMatchObject({ type: 'audio', intent: 'music', width: 0, height: 0 })
    expect((await getComputerMedia(track.id))?.type).toBe('audio/wav')
    useComputerRun.setState({ view: 'idle' })
    await startComputerJob({ media: 'image', tool: 'upscale', body: { kind: 'upscale', prompt: '', factor: 4 }, modelName: '', images: [png], uploadLimit: 1e6 })
    await until(() => useComputerRun.getState().view === 'result')
    expect(r.desk.create!.bodies[1]).toMatchObject({ kind: 'upscale', input_id: r.desk.create!.uploads[0].id, factor: 4 })
  })

  it('a kind the computer cannot run now: its reason, nothing waits in the book', async () => {
    const r = await rig()
    r.desk.create!.v2 = true
    r.desk.create!.unavailable.music = 'No music model is installed on your computer.'
    await r.store.useStore.getState().verifyConnection()
    await startComputerJob({ media: 'audio', tool: 'music', body: { kind: 'music', prompt: 'x' }, modelName: '', uploadLimit: 1e6 })
    await until(() => useComputerRun.getState().view === 'failed')
    expect(useComputerRun.getState().error).toEqual({ code: 'unavailable', message: 'No music model is installed on your computer.' })
    expect(computerBook()).toEqual([])
  })

  it('withUploads: edit takes a list, every other kind one input_id', () => {
    expect(withUploads({ kind: 'edit', prompt: 'x' }, ['a', 'b'], 'm')).toEqual({ kind: 'edit', prompt: 'x', input_ids: ['a', 'b'], mask_id: 'm' })
    expect(withUploads({ kind: 'image-to-image', prompt: 'x' }, ['a'], 'm')).toEqual({ kind: 'image-to-image', prompt: 'x', input_id: 'a' })
    expect(withUploads({ kind: 'image', prompt: 'x' }, [], undefined)).toEqual({ kind: 'image', prompt: 'x' })
  })

  it('the body carries character, lyrics, duration and factor only when the computer names them', () => {
    const caps = readCapabilities({
      kinds: [
        { kind: 'image', available: true, models: [{ id: 'm', name: 'M' }], schema: { properties: { character: { type: 'string', enum: ['chr_mia'] } } } },
        { kind: 'music', available: true, models: [{ id: 'a', name: 'A' }], schema: { properties: { duration: { type: 'integer', minimum: 10, maximum: 240 } } } },
        { kind: 'upscale', available: true, models: [], schema: { properties: { factor: { type: 'integer', enum: [2, 4] } } } },
      ],
    })
    const form = { models: {}, values: { duration: 999, factor: 3 }, negative: '', character: 'chr_mia', lyrics: ' la la ' }
    expect(jobBodyOf('image', caps.kinds[0], form, 'a portrait')).toEqual({ kind: 'image', prompt: 'a portrait', model: 'm', character: 'chr_mia' })
    expect(jobBodyOf('image', caps.kinds[0], { ...form, character: 'chr_gone' }, 'a portrait').character).toBeUndefined()
    expect(jobBodyOf('music', caps.kinds[1], form, 'calm')).toEqual({ kind: 'music', prompt: 'calm', model: 'a', lyrics: 'la la', duration: 240 })
    // 3 is not one of the factors: the computer's default stands.
    expect(jobBodyOf('upscale', caps.kinds[2], form, '')).toEqual({ kind: 'upscale', prompt: '' })
    expect(jobBodyOf('upscale', caps.kinds[2], { ...form, values: { factor: 4 } }, '')).toEqual({ kind: 'upscale', prompt: '', factor: 4 })
  })
})

describe('A17: image_generate and video_generate of the remote agent', () => {
  it('runs a job on the computer, brings the image into the gallery and hands it to the step', async () => {
    const r = await rig()
    r.desk.create!.imageBytes = 400
    __setAgentCreateForTests({ pollMs: 5, channel: () => r.store.useStore.getState().desktopChannel() })
    const out = await runAgentCreate('image_generate', { prompt: 'a red fox', negativePrompt: 'blur' })
    expect(out.ok).toBe(true)
    expect(out.observation).toContain("created on the user's computer")
    expect(out.media).toHaveLength(1)
    expect(out.media![0]).toMatchObject({ kind: 'image', mime: 'image/png' })
    expect(useCreateStore.getState().gallery[0]).toMatchObject({ id: out.media![0].id, type: 'image', prompt: 'a red fox' })
    expect(await getComputerMedia(out.media![0].id)).not.toBeNull()
    expect(r.desk.create!.bodies[0]).toMatchObject({ kind: 'image', prompt: 'a red fox', negative: 'blur', model: 'flux1-schnell.safetensors' })
    for (const call of r.plain) expect(call).toBe(`GET ${NET}/remote-api/status`)
  })

  it('a refused prompt never leaves; stopping cancels the job on the computer', async () => {
    const r = await rig()
    __setAgentCreateForTests({ pollMs: 5, channel: () => r.store.useStore.getState().desktopChannel() })
    expect((await runAgentCreate('image_generate', { prompt: 'child porn' })).ok).toBe(false)
    expect(r.desk.create!.bodies).toEqual([])
    r.desk.create!.pollsToDone = 10_000
    const ctrl = new AbortController()
    const running = runAgentCreate('video_generate', { prompt: 'waves at night' }, ctrl.signal)
    await until(() => r.desk.create!.jobs.length === 1 && r.desk.create!.jobs[0].state === 'running')
    ctrl.abort()
    const out = await running
    expect(out).toMatchObject({ ok: false, observation: 'Error: stopped by the user.' })
    await until(() => r.desk.create!.cancels.length === 1)
  })
})
