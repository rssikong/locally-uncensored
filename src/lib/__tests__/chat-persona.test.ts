import { describe, it, expect } from 'vitest'
import type { Persona } from '../../types/settings'
import { resolveChatPersona, withChatPersona, personaPromptOf, samplingPresetFor } from '../chat-persona'
import { buildChatSystemPrompt } from '../system-prompt'
import { groupSpeakers } from '../group-chat'

/** GH #170: the persona a chat sends is the one it shows. */
const walt: Persona = { id: 'walt', name: 'Walt', icon: 'User', isBuiltIn: false, systemPrompt: 'You are Walt.' }
const baron: Persona = { id: 'baron', name: 'Baron', icon: 'User', isBuiltIn: false, systemPrompt: 'You are Baron.' }
const personas = [walt, baron]

describe('resolveChatPersona', () => {
  it('follows the persona the chat recorded, not the copy it was created with', () => {
    const conv = { personaId: 'baron', systemPrompt: 'You are Walt.' }
    expect(resolveChatPersona(conv, personas, 'walt')).toEqual({ persona: baron, prompt: 'You are Baron.' })
  })

  it('NEGATIVKONTROLLE: the app wide pick does not override a chat that recorded its own', () => {
    expect(resolveChatPersona({ personaId: 'walt', systemPrompt: '' }, personas, 'baron').persona).toBe(walt)
  })

  it('reads the persona prompt as it stands today', () => {
    const edited = [walt, { ...baron, systemPrompt: 'You are Baron, edited.' }]
    expect(resolveChatPersona({ personaId: 'baron', systemPrompt: 'You are Baron.' }, edited, 'walt').prompt)
      .toBe('You are Baron, edited.')
  })

  it('falls back to the kept copy, under no persona name, when the persona was deleted', () => {
    expect(resolveChatPersona({ personaId: 'gone', systemPrompt: 'You are Gone.' }, personas, 'walt'))
      .toEqual({ prompt: 'You are Gone.' })
  })

  it('keeps an older chat on its copy and names the persona that copy belongs to', () => {
    expect(resolveChatPersona({ systemPrompt: 'You are Baron.' }, personas, 'walt'))
      .toEqual({ persona: baron, prompt: 'You are Baron.' })
  })

  it('an older chat without a copy follows the app wide pick, which the menu shows for it', () => {
    expect(resolveChatPersona({ systemPrompt: '' }, personas, 'baron')).toEqual({ persona: baron, prompt: 'You are Baron.' })
  })

  it('fills in the macros of a character card persona', () => {
    const card = { ...baron, systemPrompt: 'You are {{char}}, talking to {{user}}.', card: {} as Persona['card'] }
    expect(personaPromptOf(card)).toBe('You are Baron, talking to User.')
  })
})

describe('the system prompt of a chat', () => {
  it('carries the persona the chat picked once the persona is on for it', () => {
    const conv = withChatPersona({ personaId: 'baron', systemPrompt: 'You are Walt.', personaEnabled: true }, personas, 'walt')
    const sent = buildChatSystemPrompt(conv)
    expect(sent).toContain('You are Baron.')
    expect(sent).not.toContain('You are Walt.')
  })
})

describe('group chat persona keys', () => {
  it('the two Gemma builds of the report sit on two different keys', () => {
    // One build in KoboldCpp through the Ollama slot (no prefix), one in
    // LM Studio through the OpenAI compatible slot (prefixed). The key is the
    // full model name, slot and model id.
    const kobold = 'gemma-4-31B-it-UD-Q8_K_XL'
    const lmstudio = 'openai::gemma-4-31b-it-2'
    const speakers = groupSpeakers([kobold, lmstudio], { [kobold]: 'baron', [lmstudio]: 'walt' }, personas)
    expect(speakers[kobold].personaPrompt).toBe('You are Baron.')
    expect(speakers[lmstudio].personaPrompt).toBe('You are Walt.')
  })
})

/** GH #175: the sampling values a persona carries, per speaker. */
describe('samplingPresetFor', () => {
  const cold: Persona = { ...walt, sampling: { temperature: 0.2, minP: 0.1 } }
  const hot: Persona = { ...baron, sampling: { temperature: 1.3, repeatPenalty: 1.15 } }
  const both = [cold, hot]

  it('a chat with its persona switched on gets that persona\'s values', () => {
    const conv = { personaId: 'baron', systemPrompt: '', personaEnabled: true }
    expect(samplingPresetFor(conv, 'm', both, 'walt', true)).toEqual({ persona: hot, preset: hot.sampling })
  })

  it('NEGATIVKONTROLLE: no values while the persona is off for the chat or off app wide', () => {
    expect(samplingPresetFor({ personaId: 'baron', systemPrompt: '', personaEnabled: false }, 'm', both, 'walt', true)).toEqual({})
    expect(samplingPresetFor({ personaId: 'baron', systemPrompt: '', personaEnabled: true }, 'm', both, 'walt', false)).toEqual({})
  })

  it('in a group every member gets the values of its own persona', () => {
    const conv = {
      systemPrompt: '',
      groupModels: ['a', 'b'],
      groupPersonas: { a: 'walt', b: 'baron' },
    }
    expect(samplingPresetFor(conv, 'a', both, 'walt', true).preset).toEqual({ temperature: 0.2, minP: 0.1 })
    expect(samplingPresetFor(conv, 'b', both, 'walt', true).preset).toEqual({ temperature: 1.3, repeatPenalty: 1.15 })
  })

  it('a group member without a persona of its own follows the chat persona', () => {
    const conv = {
      personaId: 'baron', systemPrompt: '', personaEnabled: true,
      groupModels: ['a', 'b'],
      groupPersonas: { a: 'walt' },
    }
    expect(samplingPresetFor(conv, 'b', both, 'walt', true).persona).toBe(hot)
  })
})
