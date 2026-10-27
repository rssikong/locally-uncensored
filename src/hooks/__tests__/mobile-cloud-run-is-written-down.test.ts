/**
 * Point 7 of the mobile groundwork, the hook side: generate(), makeVoice() and
 * enhanceVideo() write the booked job down on a phone, strike it when it
 * ended, and leave it for the resume when the wait gave up. A staged upload
 * ends with the run's Cancel. The 401 of a voice or an enhance names the next
 * step.
 *
 * The desktop twin of every assertion pins the old behaviour: no ledger, the
 * upload called with exactly its two arguments.
 *
 * Run: npx vitest run src/hooks/__tests__/mobile-cloud-run-is-written-down.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DESKTOPS, HANDHELDS, standOn } from '../../test-support/devices'

const backing = new Map<string, string>()
const localStorageShim = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
  key: (i: number) => [...backing.keys()][i] ?? null,
  get length() { return backing.size },
} as Storage
vi.stubGlobal('localStorage', localStorageShim)

vi.mock('react', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, useCallback: (fn: unknown) => fn }
})

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
  return {
    FakeCloudJobError,
    submitCloudJob: vi.fn(),
    pollJob: vi.fn(),
    getJob: vi.fn(),
    cancelJob: vi.fn(async () => ({ status: 'canceled' })),
    uploadInput: vi.fn(),
  }
})

vi.mock('../useContentPolicy', () => ({
  contentPolicySnapshot: () => 'off' as const,
  loadContentPolicy: async () => 'off' as const,
}))
vi.mock('../../api/cloud/jobs', () => ({
  uploadInput: hoisted.uploadInput,
  getJob: hoisted.getJob,
  submitCloudJob: hoisted.submitCloudJob,
  pollJob: hoisted.pollJob,
  cancelJob: hoisted.cancelJob,
  CloudJobError: hoisted.FakeCloudJobError,
  QuoteChangedError: class extends hoisted.FakeCloudJobError {},
}))
vi.mock('../../api/cloud/studio', () => ({ studioQuote: vi.fn(), StudioQuoteChangedError: class extends Error {} }))

import { useCloudCreate, SIGN_IN_TO_RENDER } from '../useCloudCreate'
import { useCreateStore } from '../../stores/createStore'
import type { GalleryItem } from '../../stores/createStore'
import { __resetPendingCloudJobsForTests, isWatchedCloudJob, pendingCloudJobs } from '../../lib/pending-cloud-jobs'
import { __resetCloudJobResumeForTests, resumePendingCloudJobs } from '../../lib/cloud-job-resume'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

function done(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, kind: 'image', model: 'z-image-turbo', status: 'succeeded', error: null,
    result_url: `https://storage.example/${id}.png`, attestation: null, created_at: new Date().toISOString(), ...extra,
  }
}
/** Polls that wait until the test lets them go. release() answers every open
 *  one with the job of its own id. */
function heldPoll() {
  const open: { id: string; resolve: (job: unknown) => void }[] = []
  hoisted.pollJob.mockImplementation((id: string) => new Promise((resolve) => { open.push({ id, resolve }) }))
  return {
    release: (job: (id: string) => unknown) => { for (const o of open.splice(0)) o.resolve(job(o.id)) },
  }
}

beforeEach(() => {
  backing.clear()
  vi.stubGlobal('localStorage', localStorageShim)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) })))
  for (const fn of [hoisted.submitCloudJob, hoisted.pollJob, hoisted.getJob, hoisted.uploadInput]) fn.mockReset()
  hoisted.submitCloudJob.mockResolvedValue({ id: 'job-1', quota: { cost: 10 } })
  hoisted.uploadInput.mockResolvedValue('inputs/source.png')
  __resetPendingCloudJobsForTests()
  __resetCloudJobResumeForTests()
  useCreateStore.setState({
    isGenerating: false, error: null, backend: 'cloud', gallery: [], source: null, mask: null,
    voiceFromJob: null, seed: 4711,
  })
  useCreateStore.getState().setIntent('image')
  useCreateStore.getState().setPrompt('a lighthouse at dusk')
})
afterEach(() => {
  __resetCloudJobResumeForTests()
  vi.unstubAllGlobals()
})

