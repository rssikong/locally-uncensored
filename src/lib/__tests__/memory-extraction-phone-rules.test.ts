/**
 * Round 12, F12: a question is not a fact about the user. The pure halves of
 * what a phone adds to the memory extraction (lib/memory-extraction.ts).
 *
 * Run: npx vitest run src/lib/__tests__/memory-extraction-phone-rules.test.ts
 */
import { describe, expect, it } from 'vitest'
import {
  PHONE_EXTRACTION_RULES, alreadyKept, buildExtractionPrompt, plainSelfStatement, retellsAQuestion, retellsTheAnswer, saysSomethingAboutTheUser,
} from '../memory-extraction'

describe('saysSomethingAboutTheUser', () => {
  it.each([
    'What is the cargo code of the ship Zephyr-15?',
    'Summarize the file.',
    'Say hi in three words.',
    'Wie heisst die Hauptstadt von Italien?',
    'Explain quicksort',
    '',
    '   ',
  ])('no: %s', (text) => expect(saysSomethingAboutTheUser(text)).toBe(false))

  it.each([
    'I am a nurse and work night shifts.',
    "I'm vegetarian, what can I cook tonight?",
    'My dog is called Bruno.',
    'Call me Sam.',
    'Remember that the report is due on Friday.',
    'From now on answer in German.',
    'Ich wohne in Hamburg.',
    'Merk dir: mein Auto ist ein Diesel.',
    'Can you help us plan our trip?',
  ])('yes: %s', (text) => expect(saysSomethingAboutTheUser(text)).toBe(true))

  it('a word that only contains "my" or "me" is not the first person', () => {
    expect(saysSomethingAboutTheUser('Explain the enzyme amylase and the metric system.')).toBe(false)
    expect(saysSomethingAboutTheUser('Was ist ein Mirakel?')).toBe(false)
  })
})

describe('retellsAQuestion', () => {
  const m = (title: string, content = 'x') => ({ title, content })
  it('the entry of the check and its kin', () => {
    expect(retellsAQuestion(m("User Inquiry about Ship Zephyr-15's Cargo Code"))).toBe(true)
    expect(retellsAQuestion(m('Question about Iceland'))).toBe(true)
    expect(retellsAQuestion(m('User asked for a recipe'))).toBe(true)
    expect(retellsAQuestion(m('Cargo code', 'The user asked for the cargo code of the ship.'))).toBe(true)
    expect(retellsAQuestion(m('Tunnel', 'User wants to know when the tunnel was completed.'))).toBe(true)
  })
  it('a fact about the user stays', () => {
    expect(retellsAQuestion(m('Works night shifts as a nurse', 'The user is a nurse and works night shifts.'))).toBe(false)
    expect(retellsAQuestion(m('Prefers short answers', 'The user wants answers in three sentences at most.'))).toBe(false)
    expect(retellsAQuestion(m('Lives in Hamburg', 'The user lives in Hamburg.'))).toBe(false)
  })
})

describe('buildExtractionPrompt', () => {
  it('without further rules it is the prompt it always was', () => {
    const plain = buildExtractionPrompt('u', 'a', '')
    expect(buildExtractionPrompt('u', 'a', '', [])).toEqual(plain)
    expect(plain[0].content).toContain('- Content should be concise but complete (1-3 sentences)\n\n## Existing Memories')
  })
  it('the rules of the phone stand with the other rules', () => {
    const phone = buildExtractionPrompt('u', 'a', '', PHONE_EXTRACTION_RULES)[0].content
    for (const rule of PHONE_EXTRACTION_RULES) expect(phone).toContain(`- ${rule}\n`)
    expect(phone.indexOf(PHONE_EXTRACTION_RULES[0])).toBeLessThan(phone.indexOf('## Existing Memories'))
  })
})

// Check 4 on Android, finding F1: three times "I am a nurse", and the entries were about the topic and about the answer.
describe('retellsTheAnswer', () => {
  const m = (title: string, content = 'x') => ({ title, content })
  it('the entry of the check and its kin', () => {
    expect(retellsTheAnswer(m("Assistant's response content", 'Assistant explained that hand hygiene is a critical component of infection prevention.'))).toBe(true)
    expect(retellsTheAnswer(m('Hand hygiene', 'The assistant described five steps of hand hygiene.'))).toBe(true)
    expect(retellsTheAnswer(m('AI answer about tides'))).toBe(true)
  })
  it('a fact about the user and a wish about answers stay', () => {
    expect(retellsTheAnswer(m('Works night shifts as a nurse', 'The user is a nurse and works night shifts.'))).toBe(false)
    expect(retellsTheAnswer(m('Prefers short answers', 'The user wants answers in three sentences at most.'))).toBe(false)
    expect(retellsTheAnswer(m('Answer in German', 'Assistant should answer in German from now on.'))).toBe(false)
  })
})

describe('plainSelfStatement', () => {
  it('the three messages of the check each carry one', () => {
    for (const text of [
      'I am a nurse. What should I know about hand hygiene?',
      'I am a nurse and I work night shifts, how do I sleep better?',
      "I'm a nurse, please explain infection prevention.",
    ]) {
      const memory = plainSelfStatement(text)
      expect(memory?.type).toBe('user')
      expect(memory?.content).toMatch(/^The user said: "I(?: am|'m) a nurse/)
      expect(memory!.title.length).toBeLessThanOrEqual(60)
    }
  })
  it.each([
    ['I work as a carpenter in Kiel.', 'I work as a carpenter in Kiel'],
    ['Hello! My name is Mara', 'My name is Mara'],
    ['Ich bin eine Lehrerin aus Bremen. Was kann ich heute kochen?', 'Ich bin eine Lehrerin aus Bremen'],
    ['Ich arbeite als Pfleger', 'Ich arbeite als Pfleger'],
    ['By the way, I live in Hamburg now.', 'I live in Hamburg now'],
  ])('%s', (text, said) => expect(plainSelfStatement(text)?.content).toBe(`The user said: "${said}."`))
  it.each([
    'What is the cargo code of the ship Zephyr-15?',
    'I am not sure what you mean.',
    'I am a bit tired, tell me a joke.',
    'Can you check my code?',
    'Ich bin ein bisschen verwirrt.',
    'Remember that the report is due on Friday.',
    '',
  ])('none: %s', (text) => expect(plainSelfStatement(text)).toBeNull())
  it('the same statement is kept once', () => {
    const memory = plainSelfStatement('I am a nurse.')!
    expect(alreadyKept(memory, [])).toBe(false)
    expect(alreadyKept(memory, [{ type: 'user', content: 'the user said:  "I am a nurse."' }])).toBe(true)
    expect(alreadyKept(memory, [{ type: 'project', content: memory.content }])).toBe(false)
    // What the model kept about the same fact counts too.
    expect(alreadyKept(memory, [{ type: 'user', content: 'The user is a nurse and works night shifts.' }])).toBe(true)
    expect(alreadyKept(memory, [{ type: 'user', content: 'The user is a teacher.' }])).toBe(false)
  })
})
