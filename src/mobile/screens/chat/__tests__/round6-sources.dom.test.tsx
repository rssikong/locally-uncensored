// @vitest-environment jsdom
/**
 * Round 6, acceptance on Android 8 GB, find B12: the list of sources under an
 * answer named the same file five times, without the passage and with nothing
 * to tap. Now: one row per document with the number of passages, and a tap
 * shows which passages they were.
 *
 * Run: npx vitest run src/mobile/screens/chat/__tests__/round6-sources.dom.test.tsx
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Sources } from '../parts/Sources'
import { groupSources } from '../parts/logic/sources'
import { SOURCE_PREVIEW_CHARS } from '../../../../lib/rag-sources'
import { CHAT_STRINGS as S } from '../../../strings/chat'

afterEach(cleanup)

/** The case of the report: five passages of one file. */
const FIVE = [3, 4, 11, 0, 17].map((chunkIndex, i) => ({ documentName: 'greenhouse-notes.txt', chunkIndex, preview: `Passage text number ${i + 1} about the club.` }))

describe('groupSources', () => {
  it('five passages of one file are one document', () => {
    const groups = groupSources(FIVE)
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('greenhouse-notes.txt')
    expect(groups[0].passages.map((p) => [p.source, p.passage])).toEqual([[1, 4], [2, 5], [3, 12], [4, 1], [5, 18]])
  })

  it('two files keep the order they first appear in, and every passage keeps the number the model was given', () => {
    const groups = groupSources([
      { documentName: 'b.pdf', chunkIndex: 1, preview: 'one' },
      { documentName: 'a.txt', chunkIndex: 0, preview: 'two' },
      { documentName: 'b.pdf', chunkIndex: 9, preview: 'three' },
    ])
    expect(groups.map((g) => g.name)).toEqual(['b.pdf', 'a.txt'])
    expect(groups[0].passages.map((p) => p.source)).toEqual([1, 3])
    expect(groups[1].passages.map((p) => p.source)).toEqual([2])
  })

  it('a preview that fills its limit is marked as cut, a short one is not', () => {
    const [doc] = groupSources([
      { documentName: 'a.txt', chunkIndex: 0, preview: 'x'.repeat(SOURCE_PREVIEW_CHARS) },
      { documentName: 'a.txt', chunkIndex: 1, preview: 'short' },
    ])
    expect(doc.passages.map((p) => p.cut)).toEqual([true, false])
  })

  it('nothing in, nothing out; a message from an older version without a place still shows', () => {
    expect(groupSources(undefined)).toEqual([])
    expect(groupSources([])).toEqual([])
    const [doc] = groupSources([{ documentName: '', chunkIndex: Number.NaN, preview: '' }])
    expect(doc.name).toBe('Document')
    expect(doc.passages[0].passage).toBe(0)
    expect(S.message.sourcePlace(1, 0)).toBe('Source 1')
  })
})

describe('under the answer', () => {
  it('one row for the file with the number of passages, not five rows with the same name', () => {
    render(<Sources sources={FIVE} />)
    const rows = screen.getAllByTestId('m-chat-source')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('greenhouse-notes.txt')
    expect(rows[0].textContent).toContain('5 passages')
    expect(rows[0].getAttribute('aria-expanded')).toBe('false')
    expect(rows[0].getAttribute('aria-label')).toBe('greenhouse-notes.txt, 5 passages. Show')
    expect(screen.queryAllByTestId('m-chat-source-passage')).toHaveLength(0)
  })

  it('a tap shows each passage with its source number, its place in the document and its text', () => {
    render(<Sources sources={FIVE} />)
    fireEvent.click(screen.getByTestId('m-chat-source'))
    expect(screen.getByTestId('m-chat-source').getAttribute('aria-expanded')).toBe('true')
    const passages = screen.getAllByTestId('m-chat-source-passage')
    expect(passages).toHaveLength(5)
    expect(within(passages[2]).getByText('Source 3, passage 12 of the document')).toBeTruthy()
    expect(within(passages[2]).getByText('Passage text number 3 about the club.')).toBeTruthy()
    // A second tap closes it again.
    fireEvent.click(screen.getByTestId('m-chat-source'))
    expect(screen.queryAllByTestId('m-chat-source-passage')).toHaveLength(0)
  })

  it('one passage is "1 passage", and no sources means no block', () => {
    render(<Sources sources={[FIVE[0]]} />)
    expect(screen.getByTestId('m-chat-source').textContent).toContain('1 passage')
    expect(screen.getByTestId('m-chat-source').textContent).not.toContain('1 passages')
    cleanup()
    render(<Sources sources={[]} />)
    expect(screen.queryByTestId('m-chat-sources')).toBeNull()
  })

  it('the words are English and carry no dashes', () => {
    for (const text of [S.message.sourcePassages(2), S.message.sourceShow('a.txt', 2), S.message.sourcePlace(1, 2), S.message.sourceCut('abc')]) {
      expect(text).not.toMatch(/[–—]| - /)
    }
  })
})
