/**
 * Round 35, D1 (iOS check of package 15): adding a document failed once with
 * "Failed. Failed to extract text from "lu-test.txt": The object can not be
 * found here.", a sentence of WebKit with "Failed" twice. The file field hands
 * the web view a copy the system can remove; its hash was read, its text a
 * moment later was not.
 *
 * Run: npx vitest run src/mobile/screens/agent/__tests__/documents-round35.test.ts
 */
import { describe, expect, it } from 'vitest'
import { extractText } from '../../../../api/rag'
import { holdInMemory } from '../../../platform/files'
import { AGENT_STRINGS } from '../../../strings/agent'
import { failureReason, holdAtPick, isFileGone, reasonForUser } from '../parts/documents-logic'

const S = AGENT_STRINGS.documents
const WEBKIT = 'Failed to extract text from "lu-test.txt": The object can not be found here.'

function notFound(): DOMException {
  return new DOMException('The object can not be found here.', 'NotFoundError')
}

/** A picked file whose system copy is gone after `reads` reads. */
function vanishing(reads: number): File {
  const file = new File(['The tide comes twice a day.'], 'lu-test.txt', { type: 'text/plain' })
  let left = reads
  const gate = <T>(real: () => Promise<T>) => () => (left-- > 0 ? real() : Promise.reject(notFound()))
  Object.defineProperty(file, 'arrayBuffer', { value: gate(() => Blob.prototype.arrayBuffer.call(file)) })
  Object.defineProperty(file, 'text', { value: gate(() => Blob.prototype.text.call(file)) })
  return file
}

describe('D1: the sentence for a file that was gone', () => {
  it('says what happened and what to do, without the words of WebKit and without "Failed" twice', () => {
    const said = reasonForUser(WEBKIT)
    expect(said).toBe(S.fileGone('lu-test.txt'))
    expect(said).toMatch(/Try adding the file again\./)
    expect(said).not.toMatch(/can not be found|^Failed/)
    // The row puts "Failed." in front: once, not twice.
    expect(`${S.failedState}. ${said}`.match(/Failed/g)).toHaveLength(1)
    expect(isFileGone(WEBKIT)).toBe(true)
  })

  it('the code file_gone of api/rag.ts says the same', async () => {
    const err = await extractText(vanishing(0)).catch((e: unknown) => e)
    expect((err as { code?: string }).code).toBe('file_gone')
    expect(failureReason(err)).toBe(S.fileGone('lu-test.txt'))
  })

  it('a broken file keeps its reason, without "Failed to extract text from"', () => {
    const said = reasonForUser('Failed to extract text from "notes.pdf": Invalid PDF structure.')
    expect(said).toBe('LU could not read "notes.pdf": Invalid PDF structure.')
    expect(isFileGone('Failed to extract text from "notes.pdf": Invalid PDF structure.')).toBe(false)
  })
})

describe('D1: the bytes are read once, right after the pick', () => {
  it('the copy in memory reads after the system copy is gone', async () => {
    const picked = vanishing(1)
    const held = await holdInMemory(picked)
    await expect(picked.text()).rejects.toThrow(/can not be found/)
    expect(await extractText(held)).toBe('The tide comes twice a day.')
    expect(held.name).toBe('lu-test.txt')
  })

  it('a first read that fails is tried once more', async () => {
    const file = new File(['abc'], 'a.txt', { type: 'text/plain' })
    let calls = 0
    Object.defineProperty(file, 'arrayBuffer', { value: () => (++calls === 1 ? Promise.reject(notFound()) : Blob.prototype.arrayBuffer.call(file)) })
    expect(await (await holdInMemory(file)).text()).toBe('abc')
    expect(calls).toBe(2)
  })

  it('a file that cannot be read twice is not swallowed: the error comes back', async () => {
    await expect(holdInMemory(vanishing(0))).rejects.toThrow(/can not be found/)
  })

  it('the files read at the pick stay within the budget, a file over the limit is never read', () => {
    expect(holdAtPick([10, 30, 5], 20, 64)).toEqual([true, false, true])
    expect(holdAtPick([40, 40], 50, 64)).toEqual([true, false])
    expect(holdAtPick([Infinity, 1], 20, 64)).toEqual([false, true])
  })
})
