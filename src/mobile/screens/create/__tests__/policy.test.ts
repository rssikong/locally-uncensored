// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const policy = vi.hoisted(() => ({
  ensureAiConsent: vi.fn<() => Promise<boolean>>(),
  openReport: vi.fn(),
  storePolicy: vi.fn(),
}))
vi.mock('../../../policy', () => policy)
vi.mock('../../../../lib/render/gallery-label', () => ({ galleryLabelShort: () => 'a red fox' }))

import { purchaseView, reportItem, withAiConsent } from '../parts/policy'
import type { GalleryItem } from '../../../../stores/createStore'

beforeEach(() => {
  policy.ensureAiConsent.mockReset()
  policy.openReport.mockReset()
  policy.storePolicy.mockReset()
})

describe('the store rules of this build', () => {
  it('follows the three ways of showing a purchase', () => {
    for (const purchase of ['links', 'text-only', 'none'] as const) {
      policy.storePolicy.mockReturnValue({ purchase })
      expect(purchaseView()).toEqual({ mode: purchase })
    }
  })

  it('in-app purchase (round 17, in no preset) is "none" for Create: no link, no other place to buy', () => {
    policy.storePolicy.mockReturnValue({ purchase: 'in-app' })
    expect(purchaseView()).toEqual({ mode: 'none' })
  })
})

describe('consent before the first cloud job', () => {
  it('a yes starts the run', async () => {
    policy.ensureAiConsent.mockResolvedValue(true)
    const start = vi.fn()
    expect(await withAiConsent(start)).toBe(true)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('a no starts nothing and asks again next time', async () => {
    policy.ensureAiConsent.mockResolvedValue(false)
    const start = vi.fn()
    expect(await withAiConsent(start)).toBe(false)
    expect(start).not.toHaveBeenCalled()
    await withAiConsent(start)
    expect(policy.ensureAiConsent).toHaveBeenCalledTimes(2)
  })
})

describe('report', () => {
  it('hands a result of the gallery to the report sheet of the scaffold, as made in the cloud', () => {
    const item = { id: 'g1', jobId: 'job-9', type: 'video', model: 'wan-2', prompt: 'a red fox' } as unknown as GalleryItem
    reportItem(item)
    expect(policy.openReport).toHaveBeenCalledWith({ kind: 'video', id: 'job-9', model: 'wan-2', source: 'cloud', excerpt: 'a red fox' })
  })

  it('falls back to the id of the gallery entry when there is no job', () => {
    reportItem({ id: 'g2', type: 'image', model: 'flux', prompt: 'x' } as unknown as GalleryItem)
    expect(policy.openReport.mock.calls[0][0]).toMatchObject({ kind: 'image', id: 'g2' })
  })
})
