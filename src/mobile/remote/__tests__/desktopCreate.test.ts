/**
 * "My computer" (R53): the Create routes of the desktop through the sealed
 * channel, against fakeDesktop with `sealed` and `create` and the stand in
 * of the Rust commands (fakeSealed.ts). Paths, codes and fields are the ones
 * of the desktop (`feat/307-remote`, remote_create.rs).
 */
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import { createRemoteClientStore, type DesktopChannel, type RemoteClientStore } from '../remoteClientStore'
import {
  CAPABILITIES_EVERY_MS,
  COMPUTER_TEXT,
  ComputerCreateError,
  UPLOAD_LIMITS,
  UPLOAD_TEXT,
  __resetCapabilitiesForTests,
  checkUploads,
  desktopSentence,
  imageSize,
  cancelJob,
  computerOffers,
  createJob,
  errorOfAnswer,
  fetchResult,
  getCapabilities,
  getJob,
  imageMime,
  kindFor,
  readCapabilities,
  readJob,
  uploadImage,
  listGallery,
  getGalleryEntry,
  fetchGalleryThumb,
  fetchGalleryFile,
  readGalleryItem,
} from '../desktopCreate'
import { seedFakeGallery } from './fakeDesktopCreate'
import type { RemoteFetch } from '../remoteClient'
import { createMemoryTokenVault } from '../tokenVault'
import { startFakeDesktop, type FakeDesktop } from './fakeDesktop'
import { createFakeSealedPhone, type FakeSealedPhone } from './fakeSealed'

const NET = 'https://quiet-river-lamp.trycloudflare.com'
const LAN = 'http://192.168.1.20:11435'

function memoryStorage(): StateStorage {
  const data = new Map<string, string>()
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) }
}

let desk: FakeDesktop | null = null
afterEach(async () => {
  await desk?.stop()
  desk = null
  __resetCapabilitiesForTests()
})

export interface CreateRig {
  store: RemoteClientStore
  phone: FakeSealedPhone
  desk: FakeDesktop
  plain: string[]
  channel: () => DesktopChannel
}

/** Paired over the QR code (internet), Create on for this phone unless `right: false`. */
async function rig(opts: { right?: boolean; via?: 'net' | 'lan' } = {}): Promise<CreateRig> {
  desk = await startFakeDesktop({ sealed: true, create: true })
  const d = desk
  const plain: string[] = []
  const toDesk = (url: string) => {
    const u = new URL(url)
    if (u.origin !== LAN && u.origin !== NET) throw new TypeError('unknown host')
    return `${d.url}${u.pathname}${u.search}`
  }
  const fetchPlain: RemoteFetch = async (url, init) => {
    plain.push(`${init?.method ?? 'GET'} ${url}`)
    return fetch(toDesk(url), init)
  }
  const phone = createFakeSealedPhone(async (url, body) => {
    const res = await fetch(toDesk(url), { method: 'POST', body: Buffer.from(body), headers: { 'content-type': 'application/octet-stream' } })
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
  await store.useStore.getState().connect(d.sealed!.qrLink(opts.via === 'lan' ? { lan: LAN } : { net: NET }))
  expect(store.useStore.getState().status).toBe('connected')
  if (opts.right !== false) d.sealed!.devices.get(phone.deviceId)!.rights.add('create')
  await store.useStore.getState().verifyConnection()
  return {
    store,
    phone,
    desk: d,
    plain,
    channel: () => {
      const ch = store.useStore.getState().desktopChannel()
      if (!ch) throw new Error('no channel')
      return ch
    },
  }
}

/** Signature and IHDR of a PNG of this size: enough for the phone to read the size before it sends. */
function pngHead(w: number, h: number): Uint8Array {
  const be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be(w), ...be(h), 8, 6, 0, 0, 0])
}
const PNG = pngHead(64, 48)

