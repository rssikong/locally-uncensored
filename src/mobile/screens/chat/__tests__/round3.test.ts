/** Round 3, findings of the acceptance on the small iPhone: M1, M3, M4, M8. */
import { describe, expect, it } from 'vitest'
import { personaNameFor } from '../../agent/parts/options/chat-settings'
import { CHAT_STRINGS as S } from '../../../strings/chat'
import { thoughtTail, THOUGHT_TAIL_CHARS } from '../../agent/parts/blocks'
import { claimThinkingDefault, THINKING_DEFAULT_KEY } from '../parts/thinking-default'
import { chatTitleShown, wholeWordTitle } from '../parts/logic/chat-list'
import { saveNote } from '../parts/adapters/handover'
import { phoneEngineNote, PHONE_WAY } from '../parts/engine-note'
import { readAloudWay, showsSpeakButton } from '../parts/read-aloud'
import { readingLanguage } from '../parts/voice-pref'
import { answerSpeedInput, measuresSpeed, speedFigure } from '../parts/adapters/generation-speed'
import { newChatUsesPersona, ranOnOther, sameModel, visionWay } from '../parts/logic/chat-state'

describe('M1: a first model that is still downloading is not "No model yet"', () => {
  // Which model is on its way is decided in screens/models/parts/arriving.ts and tested there.
  it('the chat names it', () => {
    // Round 9, N13: it said "Loading", the word for a model that is taken into memory.
    expect(S.chat.incomingTitle('Qwen 3.5 0.8B')).toBe('Qwen 3.5 0.8B is downloading')
    expect(S.chat.incomingTitle('Qwen3 1.7B')).not.toMatch(/^Loading/)
    expect(S.chat.incomingTitle('Qwen3 1.7B')).not.toBe(S.chat.loadingModel('Qwen3 1.7B'))
  })
})

describe('M8: "This chat ran on X before" only when X is not the active model', () => {
  const chat = (modelId: string) => ({ model: 'openai::SmolLM2-360M-Instruct-Q4_K_M', messages: [{ role: 'user' as const }, { role: 'assistant' as const, modelId }] })
  it('the bare name of a message and the routed name of the picker are one model', () => {
    expect(sameModel('Qwen3.5-0.8B-Q4_K_M', 'openai::Qwen3.5-0.8B-Q4_K_M')).toBe(true)
    expect(sameModel('openai::Qwen3.5-0.8B-Q4_K_M', 'Qwen3.5-0.8B-Q4_K_M.gguf')).toBe(true)
    expect(ranOnOther(chat('Qwen3.5-0.8B-Q4_K_M'), 'openai::Qwen3.5-0.8B-Q4_K_M')).toBeNull()
    expect(ranOnOther(chat('openai::Qwen3.5-0.8B-Q4_K_M'), 'openai::Qwen3.5-0.8B-Q4_K_M')).toBeNull()
  })
  it('another model is still named', () => {
    expect(ranOnOther(chat('openai::Qwen3.5-0.8B-Q4_K_M'), 'openai::SmolLM2-360M-Instruct-Q4_K_M')).toBe('openai::Qwen3.5-0.8B-Q4_K_M')
    expect(ranOnOther(chat('Qwen3.5-0.8B-Q4_K_M'), null)).toBe('Qwen3.5-0.8B-Q4_K_M')
  })
  it('the same file name at two providers is two models', () => {
    expect(sameModel('openai::gpt-x', 'lu-cloud::gpt-x')).toBe(false)
  })
  it('a chat without an answer has nothing to say', () => {
    expect(ranOnOther({ model: 'a', messages: [] }, 'b')).toBeNull()
    expect(ranOnOther(null, 'b')).toBeNull()
  })
})

describe('M3: attaching a photo without a model that reads images has a way', () => {
  it('an installed one first, then the catalogue, else LU Cloud', () => {
    expect(visionWay(true, false)).toBe('installed')
    expect(visionWay(true, true)).toBe('installed')
    expect(visionWay(false, true)).toBe('catalog')
    expect(visionWay(false, false)).toBe('cloud')
  })
  it('every way has a sentence that says where images can be read', () => {
    for (const text of [S.model.visionInstalled, S.model.visionCatalog, S.model.visionCloud, S.model.visionNoneLocal, S.attach.noVision]) {
      expect(text).toMatch(/image/)
      expect(text).not.toMatch(/[–—]/)
    }
    expect(S.model.visionCloud).toMatch(/LU Cloud/)
  })
})

