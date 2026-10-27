/**
 * The line under an answer names what the model was given (acceptance iPhone, K14).
 *
 * An answer that had nothing to do with the document still carried "Sources".
 * The passages did go into the request, so the line was not wrong, but the
 * word claimed more than is known: the search hands over its best passages
 * for every question. The line now says what happened. And it is only ever
 * written when passages went into the prompt, on both sending paths.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHAT_STRINGS } from '../../../strings/chat'
import { buildRagSuffix } from '../../../../lib/rag-prompt'
import { sourcesFromChunks } from '../../../../lib/rag-sources'

const SRC = join(__dirname, '..', '..', '..', '..')

describe('the passages under an answer', () => {
  it('are called what they are', () => {
    expect(CHAT_STRINGS.message.sources).toBe('Passages given to the model')
    expect(CHAT_STRINGS.message.sources).not.toMatch(/^Sources$/)
  })

  it('no passage, no block in the prompt and nothing to write', () => {
    expect(buildRagSuffix([])).toBe('')
    expect(sourcesFromChunks([], [])).toEqual([])
  })

  it('a passage on the message is a passage in the prompt, in the same order', () => {
    const chunks = [
      { documentId: 'a', index: 3, content: 'The pump runs at 40 bar.' },
      { documentId: 'b', index: 0, content: 'Invoices are due in 14 days.' },
    ]
    const suffix = buildRagSuffix(chunks)
    const written = sourcesFromChunks(chunks, [{ id: 'a', name: 'pump.txt' }, { id: 'b', name: 'terms.txt' }])
    expect(written.map((s) => s.documentName)).toEqual(['pump.txt', 'terms.txt'])
    written.forEach((source, i) => {
      expect(suffix).toContain(`[Source ${i + 1}]\n${source.preview}`)
    })
  })

  for (const file of ['hooks/useChat.ts', 'hooks/useAgentChat.ts']) {
    it(`${file} writes them only behind the check that passages were retrieved, from the list the prompt is built of`, () => {
      const code = readFileSync(join(SRC, file), 'utf8')
      const writes = [...code.matchAll(/updateMessageSources\(/g)]
      expect(writes.length).toBe(1)
      const at = writes[0].index!
      const before = code.slice(Math.max(0, at - 700), at)
      const after = code.slice(at, at + 300)
      expect(before).toMatch(/ragSuffix = buildRagSuffix\(ragContext\.chunks\)/)
      expect(before).toMatch(/if \(ragContext\.chunks\.length > 0\) \{\s*useChatStore\.getState\(\)\.$/)
      expect(after).toMatch(/sourcesFromChunks\(ragContext\.chunks,/)
    })
  }
})
