/**
 * durchsicht-mobile H2: a paid cloud job must be reachable even when the app
 * dies between the tap and the answer of the submit.
 *
 * The client_request_id is on disk BEFORE the request leaves. After a restart
 * the app asks the server for that id (the server books the first job of a
 * run under it) and never sends the submit again by itself: one tap, at most
 * one paid job.
 *
 * Run: npx vitest run src/hooks/__tests__/mobile-cloud-submit-intent.test.ts
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

import { useCloudCreate } from '../useCloudCreate'
import { useCreateStore } from '../../stores/createStore'
import {
  CLOUD_SUBMIT_INTENTS_KEY, __resetPendingCloudJobsForTests, cloudSiblingJobId, cloudSubmitIntents,
  noteCloudSubmitIntent, pendingCloudJobs, settleCloudSubmitIntent,
} from '../../lib/pending-cloud-jobs'
import type { CloudSubmitIntent } from '../../lib/pending-cloud-jobs'
import { INTENT_GRACE_MS, PENDING_MAX_AGE_MS, __resetCloudJobResumeForTests, resumePendingCloudJobs } from '../../lib/cloud-job-resume'

function done(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, kind: 'image', model: 'z-image-turbo', status: 'succeeded', error: null,
    result_url: `https://storage.example/${id}.png`, attestation: null, created_at: new Date().toISOString(), ...extra,
  }
}
const REQUEST = '11111111-2222-4333-8444-555555555555'
function intent(extra: Partial<CloudSubmitIntent> = {}): CloudSubmitIntent {
  return {
    requestId: REQUEST, count: 1, kind: 'image', op: 'generate', model: 'z-image-turbo', prompt: 'a lighthouse at dusk',
    sentAt: Date.now() - 10 * 60_000, timeoutMs: 15 * 60_000, landing: 'gallery',
    items: [{ seed: 4711, intent: 'image', prompt: 'a lighthouse at dusk' }],
    ...extra,
  }
}
/** What a kill between the submit and its answer leaves behind. */
function killedMidSubmit(i: CloudSubmitIntent) {
  noteCloudSubmitIntent(i)
  settleCloudSubmitIntent(i.requestId, false)
}

beforeEach(() => {
  backing.clear()
  vi.stubGlobal('localStorage', localStorageShim)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) })))
  for (const fn of [hoisted.submitCloudJob, hoisted.pollJob, hoisted.getJob, hoisted.uploadInput]) fn.mockReset()
  hoisted.pollJob.mockImplementation(async (id: string) => done(id))
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

describe('the request id is on disk before the submit leaves', () => {
  for (const device of HANDHELDS) {
    it(`${device}: the intent exists while the submit is out and names the id that is sent`, async () => {
      standOn(device)
      let seen: CloudSubmitIntent[] = []
      let sentId = ''
      hoisted.submitCloudJob.mockImplementation(async (submit: { params: { client_request_id: string } }) => {
        // This is the moment a phone may kill the app: the request is out, no answer yet.
        seen = cloudSubmitIntents()
        sentId = submit.params.client_request_id
        return { id: sentId, quota: { cost: 10 } }
      })
      await useCloudCreate().generate()
      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatchObject({ requestId: sentId, count: 1, kind: 'image', op: 'generate', prompt: 'a lighthouse at dusk', landing: 'gallery', timeoutMs: 15 * 60_000 })
      expect(seen[0].items?.[0]).toMatchObject({ seed: 4711, intent: 'image' })
      // Answer read, job landed: nothing is left behind.
      expect(cloudSubmitIntents()).toEqual([])
      expect(useCreateStore.getState().gallery.some((g) => g.jobId === sentId)).toBe(true)
    })
  }

  for (const device of DESKTOPS) {
    it(`DESKTOP UNCHANGED ${device}: nothing is written down`, async () => {
      standOn(device)
      let during = true
      hoisted.submitCloudJob.mockImplementation(async () => {
        during = backing.has(CLOUD_SUBMIT_INTENTS_KEY)
        return { id: 'job-1', quota: { cost: 10 } }
      })
      await useCloudCreate().generate()
      expect(during).toBe(false)
      expect(cloudSubmitIntents()).toEqual([])
    })
  }

  it('a clear no from the server ends the intent: nothing was booked', async () => {
    standOn('android')
    hoisted.submitCloudJob.mockRejectedValue(new hoisted.FakeCloudJobError('credits', 429, { code: 'credits_exhausted' }))
    await useCloudCreate().generate()
    expect(cloudSubmitIntents()).toEqual([])
  })

  it('a dropped line keeps the intent: nobody knows whether the job was booked', async () => {
    standOn('android')
    hoisted.submitCloudJob.mockRejectedValue(new hoisted.FakeCloudJobError('network', 0))
    await useCloudCreate().generate()
    expect(cloudSubmitIntents()).toHaveLength(1)
    // The next pass asks for exactly that id and never submits again.
    hoisted.getJob.mockImplementation(async (id: string) => done(id))
    hoisted.submitCloudJob.mockClear()
    const id = cloudSubmitIntents()[0].requestId
    const summary = await resumePendingCloudJobs()
    expect(hoisted.getJob).toHaveBeenCalledWith(id)
    expect(hoisted.submitCloudJob).not.toHaveBeenCalled()
    expect(summary.landed).toEqual([id])
    expect(useCreateStore.getState().gallery.find((g) => g.jobId === id)).toMatchObject({ prompt: 'a lighthouse at dusk', seed: 4711 })
    expect(cloudSubmitIntents()).toEqual([])
  })

  it('a voice and an enhance write their intent as well', async () => {
    standOn('iphone')
    const kinds: string[] = []
    hoisted.submitCloudJob.mockImplementation(async (submit: { params: { client_request_id: string } }) => {
      kinds.push(...cloudSubmitIntents().map((i) => `${i.op}:${i.landing}:${i.requestId === submit.params.client_request_id}`))
      return { id: submit.params.client_request_id, quota: { cost: 1 } }
    })
    hoisted.pollJob.mockImplementation(async (id: string) => done(id, { kind: 'audio' }))
    await useCloudCreate().makeVoice({ text: 'Hello there', mode: 'speak' })
    expect(kinds).toEqual(['tts:voice:true'])
    expect(cloudSubmitIntents()).toEqual([])
  })
})

