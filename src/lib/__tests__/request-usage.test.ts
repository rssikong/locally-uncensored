/**
 * Discord 22.10.2026: "Whats the cmd to see how much tokens was used in the
 * previous request?" The sum of one request, kept on its answer.
 *
 * Run: npx vitest run src/lib/__tests__/request-usage.test.ts
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { addCallUsage, lastRequestUsageNotice, requestUsageLine, requestUsageTracker } from '../request-usage'
import { migratePersistedChat, useChatStore } from '../../stores/chatStore'
import type { Message } from '../../types/chat'

const answer = (over: Partial<Message> = {}): Message => ({
  id: over.id ?? 'a1', role: 'assistant', content: 'Hi', timestamp: 1, modelId: 'ollama::qwen2.5:0.5b', ...over,
})

describe('addCallUsage', () => {
  it('a call without numbers and without billing changes nothing', () => {
    expect(addCallUsage(undefined, {})).toBeUndefined()
    const prev = { inputTokens: 5, outputTokens: 1, calls: 1 }
    expect(addCallUsage(prev, { promptEvalCount: 0, evalCount: undefined })).toBe(prev)
  })

  it('sums every call of one request, the way an agent answer runs', () => {
    let u = addCallUsage(undefined, { promptEvalCount: 1200, evalCount: 40 })
    u = addCallUsage(u, { promptEvalCount: 1500, evalCount: 60 })
    u = addCallUsage(u, { promptEvalCount: 1800, evalCount: 200 })
    expect(u).toEqual({ inputTokens: 4500, outputTokens: 300, calls: 3 })
  })

  it('never takes a negative, fractional or non finite count at face value', () => {
    expect(addCallUsage(undefined, { promptEvalCount: -4, evalCount: Number.NaN })).toBeUndefined()
    expect(addCallUsage(undefined, { promptEvalCount: 10.4, evalCount: 2 })).toEqual({ inputTokens: 10, outputTokens: 2, calls: 1 })
  })

  it('one call on credits makes the request a credit request', () => {
    let u = addCallUsage(undefined, { promptEvalCount: 10, evalCount: 1, billing: 'flash' })
    expect(u?.billing).toBe('flash')
    u = addCallUsage(u, { promptEvalCount: 10, evalCount: 1, billing: 'credits' })
    u = addCallUsage(u, { promptEvalCount: 10, evalCount: 1, billing: 'flash' })
    expect(u?.billing).toBe('credits')
  })

  it('keeps the billing word even when that call reported no numbers', () => {
    expect(addCallUsage(undefined, { billing: 'flash' })).toEqual({ inputTokens: 0, outputTokens: 0, calls: 0, billing: 'flash' })
  })
})

describe('requestUsageTracker writes the sum onto the answer', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [{
        id: 'c1', title: 't', model: 'm', systemPrompt: '', createdAt: 1, updatedAt: 1,
        messages: [answer({ usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })],
      }],
      activeConversationId: 'c1',
    } as never)
  })
  const stored = () => useChatStore.getState().conversations[0].messages[0]

  it('stores the running sum and leaves the context anchor alone', () => {
    const t = requestUsageTracker('c1', 'a1')
    t.add({ promptEvalCount: 100, evalCount: 10 })
    t.add({})
    t.add({ promptEvalCount: 150, evalCount: 20 })
    expect(stored().requestUsage).toEqual({ inputTokens: 250, outputTokens: 30, calls: 2 })
    expect(stored().usage).toEqual({ promptTokens: 1, completionTokens: 1, totalTokens: 2 })
  })

  it('a new request starts from zero, a regenerate does not add onto the old one', () => {
    requestUsageTracker('c1', 'a1').add({ promptEvalCount: 100, evalCount: 10 })
    requestUsageTracker('c1', 'a1').add({ promptEvalCount: 7, evalCount: 3 })
    expect(stored().requestUsage).toEqual({ inputTokens: 7, outputTokens: 3, calls: 1 })
  })

  it('writes nothing for a backend that reports nothing', () => {
    requestUsageTracker('c1', 'a1').add({})
    expect(stored().requestUsage).toBeUndefined()
  })

  it('survives the persisted round trip, so it is still there after a restart', () => {
    requestUsageTracker('c1', 'a1').add({ promptEvalCount: 1234, evalCount: 56, billing: 'flash' })
    const { partialize } = useChatStore.persist.getOptions()
    const state = useChatStore.getState()
    const disk = JSON.parse(JSON.stringify(partialize ? partialize(state) : state))
    const back = migratePersistedChat(disk) as { conversations: { messages: Message[] }[] }
    expect(back.conversations[0].messages[0].requestUsage).toEqual({ inputTokens: 1234, outputTokens: 56, calls: 1, billing: 'flash' })
  })
})

describe('requestUsageLine', () => {
  it('says nothing without real numbers', () => {
    expect(requestUsageLine(undefined)).toBeNull()
    expect(requestUsageLine({ inputTokens: 0, outputTokens: 0, calls: 0 })).toBeNull()
  })

  it('in / out in the app number format', () => {
    const line = requestUsageLine({ inputTokens: 12345, outputTokens: 678, calls: 1 })
    expect(line?.text).toBe('12,345 in · 678 out')
    expect(line?.title).toContain('as reported by the model')
    expect(line?.title).not.toContain('model calls')
  })

  it('names the number of calls an agent answer summed', () => {
    expect(requestUsageLine({ inputTokens: 4500, outputTokens: 300, calls: 3 })?.title).toContain('Summed over 3 model calls.')
  })

  it('a Flash answer on the allowance says No credits, the picker word', () => {
    const line = requestUsageLine({ inputTokens: 50, outputTokens: 5, calls: 1, billing: 'flash' })
    expect(line?.text).toBe('50 in · 5 out · No credits')
    expect(line?.title).toContain('no credits')
  })

  it('a credit answer says so and invents no amount', () => {
    const line = requestUsageLine({ inputTokens: 50, outputTokens: 5, calls: 1, billing: 'credits' })
    expect(line?.text).toBe('50 in · 5 out · Credits')
    expect(line?.text).not.toMatch(/\d+\s*credits/i)
  })

  it('billing alone still shows, without made up token numbers', () => {
    expect(requestUsageLine({ inputTokens: 0, outputTokens: 0, calls: 0, billing: 'flash' })?.text).toBe('No credits')
  })
})

describe('lastRequestUsageNotice (/usage)', () => {
  it('an empty chat', () => {
    expect(lastRequestUsageNotice([])).toContain('No answer in this chat yet')
  })

  it('names the newest answer, not an older one and not an app line', () => {
    const msgs: Message[] = [
      answer({ id: 'old', requestUsage: { inputTokens: 1, outputTokens: 1, calls: 1 } }),
      { id: 'u', role: 'user', content: 'again', timestamp: 2 },
      answer({ id: 'new', requestUsage: { inputTokens: 2048, outputTokens: 512, calls: 2, billing: 'flash' } }),
      { id: 'n', role: 'system', notice: 'info', content: '/usage', timestamp: 3 },
      answer({ id: 'goal', modelId: undefined, content: 'Goal set.' }),
    ]
    expect(lastRequestUsageNotice(msgs)).toBe(
      'Last answer: 2,048 tokens in, 512 tokens out, summed over 2 model calls. No credits: a Flash model on your plan.',
    )
  })

  it('an answer whose backend reported nothing says so instead of a number', () => {
    expect(lastRequestUsageNotice([answer()])).toContain('has no token count')
  })

  it('a credit answer', () => {
    expect(lastRequestUsageNotice([answer({ requestUsage: { inputTokens: 10, outputTokens: 2, calls: 1, billing: 'credits' } })]))
      .toBe('Last answer: 10 tokens in, 2 tokens out. It used credits.')
  })
})

describe('streamProviderTurn hands counts and billing to the tracker', () => {
  it('the done chunk of a provider stream lands on the turn', async () => {
    const { streamProviderTurn } = await import('../provider-stream')
    const provider = {
      async *chatStream() {
        yield { content: 'Hi', done: false }
        yield { content: '', done: true, promptEvalCount: 42, evalCount: 7, billing: 'flash' as const }
      },
    }
    const turn = await streamProviderTurn(provider as never, 'm', [], {})
    expect(addCallUsage(undefined, turn)).toEqual({ inputTokens: 42, outputTokens: 7, calls: 1, billing: 'flash' })
  })
})

describe('every chat surface feeds the sum', () => {
  // Source check in the house style of agent-commands.test.ts: a transport
  // that reports numbers but never reaches the tracker would leave the line
  // under its answers empty without any test noticing.
  const src = (f: string) => readFileSync(join(__dirname, '..', '..', 'hooks', f), 'utf8')
  it('plain chat and group chat, agent (native and prompt transport), coding agent', () => {
    expect(src('useChat.ts').match(/requestUsageTracker\(/g)?.length).toBe(2)
    const agent = src('useAgentChat.ts')
    expect(agent).toContain('requestUsage.add(turn)')
    expect(agent).toContain('requestUsage.add(hermesTurn)')
    const codex = src('useCodex.ts')
    expect(codex.match(/requestUsage\.add\(turn\)/g)?.length).toBe(2)
    expect(codex).toContain('requestUsage.add(hermesTurn)')
  })
})
