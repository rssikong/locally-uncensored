// GH #180: with group chat turned off, a thread that was a group sent every
// earlier turn of every speaker as the current model's own assistant turn,
// and turning group chat back on lost the persona tags of the older turns.
//
// Run: npx vitest run src/lib/__tests__/group-history-outside-group.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  groupHistory, groupSpeakers, hasGroupHistory, soloHistoryTag, soloSpeakers, soloTurnAuthorFields,
} from '../group-chat'
import { plainChatSpeaker } from '../chat-persona'
import { useChatStore } from '../../stores/chatStore'
import type { Message } from '../../types/chat'
import type { Persona } from '../../types/settings'

const WALT = { id: 'p-walt', name: 'Walt', systemPrompt: 'You are Walt.' } as Persona
const BARON = { id: 'p-baron', name: 'Baron', systemPrompt: 'You are Baron.' } as Persona
const personas = [WALT, BARON]
const X = 'lmstudio::gemma-31b'
const Y = 'ollama::gemma-31b-q8'

let n = 0
const msg = (o: Partial<Message>): Message => ({ id: `m-${++n}`, role: 'user', content: 'hello', timestamp: n, ...o })

/** The plain payload as useChat builds it: tag what soloHistoryTag tags. */
function plainWire(messages: Message[], model: string, persona?: { id: string; name: string }, groupPersonas?: Record<string, string>) {
  const speakers = soloSpeakers(model, persona)
  return messages.map((m) => {
    const tag = soloHistoryTag(m, model, speakers, { groupPersonas, personas })
    return tag ? { role: 'user', content: `[${tag}] ${m.content}` } : { role: m.role, content: m.content }
  })
}

/** A group of two with a persona each, one round, then group chat off. */
function groupThenOff(): string {
  const s = useChatStore.getState()
  const id = s.createConversation(X, '', 'lu')
  s.setGroupModels(id, [X, Y])
  s.setGroupPersona(id, X, WALT.id)
  s.setGroupPersona(id, Y, BARON.id)
  s.addMessage(id, msg({ role: 'user', content: 'start' }))
  // Turns from before 3.0.7 carry no persona of their own.
  s.addMessage(id, msg({ role: 'assistant', modelId: X, content: 'walt one' }))
  s.addMessage(id, msg({ role: 'assistant', modelId: Y, content: 'baron one' }))
  s.setGroupModels(id, [])
  return id
}
const conv = (id: string) => useChatStore.getState().conversations.find((c) => c.id === id)!

describe('a thread that has been a group', () => {
  beforeEach(() => useChatStore.setState({ conversations: [], activeConversationId: null }))

  it('is recognised after group chat is turned off, and a plain chat is not', () => {
    const id = groupThenOff()
    expect(hasGroupHistory(conv(id))).toBe(true)
    expect(hasGroupHistory({ messages: [msg({ role: 'assistant', modelId: X })] })).toBe(false)
    expect(hasGroupHistory({ messages: [msg({ role: 'assistant', modelId: X, groupPersonaId: WALT.id })] })).toBe(true)
  })

  it('sends the other speaker tagged as a user turn, not as the model own line', () => {
    const id = groupThenOff()
    const wire = plainWire(conv(id).messages, X, { id: WALT.id, name: WALT.name })
    expect(wire).toEqual([
      { role: 'user', content: 'start' },
      { role: 'assistant', content: 'walt one' },
      { role: 'user', content: '[Baron] baron one' },
    ])
  })

  it('keeps every turn of the model its own when it speaks as itself', () => {
    const id = groupThenOff()
    const wire = plainWire(conv(id).messages, X)
    expect(wire[1]).toEqual({ role: 'assistant', content: 'walt one' })
    expect(wire[2]).toEqual({ role: 'user', content: '[Baron] baron one' })
  })

  it('tags the model own turns when the chat now speaks as another persona', () => {
    const id = groupThenOff()
    const wire = plainWire(conv(id).messages, X, { id: BARON.id, name: BARON.name })
    expect(wire[1]).toEqual({ role: 'user', content: '[Walt] walt one' })
    expect(wire[2]).toEqual({ role: 'assistant', content: 'baron one' })
  })

  it('leaves a tool calling turn as it is, so its results still follow a call', () => {
    const call = msg({ role: 'assistant', modelId: Y, groupPersonaId: BARON.id, tool_calls: [{ function: { name: 'web_search', arguments: {} } }] })
    expect(soloHistoryTag(call, X, soloSpeakers(X), { personas })).toBeNull()
  })

  // Negative control: a plain chat in which the user switched models never
  // was a group, and nothing in it is tagged (useChat only asks when
  // hasGroupHistory is true, and a model's own turns stay its own anyway).
  it('changes nothing for the model own untagged turns', () => {
    expect(soloHistoryTag(msg({ role: 'assistant', modelId: X }), X, soloSpeakers(X))).toBeNull()
    expect(soloHistoryTag(msg({ role: 'user' }), X, soloSpeakers(X))).toBeNull()
  })
})