describe('a render is written down the moment it is booked', () => {
  for (const device of HANDHELDS) {
    it(`${device}: on disk while it renders, gone when it landed`, async () => {
      standOn(device)
      const poll = heldPoll()
      const run = useCloudCreate().generate()
      await vi.waitFor(() => expect(hoisted.pollJob).toHaveBeenCalled())

      const [entry] = pendingCloudJobs()
      expect(entry).toMatchObject({ id: 'job-1', kind: 'image', op: 'generate', prompt: 'a lighthouse at dusk', landing: 'gallery' })
      expect(entry.model).toBeTruthy()
      expect(Math.abs(entry.startedAt - Date.now())).toBeLessThan(5_000)
      expect(entry.deadlineAt - entry.startedAt).toBe(15 * 60_000)
      expect(isWatchedCloudJob('job-1')).toBe(true)

      poll.release((id) => done(id))
      await run
      expect(useCreateStore.getState().gallery.some((g) => g.jobId === 'job-1')).toBe(true)
      expect(pendingCloudJobs()).toEqual([])
    })
  }

  for (const device of DESKTOPS) {
    it(`DESKTOP UNCHANGED ${device}: the same run writes nothing down and lands the same`, async () => {
      standOn(device)
      const poll = heldPoll()
      const run = useCloudCreate().generate()
      await vi.waitFor(() => expect(hoisted.pollJob).toHaveBeenCalled())
      expect(pendingCloudJobs()).toEqual([])
      poll.release((id) => done(id))
      await run
      const item = useCreateStore.getState().gallery.find((g) => g.jobId === 'job-1')!
      expect(item).toMatchObject({ prompt: 'a lighthouse at dusk', seed: 4711, intent: 'image', remoteUrl: 'https://storage.example/job-1.png' })
      expect(pendingCloudJobs()).toEqual([])
    })
  }

  it('a wait that gave up leaves the job for the resume, which lands it like the live run would', async () => {
    standOn('iphone')
    hoisted.pollJob.mockRejectedValueOnce(new hoisted.FakeCloudJobError('render timed out', 0))
    await useCloudCreate().generate()
    expect(useCreateStore.getState().gallery).toEqual([])
    expect(pendingCloudJobs().map((e) => e.id)).toEqual(['job-1'])
    expect(isWatchedCloudJob('job-1')).toBe(false)

    hoisted.pollJob.mockResolvedValueOnce(done('job-1'))
    const summary = await resumePendingCloudJobs()
    expect(summary.landed).toEqual(['job-1'])
    expect(useCreateStore.getState().gallery[0]).toMatchObject({
      jobId: 'job-1', prompt: 'a lighthouse at dusk', seed: 4711, intent: 'image',
      remoteUrl: 'https://storage.example/job-1.png',
    })
    expect(pendingCloudJobs()).toEqual([])
  })

  it('a job the server refuses for good is struck at once', async () => {
    standOn('android')
    hoisted.pollJob.mockRejectedValueOnce(new hoisted.FakeCloudJobError('job not found', 404))
    await useCloudCreate().generate()
    expect(pendingCloudJobs()).toEqual([])
  })

  it('every image of a run with several gets its own entry, with its own seed', async () => {
    standOn('iphone')
    useCreateStore.setState({ cloudImageCount: 2 })
    hoisted.submitCloudJob.mockResolvedValue({
      id: 'job-a', quota: { cost: 20 },
      jobs: [{ id: 'job-a', status: 'queued', cost: 10 }, { id: 'job-b', status: 'queued', cost: 10 }],
    })
    const poll = heldPoll()
    const run = useCloudCreate().generate()
    await vi.waitFor(() => expect(hoisted.pollJob).toHaveBeenCalledTimes(2))
    const entries = pendingCloudJobs()
    expect(entries.map((e) => e.id)).toEqual(['job-a', 'job-b'])
    expect(entries[0].item!.seed).toBe(4711)
    expect(entries[1].item!.seed).not.toBe(4711)
    poll.release((id) => done(id))
    await run
    expect(useCreateStore.getState().gallery.map((g) => g.jobId).sort()).toEqual(['job-a', 'job-b'])
    expect(pendingCloudJobs()).toEqual([])
  })

  it('a voice is written down as a voice', async () => {
    standOn('iphone')
    hoisted.submitCloudJob.mockResolvedValue({ id: 'voice-1', quota: { cost: 2 } })
    const poll = heldPoll()
    const run = useCloudCreate().makeVoice({ text: 'Hello there', mode: 'speak' })
    await vi.waitFor(() => expect(hoisted.pollJob).toHaveBeenCalled())
    expect(pendingCloudJobs()[0]).toMatchObject({ id: 'voice-1', kind: 'audio', op: 'tts', prompt: 'Hello there', landing: 'voice' })
    poll.release((id) => done(id, { kind: 'audio' }))
    await run
    expect(pendingCloudJobs()).toEqual([])
  })

  it('an enhance is written down with the facts of its source clip, and never with media bytes', async () => {
    standOn('iphone')
    hoisted.getJob.mockResolvedValue(done('clip-1', { kind: 'video' }))
    hoisted.submitCloudJob.mockResolvedValue({ id: 'up-1', quota: { cost: 30 } })
    const poll = heldPoll()
    const source = {
      id: 'clip-1', jobId: 'clip-1', type: 'video', model: 'wan-2.2-720p', prompt: 'waves', seed: 9,
      dataUrl: 'blob:local', remoteUrl: 'https://storage.example/old.mp4', createdAt: 1,
    } as unknown as GalleryItem
    const run = useCloudCreate().enhanceVideo(source)
    await vi.waitFor(() => expect(hoisted.pollJob).toHaveBeenCalled())
    const [entry] = pendingCloudJobs()
    expect(entry).toMatchObject({ id: 'up-1', kind: 'video', op: 'upscale', model: 'wan-2.2-720p', landing: 'gallery' })
    expect(entry.deadlineAt - entry.startedAt).toBe(45 * 60_000)
    expect(entry.item).toMatchObject({ type: 'video', prompt: 'waves', seed: 9 })
    for (const key of ['dataUrl', 'remoteUrl', 'id', 'jobId', 'createdAt']) expect(entry.item).not.toHaveProperty(key)
    poll.release((id) => done(id, { kind: 'video' }))
    await run
  })
})

