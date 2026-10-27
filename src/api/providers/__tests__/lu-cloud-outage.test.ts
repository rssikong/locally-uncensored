/**
 * 3.0.8, A28: a chat or agent turn on LU Cloud that fails while an outage is
 * announced reads the server's sentence (code `outage`), not the raw error.
 *
 * Run: npx vitest run src/api/providers/__tests__/lu-cloud-outage.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const failure = { current: null as unknown }

vi.mock('../../cloud/supabase', () => ({ getAccessToken: async () => 'token' }))
vi.mock('../openai-provider', () => ({
  OpenAIProvider: class {
    // eslint-disable-next-line require-yield
    async *chatStream() {
      throw failure.current
    }
    async chatWithTools() {
      throw failure.current
    }
  },
}))

import { LuCloudProvider } from '../lu-cloud-provider'
import { ProviderError } from '../types'
import { resetOutageWatchForTests, setOutageWatching } from '../../../lib/cloud-outage-watch'
import { useCloudOutageStore } from '../../../stores/cloudOutageStore'

const provider = new LuCloudProvider({ id: 'lu-cloud', name: 'LU Cloud', enabled: true, baseUrl: '', apiKey: '', isLocal: false } as never)

async function streamError(): Promise<unknown> {
  try {
    for await (const chunk of provider.chatStream('m', [])) void chunk
  } catch (err) {
    return err
  }
  return null
}

const announce = (active: boolean, message: string | null) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ desktop: { active, message }, web: { active: false, message: null }, updatedAt: '2026-10-22T00:00:00Z' }))))

beforeEach(() => {
  resetOutageWatchForTests()
  useCloudOutageStore.setState({ active: false, message: null, dismissedMessage: null })
  setOutageWatching(true)
})

describe('LU Cloud during an outage', () => {
  it('turns a server failure into the sentence, in the stream and in a tool turn', async () => {
    announce(true, 'LU Cloud is down for a bit.')
    failure.current = new ProviderError('HTTP 502: bad gateway', 'lu-cloud', undefined, 502)
    const err = await streamError()
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).code).toBe('outage')
    expect((err as Error).message).toBe('LU Cloud is down for a bit.')

    resetOutageWatchForTests()
    setOutageWatching(true)
    await expect(provider.chatWithTools('m', [], [])).rejects.toMatchObject({ code: 'outage', message: 'LU Cloud is down for a bit.' })
  })

  it('keeps the raw error without an announced outage', async () => {
    announce(false, null)
    failure.current = new ProviderError('HTTP 502: bad gateway', 'lu-cloud', undefined, 502)
    expect(await streamError()).toBe(failure.current)
  })

  it('keeps the sentences that are the person\'s to act on', async () => {
    announce(true, 'Down.')
    failure.current = Object.assign(new ProviderError('No credits left.', 'lu-cloud', 'credits_exhausted', 402))
    expect(await streamError()).toBe(failure.current)
  })
})
