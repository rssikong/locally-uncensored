import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Finding N2 of the iPhone review (r6/nachpruefung/ios-gross): a new chat,
// the app killed 2 to 2.4 s after the first send, and the whole chat was gone.
//
// The answer streams, the store changes every frame, and the coalescing
// window writes only at its cap of two seconds. A kill before that write had
// landed took the new chat and its question along. On a phone the write is
// now started in the tick the question is added, before any hook goes on to
// ask a model. The desktop keeps its window.
//
// The real store, a recorded backend, and a "kill" that is simply: look at
// what reached the backend without letting a single timer run.

const writes: string[] = []
vi.mock('../../lib/idbStorage', () => ({
  idbStorage: {
    getItem: () => null,
    setItem: (_k: string, v: string) => { writes.push(v); return Promise.resolve() },
    removeItem: () => Promise.resolve(),
  },
}))

let phone = true
vi.mock('../../lib/device-kind', async (original) => ({
  ...(await original<typeof import('../../lib/device-kind')>()),
  isMobile: () => phone,
}))

/** Let promises run. No timer fires: that is the kill before the window. */
async function microtasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

type Stored = { state: { conversations: { id: string; messages: { id: string; role: string; content: string }[] }[] } }

function lastWrite(): Stored | null {
  return writes.length ? (JSON.parse(writes[writes.length - 1]) as Stored) : null
}

describe('a question is written before the model is asked (phone)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    writes.length = 0
    phone = true
  })
  afterEach(() => { vi.useRealTimers() })

  it('new chat, first message, killed before any timer ran: chat and question are on the disk', async () => {
    const { useChatStore } = await import('../chatStore')
    const convId = useChatStore.getState().createConversation('smollm2', '')
    useChatStore.getState().addMessage(convId, { id: 'u1', role: 'user', content: 'Write a long story about a sailor.', timestamp: 1 })
    // What the sending hook does next: the empty answer, then tokens every frame.
    useChatStore.getState().addMessage(convId, { id: 'a1', role: 'assistant', content: '', timestamp: 2 })
    await microtasks()

    const stored = lastWrite()
    expect(stored, 'nothing was written before the kill').not.toBeNull()
    const conv = stored!.state.conversations.find((c) => c.id === convId)
    expect(conv, 'the new chat is not on the disk').toBeDefined()
    expect(conv!.messages.map((m) => m.id)).toContain('u1')
  })

  it('one write per question, not one per token', async () => {
    const { useChatStore } = await import('../chatStore')
    const convId = useChatStore.getState().createConversation('smollm2', '')
    await vi.advanceTimersByTimeAsync(5000)
    writes.length = 0
    useChatStore.getState().addMessage(convId, { id: 'u1', role: 'user', content: 'q', timestamp: 1 })
    useChatStore.getState().addMessage(convId, { id: 'a1', role: 'assistant', content: '', timestamp: 2 })
    for (let i = 0; i < 60; i++) {
      useChatStore.getState().updateMessageContent(convId, 'a1', 'x'.repeat(i + 1))
      await vi.advanceTimersByTimeAsync(16)
    }
    // The question at once, the empty answer that arrived during that write right
    // behind it, and nothing else inside the first second of the stream.
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.length).toBeLessThanOrEqual(2)
  })

  it('the desktop keeps its window: nothing is written in the tick of the message', async () => {
    phone = false
    const { useChatStore } = await import('../chatStore')
    const convId = useChatStore.getState().createConversation('m', '')
    await vi.advanceTimersByTimeAsync(5000)
    writes.length = 0
    useChatStore.getState().addMessage(convId, { id: 'u1', role: 'user', content: 'q', timestamp: 1 })
    await microtasks()
    expect(writes.length).toBe(0)
    await vi.advanceTimersByTimeAsync(300)
    expect(writes.length).toBe(1)
  })
})
