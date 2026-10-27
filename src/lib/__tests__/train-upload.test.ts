/**
 * Training photos go up one by one, and a second attempt goes on where the
 * first one stopped.
 */
import { describe, expect, it, vi } from 'vitest'
import { STAGED_UPLOAD_TTL_MS, forgetStaged, stagedCount, stagedMayBeStale, stagedPathOf, uploadTrainPhotos } from '../train-upload'

const photos = (n: number) => Array.from({ length: n }, (_, i) => new Blob([`photo-${i}`]))

describe('uploadTrainPhotos', () => {
  it('uploads every photo once, in order', async () => {
    const set = photos(4)
    const upload = vi.fn(async (photo: Blob) => `staged/${set.indexOf(photo)}`)
    const steps: string[] = []
    const paths = await uploadTrainPhotos(set, { upload, onStep: (s) => steps.push(`${s.index + 1}/${s.total}${s.skipped ? ' kept' : ''}`) })
    expect(paths).toEqual(['staged/0', 'staged/1', 'staged/2', 'staged/3'])
    expect(upload).toHaveBeenCalledTimes(4)
    expect(steps).toEqual(['1/4', '2/4', '3/4', '4/4'])
  })

  it('the line drops at photo 3: the next attempt starts at photo 3', async () => {
    const set = photos(5)
    let fail = true
    const upload = vi.fn(async (photo: Blob) => {
      const i = set.indexOf(photo)
      if (i === 2 && fail) throw new TypeError('Failed to fetch')
      return `staged/${i}`
    })
    await expect(uploadTrainPhotos(set, { upload })).rejects.toThrow('Failed to fetch')
    expect(upload).toHaveBeenCalledTimes(3)
    expect(stagedCount(set)).toBe(2)

    fail = false
    upload.mockClear()
    const steps: Array<{ index: number; resumed: number; skipped: boolean }> = []
    const paths = await uploadTrainPhotos(set, { upload, onStep: ({ index, resumed, skipped }) => steps.push({ index, resumed, skipped }) })
    expect(paths).toEqual(['staged/0', 'staged/1', 'staged/2', 'staged/3', 'staged/4'])
    // Only the three that were missing went up.
    expect(upload.mock.calls.map(([photo]) => set.indexOf(photo))).toEqual([2, 3, 4])
    expect(steps.map((s) => s.skipped)).toEqual([true, true, false, false, false])
    expect(steps[0].resumed).toBe(2)
  })

  it('a photo that was swapped goes up, the others are kept, and the order follows the set', async () => {
    const set = photos(3)
    const upload = vi.fn(async (photo: Blob) => `staged/${(await photo.text()).slice(6)}`)
    await uploadTrainPhotos(set, { upload })
    upload.mockClear()
    const other = new Blob(['photo-9'])
    const next = [set[2], other, set[0]]
    expect(await uploadTrainPhotos(next, { upload })).toEqual(['staged/2', 'staged/9', 'staged/0'])
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('a Cancel between two photos ends the loop and keeps what is up', async () => {
    const set = photos(4)
    let stop = false
    const upload = vi.fn(async (photo: Blob) => {
      if (set.indexOf(photo) === 1) stop = true
      return `staged/${set.indexOf(photo)}`
    })
    expect(await uploadTrainPhotos(set, { upload, aborted: () => stop })).toBeNull()
    expect(upload).toHaveBeenCalledTimes(2)
    expect(stagedCount(set)).toBe(2)
  })

  it('a staged path is not trusted for ever', async () => {
    const set = photos(2)
    let now = 1_000_000
    const upload = vi.fn(async () => 'staged/x')
    await uploadTrainPhotos(set, { upload, now: () => now })
    expect(stagedPathOf(set[0], now + STAGED_UPLOAD_TTL_MS)).toBe('staged/x')
    now += STAGED_UPLOAD_TTL_MS + 1
    expect(stagedCount(set, now)).toBe(0)
    upload.mockClear()
    await uploadTrainPhotos(set, { upload, now: () => now })
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('once the training was handed in, the paths are used up', async () => {
    const set = photos(2)
    const upload = vi.fn(async () => 'staged/x')
    await uploadTrainPhotos(set, { upload })
    forgetStaged(set)
    expect(stagedCount(set)).toBe(0)
    upload.mockClear()
    await uploadTrainPhotos(set, { upload })
    expect(upload).toHaveBeenCalledTimes(2)
  })
})

describe('stagedMayBeStale', () => {
  it('only answers that may be about the photos themselves', () => {
    for (const status of [400, 404, 410, 422]) expect(stagedMayBeStale(status), String(status)).toBe(true)
    for (const status of [0, 401, 402, 403, 409, 413, 429, 500, 502, 503]) expect(stagedMayBeStale(status), String(status)).toBe(false)
  })
})
