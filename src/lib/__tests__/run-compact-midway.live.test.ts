import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { getProviderForModel } from '../../api/providers/registry'
import type { ChatMessage, ToolDefinition } from '../../api/providers/types'
import { compactRunMidway, newRunCompactState, RUN_COMPACT_NOTICE_PREFIX } from '../run-compact-midway'
import { trimWorkingHistory } from '../context-decay'
import { estimateMessageTokens } from '../context-compaction'
import { COMPACT_OPEN } from '../compact-summary'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../constants'

/**
 * A real tool run on a local model that goes past the auto-compact threshold
 * and has to carry on from the summary (3.0.7).
 *
 * The run reads twelve notes one at a time; each note holds one code and one
 * value. The send budget is small, so the run passes the threshold several
 * times on the way. What counts at the end: every code is in the answer, the
 * run did not start over (no note read twice), and it compacted at least once.
 * The loop is the shape of the app's loops: compactRunMidway, then
 * trimWorkingHistory, then the real Ollama provider. Only relative `/api/`
 * URLs are pointed at the local server, as the dev proxy does in the app.
 *
 *   LIVE_COMPACT=1 npx vitest run src/lib/__tests__/run-compact-midway.live.test.ts
 *
 * Optional: LIVE_COMPACT_MODEL (an Ollama model with tool calling),
 * LIVE_COMPACT_LOG (a file the step log is written to as JSON).
 */

const LIVE = process.env.LIVE_COMPACT === '1'
const MODEL = process.env.LIVE_COMPACT_MODEL ?? 'qwen3:8b'
// What the app's agent window gives a local model; the send budget below is
// the small cap that makes the run pass the threshold.
const MODEL_WINDOW = 32768
const SEND_BUDGET = 8192
const NOTES = 12
const MAX_STEPS = 40

const filler = (i: number) =>
  Array.from({ length: 22 }, (_, k) =>
    `Line ${k + 1} of note ${i}: the warehouse inventory for aisle ${i}-${k} was counted twice and matched the sheet.`,
  ).join('\n')

const NOTE_DATA = Array.from({ length: NOTES }, (_, n) => {
  const i = n + 1
  return {
    path: `notes/part${String(i).padStart(2, '0')}.txt`,
    code: `QX-${(4711 + i * 37).toString()}-${String.fromCharCode(64 + i)}`,
    value: 10 + i * 3,
    index: i,
  }
})

function noteText(n: (typeof NOTE_DATA)[number]): string {
  return `${filler(n.index)}\nCode: ${n.code}, value: ${n.value}\n${filler(n.index + 100)}`
}

const TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read one text file and return its content.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path of the file, for example notes/part01.txt' } },
        required: ['path'],
      },
    },
  },
]

const TASK =
  `There are ${NOTES} notes, notes/part01.txt to notes/part${NOTES}.txt. Read them one at a time, in order, ` +
  'with read_file, one call per step. Never read a note twice. Each note contains exactly one line ' +
  '"Code: ..., value: ...". When all notes are read, answer with one line per note: the file, its code ' +
  'and its value, and then the sum of all values.'

describe.skipIf(!LIVE)('auto-compact in the middle of a real tool run', () => {
  const realFetch = globalThis.fetch
  beforeAll(() => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return realFetch(url.startsWith('/api/') ? `http://127.0.0.1:11434${url}` : input, init)
    })
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
  })
  afterAll(() => vi.unstubAllGlobals())

  it('passes the threshold, compacts, and finishes without starting over', async () => {
    useChatStore.setState({ conversations: [], activeConversationId: null })
    const convId = useChatStore.getState().createConversation(MODEL, '')
    useChatStore.getState().addMessage(convId, { id: 'u1', role: 'user', content: TASK, timestamp: 1 })
    useChatStore.getState().addMessage(convId, { id: 'a1', role: 'assistant', content: '', timestamp: 2 })

    const { provider, modelId } = getProviderForModel(MODEL)
    let messages: ChatMessage[] = [
      { role: 'system', content: 'You are a careful file agent. Use the tool, one call per step, and keep going until the task is done.' },
      { role: 'user', content: TASK },
    ]
    const state = newRunCompactState()
    const reads: string[] = []
    const log: Array<Record<string, unknown>> = []
    let answer = ''

    for (let step = 1; step <= MAX_STEPS; step++) {
      const before = estimateMessageTokens(messages as never)
      const compacted = await compactRunMidway({
        messages, budgetTokens: SEND_BUDGET, modelWindow: MODEL_WINDOW,
        activeModel: MODEL, convId, beforeMessageId: 'a1', state,
      })
      if (compacted.compacted) messages = compacted.messages
      messages = trimWorkingHistory(messages, SEND_BUDGET).messages
      const sent = estimateMessageTokens(messages as never)

      const res = await provider.chatWithTools(modelId, messages, TOOLS, {
        temperature: 0.2, thinking: false, window: 'agent',
      })
      log.push({
        step, before, compacted: compacted.compacted, replaced: compacted.replaced ?? 0,
        sent, calls: res.toolCalls.map((c) => c.function.arguments), text: res.content.slice(0, 400),
      })

      if (!res.toolCalls.length) { answer = res.content; break }
      messages.push({ role: 'assistant', content: res.content || '', tool_calls: res.toolCalls })
      for (const tc of res.toolCalls) {
        const raw = tc.function.arguments as unknown
        const args = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { path?: string }
        const path = String(args.path ?? '').replace(/^\.\//, '')
        reads.push(path)
        const note = NOTE_DATA.find((n) => n.path === path)
        messages.push({ role: 'tool', content: note ? noteText(note) : `No such file: ${path}`, tool_call_id: tc.id })
      }
    }

    const notices = useChatStore.getState().conversations.find((c) => c.id === convId)!.messages
      .filter((m) => m.id.startsWith(RUN_COMPACT_NOTICE_PREFIX)).map((m) => m.content)
    const carrier = messages.find((m) => typeof m.content === 'string' && m.content.includes(COMPACT_OPEN))
    const summaryInPayload = Boolean(carrier)
    const missing = NOTE_DATA.filter((n) => !answer.includes(n.code)).map((n) => n.code)
    const reread = reads.filter((p, i) => reads.indexOf(p) !== i)
    const report = {
      model: MODEL, sendBudget: SEND_BUDGET, compactions: state.count, failures: state.failures,
      reads, reread, missing, summaryInPayload, summary: carrier?.content, notices, answer, log,
      expectedSum: NOTE_DATA.reduce((n, d) => n + d.value, 0),
    }
    if (process.env.LIVE_COMPACT_LOG) writeFileSync(process.env.LIVE_COMPACT_LOG, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ ...report, log: undefined }, null, 2))

    expect(state.count).toBeGreaterThanOrEqual(1)
    expect(notices.length).toBeGreaterThanOrEqual(1)
    expect(new Set(reads).size).toBe(NOTES)
    expect(reread).toEqual([])
    expect(missing).toEqual([])
  }, 1_800_000)
})
