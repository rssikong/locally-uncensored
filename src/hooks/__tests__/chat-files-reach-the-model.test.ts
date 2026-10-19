/**
 * @vitest-environment jsdom
 *
 * 3.0.5, a user on Discord: attach any file in the chat. A model cannot
 * read bytes, so what has to arrive in the request is the description of the
 * file, and what has to be kept in the chat is that description and nothing
 * of the file itself.
 *
 * Driven through the real `useChat().sendMessage`, with only the network
 * replaced, so this is the payload a local model and a cloud model both get:
 * the description is part of the user message, not of any provider.
 *
 * Run: npx vitest run src/hooks/__tests__/chat-files-reach-the-model.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../api/cloud/supabase', () => ({ getAccessToken: async () => 'session-token-abc' }))
vi.mock('../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../useMemory', () => ({
  useMemory: () => ({ extractAndSave: async () => {} }),
  extractMemoriesFromPair: async () => {},
}))
vi.mock('../../lib/run-lane-of-model', () => ({
  laneOf: () => 'cloud',
  currentLaneFacts: () => ({ openaiSlotIsLocal: true, ollamaBaseIsLocal: true }),
}))

import { useChat } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { describeFileBytes, type ChatFileInput } from '../../lib/chat-files'

const MODEL = 'openai::some-chat-model'

/** A small fake Game Boy Advance cartridge. */
function rom(): Uint8Array {
  const bytes = new Uint8Array(2048)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 0xff
  bytes.set([0x2e, 0x00, 0x00, 0xea, 0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21], 0)
  bytes.set([0x00, ...[...'POKEMON EMER'].map((c) => c.charCodeAt(0)), 0x00], 0xa0)
  return bytes
}

function attachedRom(): ChatFileInput {
  const bytes = rom()
  return {
    attachment: {
      name: 'emerald.gba',
      size: bytes.length,
      sha256: 'c0ffee'.padEnd(64, '0'),
      ...describeFileBytes(bytes, 'emerald.gba'),
    },
  }
}

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

interface WireMessage { role: string; content: string }
let requests: WireMessage[][] = []

beforeEach(() => {
  requests = []
  __resetRunLanesForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: MODEL })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' },
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } },
  }))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
    requests.push(JSON.parse(String((init as RequestInit).body)).messages)
    return sse('It looks like a Pokemon Emerald cartridge.')
  })
})
afterEach(() => vi.restoreAllMocks())

function openChat(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  return convId
}

const conversation = (id: string) => useChatStore.getState().conversations.find((c) => c.id === id)!
const text = (content: unknown): string => typeof content === 'string' ? content : JSON.stringify(content)

describe('a file attached in plain chat', () => {
  it('reaches the model as name, type, hash, hex dump and strings', async () => {
    const convId = openChat()
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage('what game is this?', undefined, [attachedRom()]) })

    expect(requests).toHaveLength(1)
    const user = requests[0].filter((m) => m.role === 'user')
    expect(user).toHaveLength(1)
    const sent = text(user[0].content)
    expect(sent.startsWith('what game is this?\n\n[Attached file: emerald.gba]')).toBe(true)
    expect(sent).toContain('Type: Game Boy Advance ROM')
    expect(sent).toContain('Size: 2.0 KB (2048 bytes)')
    expect(sent).toContain(`SHA-256: ${'c0ffee'.padEnd(64, '0')}`)
    expect(sent).toContain('00000000  2e 00 00 ea 24 ff ae 51  69 9a a2 21')
    expect(sent).toContain('POKEMON EMER')
    // Plain chat has no file tools, and the block does not pretend it has.
    expect(sent).toContain('The file itself is not available to you in this chat.')
    expect(sent).not.toContain('working folder')
    expect(conversation(convId).messages.at(-1)!.content).toContain('Pokemon Emerald')
  })

  it('keeps the typed text for the bubble and the description for the chip, and nothing of the file', async () => {
    const convId = openChat()
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage('what game is this?', undefined, [attachedRom()]) })

    const stored = conversation(convId).messages.find((m) => m.role === 'user')!
    expect(stored.displayContent).toBe('what game is this?')
    expect(stored.files).toHaveLength(1)
    expect(Object.keys(stored.files![0]).sort()).toEqual(['binary', 'kind', 'name', 'sha256', 'size', 'summary'])
    // The whole stored message stays a few kilobytes for a file of any size.
    expect(JSON.stringify(stored).length).toBeLessThan(12_000)
    // And the chat is named after the question, not after a hex dump.
    expect(conversation(convId).title).toBe('what game is this?')
  })

  it('a chat started with nothing but a file is named after the file', async () => {
    const convId = openChat()
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage('(file)', undefined, [attachedRom()]) })
    expect(conversation(convId).title).toBe('emerald.gba')
  })

  it('regenerate asks the same question with the same file, once', async () => {
    const convId = openChat()
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage('what game is this?', undefined, [attachedRom()]) })
    const answerId = conversation(convId).messages.at(-1)!.id
    await act(async () => {
      result.current.regenerateMessage(convId, answerId)
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(requests).toHaveLength(2)
    const again = text(requests[1].filter((m) => m.role === 'user')[0].content)
    expect(again).toBe(text(requests[0].filter((m) => m.role === 'user')[0].content))
    // One block, not two: the resend starts from what was typed.
    expect(again.match(/\[Attached file: emerald\.gba\]/g)).toHaveLength(1)
    const users = conversation(convId).messages.filter((m) => m.role === 'user')
    expect(users).toHaveLength(1)
    expect(users[0].displayContent).toBe('what game is this?')
    expect(users[0].files).toHaveLength(1)
  })

  it('NEGATIVE CONTROL: a message without files is stored and sent exactly as before', async () => {
    const convId = openChat()
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage('plain question') })
    const stored = conversation(convId).messages.find((m) => m.role === 'user')!
    expect(stored.content).toBe('plain question')
    expect('displayContent' in stored).toBe(false)
    expect('files' in stored).toBe(false)
    expect(text(requests[0].filter((m) => m.role === 'user')[0].content)).toBe('plain question')
  })
})

describe('a file attached in a group chat', () => {
  it('reaches every speaker inside the one user line they share', async () => {
    const convId = openChat()
    useChatStore.getState().setGroupModels(convId, ['openai::model-a', 'openai::model-b'])
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage('what game is this?', undefined, [attachedRom()]) })

    expect(requests).toHaveLength(2)
    for (const request of requests) {
      const first = text(request.filter((m) => m.role === 'user')[0].content)
      expect(first).toContain('[Attached file: emerald.gba]')
      expect(first).toContain('POKEMON EMER')
    }
    const users = conversation(convId).messages.filter((m) => m.role === 'user')
    expect(users).toHaveLength(1)
    expect(users[0].files).toHaveLength(1)
  })
})