describe('M4: "Use personas: On" holds for a new chat', () => {
  it('on in the settings and a persona chosen: the new chat uses it', () => {
    expect(newChatUsesPersona(true, true, null)).toBe(true)
    expect(newChatUsesPersona(true, true, true)).toBe(true)
  })
  it('switched off for this chat before the first message: it stays off', () => {
    expect(newChatUsesPersona(true, true, false)).toBe(false)
  })
  it('off in the settings, or no persona text: never', () => {
    expect(newChatUsesPersona(false, true, true)).toBe(false)
    expect(newChatUsesPersona(true, false, null)).toBe(false)
  })
  it('the chip names the persona the chat started with, not the one that is active now', () => {
    const personas = [{ name: 'Code Expert', systemPrompt: 'You code.' }, { name: 'Poet', systemPrompt: 'You rhyme.' }]
    expect(personaNameFor(true, 'You code.', personas, 'Poet')).toBe('Code Expert')
    expect(personaNameFor(true, 'Edited since', personas, 'Poet')).toBeNull()
    // A chat without a text gets the active persona when its switch is turned on.
    expect(personaNameFor(true, '', personas, 'Poet')).toBe('Poet')
    expect(personaNameFor(false, '', personas, 'Poet')).toBe('Poet')
  })
})

describe('Android H4: thinking on a phone', () => {
  it('the default is applied once and never again', () => {
    const kept = new Map<string, string>()
    const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) }
    expect(claimThinkingDefault(storage)).toBe(true)
    expect(kept.get(THINKING_DEFAULT_KEY)).toBe('off')
    // The user turned thinking on afterwards: the next start leaves it alone.
    expect(claimThinkingDefault(storage)).toBe(false)
  })
  it('a store that cannot be reached changes nothing', () => {
    expect(claimThinkingDefault(null)).toBe(false)
    expect(claimThinkingDefault({ getItem: () => { throw new Error('denied') }, setItem: () => undefined })).toBe(false)
  })
  it('a growing thought shows its end, cut at a word', () => {
    expect(thoughtTail('short thought')).toBe('short thought')
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')
    const tail = thoughtTail(long)
    expect(tail.startsWith('... word')).toBe(true)
    expect(tail.endsWith('word199')).toBe(true)
    expect(tail.length).toBeLessThanOrEqual(THOUGHT_TAIL_CHARS + 4)
  })
  it('the hint after a thought without an answer offers the way out', () => {
    expect(S.message.answerWithoutThinking).toBe('Answer without thinking')
    expect(S.message.thoughtOnly).not.toMatch(/Try again/)
  })
})

describe('Android N6: a title never ends in half a word', () => {
  const question = 'What should I name my dog called after a river in the north?'
  it('a title cut inside a word ends at the last whole word', () => {
    const cut = question.slice(0, 29)
    expect(cut).toBe('What should I name my dog cal')
    expect(wholeWordTitle(cut, question)).toBe('What should I name my dog…')
  })
  it('a title cut between two words only says that there was more', () => {
    expect(wholeWordTitle('What should I name my dog', question)).toBe('What should I name my dog…')
  })
  it('the whole message, a renamed chat and one long word stay as they are', () => {
    expect(wholeWordTitle('Hi there', 'Hi there')).toBe('Hi there')
    expect(wholeWordTitle('Dog names', question)).toBe('Dog names')
    expect(wholeWordTitle('Donaudampfschiff', 'Donaudampfschifffahrt')).toBe('Donaudampfschiff…')
  })
  it('reads the first message of the user', () => {
    const chat = { title: question.slice(0, 50), messages: [{ id: 'u', role: 'user' as const, content: question, timestamp: 1 }] }
    expect(chatTitleShown(chat)).toBe('What should I name my dog called after a river in…')
    expect(chatTitleShown({ title: '', messages: [] })).not.toBe('')
  })
})