describe('a staged upload ends with the run', () => {
  function withSource() {
    useCreateStore.getState().setIntent('removebg')
    useCreateStore.setState({ source: { filename: '', url: PNG, width: 4, height: 4 } })
  }

  for (const device of HANDHELDS) {
    it(`${device}: the upload carries the run's abort signal`, async () => {
      standOn(device)
      withSource()
      hoisted.pollJob.mockResolvedValue(done('job-1'))
      await useCloudCreate().generate()
      expect(hoisted.uploadInput).toHaveBeenCalledTimes(1)
      const args = hoisted.uploadInput.mock.calls[0]
      expect(args).toHaveLength(3)
      expect(args[1]).toBe('source')
      expect((args[2] as { signal: AbortSignal }).signal).toBeInstanceOf(AbortSignal)
    })
  }

  for (const device of DESKTOPS) {
    it(`DESKTOP UNCHANGED ${device}: the upload is called with its two arguments`, async () => {
      standOn(device)
      withSource()
      hoisted.pollJob.mockResolvedValue(done('job-1'))
      await useCloudCreate().generate()
      expect(hoisted.uploadInput).toHaveBeenCalledTimes(1)
      expect(hoisted.uploadInput.mock.calls[0]).toHaveLength(2)
    })
  }

  it('phone: Cancel during the upload stops it, books nothing and shows no error', async () => {
    standOn('iphone')
    withSource()
    hoisted.uploadInput.mockImplementation((_blob: Blob, _role: string, opts?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
      }))
    const hook = useCloudCreate()
    const run = hook.generate()
    await vi.waitFor(() => expect(hoisted.uploadInput).toHaveBeenCalled())
    await hook.cancel()
    await run
    expect(hoisted.submitCloudJob).not.toHaveBeenCalled()
    expect(useCreateStore.getState().error).toBeNull()
    expect(useCreateStore.getState().isGenerating).toBe(false)
  })
})

describe('401 names the next step', () => {
  for (const device of ['iphone', 'windows'] as const) {
    it(`${device}: a voice made while signed out says to sign in`, async () => {
      standOn(device)
      hoisted.submitCloudJob.mockRejectedValue(new hoisted.FakeCloudJobError('not signed in', 401))
      await useCloudCreate().makeVoice({ text: 'Hello there', mode: 'speak' })
      expect(useCreateStore.getState().error).toBe(SIGN_IN_TO_RENDER)
    })

    it(`${device}: an enhance while signed out says to sign in`, async () => {
      standOn(device)
      hoisted.getJob.mockRejectedValue(new hoisted.FakeCloudJobError('not signed in', 401))
      await useCloudCreate().enhanceVideo({ id: 'clip-1', jobId: 'clip-1', type: 'video', model: 'wan-2.2-720p' } as unknown as GalleryItem)
      expect(useCreateStore.getState().error).toBe(SIGN_IN_TO_RENDER)
    })
  }

  it('the sentence of generate() is word for word what it was', () => {
    expect(SIGN_IN_TO_RENDER).toBe('Sign in to your LU Cloud account to render in the cloud.')
  })
})
