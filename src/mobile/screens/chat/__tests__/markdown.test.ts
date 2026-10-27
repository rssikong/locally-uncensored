import { describe, expect, it } from 'vitest'
import { fencedBlockIndex, isHtmlBlock, isInlineImageSrc, languageLabel, parsePreviewBlockId, previewBlockId } from '../parts/logic/markdown'

describe('fencedBlockIndex', () => {
  const text = ['Intro', '```js', 'a()', '```', 'Between', '~~~html', '<p>', '~~~', '', '```', 'plain', '```'].join('\n')
  it('counts fenced blocks from 0 by the line they start at', () => {
    expect(fencedBlockIndex(text, 2)).toBe(0)
    expect(fencedBlockIndex(text, 6)).toBe(1)
    expect(fencedBlockIndex(text, 10)).toBe(2)
  })
  it('does not take a fence inside another kind of fence for a new block', () => {
    const nested = ['~~~md', '```js', 'x', '```', '~~~', '```py', 'y', '```'].join('\n')
    expect(fencedBlockIndex(nested, 6)).toBe(1)
  })
  it('stays inside the list for a line past the end', () => {
    expect(fencedBlockIndex(text, 99)).toBe(2)
    expect(fencedBlockIndex('no code', 1)).toBe(0)
  })
})

describe('preview block ids', () => {
  it('survive the way through a route, also with a tilde in the message id', () => {
    expect(parsePreviewBlockId(previewBlockId('msg-1', 3))).toEqual({ messageId: 'msg-1', index: 3 })
    expect(parsePreviewBlockId(previewBlockId('a~b', 0))).toEqual({ messageId: 'a~b', index: 0 })
  })
  it('refuse what is no id', () => {
    for (const bad of ['', 'abc', '~1', 'a~x', 'a~-1', 'a~1.5']) expect(parsePreviewBlockId(bad)).toBeNull()
  })
})

describe('isHtmlBlock', () => {
  it('is true for a web page only', () => {
    expect(isHtmlBlock('HTML', '<p>')).toBe(true)
    expect(isHtmlBlock(undefined, '  <!DOCTYPE html><html>')).toBe(true)
    expect(isHtmlBlock('', '<html lang="en">')).toBe(true)
    expect(isHtmlBlock('js', '<html>')).toBe(false)
    expect(isHtmlBlock(undefined, '<div>part</div>')).toBe(false)
  })
})

describe('isInlineImageSrc', () => {
  it('lets only images through that carry their own bytes', () => {
    expect(isInlineImageSrc('data:image/png;base64,AAAA')).toBe(true)
    expect(isInlineImageSrc('blob:http://localhost/1')).toBe(true)
    expect(isInlineImageSrc('https://example.com/a.png')).toBe(false)
    expect(isInlineImageSrc('data:text/html,<p>')).toBe(false)
    expect(isInlineImageSrc(undefined)).toBe(false)
  })
})

describe('languageLabel', () => {
  it('names a block', () => {
    expect(languageLabel(' TS ', 'Code')).toBe('ts')
    expect(languageLabel(undefined, 'Code')).toBe('Code')
  })
})
