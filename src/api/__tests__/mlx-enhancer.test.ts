/**
 * The run of the Qwen-Image 2.1 prompt enhancer on a Mac (GH #148): what goes
 * to Rust, what comes back, and that Cancel ends this run and no other.
 * Nothing is loaded: the command is mocked.
 *
 * Run: npx vitest run src/api/__tests__/mlx-enhancer.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  sent: [] as Array<{ cmd: string; args: Record<string, unknown> }>,
  answer: { text: 'The user wants a fox.\n</think>\n\nA long description of a red fox in the snow.' } as unknown,
  fail: null as Error | null,
  hold: null as null | (() => void),
}))
vi.mock('../mlx-invoke', () => ({
  invokeMedia: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    calls.sent.push({ cmd, args })
    if (cmd !== 'mlx_enhance_prompt') return { ok: true, stopped: true }
    if (calls.hold) await new Promise<void>((resolve) => { calls.hold = resolve })
    if (calls.fail) throw calls.fail
    return calls.answer
  }),
}))

import { enhancePromptOnMac } from '../mlx-enhancer'

beforeEach(() => {
  calls.sent.length = 0
  calls.answer = { text: 'The user wants a fox.\n</think>\n\nA long description of a red fox in the snow.' }
  calls.fail = null
  calls.hold = null
})

describe('a rewrite on the Mac', () => {
  it('a new picture: the id, the prompt and the seed, no images, and the prompt out of the answer', async () => {
    const out = await enhancePromptOnMac({ model: 'qwen-image-2.1-pe-t2i-4bit', mode: 't2i', prompt: 'a fox', images: ['/s/a.png'], seed: 42 })
    expect(out).toEqual({ status: 'improved', prompt: 'A long description of a red fox in the snow.' })
    expect(calls.sent).toHaveLength(1)
    const [{ cmd, args }] = calls.sent
    expect(cmd).toBe('mlx_enhance_prompt')
    expect(args).toMatchObject({ model: 'qwen-image-2.1-pe-t2i-4bit', prompt: 'a fox', images: [], seed: 42 })
    expect(String(args.run)).toMatch(/^enhance-/)
  })

  it('an edit: the staged images in their order', async () => {
    await enhancePromptOnMac({ model: 'qwen-image-2.1-pe-i2i-4bit', mode: 'i2i', prompt: 'make it night', images: ['/s/a.png', '', '/s/b.png'], seed: 1 })
    expect(calls.sent[0].args.images).toEqual(['/s/a.png', '/s/b.png'])
  })

  it('a seed Rust cannot take is made one it can', async () => {
    await enhancePromptOnMac({ model: 'm', mode: 't2i', prompt: 'p', seed: -1 })
    await enhancePromptOnMac({ model: 'm', mode: 't2i', prompt: 'p', seed: 3.7 })
    expect(calls.sent.map((c) => c.args.seed)).toEqual([0, 3])
  })

  it('never throws: a refusal of the backend or an answer without text is failed', async () => {
    calls.fail = new Error('Qwen-Image 2.1 Prompt Enhancer 4-bit is not installed.')
    expect(await enhancePromptOnMac({ model: 'm', mode: 't2i', prompt: 'p', seed: 1 })).toEqual({ status: 'failed' })
    calls.fail = null
    calls.answer = {}
    expect(await enhancePromptOnMac({ model: 'm', mode: 't2i', prompt: 'p', seed: 1 })).toEqual({ status: 'failed' })
  })

  it('Cancel ends this run by its name, and what comes back afterwards is not taken', async () => {
    calls.hold = () => {}
    const own = new AbortController()
    const pending = enhancePromptOnMac({ model: 'm', mode: 't2i', prompt: 'a fox', seed: 1 }, own.signal)
    await vi.waitFor(() => expect(calls.sent).toHaveLength(1))
    const run = calls.sent[0].args.run
    own.abort()
    const stop = calls.sent.find((c) => c.cmd === 'mlx_generate_cancel')
    expect(stop?.args).toEqual({ run })
    calls.hold?.()
    expect(await pending).toEqual({ status: 'failed' })
  })

  it('cancelled before it began: nothing is started', async () => {
    const own = new AbortController()
    own.abort()
    expect(await enhancePromptOnMac({ model: 'm', mode: 't2i', prompt: 'p', seed: 1 }, own.signal)).toEqual({ status: 'failed' })
    expect(calls.sent).toEqual([])
  })
})
