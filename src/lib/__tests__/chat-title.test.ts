import { describe, expect, it } from 'vitest'
import { plainChatTitle } from '../chat-title'

describe('the name of a chat without Markdown marks (short check 7, F1)', () => {
  it('a heading, bold, code marks and a link lose their marks', () => {
    expect(plainChatTitle('# Plan for **tomorrow**')).toBe('Plan for tomorrow')
    expect(plainChatTitle('Use `npm run dev` and [the docs](https://example.test/a)')).toBe('Use npm run dev and the docs')
    expect(plainChatTitle('- [ ] buy milk')).toBe('buy milk')
    expect(plainChatTitle('> a quote')).toBe('a quote')
  })

  it('the table of the report reads as words, without bars and separator row', () => {
    const t = plainChatTitle('# Title\n| a | b |\n|---|---|\n| 1 | 2 |\n```js\nconsole.log(1)\n```')
    expect(t).toBe('Title a b 1 2 console.log(1)')
    expect(t).not.toMatch(/[|#`]/)
  })

  it('a code fence is not part of the name, the code in it may be', () => {
    expect(plainChatTitle('```python\nprint(1)\n```\nwhy')).toBe('print(1) why')
  })

  it('snake_case and a product of numbers keep their characters', () => {
    expect(plainChatTitle('explain my_var_name and 2*3')).toBe('explain my_var_name and 2*3')
  })

  it('is cut at 50 characters and never empty', () => {
    expect(plainChatTitle('word '.repeat(40)).length).toBeLessThanOrEqual(50)
    expect(plainChatTitle('***')).toBe('***')
  })
})
