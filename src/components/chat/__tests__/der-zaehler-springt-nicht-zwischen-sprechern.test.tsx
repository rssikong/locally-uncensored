// @vitest-environment jsdom
/**
 * GH #167, part 2: in a group chat the context counter alternated between
 * the speakers. It anchored on the newest usage report, whoever wrote it, and
 * divided by the window of the model in the picker. The reporter saw 10.4K
 * while the next model answered and 205.2K after the other one finished,
 * over one 256K window, without a word about which model a number was for.
 *
 * Now the counter belongs to one speaker and names it: the one answering, or
 * the one who opens the next round. Its number anchors on that speaker's own
 * report and divides by that speaker's window.
 *
 * Run: npx vitest run src/components/chat/__tests__/der-zaehler-springt-nicht-zwischen-sprechern.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const WINDOWS: Record<string, number> = {
  'openai::baron': 262144,
  'openai::small': 16384,
}

vi.mock('../../../hooks/useActiveContextWindow', () => ({
  useActiveContextWindow: (_tick = 0, model?: string) => {
    const w = WINDOWS[model ?? 'openai::baron'] ?? 0
    return {
      provider: 'custom', contextWindow: w, modelMax: w, sendWindow: w, isTrue: true,
      adjustable: true, source: 'probe', windowKey: '',
    }
  },
}))

import { TokenCounter } from '../TokenCounter'
import { useChatStore } from '../../../stores/chatStore'
import { useModelStore } from '../../../stores/modelStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useGenerationStore } from '../../../stores/generationStore'
import { BUILT_IN_PERSONAS, DEFAULT_SETTINGS } from '../../../lib/constants'
import { computeContextFill } from '../../../lib/token-usage'
import { groupCounterSpeaker } from '../../../lib/group-counter'
import type { Message } from '../../../types/chat'

const BARON = 'openai::baron'
const SMALL = 'openai::small'

let convId = ''
let n = 0
const msg = (m: Partial<Message>): Message =>
  ({ id: `m${n++}`, role: 'assistant', content: 'x', timestamp: n, ...m }) as Message

beforeEach(() => {
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useModelStore.setState({ activeModel: BARON })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, personas: [...BUILT_IN_PERSONAS] })
  useGenerationStore.setState({ generating: {} })
  convId = useChatStore.getState().createConversation(BARON, '')
  useChatStore.getState().setActiveConversation(convId)
  useChatStore.getState().setGroupModels(convId, [BARON, SMALL])
})
afterEach(cleanup)

/** One finished round: Baron sent 205,200 tokens, the small model 10,400. */
function finishedRound() {
  const add = (m: Message) => useChatStore.getState().addMessage(convId, m)
  add(msg({ role: 'user', content: 'こんにちは' }))
  add(msg({ modelId: BARON, usage: { promptTokens: 205200, completionTokens: 10, totalTokens: 205210 } }))
  add(msg({ modelId: SMALL, usage: { promptTokens: 10400, completionTokens: 10, totalTokens: 10410 } }))
}

const shown = () => screen.getByText(/\/\d/).textContent

describe('the counter in a group chat', () => {
  it('after a round it shows the speaker who opens the next one, with its name and its own number', () => {
    finishedRound()
    render(<TokenCounter />)
    expect(screen.getByTestId('counter-speaker').textContent).toBe('baron:')
    // Baron's own report, not the small model's newer one.
    expect(shown()).toMatch(/^200\.\dK\/256K$/)
  })

  it('while the small model answers it shows that model, over that model window', () => {
    finishedRound()
    useChatStore.getState().addMessage(convId, msg({ role: 'user', content: 'つづけて' }))
    useChatStore.getState().addMessage(convId, msg({ modelId: BARON, usage: { promptTokens: 205900, completionTokens: 5, totalTokens: 205905 } }))
    useChatStore.getState().addMessage(convId, msg({ modelId: SMALL, content: '' }))
    useGenerationStore.getState().setGenerating(convId, true)
    render(<TokenCounter />)
    expect(screen.getByTestId('counter-speaker').textContent).toBe('small:')
    // The small model's own 10.4K plus what came since, over ITS 16K.
    expect(shown()).toMatch(/^10\.\dK\/16K$/)
  })

  it('the speaker anchor ignores the other speakers reports (the jump of the issue)', () => {
    const messages = [
      msg({ role: 'user', content: 'a' }),
      msg({ modelId: BARON, content: '', usage: { promptTokens: 205200, completionTokens: 1, totalTokens: 205201 } }),
      msg({ modelId: SMALL, content: '', usage: { promptTokens: 10400, completionTokens: 1, totalTokens: 10401 } }),
    ]
    const forBaron = computeContextFill(messages, undefined, { anchorModelId: BARON })
    expect(forBaron.used).toBeGreaterThanOrEqual(205200)
    const forSmall = computeContextFill(messages, undefined, { anchorModelId: SMALL })
    expect(forSmall.used).toBeLessThan(11000)
  })

  it('a single model chat has no speaker and keeps the old counter', () => {
    expect(groupCounterSpeaker([], undefined, false)).toBeNull()
    expect(groupCounterSpeaker([], [BARON], false)).toBeNull()
  })
})
