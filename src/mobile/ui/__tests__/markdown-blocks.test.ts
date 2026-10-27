/**
 * The fenced blocks of an answer are counted in one place. The chat builds
 * the address of a preview from that count and the preview page finds the
 * block again by it, so this file also holds the kit's count against the two
 * copies the strands still carry: as long as they agree, moving a strand to
 * the kit changes no address.
 */
import { describe, expect, it } from 'vitest'
import { fencedBlockIndex as chatIndex, parsePreviewBlockId as chatParse, previewBlockId as chatId } from '../../screens/chat/parts/logic/markdown'
import { fencedBlocks as agentBlocks, findPreviewBlock as agentFind, parsePreviewBlockId as agentParse } from '../../screens/agent/parts/preview-block'
import { answerText, fencedBlockIndex, fencedBlocks, findPreviewBlock, isInlineImageSrc, isPreviewableBlock, languageLabel, parsePreviewBlockId, previewBlockId } from '../markdown-blocks'

const ANSWER = [
  'Here is the page.',
  '',
  '```ts',
  'const a = 1',
  '```',
  '',
  'And the page itself:',
  '',
  '~~~html',
  '<!doctype html>',
  '<html><body>```not a fence```</body></html>',
  '~~~',
  '',
  '- a list',
  '  ```',
  '  plain',
  '  ```',
  '',
  '```svg',
  '<svg></svg>',
].join('\n')

const SAMPLES = [
  ANSWER,
  '',
  'no code at all',
  '```\nnever closed',
  '```js\na\n```\n```py\nb\n```',
  '````md\n```js\ninner\n```\n````\n\n```html\n<html></html>\n```',
  'text\n\n   ```json\n   {}\n   ```\n\n    ```indented four, so it is no fence\n',
]

describe('fencedBlocks', () => {
  it('finds every block with its language, its code and its line', () => {
    const blocks = fencedBlocks(ANSWER)
    expect(blocks.map((b) => b.language)).toEqual(['ts', 'html', '', 'svg'])
    expect(blocks.map((b) => b.line)).toEqual([3, 9, 15, 19])
    expect(blocks[0].code).toBe('const a = 1')
    expect(blocks[1].code).toBe('<!doctype html>\n<html><body>```not a fence```</body></html>')
    // The last block is never closed: an answer that is still streaming.
    expect(blocks[3].code).toBe('<svg></svg>')
  })

  it('counts exactly as the copy of the agent strand does', () => {
    for (const text of SAMPLES) {
      expect(fencedBlocks(text).map(({ language, code }) => ({ language, code })), JSON.stringify(text)).toEqual(agentBlocks(text))
    }
  })
})

describe('fencedBlockIndex', () => {
  it('gives the position of the block that starts at a line', () => {
    expect(fencedBlockIndex(ANSWER, 3)).toBe(0)
    expect(fencedBlockIndex(ANSWER, 9)).toBe(1)
    expect(fencedBlockIndex(ANSWER, 15)).toBe(2)
    expect(fencedBlockIndex(ANSWER, 19)).toBe(3)
  })

  it('answers for every line exactly as the copy of the chat strand does', () => {
    for (const text of SAMPLES) {
      const lines = text.split('\n').length
      for (let line = 0; line <= lines + 2; line += 1) {
        expect(fencedBlockIndex(text, line), `${JSON.stringify(text)} line ${line}`).toBe(chatIndex(text, line))
      }
    }
  })
})

describe('block ids', () => {
  it('are built and read the same way as in both strands', () => {
    expect(previewBlockId('msg-1', 2)).toBe('msg-1~2')
    expect(previewBlockId('msg-1', 2)).toBe(chatId('msg-1', 2))
    for (const id of ['msg-1~2', 'a~b~0', '~1', 'msg', 'msg~', 'msg~-1', 'msg~1.5', 'msg~x']) {
      expect(parsePreviewBlockId(id), id).toEqual(chatParse(id))
      expect(parsePreviewBlockId(id), id).toEqual(agentParse(id))
    }
    expect(parsePreviewBlockId('a~b~0')).toEqual({ messageId: 'a~b', index: 0 })
    expect(parsePreviewBlockId('msg')).toBeNull()
  })
})

