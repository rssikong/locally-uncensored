/**
 * David's wish for 3.0.7: emoticons in the chat composer become emojis, as in
 * other chat apps. ":D" turns into 😃 once the word is over, never inside
 * code, a URL, a path or a word, and Enter ends the last word too.
 *
 * Run: npx vitest run src/lib/__tests__/emoticons-turn-into-emojis.test.ts
 */
import { describe, it, expect } from 'vitest'
import { EMOTICONS, insideCode, turnOnSend, turnOnType } from '../emoticons'

/** Type `text` one character at a time, the way the composer sees it. */
function typed(text: string): string {
  let field = ''
  for (const ch of text) {
    field += ch
    const turn = turnOnType(field, field.length)
    if (turn) field = turn.after
  }
  return field
}

describe('emoticons while typing', () => {
  it.each([
    [':D ', '😃 '], [':) ', '🙂 '], [';) ', '😉 '], [':( ', '🙁 '], ['<3 ', '❤️ '],
    [':-) ', '🙂 '], [":'( ", '😢 '], ['</3 ', '💔 '], [':P ', '😛 '], ['XD ', '😆 '],
  ])('%s becomes %s', (input, output) => {
    expect(typed(input)).toBe(output)
  })

  it('turns only once the word is over: a space, a newline or . , ! ?', () => {
    expect(typed(':)')).toBe(':)')
    expect(typed('nice :)!')).toBe('nice 🙂!')
    expect(typed('nice :).')).toBe('nice 🙂.')
    expect(typed('nice :)\n')).toBe('nice 🙂\n')
    // ":)" followed by "D" is a different word, not a face and a letter.
    expect(typed(':)D ')).toBe(':)D ')
  })

  it('takes the longer face where one ends in another', () => {
    expect(typed(':-D ')).toBe('😃 ')
    expect(typed('</3 ')).toBe('💔 ')
  })

  it('leaves faces inside a word, a URL or a path alone', () => {
    expect(typed('note:) ')).toBe('note:) ')
    expect(typed('http://example.com/:) ')).toBe('http://example.com/:) ')
    expect(typed('C:\\files\\x:D ')).toBe('C:\\files\\x:D ')
    expect(typed('~/a;) ')).toBe('~/a;) ')
    expect(typed('a<3 ')).toBe('a<3 ')
  })

  it('leaves code alone, inline and fenced', () => {
    expect(typed('run `echo :) ` ok :) ')).toBe('run `echo :) ` ok 🙂 ')
    expect(typed('```\nif x :) \n```\n:) ')).toBe('```\nif x :) \n```\n🙂 ')
    expect(insideCode('```js\na', 6)).toBe(true)
    expect(insideCode('`a` b', 4)).toBe(false)
  })

  it('names no face that reads as something else at the start of a word', () => {
    for (const notAFace of ['B)', '8)', ':/', ':S']) expect(EMOTICONS[notAFace]).toBeUndefined()
    expect(typed('option B) ')).toBe('option B) ')
  })

  it('puts the caret behind the emoji and the character that ended the word', () => {
    const turn = turnOnType('hi :D x', 6)!
    expect(turn.after).toBe('hi 😃 x')
    expect(turn.caret).toBe(3 + '😃'.length + 1)
  })
})

describe('emoticons on send', () => {
  it('turns a face that ends the message, as Enter ends its word', () => {
    expect(turnOnSend('thanks :)')).toBe('thanks 🙂')
    expect(turnOnSend(':D')).toBe('😃')
    expect(turnOnSend('thanks :)  ')).toBe('thanks 🙂  ')
  })

  it('leaves the rest as it is', () => {
    expect(turnOnSend('see http://x/:)')).toBe('see http://x/:)')
    expect(turnOnSend('`x :)')).toBe('`x :)')
    expect(turnOnSend('plain')).toBe('plain')
  })
})
