/**
 * Point 7 of the mobile groundwork, the client side.
 *
 * pollJob: the deadline is a wall clock. A phone that froze the app with a
 * request open (or a laptop lid) comes back after the deadline with one dead
 * request, and the old loop answered "render timed out" without asking the
 * server, although the job had long finished. It asks once more now.
 *
 * uploadInput: takes the caller's abort signal. Without one the request is
 * exactly what it was.
 *
 * Run: npx vitest run src/api/cloud/__tests__/poll-asks-once-more-and-upload-can-end.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => {
  class CloudJobError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  return {
    CloudJobError,
    cloudFetch: vi.fn(),
    jsonOrError: vi.fn(async (res: { body: unknown }) => res.body),
  }
})
vi.mock('../client', () => client)

import { pollJob, uploadInput } from '../jobs'

const job = (status: string) => ({ id: 'job-1', status, result_url: status === 'succeeded' ? 'https://storage.example/out.png' : null })
const dead = () => { throw new client.CloudJobError('Could not reach the LU Cloud server.', 0) }

beforeEach(() => {
  client.cloudFetch.mockReset()
  client.jsonOrError.mockClear()
})

describe('pollJob at the deadline', () => {
  it('THE FIX: a dead request past the deadline asks once more and returns the finished job', async () => {
    client.cloudFetch
      .mockImplementationOnce(dead)
      .mockResolvedValueOnce({ body: { job: job('succeeded') } })
    const ticks: string[] = []
    const result = await pollJob('job-1', { timeoutMs: 0, onTick: (j) => ticks.push(j.status) })
    expect(result.status).toBe('succeeded')
    expect(client.cloudFetch).toHaveBeenCalledTimes(2)
    // The caller sees the last state like any other tick.
    expect(ticks).toEqual(['succeeded'])
  })

  it('a job that failed meanwhile is returned as failed, not as a timeout', async () => {
    client.cloudFetch.mockImplementationOnce(dead).mockResolvedValueOnce({ body: { job: job('failed') } })
    expect((await pollJob('job-1', { timeoutMs: 0 })).status).toBe('failed')
  })

  it('NEGATIVE CONTROL: still rendering at the last look is the timeout it always was', async () => {
    client.cloudFetch.mockImplementationOnce(dead).mockResolvedValueOnce({ body: { job: job('running') } })
    await expect(pollJob('job-1', { timeoutMs: 0 })).rejects.toThrow('render timed out')
    expect(client.cloudFetch).toHaveBeenCalledTimes(2)
  })

  it('NEGATIVE CONTROL: a last look that fails too is the timeout, with no third request', async () => {
    client.cloudFetch.mockImplementation(dead)
    await expect(pollJob('job-1', { timeoutMs: 0 })).rejects.toThrow('render timed out')
    expect(client.cloudFetch).toHaveBeenCalledTimes(2)
  })

  it('UNCHANGED: an answered poll past the deadline does not ask twice', async () => {
    client.cloudFetch.mockResolvedValue({ body: { job: job('running') } })
    await expect(pollJob('job-1', { timeoutMs: 0 })).rejects.toThrow('render timed out')
    expect(client.cloudFetch).toHaveBeenCalledTimes(1)
  })

  it('UNCHANGED: a definitive answer fails fast, before any last look', async () => {
    client.cloudFetch.mockImplementation(() => { throw new client.CloudJobError('job not found', 404) })
    await expect(pollJob('job-1', { timeoutMs: 0 })).rejects.toThrow('job not found')
    expect(client.cloudFetch).toHaveBeenCalledTimes(1)
  })

  it('UNCHANGED: a finished job is returned on the first answer', async () => {
    client.cloudFetch.mockResolvedValue({ body: { job: job('succeeded') } })
    expect((await pollJob('job-1')).status).toBe('succeeded')
    expect(client.cloudFetch).toHaveBeenCalledTimes(1)
  })
})

describe('uploadInput and the abort signal', () => {
  it('a signal handed in reaches the request', async () => {
    client.cloudFetch.mockResolvedValue({ body: { path: 'inputs/a.png' } })
    const ac = new AbortController()
    expect(await uploadInput(new Blob(['x']), 'video', { signal: ac.signal })).toBe('inputs/a.png')
    const [path, init] = client.cloudFetch.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/jobs/upload?role=video')
    expect(init.signal).toBe(ac.signal)
  })

  it('UNCHANGED: without a signal the request carries none', async () => {
    client.cloudFetch.mockResolvedValue({ body: { path: 'inputs/a.png' } })
    await uploadInput(new Blob(['x']), 'source')
    const [, init] = client.cloudFetch.mock.calls[0] as [string, RequestInit]
    expect('signal' in init).toBe(false)
    expect(Object.keys(init).sort()).toEqual(['body', 'headers', 'method'])
  })
})