describe('what can be previewed', () => {
  it('a web page and a drawing, by language or by how the block starts', () => {
    expect(isPreviewableBlock('html', '<p>x</p>')).toBe(true)
    expect(isPreviewableBlock('SVG', '<svg/>')).toBe(true)
    expect(isPreviewableBlock(undefined, '  <!DOCTYPE html><html></html>')).toBe(true)
    expect(isPreviewableBlock(undefined, '<svg viewBox="0 0 1 1"></svg>')).toBe(true)
    expect(isPreviewableBlock('ts', '<html>')).toBe(false)
    expect(isPreviewableBlock(undefined, '<div>a fragment</div>')).toBe(false)
  })

  it('finds the block an address means, as the preview page of the agent strand does', () => {
    for (const text of SAMPLES) {
      for (let index = 0; index < 5; index += 1) {
        const mine = findPreviewBlock(text, index)
        const theirs = agentFind(text, index)
        expect(mine ? { language: mine.language, code: mine.code } : null, `${JSON.stringify(text)} block ${index}`).toEqual(theirs)
      }
    }
    expect(findPreviewBlock(ANSWER, 1)?.language).toBe('html')
    expect(findPreviewBlock(ANSWER, 0)).toBeNull()
    expect(findPreviewBlock(undefined, 0)).toBeNull()
  })
})

describe('answerText', () => {
  it('a plain answer is its content', () => {
    expect(answerText({ content: 'Hello' })).toBe('Hello')
    expect(answerText({ content: 'Hello', agentBlocks: [{ phase: 'answer', content: 'ignored' }] })).toBe('Hello')
  })

  it('an agent run with empty content is the text of its answer blocks, in order', () => {
    const message = {
      content: '',
      agentBlocks: [
        { phase: 'thinking', content: 'The user wants a page.' },
        { phase: 'tool_call', content: '' },
        { phase: 'answer', content: 'Here is the page.' },
        { phase: 'answer', content: '```html\n<!doctype html>\n<html><body>Hi</body></html>\n```' },
      ],
    }
    expect(answerText(message)).toBe('Here is the page.\n\n```html\n<!doctype html>\n<html><body>Hi</body></html>\n```')
  })

  it('the preview finds the web page of an agent answer through the same text (L17)', () => {
    const message = {
      content: '   ',
      agentBlocks: [
        { phase: 'answer', content: 'First some code:\n\n```ts\nconst a = 1\n```' },
        { phase: 'tool_call', content: 'file_write' },
        { phase: 'answer', content: 'And the page:\n\n```html\n<html><body>Hi</body></html>\n```' },
      ],
    }
    const text = answerText(message)
    // The chat draws this text and counts the block the Preview button sits on ...
    const line = text.split('\n').findIndex((l) => l.startsWith('```html')) + 1
    const index = fencedBlockIndex(text, line)
    expect(index).toBe(1)
    // ... and the preview page finds the same block by that number, in the same text.
    const id = parsePreviewBlockId(previewBlockId('m7', index))
    expect(findPreviewBlock(text, id!.index)).toMatchObject({ language: 'html', code: '<html><body>Hi</body></html>' })
    // Looking in message.content alone, as the preview page did, finds nothing.
    expect(findPreviewBlock(message.content, id!.index)).toBeNull()
  })

  it('nothing is nothing', () => {
    expect(answerText(null)).toBe('')
    expect(answerText({})).toBe('')
    expect(answerText({ content: null, agentBlocks: null })).toBe('')
  })
})

describe('small helpers', () => {
  it('an image is shown inline only when it carries its own bytes', () => {
    expect(isInlineImageSrc('data:image/png;base64,AAAA')).toBe(true)
    expect(isInlineImageSrc('blob:http://localhost/1')).toBe(true)
    expect(isInlineImageSrc('https://example.com/a.png')).toBe(false)
    expect(isInlineImageSrc(undefined)).toBe(false)
  })

  it('a block without a language gets the fallback name', () => {
    expect(languageLabel('TS', 'Code')).toBe('ts')
    expect(languageLabel(undefined, 'Code')).toBe('Code')
    expect(languageLabel('  ', 'Code')).toBe('Code')
  })
})
