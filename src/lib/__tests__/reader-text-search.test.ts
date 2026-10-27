/**
 * Check on the iPhone, round 23 (N9 follow-up): the Markdown export showed `&#039;` in the results of a web
 * search (the page encoded twice) and the line of the app for the model about a search engine that answered
 * with a bot check. A reader gets the results, decoded, and not that line.
 *
 * Run: npx vitest run src/lib/__tests__/reader-text-search.test.ts
 */
import { describe, expect, it } from 'vitest'
import type { Message } from '../../types/chat'
import { decodeEntities, exportHeading, exportMessageText, readerToolText } from '../reader-text'

const searchMessage = (text: string): Message => ({ id: 'r1', role: 'user', content: `<tool_response>${JSON.stringify({ name: 'web_search', content: text })}</tool_response>`, timestamp: 1 }) as Message

const RESULT = [
  "1. Argentina win the World Cup &amp;#039;22\\n   https://example.org/a?x=1&amp;y=2\\n   Messi&#039;s team beat France &quot;on penalties&quot;.",
].join('')

describe('the text of a web search for a reader', () => {
  it('decodes entities, also the ones that were encoded twice', () => {
    expect(decodeEntities('Messi&#039;s and &amp;#039;22 and &#x27;x&#x27; and a&nbsp;b')).toBe("Messi's and '22 and 'x' and a b")
    expect(decodeEntities('plain text')).toBe('plain text')
  })

  it('leaves angle brackets encoded, so a snippet about a tag stays text in a Markdown file', () => {
    expect(decodeEntities('use &lt;script&gt; and &#60;b&#62; and &amp;lt;i&amp;gt;')).toBe('use &lt;script&gt; and &#60;b&#62; and &lt;i&gt;')
  })

  it('takes the note of the app about a search engine out, and keeps the results', () => {
    const text = '1. A\n   https://a.example\n   snippet\n\n[Note: DuckDuckGo: answered with a bot check instead of results (HTTP 202). Results above are from Wikipedia only.]'
    const clean = readerToolText('web_search', text)
    expect(clean).not.toContain('[Note:')
    expect(clean).not.toContain('DuckDuckGo')
    expect(clean).toContain('1. A')
    expect(clean).toContain('snippet')
  })

  it('the export of a search result carries both corrections, and another tool is untouched', () => {
    const text = exportMessageText(searchMessage(`${RESULT.replace(/\\n/g, '\n')}\n\n[Note: DuckDuckGo: answered with a bot check instead of results (HTTP 202). Results above are from another free search only.]`), () => '')
    expect(text).toContain("Messi's team beat France \"on penalties\".")
    expect(text).toContain("World Cup '22")
    expect(text).toContain('x=1&y=2')
    expect(text).not.toMatch(/&#039;|&amp;|\[Note:/)
    expect(exportHeading(searchMessage('x'))).toBe('Search result')
    expect(readerToolText('file_read', '[Note: stays] &amp;')).toBe('[Note: stays] &amp;')
  })
})
