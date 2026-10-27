/**
 * The loop stop sits at the transport of the engine on a phone, and only there
 * (acceptance Android, re-run, N4). The desktop engine keeps the rule it had.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({ fetch: vi.fn() }))
const device = vi.hoisted(() => ({ mobile: true }))
vi.mock('../../backend', () => ({
  localFetch: vi.fn(async () => new Response('{}', { status: 404 })),
  localFetchStream: (...args: unknown[]) => transport.fetch(...args),
  isPrivateOrLanHost: () => true,
  isDirectFetchAllowed: () => true,
  hostnameOf: (url: string) => new URL(url).hostname,
  ensureProxyAllowsHost: vi.fn(), backendCall: vi.fn(), isTauri: () => false,
  isLinux: () => false, isMacOS: () => false,
}))
vi.mock('../../builtin-ensure', () => ({
  ensureBuiltinEngineAlive: vi.fn(), explainDeadEngine: (e: unknown) => e,
  explainEngineTransportMessage: (s: string) => s, isManagedBuiltinSlot: () => false,
}))
vi.mock('../../../lib/device-kind', async (original) => ({
  ...(await original<typeof import('../../../lib/device-kind')>()),
  isMobile: () => device.mobile,
}))

import { OpenAIProvider } from '../openai-provider'

afterEach(() => {
  vi.clearAllMocks()
  device.mobile = true
})

const PASSAGE = '1. Canberra is the capital of Australia. Source: Wikipedia\n2. The capital is Canberra, in Victoria. Source: Britannica\n'

/** A stream that repeats one passage `rounds` times, one passage per event, and then ends. */
function looping(field: string, rounds: number) {
  let signal: AbortSignal | undefined
  let sent = 0
  transport.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
    signal = init.signal ?? undefined
    return new Response(new ReadableStream({
      pull(controller) {
        if (signal?.aborted) return controller.error(new DOMException('Aborted', 'AbortError'))
        if (sent >= rounds) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          return controller.close()
        }
        sent += 1
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { [field]: PASSAGE } }] })}\n\n`))
      },
    }))
  })
  return { sent: () => sent, signal: () => signal }
}

const provider = (managed: boolean) => new OpenAIProvider({
  id: 'openai', name: 'Built-in Engine', enabled: true, apiKey: '',
  baseUrl: 'http://127.0.0.1:8127/v1', isLocal: true, managed,
})

async function read(p: OpenAIProvider): Promise<string> {
  let text = ''
  for await (const chunk of p.chatStream('test-local-model', [{ role: 'user', content: 'What is the capital of Australia?' }])) text += chunk.content + (chunk.thinking ?? '')
  return text
}

describe('the engine on a phone ends an answer that loops', () => {
  it.each(['content', 'reasoning_content'])('stops endless repeated %s and aborts the request', async (field) => {
    const stream = looping(field, 5000)
    await expect(read(provider(true))).rejects.toThrow('kept repeating the same text')
    expect(stream.signal()?.aborted).toBe(true)
    expect(stream.sent()).toBeLessThan(40)
  })

  it('lets a passage that is repeated three times and ends pass', async () => {
    looping('content', 3)
    await expect(read(provider(true))).resolves.toBe(PASSAGE.repeat(3))
  })

  it('does not watch a server the app does not manage', async () => {
    looping('content', 200)
    await expect(read(provider(false))).resolves.toBe(PASSAGE.repeat(200))
  })
})

describe('the desktop engine is left as it was', () => {
  it('does not stop the same stream on a desktop', async () => {
    device.mobile = false
    looping('content', 200)
    await expect(read(provider(true))).resolves.toBe(PASSAGE.repeat(200))
  })
})
