/**
 * The document model has one size and one way onto a phone (acceptance on
 * the large iPhone, G7).
 *
 * The card in Documents said "86.0 MB", the progress line and the onboarding
 * "80.2 MB": the card read a rounded figure (0.084 GB), the rest the byte
 * count the host states. The same rounded figure went to the native download
 * as the expected size, without a checksum. And a start that was refused, or
 * a file that was there already, left the install waiting for a row that
 * never came.
 *
 * Run: npx vitest run src/api/__tests__/embed-install-one-size.test.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mobile = vi.hoisted(() => ({ on: true, single: true }))
const start = vi.hoisted(() => ({ fn: vi.fn(async (..._args: unknown[]) => ({ status: 'started', id: 'x' }) as { status: string; id: string; error?: string }) }))
const embed = vi.hoisted(() => ({ fn: vi.fn(async () => undefined) }))

vi.mock('../../lib/device-kind', () => ({ isMobile: () => mobile.on }))
vi.mock('../../lib/capabilities', () => ({ singleModelSlot: () => mobile.single }))
vi.mock('../discover', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../discover')>()),
  detectProviderModelPath: async () => '/models',
  startModelDownloadToPath: (...args: unknown[]) => start.fn(...args),
}))
vi.mock('../engine', () => ({ startBundledEmbed: () => embed.fn() }))

import { installBundledEmbedModel } from '../embed-install'
import { ONBOARDING_EMBED_MODEL } from '../../lib/constants'
import { formatBytes } from '../../lib/formatters'
import { MOBILE_EMBED_MODEL } from '../../mobile/data/mobile-models'
import { useDownloadStore } from '../../stores/downloadStore'

const FILE = ONBOARDING_EMBED_MODEL.filename
const row = (status: string, error?: string) => ({ [FILE]: { id: FILE, filename: FILE, progress: 1, total: 1, speed: 0, status, error } })

beforeEach(() => {
  mobile.on = true
  mobile.single = true
  start.fn.mockClear()
  start.fn.mockImplementation(async () => ({ status: 'started', id: FILE }))
  embed.fn.mockClear()
  useDownloadStore.setState({ downloads: {}, startPolling: () => undefined } as never)
  vi.stubGlobal('window', { dispatchEvent: () => true })
  vi.stubGlobal('CustomEvent', class {})
})

describe('G7: one size', () => {
  it('the logic layer and the phone catalogue name the same file, the same bytes and the same checksum', () => {
    expect(ONBOARDING_EMBED_MODEL.filename).toBe(MOBILE_EMBED_MODEL.filename)
    expect(ONBOARDING_EMBED_MODEL.downloadUrl).toBe(MOBILE_EMBED_MODEL.downloadUrl)
    expect(ONBOARDING_EMBED_MODEL.sizeBytes).toBe(MOBILE_EMBED_MODEL.sizeBytes)
    expect(ONBOARDING_EMBED_MODEL.sizeBytes).toBe(MOBILE_EMBED_MODEL.expectedBytes)
    expect(ONBOARDING_EMBED_MODEL.sha256).toBe(MOBILE_EMBED_MODEL.sha256)
    // What the host stated on 09.10.2026 (x-linked-size).
    expect(MOBILE_EMBED_MODEL.sizeBytes).toBe(84106624)
  })

  it('every place of the phone says "80.2 MB", and the rounded figure would have said "86.0 MB"', () => {
    expect(formatBytes(MOBILE_EMBED_MODEL.sizeBytes)).toBe('80.2 MB')
    expect(formatBytes(Math.round(ONBOARDING_EMBED_MODEL.sizeGB * 1_073_741_824))).toBe('86.0 MB')
    const page = readFileSync(join(__dirname, '..', '..', 'mobile', 'screens', 'agent', 'DocumentsPage.tsx'), 'utf8')
    expect(page).toContain('S.install.title(formatBytes(MOBILE_EMBED_MODEL.sizeBytes))')
    expect(page).not.toContain('sizeGB')
    const onboarding = readFileSync(join(__dirname, '..', '..', 'mobile', 'screens', 'onboarding', 'SetupDocumentsPage.tsx'), 'utf8')
    expect(onboarding).toContain('formatBytes(MOBILE_EMBED_MODEL.sizeBytes)')
  })

  it('the card in Documents goes through the door of every phone download before the logic layer waits', () => {
    const page = readFileSync(join(__dirname, '..', '..', 'mobile', 'screens', 'agent', 'DocumentsPage.tsx'), 'utf8')
    const door = page.indexOf('await startDownload({')
    const wait = page.indexOf('await rag.installEmbeddingAndDrainQueue()')
    expect(door).toBeGreaterThan(0)
    expect(wait).toBeGreaterThan(door)
    expect(page).toContain("if (outcome !== 'started' && outcome !== 'installed') return")
  })
})

describe('G7: what the download is started with', () => {
  it('on a phone: the bytes the host states and the checksum', async () => {
    useDownloadStore.setState({ downloads: row('complete') } as never)
    await installBundledEmbedModel()
    expect(start.fn).toHaveBeenCalledWith(ONBOARDING_EMBED_MODEL.downloadUrl, '/models', FILE, 84106624, MOBILE_EMBED_MODEL.sha256)
    // One model slot: the embedder is not started here.
    expect(embed.fn).not.toHaveBeenCalled()
  })

  it('on the desktop: exactly the call it made before', async () => {
    mobile.on = false
    mobile.single = false
    useDownloadStore.setState({ downloads: row('complete') } as never)
    await installBundledEmbedModel()
    expect(start.fn).toHaveBeenCalledWith(ONBOARDING_EMBED_MODEL.downloadUrl, '/models', FILE, 90194313)
    expect(embed.fn).toHaveBeenCalledTimes(1)
  })
})

describe('G7: the install never waits for a row that cannot come', () => {
  it('a refused start is an error at once, with the reason', async () => {
    start.fn.mockImplementation(async () => ({ status: 'error', id: FILE, error: 'The download service is not ready yet.' }))
    await expect(installBundledEmbedModel()).rejects.toThrow('The download service is not ready yet.')
  })

  it('a file that is there already is done at once', async () => {
    start.fn.mockImplementation(async () => ({ status: 'exists', id: FILE }))
    await expect(installBundledEmbedModel()).resolves.toBeUndefined()
  })

  it('a download that breaks is an error, a running one is waited for and reports its bytes', async () => {
    vi.useFakeTimers()
    try {
      const seen: Array<[number, number]> = []
      const done = installBundledEmbedModel((completed, total) => seen.push([completed, total]))
      await vi.advanceTimersByTimeAsync(600)
      useDownloadStore.setState({ downloads: { [FILE]: { id: FILE, filename: FILE, progress: 40, total: 80, speed: 1, status: 'downloading' } } } as never)
      await vi.advanceTimersByTimeAsync(600)
      useDownloadStore.setState({ downloads: row('complete') } as never)
      await vi.advanceTimersByTimeAsync(600)
      await done
      expect(seen).toContainEqual([40, 80])

      const broken = installBundledEmbedModel()
      const caught = broken.catch((err: Error) => err.message)
      useDownloadStore.setState({ downloads: row('error', 'Not enough free space') } as never)
      await vi.advanceTimersByTimeAsync(600)
      expect(await caught).toBe('Not enough free space')
    } finally {
      vi.useRealTimers()
    }
  })
})
