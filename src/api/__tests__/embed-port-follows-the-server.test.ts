/**
 * iOS check of package 17, N-1, the port half: a phone's embeddings server
 * no longer dies on a taken 8128, it takes the next free port of its own
 * walk (engine.rs, embed_port_candidates). The page has to follow it, or the
 * reader runs and every request still goes to 8128, to whoever holds it.
 *
 * Run: npx vitest run src/api/__tests__/embed-port-follows-the-server.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let status: Record<string, unknown> = { running: false, healthy: false, port: 8128 }
let startAnswer: Record<string, unknown> = { status: 'started', port: 8128 }

vi.mock('../backend', () => ({
  backendCall: async (cmd: string) => {
    if (cmd === 'bundled_embed_status') return status
    if (cmd === 'start_bundled_embed') return startAnswer
    return null
  },
  localFetch: async () => new Response('{}', { status: 200 }),
  ollamaUrl: (p: string) => `http://localhost:11434/api${p}`,
  isTauri: () => false,
}))

import { bundledEmbedStatus, embedBaseUrl, startBundledEmbed } from '../engine'

beforeEach(async () => {
  // Back to the default port for every case.
  status = { running: true, healthy: true, port: 8128 }
  await bundledEmbedStatus()
  status = { running: false, healthy: false, port: 8128 }
})

describe('the page talks to the port the embeddings server really holds', () => {
  it('8128 by default', () => {
    expect(embedBaseUrl()).toBe('http://127.0.0.1:8128/v1')
  })

  it('a start that walked to another port moves the page there', async () => {
    startAnswer = { status: 'started', port: 8149 }
    await startBundledEmbed('/m/e.gguf')
    expect(embedBaseUrl()).toBe('http://127.0.0.1:8149/v1')
  })

  it('a running server reports its port, a stopped one does not move the page', async () => {
    status = { running: true, healthy: true, port: 8150 }
    await bundledEmbedStatus()
    expect(embedBaseUrl()).toBe('http://127.0.0.1:8150/v1')
    status = { running: false, healthy: false, port: 8128 }
    await bundledEmbedStatus()
    expect(embedBaseUrl()).toBe('http://127.0.0.1:8150/v1')
  })

  it('an answer without a usable port changes nothing', async () => {
    startAnswer = { status: 'already_running' }
    await startBundledEmbed('/m/e.gguf')
    status = { running: true, port: 'x' }
    await bundledEmbedStatus()
    expect(embedBaseUrl()).toBe('http://127.0.0.1:8128/v1')
  })
})
