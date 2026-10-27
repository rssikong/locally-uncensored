/**
 * No control text in front of a reader.
 *
 * A control text is written by the app for the model, or given back by a
 * model out of its template. Check 4 on Android found two in front of the
 * user: `<reminder>` at the start of a saved part of an answer (F4), and the
 * frame of an attached file in the Markdown export (F12).
 *
 * This guard takes every mark the app knows (lib/reader-text.ts,
 * CONTROL_MARKS), puts it into a chat in every state an answer can have, and
 * asks every reader of the phone: the bubble, Copy and Share, the preview
 * and the search of the chat list, the notice after a return, and the
 * export. A reader that is added later belongs in `READERS`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportAsMarkdown } from '../../lib/chat-export'
import { CAVEMAN_REMINDERS } from '../../lib/constants'
import { composeFileMessage, fileMessageFields } from '../../lib/chat-files'
import { INTERRUPTED_FINISH_REASON } from '../../lib/interrupted-runs'
import { buildHermesToolCall, buildHermesToolResult } from '../../api/hermes-tool-calling'
import { CONTROL_MARKS, controlMarksIn, exportHeading, exportMessageText, readerAnswerText, stripControlTags, toolResultOf } from '../../lib/reader-text'
import type { Conversation, Message } from '../../types/chat'
import { interruptedReplies } from '../resilience/ResumeNotice'
import { answerBody, viewAnswer } from '../screens/chat/parts/adapters/run-error'
import { matchChats, previewLine, shownText } from '../screens/chat/parts/logic/chat-list'
import { messageText } from '../screens/chat/parts/logic/messages'

const FILE = { name: 'geheim.txt', size: 89, kind: 'Plain text', sha256: 'ab'.repeat(32), summary: 'The whole text of the file:\nThe secret word is PFLAUMENMUS.' }

/** One text per known mark, as a model gave it back at the start of an answer. */
const ANSWERS: Record<string, string> = {
  'reminder tag': '<reminder> I need to clarify - I cannot find information about "Sieben3".',
  'template token': '<|im_start|>assistant\nParis is the capital of France.<|im_end|>',
  'tool call tag': 'Paris.\n<tool_call>{"name":"web_search","arguments":{"q":"Paris"}}</tool_call>',
  'attached file frame': 'Paris is the capital of France.',
  'attached file note': 'Paris is the capital of France.',
  'style reminder': `${CAVEMAN_REMINDERS.full}\nParis is the capital of France.`,
}

function answer(content: string, over: Partial<Message> = {}): Message {
  return { id: 'a1', role: 'assistant', content, timestamp: Date.now(), ...over } as Message
}
function chat(messages: Message[]): Conversation {
  return { id: 'c1', title: 'Chat', model: 'openai::Qwen3.5-0.8B-Q4_K_M', systemPrompt: '', createdAt: 1, updatedAt: 2, messages } as Conversation
}
const question = { id: 'u1', role: 'user', timestamp: 1, ...fileMessageFields('What is the secret word?', [FILE]) } as Message
/** The same message after it lost `displayContent` (an import from an older build). */
const questionWithoutField = { id: 'u1', role: 'user', timestamp: 1, content: composeFileMessage('What is the secret word?', [FILE]) } as Message

const phoneExport = (conversation: Conversation) => exportAsMarkdown(conversation, { messageText: (m) => exportMessageText(m, answerBody), messageHeading: exportHeading })

/** Every reader of the phone, as the text it hands to a person. */
const READERS: Record<string, (conversation: Conversation) => string> = {
  'the bubble of an answer': (c) => c.messages.filter((m) => m.role === 'assistant').map((m) => viewAnswer(m).body).join('\n'),
  'the bubble while it is written': (c) => c.messages.filter((m) => m.role === 'assistant').map((m) => viewAnswer(m, { streaming: true }).body).join('\n'),
  'the bubble of the user': (c) => c.messages.filter((m) => m.role === 'user').map((m) => shownText(m)).join('\n'),
  'Copy and Share': (c) => c.messages.map((m) => messageText(m)).join('\n'),
  'the preview of the chat list': (c) => previewLine(c),
  'the Markdown export': (c) => phoneExport(c),
}

