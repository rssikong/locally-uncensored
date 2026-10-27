/**
 * Round 5, the documents of a chat: what the page reads from the store after
 * it was left and opened again (N1, N5), the same file twice (N4), and the
 * line in the chat while a document is read (N7).
 *
 * Run: npx vitest run src/mobile/screens/agent/__tests__/documents-round5.test.ts
 */
import { describe, expect, it } from 'vitest'
import { documentContentHash } from '../../../../api/rag'
import { failedOnly, pausedOnly, reasonForUser, runningName, sameDocument } from '../parts/documents-logic'
import { documentLineText } from '../parts/slot-turn'
import { AGENT_STRINGS as T } from '../../../strings/agent'

const entries = [
  { id: 'a', name: 'a.txt', size: 1, state: 'paused' as const },
  { id: 'b', name: 'b.txt', size: 2, state: 'failed' as const, reason: 'Embedding failed (HTTP 500): proxy_localhost: error sending request' },
  { id: 'c', name: 'c.txt', size: 3, state: 'running' as const },
]

describe('N1: a reading that failed is a row, not a memory of the page', () => {
  it('failed, paused and running are three different rows', () => {
    expect(failedOnly(entries).map((e) => e.id)).toEqual(['b'])
    expect(pausedOnly(entries).map((e) => e.id)).toEqual(['a'])
    expect(failedOnly(undefined)).toEqual([])
  })

  it('a transport error is not shown to the user, a sentence written for the user is', () => {
    expect(reasonForUser(entries[1].reason)).toBeUndefined()
    expect(reasonForUser('This device does not have enough free memory.', 'single_slot_conflict')).toBe('This device does not have enough free memory.')
    expect(reasonForUser('No text could be extracted from this file.')).toBe('No text could be extracted from this file.')
    expect(reasonForUser(undefined)).toBeUndefined()
  })
})

describe('N5: the name of the file that is being read comes from the store', () => {
  it('names the running entry, and nothing when none runs', () => {
    expect(runningName(entries)).toBe('c.txt')
    expect(runningName(entries.slice(0, 2))).toBeNull()
    expect(runningName(undefined)).toBeNull()
  })
})

describe('N4: the same file twice is one document', () => {
  const docs = [
    { id: 'd1', name: 'lu-vier.txt', size: 400, contentHash: 'aaa' },
    { id: 'd2', name: 'old.pdf', size: 900 },
  ]
  it('the same content is found, whatever the file is called', () => {
    expect(sameDocument(docs, { name: 'copy of lu-vier.txt', size: 400, contentHash: 'aaa' })?.id).toBe('d1')
  })
  it('the same name and size with other content is another document', () => {
    expect(sameDocument(docs, { name: 'lu-vier.txt', size: 400, contentHash: 'bbb' })).toBeNull()
  })
  it('a document from before the checksum is matched by name and size', () => {
    expect(sameDocument(docs, { name: 'old.pdf', size: 900, contentHash: 'ccc' })?.id).toBe('d2')
    expect(sameDocument(docs, { name: 'old.pdf', size: 901, contentHash: 'ccc' })).toBeNull()
  })
  it('without a checksum on the new file, name and size decide', () => {
    expect(sameDocument(docs, { name: 'lu-vier.txt', size: 400 })?.id).toBe('d1')
    expect(sameDocument(docs, { name: 'other.txt', size: 400 })).toBeNull()
  })
  it('the checksum is the same for the same bytes and differs for others', async () => {
    const a = await documentContentHash(new File(['Opening hours are nine to five.'], 'a.txt'))
    const b = await documentContentHash(new File(['Opening hours are nine to five.'], 'b.txt'))
    const c = await documentContentHash(new File(['Opening hours are nine to six.'], 'a.txt'))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(b).toBe(a)
    expect(c).not.toBe(a)
  })
})

describe('N7: the chat says that a document is being read', () => {
  it('the turn has the more exact sentence', () => {
    expect(documentLineText('reading', 'reading')).toBe(T.notices.slotReading)
  })
  it('a phone with room for both takes no turn and still says it', () => {
    expect(documentLineText('idle', 'reading')).toBe(T.notices.docReading)
    expect(documentLineText('idle', 'waiting-for-answer')).toBe(T.notices.docWaiting)
    expect(documentLineText('idle', 'none')).toBeNull()
  })
  it('the sentences are English and carry no dashes', () => {
    for (const text of [T.notices.docReading, T.notices.docWaiting, T.documents.failedToast('a.txt'), T.documents.duplicate('a.txt'), T.documents.duplicateAs('a.txt', 'b.txt'), T.documents.waitsForAnswer, T.documents.failedRestart]) {
      expect(text).not.toMatch(/[\u2013\u2014]/)
    }
  })
})
