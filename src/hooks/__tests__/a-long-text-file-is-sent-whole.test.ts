/**
 * @vitest-environment jsdom
 *
 * GH #171: a long Markdown file (one day of a story, tens of thousands of
 * Japanese characters) was cut to its first 4000 characters before it was
 * sent, without a word, to a model with a 262,144 token window. The model
 * then said the text stops midway.
 *
 * What has to hold instead, driven through the real `useChat().sendMessage`
 * with only the network replaced:
 *   - a file that fits the model's context goes out whole;
 *   - a file that does not fit goes out as far as it fits, the model is told
 *     so, and the user sees how much went out and why;
 *   - the user's own limit in Settings is honoured the same way.
 *
 * The window here is the one a user sets for their own OpenAI-compatible
 * server (GH #129), the setup of the report. The sizes keep a wide margin to
 * every limit, so the test does not depend on the exact token estimate.
 *
 * Run: npx vitest run src/hooks/__tests__/a-long-text-file-is-sent-whole.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../useMemory', () => ({
  useMemory: () => ({ extractAndSave: async () => {} }),
  extractMemoriesFromPair: async () => {},
}))
vi.mock('../../lib/run-lane-of-model', () => ({
  laneOf: () => 'local',
  currentLaneFacts: () => ({ openaiSlotIsLocal: true, ollamaBaseIsLocal: true }),
}))

import { useChat } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useChatNoticeStore } from '../../stores/chatNoticeStore'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { contextWindowKey } from '../../lib/context-source'
import { prepareChatFile } from '../../lib/chat-files'

const BASE_URL = 'http://127.0.0.1:8080/v1'
const MODEL_ID = 'story-model-256k'
const MODEL = `openai::${MODEL_ID}`

/** About 60,000 Japanese characters, with a marked beginning and end. */
const LINE = '朝、ウォルトは港へ向かった。バロンは静かに地図を広げ、二人は次の島について話し合った。\n'
const STORY = `# 一日目\n冒頭の場面です。\n${LINE.repeat(1400)}最後の場面です。物語はここで終わる。\n`
const LAST_PART = '最後の場面です。物語はここで終わる。'

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

interface WireMessage { role: string; content: string }
let requests: WireMessage[][] = []

function useWindow(tokens: number, attachmentTokenLimit = 0): void {
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      appMode: 'local',
      cavemanMode: 'off',
      contextWindowByModel: { [contextWindowKey(BASE_URL, MODEL_ID)]: tokens },
      attachmentTokenLimit,
    },
  })
}

beforeEach(() => {
  requests = []
  __resetRunLanesForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useChatNoticeStore.getState().clear()
  useModelStore.setState({ models: [], activeModel: MODEL })
  useWindow(262_144)
  // The user's own llama.cpp server on this machine, not the built-in engine.
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true, managed: false, isLocal: true, baseUrl: BASE_URL } },
  }))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
    requests.push(JSON.parse(String((init as RequestInit).body)).messages)
    return sse('The story ends at the harbour.')
  })
})
afterEach(() => vi.restoreAllMocks())

function openChat(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  return convId
}

const conversation = (id: string) => useChatStore.getState().conversations.find((c) => c.id === id)!
const sentUser = (): string => {
  const user = requests[0].filter((m) => m.role === 'user')
  return String(user[user.length - 1].content)
}
const fileNotice = () => useChatNoticeStore.getState().notices.find((n) => n.id === 'file-cut')

async function sendStory(): Promise<string> {
  const convId = openChat()
  const file = await prepareChatFile(new File([STORY], 'day-one.md', { type: 'text/markdown' }))
  const { result } = renderHook(() => useChat())
  await act(async () => { await result.current.sendMessage('How does the last part end?', undefined, [file]) })
  return convId
}

describe('GH #171: a long text file attached in chat', () => {
  it('goes out whole when it fits the model context', async () => {
    expect(STORY.length).toBeGreaterThan(50_000)
    await sendStory()

    expect(requests).toHaveLength(1)
    const sent = sentUser()
    expect(sent).toContain('冒頭の場面です。')
    expect(sent).toContain(LAST_PART)
    expect(sent).toContain(STORY.trim())
    expect(sent).not.toContain('longer than this excerpt')
    // Nothing was cut, so there is nothing to tell the user.
    expect(fileNotice()).toBeUndefined()
  })

  it('goes out as far as it fits when the window is small, and says so to the model and the user', async () => {
    useWindow(8192)
    const convId = await sendStory()

    const sent = sentUser()
    expect(sent).toContain('冒頭の場面です。')
    expect(sent).not.toContain(LAST_PART)
    // The model learns that it got only the start, and how much of it.
    expect(sent).toMatch(/Only the first [\d,]+ of [\d,]+ characters of this file are included/)

    // The user sees it: a line above the transcript, naming the file, the
    // share that went out and the reason.
    const notice = fileNotice()
    expect(notice?.text).toContain('day-one.md')
    expect(notice?.text).toMatch(/[\d,]+ of [\d,]+ characters/)
    expect(notice?.text).toContain("context window")
    // And the chip under the message keeps saying it after the line is gone.
    const stored = conversation(convId).messages.find((m) => m.role === 'user')!
    const chip = stored.files![0]
    expect(chip.textChars).toBe(STORY.length)
    expect(chip.includedChars).toBeGreaterThan(0)
    expect(chip.includedChars!).toBeLessThan(STORY.length)
  })

  it('honours the limit set in Settings, and names it as the reason', async () => {
    useWindow(262_144, 2000)
    await sendStory()

    const sent = sentUser()
    expect(sent).not.toContain(LAST_PART)
    expect(sent).toMatch(/Only the first [\d,]+ of [\d,]+ characters of this file are included/)
    expect(fileNotice()?.text).toContain('limit for attached files')
  })

  it('NEGATIVE CONTROL: a short text file goes out whole and without a notice, as before', async () => {
    openChat()
    const file = await prepareChatFile(new File(['短いメモです。'], 'memo.md', { type: 'text/markdown' }))
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage('read this', undefined, [file]) })
    expect(sentUser()).toContain('The whole text of the file:\n短いメモです。')
    expect(fileNotice()).toBeUndefined()
  })
})