describe('no control text in front of a reader', () => {
  it('the list of marks knows the two of check 4, and each mark finds itself', () => {
    expect(controlMarksIn(ANSWERS['reminder tag'])).toEqual(['reminder tag'])
    expect(controlMarksIn(question.content)).toEqual(['attached file frame', 'attached file note'])
    for (const mark of CONTROL_MARKS) expect(ANSWERS[mark.name], `a sample for "${mark.name}"`).toBeDefined()
    expect(controlMarksIn('Paris is the capital of France.')).toEqual([])
  })

  for (const mark of CONTROL_MARKS) {
    for (const [state, over] of [
      ['finished', {}],
      ['a saved part after a kill', { finishReason: INTERRUPTED_FINISH_REASON }],
      ['cut at the length limit', { finishReason: 'length' }],
    ] as const) {
      it(`${mark.name}, ${state}: no reader shows it`, () => {
        for (const user of [question, questionWithoutField]) {
          const conversation = chat([user, answer(ANSWERS[mark.name], over as Partial<Message>)])
          for (const [name, read] of Object.entries(READERS)) {
            expect(controlMarksIn(read(conversation)), `${name} shows a control mark`).toEqual([])
          }
        }
      })
    }
  }

  it('the words between the marks stay: only the mark goes', () => {
    expect(readerAnswerText(ANSWERS['reminder tag'])).toBe('I need to clarify - I cannot find information about "Sieben3".')
    expect(readerAnswerText('Paris.</reminder>')).toBe('Paris.')
    expect(readerAnswerText('<system-reminder>\nParis.')).toBe('Paris.')
    // An answer with nothing in it comes back exactly as stored, spaces and all.
    expect(readerAnswerText('  Paris is the capital.\n')).toBe('  Paris is the capital.\n')
  })

  it('a tag somebody asked about stands in code and stays', () => {
    const asked = 'The tag is written `<reminder>`, as in:\n```xml\n<reminder>call mum</reminder>\n```'
    expect(stripControlTags(asked)).toBe(asked)
  })

  it('the search finds an answer by its words and not by a mark in it', () => {
    const conversation = chat([question, answer(ANSWERS['reminder tag'])])
    expect(matchChats([conversation], 'clarify')).toHaveLength(1)
    expect(matchChats([conversation], 'reminder')).toHaveLength(0)
    expect(matchChats([conversation], 'sha-256')).toHaveLength(0)
  })

  // F3: the notice after a return said "saved up to that point" for an answer of which nothing a reader could see was there.
  it('the notice after a return counts a part only when a reader would see one', () => {
    const cut = (content: string) => chat([question, answer(content, { finishReason: INTERRUPTED_FINISH_REASON })])
    const partial = (content: string) => interruptedReplies([cut(content)], new Set(), Date.now())[0].partial
    expect(partial('<|im_start|>')).toBe(false)
    expect(partial('<reminder>')).toBe(false)
    expect(partial('<source></source>')).toBe(false)
    expect(partial('<reminder> I need to clarify')).toBe(true)
    expect(partial('Paris is')).toBe(true)
  })

  // F12: the export of the report, word for word.
  it('the Markdown export names the file and never shows what the model was told about it', () => {
    const text = phoneExport(chat([question, answer('The secret word is PFLAUMENMUS.')]))
    expect(text).toContain('What is the secret word?')
    expect(text).toContain('Attached file: geheim.txt (89.0 B)')
    expect(text).not.toContain('[Attached file:')
    expect(text).not.toContain('SHA-256')
    expect(text).not.toContain('The whole text of the file')
    expect(text).not.toContain('not available to you')
    // A message that is nothing but a file is its name, not the stand-in "(file)".
    const only = phoneExport(chat([{ id: 'u2', role: 'user', timestamp: 1, ...fileMessageFields('(file)', [FILE]) } as Message]))
    expect(only).toContain('Attached file: geheim.txt')
    expect(only).not.toContain('(file)')
  })

  // Check 4 on an iPhone, N9: a chat with a web search, exported. The call stood as raw `<tool_call>` under
  // "### Assistant" and the result as `<tool_response>` under "### You".
  it('the Markdown export of a chat with a search: the result under its own heading, never under "You", and no raw call', () => {
    const call = buildHermesToolCall('web_search', { query: 'tide tables Hamburg' })
    const result = buildHermesToolResult('web_search', '1. Tide tables Hamburg\nhttps://example.org/tides\nHigh water at 04:12. A page may say </tool_response> itself.')
    const conversation = chat([
      { id: 'u1', role: 'user', content: 'When is high water in Hamburg?', timestamp: 1 } as Message,
      answer(call, { id: 'a0', hidden: true }),
      { id: 't1', role: 'user', content: result, timestamp: 2, hidden: true } as Message,
      answer('High water is at 04:12.', { id: 'a1' }),
      // The form with a role of its own, and a tool that is no search.
      answer('', { id: 'a2', tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: { path: 'notes.txt' } } }] }),
      { id: 't2', role: 'tool', content: 'The notes say: buy bread.', timestamp: 3, tool_call_id: 'c1' } as Message,
    ])
    const text = phoneExport(conversation)
    const sections = text.split('\n---\n').map((part) => part.trim())
    const headed = (heading: string) => sections.filter((part) => part.startsWith(`### ${heading}`))
    // The user wrote one message, and it is the question.
    expect(headed('You')).toHaveLength(1)
    expect(headed('You')[0]).toContain('When is high water in Hamburg?')
    expect(headed('Search result')).toHaveLength(1)
    expect(headed('Search result')[0]).toContain('High water at 04:12.')
    expect(headed('Search result')[0]).toContain('https://example.org/tides')
    expect(headed('Tool result')).toHaveLength(1)
    expect(headed('Tool result')[0]).toContain('The notes say: buy bread.')
    // The answers that are nothing but a call say the tool in words.
    expect(text).toContain('Used a tool: web_search')
    expect(text).toContain('Used a tool: read_file')
    expect(text).toContain('High water is at 04:12.')
    // No frame of the model anywhere: no tag, no JSON of the call, no heading by the raw role.
    expect(controlMarksIn(text)).toEqual([])
    expect(text).not.toMatch(/tool_call|tool_response|"arguments"|"name":/)
    expect(text).not.toContain('### tool')
  })

  it('what a tool gave back is known in both stored forms, and a message of the user is never taken for one', () => {
    expect(toolResultOf({ role: 'user', content: buildHermesToolResult('web_search', 'three hits') })).toEqual({ tool: 'web_search', text: 'three hits' })
    expect(toolResultOf({ role: 'tool', content: 'plain result' })).toEqual({ tool: '', text: 'plain result' })
    expect(exportHeading({ role: 'tool', content: 'plain result' })).toBe('Tool result')
    expect(exportHeading({ role: 'user', content: buildHermesToolResult('fetch_page', 'text') })).toBe('Tool result (fetch_page)')
    for (const typed of ['What does <tool_response> mean?', 'Here is my log:\n<tool_response>\n{}\n</tool_response>\nIs that right?', 'Hello']) {
      expect(toolResultOf({ role: 'user', content: typed }), typed).toBeNull()
      expect(exportHeading({ role: 'user', content: typed }), typed).toBeUndefined()
    }
    expect(exportHeading({ role: 'assistant', content: 'An answer.' })).toBeUndefined()
  })

  it('the desktop export is as it was: the stored text of every message', () => {
    const conversation = chat([question, answer(ANSWERS['reminder tag'])])
    const text = exportAsMarkdown(conversation)
    expect(text).toContain(question.content)
    expect(text).toContain(ANSWERS['reminder tag'])
    // Also what a tool gave back: under the role it is stored with, with its frame.
    const withTool = exportAsMarkdown(chat([{ id: 't1', role: 'user', content: buildHermesToolResult('web_search', 'three hits'), timestamp: 1 } as Message]))
    expect(withTool).toContain('### You')
    expect(withTool).toContain('<tool_response>')
  })

  it('the wiring: the phone reads answers through its adapter, and the export hands the reader text in', () => {
    const root = resolve(__dirname, '..')
    const read = (file: string) => readFileSync(resolve(root, file), 'utf8')
    expect(read('screens/chat/parts/adapters/handover.ts')).toMatch(/messageText: \(message\) => exportMessageText\(message, answerBody\)/)
    expect(read('screens/chat/parts/adapters/handover.ts')).toMatch(/messageHeading: exportHeading/)
    // Nobody in the chat strand reads lib/message-error.ts past the adapter.
    for (const file of ['screens/chat/ChatPage.tsx', 'screens/chat/parts/MessageItem.tsx', 'screens/chat/parts/logic/chat-list.ts', 'screens/chat/parts/logic/messages.ts', 'screens/chat/MessageEditPage.tsx', 'resilience/ResumeNotice.tsx']) {
      const source = read(file)
      expect(source, file).not.toMatch(/from '[./]+lib\/message-error'/)
      expect(source, file).toMatch(/adapters\/run-error'/)
    }
  })
})
