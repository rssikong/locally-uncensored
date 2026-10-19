/**
 * GH #181: a persona's reminder, sent near the end of the prompt.
 *
 * What is asserted here is the placement rule on its own (depth, the user
 * turn it rides in, the fallbacks), that it stays inside the send budget,
 * that the wire contract after it still alternates, and that a character
 * card's depth prompt comes in and goes out with it.
 *
 * Run: npx vitest run src/lib/__tests__/persona-note.test.ts
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_NOTE_DEPTH, MAX_NOTE_DEPTH, clampNoteDepth,
  injectPersonaNote, noteTokens, personaNoteOf, type PersonaNote,
} from '../persona-note'
import { applyChatSendBudget } from '../chat-send-budget'
import { estimateMessageTokens } from '../context-compaction'
import { applyTemplateContract } from '../../api/providers/normalize-system'
import { personaFromCard, personaToCardV2 } from '../character-card'
import { speakerPersonaFor } from '../chat-persona'
import type { Persona } from '../../types/settings'

const NOTE = 'Stay Sherlock. Status block: [mood | clue].'
const note = (depth: number): PersonaNote => ({ text: NOTE, depth })

type M = { role: string; content: string }
const chat = (): M[] => [
  { role: 'system', content: 'You are Sherlock.' },
  { role: 'user', content: 'u1' },
  { role: 'assistant', content: 'a1' },
  { role: 'user', content: 'u2' },
  { role: 'assistant', content: 'a2' },
  { role: 'user', content: 'u3' },
]

describe('personaNoteOf', () => {
  it('no reminder, or only whitespace, is none', () => {
    expect(personaNoteOf(undefined)).toBeNull()
    expect(personaNoteOf({ name: 'X' })).toBeNull()
    expect(personaNoteOf({ name: 'X', note: '  \n ' })).toBeNull()
  })

  it('a persona without a depth gets the default one, a wild depth is clamped', () => {
    expect(personaNoteOf({ name: 'X', note: ' hi ' })).toEqual({ text: 'hi', depth: DEFAULT_NOTE_DEPTH })
    expect(personaNoteOf({ name: 'X', note: 'hi', noteDepth: 999 })!.depth).toBe(MAX_NOTE_DEPTH)
    expect(personaNoteOf({ name: 'X', note: 'hi', noteDepth: -3 })!.depth).toBe(0)
    expect(clampNoteDepth(Number.NaN)).toBe(DEFAULT_NOTE_DEPTH)
    expect(clampNoteDepth(2.6)).toBe(3)
  })

  it('a character card fills in {{char}} and {{user}}, as its prompt does', () => {
    const card = {
      description: '', personality: '', scenario: '', firstMessage: '', exampleMessages: '', alternateGreetings: [],
      systemPrompt: '', postHistoryInstructions: '', creatorNotes: '',
    }
    expect(personaNoteOf({ name: 'Baron', card, note: '{{char}} never calls {{user}} by name.' })!.text)
      .toBe('Baron never calls User by name.')
  })
})

describe('injectPersonaNote: where the reminder lands', () => {
  it('depth 0 is the latest message, behind what the user wrote', () => {
    const out = injectPersonaNote(chat(), note(0))
    expect(out[5].content).toBe(`u3\n\n${NOTE}`)
    expect(out.filter((m) => m.content.includes(NOTE))).toHaveLength(1)
  })

  it('depth counts messages from the end, the system prompt not among them', () => {
    expect(injectPersonaNote(chat(), note(2))[3].content).toBe(`u2\n\n${NOTE}`)
    expect(injectPersonaNote(chat(), note(4))[1].content).toBe(`u1\n\n${NOTE}`)
  })

  it('an assistant turn at that depth hands it to the user turn before it, never to the model\'s own words', () => {
    const out = injectPersonaNote(chat(), note(1))
    expect(out[3].content).toBe(`u2\n\n${NOTE}`)
    expect(out[4].content).toBe('a2')
  })

  it('deeper than the chat is long: the first user turn', () => {
    expect(injectPersonaNote(chat(), note(40))[1].content).toBe(`u1\n\n${NOTE}`)
  })

  it('a chat that opens on a greeting: the nearest user turn after it', () => {
    const msgs: M[] = [{ role: 'system', content: 's' }, { role: 'assistant', content: 'Hello traveller.' }, { role: 'user', content: 'hi' }]
    expect(injectPersonaNote(msgs, note(1))[2].content).toBe(`hi\n\n${NOTE}`)
  })

  it('no user turn at all: behind the system prompt, and without one as a user turn', () => {
    expect(injectPersonaNote([{ role: 'system', content: 's' }, { role: 'assistant', content: 'a' }], note(0))[0].content).toBe(`s\n\n${NOTE}`)
    expect(injectPersonaNote([] as M[], note(0))).toEqual([{ role: 'user', content: NOTE }])
  })

  it('adds no message and never changes the input', () => {
    const input = chat()
    const copy = JSON.parse(JSON.stringify(input))
    const out = injectPersonaNote(input, note(0))
    expect(out).toHaveLength(input.length)
    expect(input).toEqual(copy)
  })

  it('no reminder: the same array, by reference', () => {
    const input = chat()
    expect(injectPersonaNote(input, null)).toBe(input)
  })

  it('a user turn without text (tool payloads) is passed over', () => {
    const msgs = [{ role: 'user', content: 'task' }, { role: 'assistant', content: '' }, { role: 'tool', content: 'result' }, { role: 'user', content: [{ type: 'image' }] as unknown as string }]
    const out = injectPersonaNote(msgs, note(0))
    expect(out[0].content).toBe(`task\n\n${NOTE}`)
    expect(out[2].content).toBe('result')
  })
})

describe('the wire contract after the reminder', () => {
  it('two user turns in a row are still merged into one, and the reminder rides along once', () => {
    // A group payload: another member's line reaches this model as a user turn.
    const msgs: M[] = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'who did it?' },
      { role: 'user', content: '[Watson] I examined the body.' },
    ]
    const out = applyTemplateContract(injectPersonaNote(msgs, note(0)), { toolRole: 'native', alternate: true })
    expect(out).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: `who did it?\n\n[Watson] I examined the body.\n\n${NOTE}` },
    ])
  })

  it('a strict template sees one system message at the front and the reminder deep in the chat', () => {
    const out = applyTemplateContract(injectPersonaNote(chat(), note(2)), { toolRole: 'text', alternate: true })
    expect(out.filter((m) => m.role === 'system')).toHaveLength(1)
    expect(out[0].content).not.toContain(NOTE)
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'user'])
  })
})

describe('the send budget', () => {
  const long = (n: number): M[] => [
    { role: 'system', content: 'You are Sherlock.' },
    // 300, not 400: since 3.0.7 every digit is a token of its own, and at 400
    // the four turns the trim always keeps plus the pinned first one were
    // already over the budget by themselves.
    ...Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i} `.repeat(300) })),
  ]
  const input = { providerId: 'openai', modelWindow: 20_000, sendWindowTokens: 8_000, contextDecay: true }

  it('the payload with the reminder stays within the budget a payload without one gets', () => {
    const plain = applyChatSendBudget(long(60), input)
    const withNote = applyChatSendBudget(long(60), { ...input, note: note(4) })
    expect(plain.budget).not.toBeNull()
    expect(estimateMessageTokens(withNote.messages as never)).toBeLessThanOrEqual(plain.budget!)
    expect(withNote.promptTokens).toBe(estimateMessageTokens(withNote.messages as never))
    expect(withNote.budget).toBe(plain.budget)
  })

  it('a trim never takes the reminder with it: it sits at its depth in what goes out', () => {
    // 61 turns: the latest one is the user's, as on every send.
    const out = applyChatSendBudget(long(61), { ...input, note: note(2) }).messages
    expect(out.length).toBeLessThan(62)
    const at = out.findIndex((m) => m.content.includes(NOTE))
    expect(out.length - 1 - at).toBe(2)
  })

  it('counts what it costs', () => {
    expect(noteTokens(null)).toBe(0)
    expect(noteTokens(note(0))).toBeGreaterThan(0)
  })

  it('with the notaus off the history is untouched and the reminder still goes in', () => {
    const msgs = long(7)
    const out = applyChatSendBudget(msgs, { ...input, contextDecay: false, note: note(0) })
    expect(out.budget).toBeNull()
    expect(out.messages.slice(0, -1)).toEqual(msgs.slice(0, -1))
    expect(out.messages.at(-1)!.content.endsWith(NOTE)).toBe(true)
  })

  it('without a reminder it is exactly the call without one', () => {
    const msgs = long(6)
    expect(applyChatSendBudget(msgs, { ...input, note: null })).toEqual(applyChatSendBudget(msgs, input))
  })
})

describe('whose reminder: speakerPersonaFor', () => {
  const SHERLOCK: Persona = { id: 'sherlock', name: 'Sherlock', icon: 'Search', systemPrompt: 'S', isBuiltIn: false, note: 'n1' }
  const WATSON: Persona = { id: 'watson', name: 'Watson', icon: 'User', systemPrompt: 'W', isBuiltIn: false, note: 'n2' }
  const personas = [SHERLOCK, WATSON]
  const group = { groupModels: ['a', 'b'], groupPersonas: { a: 'sherlock', b: 'watson' } }

  it('each group member gets the persona it plays', () => {
    expect(speakerPersonaFor(group, 'a', personas, undefined, false)?.id).toBe('sherlock')
    expect(speakerPersonaFor(group, 'b', personas, undefined, false)?.id).toBe('watson')
  })

  it('a member without one falls back to the chat persona only while that is on', () => {
    const conv = { groupModels: ['a', 'b'], groupPersonas: { a: 'sherlock' }, personaId: 'watson' }
    expect(speakerPersonaFor(conv, 'b', personas, undefined, true)).toBeUndefined()
    expect(speakerPersonaFor({ ...conv, personaEnabled: true }, 'b', personas, undefined, true)?.id).toBe('watson')
  })

  it('a plain chat: the chat persona, gated on both switches', () => {
    const conv = { personaId: 'sherlock', personaEnabled: true }
    expect(speakerPersonaFor(conv, 'x', personas, undefined, true)?.id).toBe('sherlock')
    expect(speakerPersonaFor(conv, 'x', personas, undefined, false)).toBeUndefined()
    expect(speakerPersonaFor({ personaId: 'sherlock' }, 'x', personas, undefined, true)).toBeUndefined()
  })
})

describe('character cards carry it as their depth prompt', () => {
  const parsed = (extensions?: Record<string, unknown>) => ({
    name: 'Baron',
    card: {
      description: 'd', personality: '', scenario: '', firstMessage: '', exampleMessages: '', alternateGreetings: [],
      systemPrompt: '', postHistoryInstructions: '', creatorNotes: '', ...(extensions ? { extensions } : {}),
    },
  })

  it('a card with a depth prompt comes in with that reminder and depth', () => {
    const p = personaFromCard(parsed({ depth_prompt: { prompt: ' Speak in rhyme. ', depth: 2, role: 'system' } }) as never, 'id1')
    expect([p.note, p.noteDepth]).toEqual(['Speak in rhyme.', 2])
  })

  it('a card without one comes in without a reminder', () => {
    const p = personaFromCard(parsed() as never, 'id2')
    expect('note' in p).toBe(false)
    expect('noteDepth' in p).toBe(false)
  })

  it('an edit in LU goes out with the card, the rest of its extensions untouched', () => {
    const p = personaFromCard(parsed({ depth_prompt: { prompt: 'old', depth: 4, role: 'system' }, other: 1 }) as never, 'id3')
    const out = personaToCardV2({ ...p, note: 'new', noteDepth: 1 }) as { data: { extensions: Record<string, unknown> } }
    expect(out.data.extensions).toEqual({ depth_prompt: { prompt: 'new', depth: 1, role: 'system' }, other: 1 })
  })
})
