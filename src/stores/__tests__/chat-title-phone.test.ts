import { beforeEach, describe, expect, it, vi } from 'vitest'

let mobile = true
vi.mock('../../lib/device-kind', async (original) => ({
  ...(await original<typeof import('../../lib/device-kind')>()),
  isMobile: () => mobile,
}))

const first = { id: 'm1', role: 'user' as const, content: '# Title **bold**\n| a | b |\n|---|---|\n| 1 | 2 |', timestamp: 1 }

async function titleAfter(): Promise<string> {
  const { useChatStore } = await import('../chatStore')
  const id = useChatStore.getState().createConversation('model', '')
  useChatStore.getState().addMessage(id, first)
  return useChatStore.getState().conversations.find((c) => c.id === id)!.title
}

beforeEach(() => { vi.resetModules() })

describe('the title of a new chat (short check 7, F1)', () => {
  it('on the phone it has no Markdown marks', async () => {
    mobile = true
    const t = await titleAfter()
    expect(t).toBe('Title bold a b 1 2')
  })
  it('on the desktop it is the raw start of the message, as before', async () => {
    mobile = false
    const t = await titleAfter()
    expect(t).toBe(first.content.slice(0, 50))
  })
})
