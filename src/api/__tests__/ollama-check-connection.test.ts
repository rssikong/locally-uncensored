/**
 * checkConnection answered "Ollama is there" on every machine without Ollama.
 *
 * In the packaged app localFetch does not throw when nothing answers. The
 * proxy fails, the direct fetch fails, and it returns a synthetic Response
 * with status 500 that carries the error text (api/backend.ts). The old
 * checkConnection awaited that and returned true, because nothing threw. So
 * Document Chat on a machine without Ollama took the `ollama pull` branch
 * against nothing, and the stale-model scan at start ran against a dead port.
 *
 * A desktop fix, found by the mobile audit (section 2.2).
 *
 * Run: npx vitest run src/api/__tests__/ollama-check-connection.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const localFetch = vi.hoisted(() => vi.fn())
vi.mock('../backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../backend')>()),
  localFetch,
}))

import { checkConnection } from '../ollama'

beforeEach(() => { localFetch.mockReset() })

describe('checkConnection', () => {
  it('nothing listening: the synthetic 500 from localFetch means not reachable', async () => {
    localFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'proxy_localhost: error sending request' }), { status: 500 }))
    expect(await checkConnection(3000)).toBe(false)
  })

  it('something else on the port that answers 404 is not Ollama either', async () => {
    localFetch.mockResolvedValue(new Response('not found', { status: 404 }))
    expect(await checkConnection()).toBe(false)
  })

  it('a real answer is a yes', async () => {
    localFetch.mockResolvedValue(new Response(JSON.stringify({ models: [] }), { status: 200 }))
    expect(await checkConnection()).toBe(true)
  })

  it('a throw (browser build, timeout) is a no, as before', async () => {
    localFetch.mockRejectedValue(new Error('timeout'))
    expect(await checkConnection(3000)).toBe(false)
  })

  it('passes the probe budget on', async () => {
    localFetch.mockResolvedValue(new Response('{}', { status: 200 }))
    await checkConnection(3000)
    expect(localFetch.mock.calls[0][1]).toEqual({ timeoutMs: 3000 })
  })
})
