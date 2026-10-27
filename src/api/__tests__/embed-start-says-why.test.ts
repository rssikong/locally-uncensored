/**
 * iOS check of package 17, N-1, the engine half: ensureBundledEmbedAlive
 * swallowed the error of a failed start, so the phone could not tell a taken
 * port from missing memory. It now hands the words back, and stays quiet
 * (null) when nothing failed.
 *
 * Run: npx vitest run src/api/__tests__/embed-start-says-why.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let running = false
let startError: unknown = null

vi.mock('../backend', () => ({
  backendCall: async (cmd: string) => {
    if (cmd === 'bundled_embed_status') return { running, healthy: running }
    if (cmd === 'list_bundled_models') return { dir: '/m', models: [{ name: 'nomic-embed-text-v1.5.Q4.gguf', path: '/m/e.gguf' }] }
    if (cmd === 'start_bundled_embed') {
      if (startError) throw startError
      running = true
      return { status: 'started', port: 8128 }
    }
    return null
  },
  localFetch: async () => new Response('{}', { status: 200 }),
  ollamaUrl: (p: string) => `http://localhost:11434/api${p}`,
  isTauri: () => false,
}))

import { ensureBundledEmbedAlive } from '../engine'

beforeEach(() => {
  running = false
  startError = null
})

describe('the start of the document reader says why it failed', () => {
  it('a Tauri error (a plain string) comes back word for word', async () => {
    startError = 'The LU Engine could not open the local port 8128: address already in use (os error 48)'
    expect(await ensureBundledEmbedAlive()).toBe(startError)
  })

  it('an Error comes back as its message', async () => {
    startError = new Error('Not enough free memory')
    expect(await ensureBundledEmbedAlive()).toBe('Not enough free memory')
  })

  it('a start that worked, or a reader that already runs, says nothing', async () => {
    expect(await ensureBundledEmbedAlive()).toBeNull()
    expect(running).toBe(true)
    expect(await ensureBundledEmbedAlive()).toBeNull()
  })
})