describe('pure parts', () => {
  it('kinds, features and image types', () => {
    expect([kindFor('image', false), kindFor('image', true), kindFor('video', false), kindFor('video', true)]).toEqual(['image', 'image-to-image', 'video', 'image-to-video'])
    expect(computerOffers(['sealed', 'pending'])).toBe(false)
    expect(computerOffers(['sealed', 'create-video'], 'video')).toBe(true)
    expect(computerOffers(['sealed', 'create-video'], 'image')).toBe(false)
    expect(imageMime(PNG)).toBe('image/png')
    expect(imageMime(new Uint8Array([0xff, 0xd8, 0xff, 0]))).toBe('image/jpeg')
    expect(imageMime(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('reads capabilities bounded: never an upload larger than one sealed message', () => {
    const c = readCapabilities({ tool: 'mlx', kinds: [{ kind: 'image', available: true, models: [{ id: 'a', name: 'A' }], schema: { properties: { width: { type: 'integer', minimum: 256 } } } }, { kind: 'nonsense' }], limits: { max_upload_bytes: 20 * 1024 * 1024 } })
    expect(c.kinds.map((k) => k.kind)).toEqual(['image'])
    expect(c.limits.maxUploadBytes).toBe(8 * 1024 * 1024 - 64 * 1024)
    expect(c.kinds[0].fields[0]).toMatchObject({ key: 'width', type: 'integer', minimum: 256 })
  })

  it('reads a job and refuses what is not one', () => {
    expect(() => readJob({ id: '../x', state: 'done' })).toThrow(ComputerCreateError)
    const j = readJob({ id: `job_${'a'.repeat(32)}`, state: 'running', progress: 7, step_text: 'Sampling\n3/30', results: [{ id: 'res_bad' }] })
    expect(j.progress).toBe(1)
    expect(j.stepText).toBe('Sampling 3/30')
    expect(j.results).toEqual([])
  })

  it('every refusal has its own sentence', () => {
    expect(errorOfAnswer(403, { error: 'forbidden', right: 'create' }).code).toBe('forbidden')
    expect(errorOfAnswer(403, { error: 'Create is off ...', permission: 'create', needs_permission: true }).message).toBe(COMPUTER_TEXT.forbidden)
    expect(errorOfAnswer(429, { error: '4 jobs are already waiting on this computer. Try again when one has finished.' }).code).toBe('busy')
    expect(errorOfAnswer(404, null, 'capabilities').code).toBe('too-old')
    expect(errorOfAnswer(503, { error: 'x' }).code).toBe('not-answering')
    expect(errorOfAnswer(400, { error: 'An image needs a prompt.' }).message).toBe('An image needs a prompt.')
  })
})

describe('sentences and limits of the computer (Desktop f72041dab)', () => {
  it('the field error is shown as the sentence it is: control characters out, about 200 characters, never a bare code', () => {
    expect(desktopSentence('This phone has too many images waiting on this computer.\u0007\u202e')).toBe('This phone has too many images waiting on this computer.')
    expect(desktopSentence('rate_limited')).toBe('')
    const long = `${'word '.repeat(80)}end.`
    const cut = desktopSentence(long)
    expect(cut.length).toBeLessThanOrEqual(200)
    expect(cut.endsWith('...')).toBe(true)
    expect(errorOfAnswer(400, { error: long }).message.length).toBeLessThanOrEqual(200)
    expect(errorOfAnswer(429, { error: 'rate_limited' }).message).toBe(COMPUTER_TEXT.busy)
    expect(readJob({ id: `job_${'b'.repeat(32)}`, state: 'failed', error: `The generation failed.\n${'x'.repeat(400)}` }).error.length).toBeLessThanOrEqual(200)
  })

  it('reads the size of PNG, JPEG and WebP from the header', () => {
    expect(imageSize(pngHead(640, 480))).toEqual({ width: 640, height: 480 })
    // JPEG: SOI, APP0 (len 4), SOF0 with height 300, width 500.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x01, 0x2c, 0x01, 0xf4, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(imageSize(jpeg)).toEqual({ width: 500, height: 300 })
    // WebP VP8X: canvas 4096 x 4097 (stored minus one, 24 bit little endian).
    const webp = new Uint8Array(30)
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58])
    webp.set([0xff, 0x0f, 0x00, 0x00, 0x10, 0x00], 24)
    expect(imageSize(webp)).toEqual({ width: 4096, height: 4097 })
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('8 images, 64 MB together, 4096 pixels a side, one sealed message each', () => {
    const ok = pngHead(4096, 4096)
    expect(checkUploads([ok], 1e6)).toBeNull()
    expect(checkUploads(Array.from({ length: UPLOAD_LIMITS.maxFiles + 1 }, () => ok), 1e6)?.message).toBe(UPLOAD_TEXT.tooMany)
    const big = new Uint8Array(9 * 1024 * 1024)
    big.set(pngHead(100, 100))
    expect(checkUploads(Array.from({ length: 8 }, () => big), 10 * 1024 * 1024)?.message).toBe(UPLOAD_TEXT.tooMuch)
    expect(checkUploads([big], 8 * 1024 * 1024)?.message).toBe(COMPUTER_TEXT.tooLarge)
    expect(checkUploads([pngHead(100, 5000)], 1e6)?.message).toBe(UPLOAD_TEXT.tooWide)
  })
})

describe('through the sealed channel', () => {
  it('capabilities, upload, job, progress, result in pieces with SHA-256; nothing in plain text', async () => {
    const r = await rig()
    expect(r.store.useStore.getState().features).toEqual(expect.arrayContaining(['create-image', 'create-video', 'signin']))
    const caps = await getCapabilities(r.channel())
    expect(caps.tool).toBe('comfyui')
    expect(caps.kinds.map((k) => k.kind)).toEqual(['image', 'image-to-image', 'video', 'image-to-video'])
    expect(caps.limits.maxUploadBytes).toBe(8 * 1024 * 1024 - 64 * 1024)

    const up = await uploadImage(r.channel(), PNG, caps.limits.maxUploadBytes)
    expect(up.id).toMatch(/^upl_[0-9a-f]{32}$/)
    expect(r.desk.create!.uploads[0].bytes).toBe(PNG.length)

    const { job, duplicate } = await createJob(r.channel(), { kind: 'image', prompt: 'a red fox', count: 1, client_request_id: 'lu-phone-1' })
    expect(duplicate).toBe(false)
    expect(job.state).toBe('queued')
    let j = job
    for (let i = 0; i < 5 && j.state !== 'done'; i++) j = await getJob(r.channel(), j.id)
    expect(j.state).toBe('done')
    const res = j.results[0]
    expect(res.bytes).toBeGreaterThan(4 * 1024 * 1024)
    const bytes = await fetchResult(r.channel(), res)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(res.sha256)
    // Two pieces of at most 4 MiB.
    expect(r.desk.sealed!.routed.filter((x) => x.path.startsWith('/remote-api/create/results/')).length).toBe(2)

    // WAECHTER: over the internet only the bare status went in plain text; Create only inside the channel.
    for (const call of r.plain) expect(call).toBe(`GET ${NET}/remote-api/status`)
    expect(r.desk.log.filter((l) => l.startsWith('POST /remote-api/sealed')).length).toBeGreaterThan(5)
    for (const l of r.desk.log.filter((x) => x.includes('/remote-api/create/'))) expect(r.desk.sealed!.routed.some((x) => l === `${x.method} ${x.path.split('?')[0]}`)).toBe(true)
  })

  it('the same client_request_id gives the same job (200), no second one', async () => {
    const r = await rig()
    const a = await createJob(r.channel(), { kind: 'image', prompt: 'x', client_request_id: 'lu-phone-same' })
    const b = await createJob(r.channel(), { kind: 'image', prompt: 'x', client_request_id: 'lu-phone-same' })
    expect(b.duplicate).toBe(true)
    expect(b.job.id).toBe(a.job.id)
    expect(r.desk.create!.jobs.length).toBe(1)
  })

  it('429 with two jobs of this phone waiting (max_waiting_per_device): the sentence of the computer', async () => {
    const r = await rig()
    r.desk.create!.pollsToRun = 99
    const caps = await getCapabilities(r.channel())
    expect(caps.limits.maxWaitingPerDevice).toBe(2)
    for (let i = 0; i < 2; i++) await createJob(r.channel(), { kind: 'image', prompt: 'x', client_request_id: `c${i}` })
    const err = await createJob(r.channel(), { kind: 'image', prompt: 'x', client_request_id: 'c5' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ComputerCreateError)
    expect((err as ComputerCreateError).code).toBe('busy')
    expect((err as ComputerCreateError).message).toBe('This phone already has 2 jobs waiting on this computer. Try again when one has started.')
  })

  it('capabilities at most every 10 s per computer; stale:true is an answer like any other', async () => {
    const r = await rig()
    let t = 1_000_000
    const clock = () => t
    const a = await getCapabilities(r.channel(), undefined, clock)
    t += 4_000
    const [b, c] = await Promise.all([getCapabilities(r.channel(), undefined, clock), getCapabilities(r.channel(), undefined, clock)])
    expect(b).toBe(a)
    expect(c).toBe(a)
    expect(r.desk.create!.capsAsks.length).toBe(1)
    t += CAPABILITIES_EVERY_MS
    await getCapabilities(r.channel(), undefined, clock)
    expect(r.desk.create!.capsAsks.length).toBe(2)
    const stale = readCapabilities({ tool: 'mlx', stale: true, kinds: [{ kind: 'image', available: true, models: [{ id: 'm', name: 'M' }] }] })
    expect(stale.stale).toBe(true)
    expect(stale.kinds[0].available).toBe(true)
  })

  it('upload limits are checked before anything is sent', async () => {
    const r = await rig()
    const caps = await getCapabilities(r.channel())
    const before = r.desk.log.length
    const wide = pngHead(4097, 100)
    const e1 = await uploadImage(r.channel(), wide, caps.limits.maxUploadBytes).catch((e: unknown) => e)
    expect((e1 as ComputerCreateError).message).toBe(UPLOAD_TEXT.tooWide)
    const e2 = await uploadImage(r.channel(), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), caps.limits.maxUploadBytes).catch((e: unknown) => e)
    expect((e2 as ComputerCreateError).message).toBe(UPLOAD_TEXT.unreadable)
    // Nothing of it reached the computer.
    expect(r.desk.log.length).toBe(before)
    expect(r.desk.create!.uploads).toEqual([])
  })

  it('403: without the right of this phone, and with the switch off on the computer', async () => {
    const r = await rig({ right: false })
    expect(r.store.useStore.getState().features).not.toContain('create-image')
    const e1 = await getCapabilities(r.channel()).catch((e: unknown) => e)
    expect((e1 as ComputerCreateError).code).toBe('forbidden')
    r.desk.sealed!.devices.get(r.phone.deviceId)!.rights.add('create')
    r.desk.create!.enabled = false
    const e2 = await getCapabilities(r.channel()).catch((e: unknown) => e)
    expect((e2 as ComputerCreateError).code).toBe('forbidden')
  })

  it('cancel ends the job on the computer', async () => {
    const r = await rig()
    const { job } = await createJob(r.channel(), { kind: 'video', prompt: 'waves', client_request_id: 'v1' })
    const after = await cancelJob(r.channel(), job.id)
    expect(after.state).toBe('cancelled')
    expect(r.desk.create!.cancels).toEqual([job.id])
  })

  it('a damaged piece is refused (result_corrupt), never put into the gallery', async () => {
    const r = await rig()
    const { job } = await createJob(r.channel(), { kind: 'video', prompt: 'waves', client_request_id: 'v2' })
    let j = job
    for (let i = 0; i < 5 && j.state !== 'done'; i++) j = await getJob(r.channel(), j.id)
    r.desk.create!.corruptNext = true
    const err = await fetchResult(r.channel(), j.results[0]).catch((e: unknown) => e)
    expect((err as ComputerCreateError).code).toBe('corrupt')
  })

  it('another phone does not see this phone\'s jobs', async () => {
    const r = await rig()
    const { job } = await createJob(r.channel(), { kind: 'image', prompt: 'x', client_request_id: 'mine' })
    r.desk.create!.jobs[0].owner = 'someone-else'
    const err = await getJob(r.channel(), job.id).catch((e: unknown) => e)
    expect((err as ComputerCreateError).code).toBe('not-found')
  })

  it('no channel without a sealed pairing: a plain pairing has no desktopChannel', async () => {
    const r = await rig()
    await r.store.useStore.getState().disconnect()
    expect(r.store.useStore.getState().desktopChannel()).toBeNull()
    expect(r.store.useStore.getState().features).toEqual([])
  })
})

describe('stage 2 (A17, CREATE-V2.md)', () => {
  it('reads available, reason, characters, max_edit_inputs and the numbers of factor', () => {
    const c = readCapabilities({
      kinds: [
        { kind: 'edit', available: true, models: [{ id: 'e', name: 'E' }], schema: { properties: { prompt: { type: 'string' } } } },
        { kind: 'upscale', available: true, models: [], schema: { properties: { factor: { type: 'integer', enum: [2, 4], default: 2 } } } },
        { kind: 'music', available: false, reason: 'No music model is installed on your computer.\u202e Install one.', models: [] },
        { kind: 'removebg', available: true },
      ],
      characters: [{ id: 'chr_1', name: 'Mia', model_family: 'z-image', trigger: 'mia_lu' }, { id: 'chr_1', name: 'twice' }, { name: 'no id' }],
      limits: { max_edit_inputs: 5 },
    })
    expect(c.kinds.map((k) => [k.kind, k.available])).toEqual([['edit', true], ['upscale', true], ['music', false], ['removebg', true]])
    expect(c.kinds[2].reason).toBe('No music model is installed on your computer. Install one.')
    expect(c.kinds[1].fields[0]).toMatchObject({ key: 'factor', type: 'integer', enumNumbers: [2, 4], default: 2 })
    expect(c.characters).toEqual([{ id: 'chr_1', name: 'Mia', modelFamily: 'z-image', trigger: 'mia_lu' }])
    expect(c.limits.maxEditInputs).toBe(5)
    // A 3.0.7 computer names none of it.
    expect(readCapabilities({ kinds: [] }).limits.maxEditInputs).toBe(1)
    expect(readCapabilities({ kinds: [] }).characters).toEqual([])
  })

  it('a music result is audio with its length; 409 and unsupported_kind have their sentence', () => {
    const sha = 'b'.repeat(64)
    const j = readJob({ id: `job_${'a'.repeat(32)}`, kind: 'music', state: 'done', results: [{ id: `res_${'c'.repeat(32)}`, mime: 'audio/wav', bytes: 10, sha256: sha, duration_ms: 30000 }] })
    expect(j.kind).toBe('music')
    expect(j.results[0]).toMatchObject({ mime: 'audio/wav', durationMs: 30000, width: null })
    expect(errorOfAnswer(409, { error: 'unavailable', reason: 'No music model is installed on your computer.' })).toMatchObject({ code: 'unavailable', message: 'No music model is installed on your computer.' })
    expect(errorOfAnswer(400, { error: 'unsupported_kind' }).message).toBe(COMPUTER_TEXT.unsupported)
    expect(computerOffers(['sealed', 'create-music'])).toBe(true)
  })

  it('a gallery entry is checked: id, media, mime', () => {
    expect(readGalleryItem({ id: '../x', media: 'image', mime: 'image/png', bytes: 3 })).toBeNull()
    expect(readGalleryItem({ id: 'gal_1', media: 'image', mime: 'audio/wav', bytes: 3 })).toBeNull()
    expect(readGalleryItem({ id: 'gal_1', media: 'audio', mime: 'audio/wav', bytes: 3, created_at: 5, from_phone: true })).toMatchObject({ id: 'gal_1', media: 'audio', fromPhone: true, sha256: null })
  })

  it('edit with references and mask, upscale, removebg, music, character: through the channel', async () => {
    const r = await rig()
    r.desk.create!.v2 = true
    await r.store.useStore.getState().verifyConnection()
    expect(r.store.useStore.getState().features).toEqual(expect.arrayContaining(['create-edit', 'create-upscale', 'create-removebg', 'create-music', 'create-character', 'create-gallery']))
    const caps = await getCapabilities(r.channel())
    expect(caps.kinds.map((k) => k.kind)).toEqual(['image', 'image-to-image', 'video', 'image-to-video', 'edit', 'upscale', 'removebg', 'music'])
    expect(caps.characters[0].name).toBe('Mia')
    const a = await uploadImage(r.channel(), PNG, caps.limits.maxUploadBytes)
    const b = await uploadImage(r.channel(), PNG, caps.limits.maxUploadBytes)
    const run = async (body: Parameters<typeof createJob>[1]) => {
      let j = (await createJob(r.channel(), body)).job
      for (let i = 0; i < 6 && j.state !== 'done'; i++) j = await getJob(r.channel(), j.id)
      return j
    }
    expect((await run({ kind: 'edit', prompt: 'make it blue', input_ids: [a.id, b.id], mask_id: b.id, client_request_id: 'e1' })).state).toBe('done')
    const up = await run({ kind: 'upscale', prompt: '', input_id: a.id, factor: 4, client_request_id: 'u1' })
    expect(up.results[0].width).toBe(256)
    expect((await run({ kind: 'removebg', prompt: '', input_id: a.id, client_request_id: 'r1' })).state).toBe('done')
    const music = await run({ kind: 'music', prompt: 'calm piano', lyrics: 'la la', duration: 20, client_request_id: 'm1' })
    expect(music.results[0]).toMatchObject({ mime: 'audio/wav', durationMs: 20000 })
    const bytes = await fetchResult(r.channel(), music.results[0])
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF')
    expect((await run({ kind: 'image', prompt: 'portrait', character: 'chr_mia', client_request_id: 'c1' })).state).toBe('done')
    // Not available on the computer: 409 with its reason.
    r.desk.create!.unavailable.music = 'No music model is installed on your computer.'
    await expect(createJob(r.channel(), { kind: 'music', prompt: 'x', client_request_id: 'm2' })).rejects.toMatchObject({ code: 'unavailable', message: 'No music model is installed on your computer.' })
  })

  it('the gallery: pages, entry with sha256, thumb, file in pieces; audio has no thumb', async () => {
    const r = await rig()
    r.desk.create!.v2 = true
    r.desk.create!.imageBytes = 5 * 1024 * 1024
    seedFakeGallery(r.desk.create!)
    const big = Buffer.alloc(5 * 1024 * 1024, 7)
    r.desk.create!.gallery.push({ id: 'gal_big', media: 'image', mime: 'image/png', bytes: big, width: 10, height: 10, duration_ms: null, created_at: 1_790_000_999, prompt: 'big', model: 'm', from_phone: true, sha256: createHash('sha256').update(big).digest('hex') })
    const first = await listGallery(r.channel(), { limit: 2 })
    expect(first.items.map((i) => i.id)[0]).toBe('gal_big')
    expect(first.next).toBe(first.items[1].id)
    const second = await listGallery(r.channel(), { before: first.next, limit: 2 })
    expect(second.items.length).toBe(1)
    expect(second.next).toBeNull()
    const entry = await getGalleryEntry(r.channel(), 'gal_big')
    expect(entry.sha256).toBe(r.desk.create!.gallery[2].sha256)
    const file = await fetchGalleryFile(r.channel(), entry)
    expect(file.length).toBe(big.length)
    const thumb = await fetchGalleryThumb(r.channel(), 'gal_big')
    expect(thumb && imageMime(thumb)).toBe('image/jpeg')
    const audio = [...first.items, ...second.items].find((i) => i.media === 'audio')!
    expect(await fetchGalleryThumb(r.channel(), audio.id)).toBeNull()
    // Without a sha in the entry the header of the first piece is taken; a wrong one is refused.
    await expect(fetchGalleryFile(r.channel(), { id: 'gal_big', bytes: big.length, sha256: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'corrupt' })
    for (const call of r.plain) expect(call).toBe(`GET ${NET}/remote-api/status`)
  })
})

describe('A17: Agent mode in the remote chat makes images on the computer', () => {
  it('image_generate goes to the model only with create, runs on the phone, the step keeps the image across a restart of the state', async () => {
    const { setRemoteCreateRunner } = await import('../remoteAgent')
    const r = await rig()
    const s = () => r.store.useStore.getState()
    const media = { id: `pc_res_${'b'.repeat(32)}`, kind: 'image' as const, mime: 'image/png' }
    const asked: string[] = []
    setRemoteCreateRunner(async (tool, args) => {
      asked.push(`${tool} ${String(args.prompt)}`)
      return { ok: true, observation: 'The image was created.', media: [media] }
    })
    try {
      const chatId = s().newChat()
      s().setAgentMode(chatId, true)
      r.desk.nextToolCalls = [{ function: { name: 'image_generate', arguments: { prompt: 'a red fox' } } }]
      expect(await s().sendMessage('draw a fox')).toBe('sent')
      const answer = s().chats.find((c) => c.id === chatId)!.messages[1]
      expect(answer.steps![0]).toMatchObject({ tool: 'image_generate', state: 'done', media: [media] })
      expect(asked).toEqual(['image_generate a red fox'])
      expect(r.desk.toolCalls).toEqual([])
      const names = (r.desk.chatRequests[0].body.tools as Array<{ function: { name: string } }>).map((t) => t.function.name)
      expect(names).toContain('image_generate')
      expect(names).toContain('video_generate')

      // Without the right create the computer names no create word: no tool for the model.
      r.desk.sealed!.devices.get(r.phone.deviceId)!.rights.delete('create')
      await s().verifyConnection()
      expect(s().features).not.toContain('create-image')
      r.desk.nextToolCalls = []
      await s().sendMessage('and another one')
      const names2 = (r.desk.chatRequests.at(-1)!.body.tools as Array<{ function: { name: string } }>).map((t) => t.function.name)
      expect(names2).not.toContain('image_generate')
    } finally {
      setRemoteCreateRunner(null)
    }
  })
})