describe('turning group chat off and on keeps who said what', () => {
  beforeEach(() => useChatStore.setState({ conversations: [], activeConversationId: null }))

  it('stamps the personas on the way out and keeps them on the way back', () => {
    const id = groupThenOff()
    const [, walt, baron] = conv(id).messages
    expect(walt.groupPersonaId).toBe(WALT.id)
    expect(baron.groupPersonaId).toBe(BARON.id)

    // Back on, nobody picked again yet: the older turns still carry their tags.
    const s = useChatStore.getState()
    s.setGroupModels(id, [X])
    s.setGroupModels(id, [X, Y])
    const c = conv(id)
    const toY = groupHistory(c.messages, Y, groupSpeakers([X, Y], c.groupPersonas, personas), { groupPersonas: c.groupPersonas, personas })
    expect(toY[1]).toEqual({ role: 'user', content: '[Walt] walt one' })

    // Picks restored: each persona owns its old lines again.
    s.setGroupPersona(id, X, WALT.id)
    s.setGroupPersona(id, Y, BARON.id)
    const c2 = conv(id)
    const speakers = groupSpeakers([X, Y], c2.groupPersonas, personas)
    const toX = groupHistory(c2.messages, X, speakers, { groupPersonas: c2.groupPersonas, personas })
    expect(toX[1]).toEqual({ role: 'assistant', content: 'walt one' })
    expect(toX[2]).toEqual({ role: 'user', content: '[Baron] baron one' })
  })

  it('a plain turn records its author and keeps it after group chat is back', () => {
    const id = groupThenOff()
    const s = useChatStore.getState()
    // Off: X answers as itself, then as Walt.
    s.addMessage(id, msg({ role: 'assistant', modelId: X, content: 'x alone', ...soloTurnAuthorFields() }))
    s.addMessage(id, msg({ role: 'assistant', modelId: X, content: 'x as walt', ...soloTurnAuthorFields({ id: WALT.id, name: WALT.name }) }))
    // On again, and X now plays Baron: neither plain turn moves to Baron.
    s.setGroupModels(id, [X, Y])
    s.setGroupPersona(id, X, BARON.id)
    const c = conv(id)
    const ids = c.messages.map((m) => m.content)
    const alone = c.messages[ids.indexOf('x alone')]
    expect(alone.noGroupPersona).toBe(true)
    expect(alone.groupPersonaId).toBeUndefined()
    const toY = groupHistory(c.messages, Y, groupSpeakers([X, Y], c.groupPersonas, personas), { groupPersonas: c.groupPersonas, personas })
    expect(toY[ids.indexOf('x alone')]).toEqual({ role: 'user', content: `[${X}] x alone` })
    expect(toY[ids.indexOf('x as walt')]).toEqual({ role: 'user', content: '[Walt] x as walt' })
  })
})

describe('the plain chat speaker', () => {
  it('is the chat persona only when it is switched on', () => {
    expect(plainChatSpeaker({ personaId: WALT.id, personaEnabled: true }, personas, undefined)).toEqual({ id: WALT.id, name: 'Walt' })
    expect(plainChatSpeaker({ personaId: WALT.id, personaEnabled: false }, personas, undefined)).toBeUndefined()
    expect(plainChatSpeaker({ personaId: WALT.id, personaEnabled: true }, personas, undefined, false)).toBeUndefined()
  })
})

describe('the plain chat path is wired to it', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useChat.ts'), 'utf8')
  const plain = src.slice(src.indexOf('const assistantMessage = {\n      id: uuid(),\n      role: "assistant"'))
  it('records the author of a new plain turn in a group thread', () => {
    expect(src).toMatch(/hasGroupHistory\(soloConv\)/)
    expect(plain).toMatch(/soloTurnAuthorFields\(soloPersona\.persona\)/)
  })
  it('tags the other speakers in the payload and explains the tags', () => {
    expect(plain).toMatch(/role: \(tag \? 'user' : m\.role\)/)
    expect(plain).toMatch(/SOLO_HISTORY_LINE/)
  })
})
