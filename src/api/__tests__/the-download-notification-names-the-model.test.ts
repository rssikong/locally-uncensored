/**
 * The notification of a download names the model, not the file.
 *
 * Short check on Android, package 8: the system notification of a running
 * download read "Qwen3.5-0.8B-Q4_K_M.gguf" while every page of the app calls
 * the same model by its name. The phone shell now hands the call the name its
 * pages show. A desktop never sets a name, and its call must stay exactly as
 * it was: the desktop command does not know the argument.
 *
 * Run: npx vitest run src/api/__tests__/the-download-notification-names-the-model.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const backendCall = vi.fn(async () => ({ status: 'started', id: 'x' }))

vi.mock('../backend', async () => {
  const actual = await vi.importActual<typeof import('../backend')>('../backend')
  return { ...actual, backendCall: (...a: unknown[]) => backendCall(...(a as [])) }
})

const { startModelDownloadToPath, resumeDownload, setDownloadTitleResolver } = await import('../discover')
const { downloadLabel } = await import('../../mobile/screens/models/parts/watch')

function lastArgs(): Record<string, unknown> {
  const call = backendCall.mock.calls.at(-1) as unknown as [string, Record<string, unknown>]
  return call[1]
}

describe('the name of a download in the notification', () => {
  beforeEach(() => {
    backendCall.mockClear()
    setDownloadTitleResolver(null)
  })

  it('a desktop sends exactly what it always sent', async () => {
    await startModelDownloadToPath('https://example.org/m.gguf', '/models', 'm.gguf', 10, 'ab')
    expect(lastArgs()).toEqual({ url: 'https://example.org/m.gguf', destDir: '/models', filename: 'm.gguf', expectedBytes: 10, expectedSha256: 'ab' })
    await resumeDownload('m.gguf', 'https://example.org/m.gguf', '', 10, 'ab')
    expect(Object.keys(lastArgs()).sort()).toEqual(['authToken', 'expectedBytes', 'expectedSha256', 'id', 'subfolder', 'url'])
  })

  it('the phone sends the name its pages show, at the start and when it goes on', async () => {
    setDownloadTitleResolver(downloadLabel)
    await startModelDownloadToPath('https://example.org/q.gguf', '/models', 'Qwen3.5-0.8B-Q4_K_M.gguf')
    const title = lastArgs().title
    expect(title).toBe(downloadLabel('Qwen3.5-0.8B-Q4_K_M.gguf'))
    expect(String(title)).not.toMatch(/\.gguf$/i)
    await resumeDownload('Qwen3.5-0.8B-Q4_K_M.gguf', 'https://example.org/q.gguf', '')
    expect(lastArgs().title).toBe(title)
  })

  it('the phone shell sets the name at its start', () => {
    const boot = readFileSync(resolve(__dirname, '../../mobile/boot/index.tsx'), 'utf8')
    expect(boot).toContain('setDownloadTitleResolver(downloadLabel)')
  })

  it('no name, an empty name or a resolver that throws leave the argument out', async () => {
    setDownloadTitleResolver(() => undefined)
    await startModelDownloadToPath('https://example.org/m.gguf', '/models', 'm.gguf')
    expect('title' in lastArgs()).toBe(false)
    setDownloadTitleResolver(() => '   ')
    await startModelDownloadToPath('https://example.org/m.gguf', '/models', 'm.gguf')
    expect('title' in lastArgs()).toBe(false)
    setDownloadTitleResolver(() => {
      throw new Error('no catalogue')
    })
    await startModelDownloadToPath('https://example.org/m.gguf', '/models', 'm.gguf')
    expect('title' in lastArgs()).toBe(false)
  })
})