describe('Android N10: the speaker button only where something can speak', () => {
  it('a voice of the hook or of the phone is a way, nothing else is', () => {
    expect(readAloudWay({ hookVoice: true, systemVoice: false })).toBe('hook')
    expect(readAloudWay({ hookVoice: false, systemVoice: true })).toBe('hook')
    expect(readAloudWay({ hookVoice: false, systemVoice: false })).toBe(null)
  })
  it('no button without a voice, and none while read aloud is switched off', () => {
    expect(showsSpeakButton(true, null)).toBe(false)
    expect(showsSpeakButton(false, 'hook')).toBe(false)
    expect(showsSpeakButton(true, 'hook')).toBe(true)
  })
  it('reads a German answer in German and an English one in English, whatever the phone is set to', () => {
    expect(readingLanguage('Das Meer ist nicht nur blau, und die Wellen sind auch laut.', 'en-US')).toBe('de-DE')
    expect(readingLanguage('The sea is not only blue, and the waves are loud.', 'de-DE')).toBe('en-US')
    // Nothing to tell it by: the language of the phone, and without one English.
    expect(readingLanguage('42', 'fr-FR')).toBe('fr-FR')
    expect(readingLanguage('42', null)).toBe('en-US')
  })
})

describe('Android N22: one measure for the speed of an answer', () => {
  it('an answer that arrives in one piece measures nothing (Android 8 GB, B1: "1200 tokens per second" under an error)', () => {
    // 28 tokens of a sentence, first and last token 23 ms apart: 1217 tokens per second on a phone that writes 20.
    expect(measuresSpeed({ tokens: 28, ms: 23 })).toBe(false)
    expect(measuresSpeed({ tokens: 0, ms: 5000 })).toBe(false)
    expect(measuresSpeed({ tokens: 96, ms: 8000 })).toBe(true)
  })

  it('counts from the first token, not from the tap on Send', () => {
    // 8 s of loading and reading the prompt, then 100 tokens in 5 s: 20 per second, not 7.7.
    expect(answerSpeedInput({ reportedTokens: 100, body: 'x', runStartedAt: 1000, firstTokenAt: 9000, endedAt: 14000 })).toEqual({ tokens: 100, ms: 5000 })
  })
  it('counts the thoughts as written tokens when the engine reported none', () => {
    const measured = answerSpeedInput({ body: 'a'.repeat(40), thinking: 'b'.repeat(39), runStartedAt: 0, firstTokenAt: 100, endedAt: 1100 })
    expect(measured).toEqual({ tokens: 20, ms: 1000 })
  })
  it('falls back to the whole run when the first token was not seen', () => {
    expect(answerSpeedInput({ reportedTokens: 10, body: '', runStartedAt: 500, firstTokenAt: null, endedAt: 1500 }).ms).toBe(1000)
    expect(answerSpeedInput({ reportedTokens: 10, body: '', runStartedAt: 500, firstTokenAt: 100, endedAt: 1500 }).ms).toBe(1000)
  })
  it('writes the figure like the diagnostics do', () => {
    expect(speedFigure(20.46)).toBe('20')
    expect(speedFigure(8.54)).toBe('8.5')
    expect(speedFigure(0)).toBe('0')
    expect(S.message.speed('8.5')).toBe('8.5 tokens per second')
  })
})

describe('Android M8: an export can be saved to the phone, and the sheet says where it went', () => {
  it('names the file and the place for what was written', () => {
    expect(saveNote('saved', 'Trip.md')).toEqual({ ok: true, tone: 'info', text: 'Saved as Trip.md in the folder you picked.' })
    expect(saveNote('downloaded', 'Trip.md').text).toContain('downloads of this browser')
  })
  it('says honestly when nothing was written, with the next step', () => {
    expect(saveNote('cancelled', 'Trip.md')).toMatchObject({ ok: false, tone: 'warn' })
    expect(saveNote('unavailable', 'Trip.md').text).toContain('Use Share')
    expect(saveNote('failed', 'Trip.md')).toMatchObject({ ok: false, tone: 'error' })
  })
})

describe('Android buttons M6: the way out of a damaged model file is one the phone has', () => {
  it('replaces the way of the desktop and leaves every other sentence alone', () => {
    const native = 'The engine could not read the model file. Open Models, Get new and download it again, or pick another model.'
    expect(phoneEngineNote(native)).toBe(`The engine could not read the model file. ${PHONE_WAY}, or pick another model.`)
    expect(phoneEngineNote('Out of memory.')).toBe('Out of memory.')
    expect(phoneEngineNote(null)).toBeNull()
  })
})
