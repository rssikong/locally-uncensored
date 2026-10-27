/**
 * GH #171, second part: exporting a group chat as Markdown headed every model
 * turn "### Assistant", so who said what was lost. The user renamed the
 * headings to "### ウォルト" and "### バロン" by hand.
 *
 * Each model turn now carries the persona and the model that wrote it, in
 * Markdown and in JSON. A single-model chat keeps its headings.
 *
 * Run: npx vitest run src/lib/__tests__/group-chat-export-names-the-speakers.test.ts
 */
import { describe, it, expect } from 'vitest'
import { exportAsMarkdown, exportAsJSON } from '../chat-export'
import type { Conversation } from '../../types/chat'

const A = 'openai::qwen3-32b'
const B = 'ollama::llama3.3:70b'
const WALT = { id: 'walt', name: 'ウォルト', icon: 'User', systemPrompt: 'You are Walt.', isBuiltIn: false }
const BARON = { id: 'baron', name: 'バロン', icon: 'User', systemPrompt: 'You are the Baron.', isBuiltIn: false }

const group: Conversation = {
  id: 'g1',
  title: 'Harbour',
  model: A,
  systemPrompt: '',
  createdAt: 1712160000000,
  updatedAt: 1712160000000,
  groupModels: [A, B],
  groupPersonas: { [A]: 'walt', [B]: 'baron' },
  messages: [
    { id: 'u1', role: 'user', content: 'Where do we sail?', timestamp: 1 },
    { id: 'a1', role: 'assistant', content: 'North.', modelId: A, timestamp: 2 },
    { id: 'a2', role: 'assistant', content: 'South.', modelId: B, timestamp: 3 },
  ],
}

const headings = (md: string) => md.split('\n').filter((line) => line.startsWith('### '))

describe('GH #171: a group chat export names who wrote each turn', () => {
  it('Markdown: persona and model on every model turn, never "Assistant"', () => {
    const md = exportAsMarkdown(group, { personas: [WALT, BARON] })
    expect(headings(md)).toEqual([
      '### You',
      '### ウォルト (qwen3-32b)',
      '### バロン (llama3.3:70b)',
    ])
  })

  it('Markdown: a participant without a persona is headed by its model', () => {
    const md = exportAsMarkdown({ ...group, groupPersonas: { [A]: 'walt' } }, { personas: [WALT, BARON] })
    expect(headings(md)).toEqual(['### You', '### ウォルト (qwen3-32b)', '### llama3.3:70b'])
  })

  it('Markdown: the persona recorded at the turn wins over a later pick', () => {
    const later: Conversation = {
      ...group,
      // The user has since moved model A to another persona.
      groupPersonas: { [A]: 'baron', [B]: 'baron' },
      messages: group.messages.map((m) => (m.id === 'a1' ? { ...m, groupPersonaId: 'walt', groupSpeakerName: 'ウォルト' } : m)),
    }
    expect(headings(exportAsMarkdown(later, { personas: [WALT, BARON] }))[1]).toBe('### ウォルト (qwen3-32b)')
  })

  it('Markdown: a persona deleted since keeps the name it had at the turn', () => {
    const gone: Conversation = {
      ...group,
      groupPersonas: undefined,
      messages: group.messages.map((m) => (m.id === 'a1' ? { ...m, groupPersonaId: 'walt', groupSpeakerName: `ウォルト (${A})` } : m)),
    }
    expect(headings(exportAsMarkdown(gone, { personas: [BARON] }))[1]).toBe('### ウォルト (qwen3-32b)')
  })

  it('JSON: every model turn carries its persona next to the model it already had', () => {
    const parsed = JSON.parse(exportAsJSON(group, [WALT, BARON])) as Conversation
    const said = parsed.messages.filter((m) => m.role === 'assistant') as Array<Conversation['messages'][number] & { speakerPersona?: string }>
    expect(said.map((m) => [m.speakerPersona, m.modelId])).toEqual([['ウォルト', A], ['バロン', B]])
    // The user turn gets nothing it did not have.
    expect('speakerPersona' in parsed.messages[0]).toBe(false)
  })

  it('NEGATIVE CONTROL: a single-model chat keeps "### Assistant" and an unchanged JSON', () => {
    const single: Conversation = { ...group, groupModels: undefined, groupPersonas: undefined }
    expect(headings(exportAsMarkdown(single, { personas: [WALT, BARON] }))).toEqual(['### You', '### Assistant', '### Assistant'])
    expect(exportAsJSON(single, [WALT, BARON])).toBe(JSON.stringify(single, null, 2))
  })
})
