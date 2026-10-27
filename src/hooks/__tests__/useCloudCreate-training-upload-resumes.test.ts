/**
 * Training on a phone: the line drops while the photos go up. "Try again"
 * goes on with the photo that failed instead of starting at the first one.
 * On the desktop the loop is the one it always was.
 */
import { beforeEach, expect, it, vi } from 'vitest'

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
    mobile: { on: true },
    uploadInput: vi.fn(),
    submitCloudJob: vi.fn(),
    pollJob: vi.fn(async () => ({ id: 'job-train', kind: 'image', model: 'm', status: 'failed', error: 'stop here', created_at: new Date().toISOString() })),
  }
})

vi.mock('../../lib/device-kind', async (orig) => ({ ...((await orig()) as object), isMobile: () => hoisted.mobile.on }))
vi.mock('../useContentPolicy', () => ({
  contentPolicySnapshot: () => 'off' as const,
  loadContentPolicy: async () => 'off' as const,
}))
vi.mock('../../api/cloud/jobs', () => ({
  uploadInput: hoisted.uploadInput,
  getJob: vi.fn(),
  submitCloudJob: hoisted.submitCloudJob,
  pollJob: hoisted.pollJob,
  cancelJob: vi.fn(async () => {}),
  CloudJobError: hoisted.FakeCloudJobError,
  QuoteChangedError: class extends hoisted.FakeCloudJobError {},
}))
vi.mock('../../api/cloud/studio', () => ({ studioQuote: vi.fn(), StudioQuoteChangedError: class extends Error {} }))

import { useCloudCreate } from '../useCloudCreate'
import { useCreateStore, type MediaRef } from '../../stores/createStore'

const photo = (i: number): MediaRef => ({ name: `p${i}.jpg`, url: `blob:p${i}`, blob: new Blob([`photo-${i}`]) })
let set: MediaRef[] = []
const indexOf = (blob: Blob) => set.findIndex((p) => p.blob === blob)

beforeEach(() => {
  hoisted.mobile.on = true
  hoisted.uploadInput.mockReset()
  hoisted.submitCloudJob.mockReset()
  hoisted.submitCloudJob.mockImplementation(async () => ({ id: 'job-train', quota: { cost: 1000 } }))
  set = [0, 1, 2, 3, 4, 5].map(photo)
  useCreateStore.setState({ isGenerating: false, error: null, backend: 'cloud', gallery: [], source: null, trainImages: set, triggerWord: 'mira' })
  useCreateStore.getState().setIntent('character')
})

const paramsOfSubmit = () => (hoisted.submitCloudJob.mock.calls.at(-1)?.[0] as { params: { image_paths: string[] } }).params.image_paths

it('on a phone the second attempt uploads only what is missing', async () => {
  let drop = true
  hoisted.uploadInput.mockImplementation(async (blob: Blob) => {
    if (indexOf(blob) === 3 && drop) throw new TypeError('Failed to fetch')
    return `staged/${indexOf(blob)}`
  })
  const hook = useCloudCreate()
  await hook.generate()
  expect(hoisted.uploadInput).toHaveBeenCalledTimes(4)
  expect(hoisted.submitCloudJob).not.toHaveBeenCalled()
  expect(useCreateStore.getState().error).toBeTruthy()
  // The photos are still there for the next attempt.
  expect(useCreateStore.getState().trainImages).toHaveLength(6)

  drop = false
  hoisted.uploadInput.mockClear()
  await hook.generate()
  expect(hoisted.uploadInput.mock.calls.map(([blob]) => indexOf(blob as Blob))).toEqual([3, 4, 5])
  expect(paramsOfSubmit()).toEqual(['staged/0', 'staged/1', 'staged/2', 'staged/3', 'staged/4', 'staged/5'])
})

it('once a training was handed in, a second training uploads its photos again', async () => {
  hoisted.uploadInput.mockImplementation(async (blob: Blob) => `staged/${indexOf(blob)}`)
  const hook = useCloudCreate()
  await hook.generate()
  expect(hoisted.submitCloudJob).toHaveBeenCalledTimes(1)
  hoisted.uploadInput.mockClear()
  useCreateStore.setState({ trainImages: set, isGenerating: false, error: null })
  useCreateStore.getState().setIntent('character')
  await hook.generate()
  expect(hoisted.uploadInput).toHaveBeenCalledTimes(6)
})

it('the server refuses the request itself: the next attempt uploads everything again', async () => {
  hoisted.uploadInput.mockImplementation(async (blob: Blob) => `staged/${indexOf(blob)}`)
  hoisted.submitCloudJob.mockImplementationOnce(async () => {
    throw new hoisted.FakeCloudJobError('input not found', 404)
  })
  const hook = useCloudCreate()
  await hook.generate()
  hoisted.uploadInput.mockClear()
  await hook.generate()
  expect(hoisted.uploadInput).toHaveBeenCalledTimes(6)
})

it('an empty wallet at the request keeps the photos that are up', async () => {
  hoisted.uploadInput.mockImplementation(async (blob: Blob) => `staged/${indexOf(blob)}`)
  hoisted.submitCloudJob.mockImplementationOnce(async () => {
    throw new hoisted.FakeCloudJobError('not enough credits', 402)
  })
  const hook = useCloudCreate()
  await hook.generate()
  hoisted.uploadInput.mockClear()
  await hook.generate()
  expect(hoisted.uploadInput).not.toHaveBeenCalled()
  expect(paramsOfSubmit()).toHaveLength(6)
})

it('on the desktop every attempt uploads every photo, as before', async () => {
  hoisted.mobile.on = false
  let drop = true
  hoisted.uploadInput.mockImplementation(async (blob: Blob) => {
    if (indexOf(blob) === 3 && drop) throw new TypeError('Failed to fetch')
    return `staged/${indexOf(blob)}`
  })
  const hook = useCloudCreate()
  await hook.generate()
  drop = false
  hoisted.uploadInput.mockClear()
  await hook.generate()
  expect(hoisted.uploadInput).toHaveBeenCalledTimes(6)
  // Two arguments, no signal: the desktop call is untouched.
  expect(hoisted.uploadInput.mock.calls[0]).toHaveLength(2)
})