describe('after a restart the open submit is asked for, never sent again', () => {
  it('the job exists: it goes into the ledger, is polled and lands as the answer to that tap', async () => {
    standOn('android')
    killedMidSubmit(intent())
    hoisted.getJob.mockImplementation(async (id: string) => done(id, { status: 'running', result_url: null }))
    const summary = await resumePendingCloudJobs()
    expect(hoisted.getJob).toHaveBeenCalledWith(REQUEST)
    expect(hoisted.pollJob).toHaveBeenCalledWith(REQUEST, expect.anything())
    expect(hoisted.submitCloudJob).not.toHaveBeenCalled()
    expect(summary.landed).toEqual([REQUEST])
    expect(useCreateStore.getState().gallery.find((g) => g.jobId === REQUEST)).toMatchObject({ seed: 4711, intent: 'image' })
    expect(cloudSubmitIntents()).toEqual([])
    expect(pendingCloudJobs()).toEqual([])
  })

  it('the server knows no such job: nothing was booked, the intent goes and nothing is sent', async () => {
    standOn('android')
    killedMidSubmit(intent())
    hoisted.getJob.mockRejectedValue(new hoisted.FakeCloudJobError('not found', 404))
    await resumePendingCloudJobs()
    expect(hoisted.submitCloudJob).not.toHaveBeenCalled()
    expect(cloudSubmitIntents()).toEqual([])
    expect(pendingCloudJobs()).toEqual([])
  })

  it('a submit only seconds old is not written off on a 404: it may still be on its way in', async () => {
    standOn('android')
    killedMidSubmit(intent({ sentAt: Date.now() - INTENT_GRACE_MS / 2 }))
    hoisted.getJob.mockRejectedValue(new hoisted.FakeCloudJobError('not found', 404))
    await resumePendingCloudJobs()
    expect(cloudSubmitIntents()).toHaveLength(1)
  })

  it('no line or signed out: the question stays open, up to the age limit', async () => {
    standOn('iphone')
    killedMidSubmit(intent())
    hoisted.getJob.mockRejectedValue(new hoisted.FakeCloudJobError('network', 0))
    await resumePendingCloudJobs()
    expect(cloudSubmitIntents()).toHaveLength(1)
    __resetCloudJobResumeForTests()
    hoisted.getJob.mockRejectedValue(new hoisted.FakeCloudJobError('sign in', 401))
    await resumePendingCloudJobs()
    expect(cloudSubmitIntents()).toHaveLength(1)
    __resetCloudJobResumeForTests()
    backing.clear()
    killedMidSubmit(intent({ sentAt: Date.now() - PENDING_MAX_AGE_MS - 1000 }))
    await resumePendingCloudJobs()
    expect(cloudSubmitIntents()).toEqual([])
  })

  it('several images: the further jobs are found under the ids the server derives', async () => {
    standOn('android')
    const second = await cloudSiblingJobId(REQUEST, 1)
    const third = await cloudSiblingJobId(REQUEST, 2)
    killedMidSubmit(intent({ count: 3, items: [{ seed: 1 }, { seed: 2 }, { seed: 3 }] }))
    // The wallet ran dry after the second image: the third was never booked.
    hoisted.getJob.mockImplementation(async (id: string) => {
      if (id === third) throw new hoisted.FakeCloudJobError('not found', 404)
      return done(id)
    })
    const summary = await resumePendingCloudJobs()
    expect(summary.landed.sort()).toEqual([REQUEST, second].sort())
    expect(useCreateStore.getState().gallery.find((g) => g.jobId === second)).toMatchObject({ seed: 2 })
    expect(hoisted.submitCloudJob).not.toHaveBeenCalled()
    expect(cloudSubmitIntents()).toEqual([])
  })

  it('the derived id is the one of the server (its siblingId)', async () => {
    expect(await cloudSiblingJobId(REQUEST, 0)).toBe(REQUEST)
    // sha256("<id>:1"), cut the way the server cuts it.
    expect(await cloudSiblingJobId(REQUEST, 1)).toBe('9534c811-ed72-4030-8957-28bf50c824bd')
  })

  it('a submit this session is still sending is left alone', async () => {
    standOn('android')
    noteCloudSubmitIntent(intent())
    await resumePendingCloudJobs()
    expect(hoisted.getJob).not.toHaveBeenCalled()
    expect(cloudSubmitIntents()).toHaveLength(1)
  })

  it('desktop: nothing to ask', async () => {
    standOn(DESKTOPS[0])
    killedMidSubmit(intent())
    await resumePendingCloudJobs()
    expect(hoisted.getJob).not.toHaveBeenCalled()
  })
})
