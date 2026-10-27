/**
 * iOS check of package 17, N-2: after a restart the failed reading kept the
 * memory sentence and got "Choose the file again to try once more." on top:
 * "... add the file or send the message again, or switch this chat to LU
 * Cloud. Choose the file again to try once more." Two instructions in a row.
 * The row now says one next step.
 *
 * Run: npx vitest run src/mobile/screens/agent/__tests__/documents-failed-row-one-step.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENT_STRINGS } from '../../../strings/agent'
import { failedRowText } from '../parts/documents-logic'
import { EMBEDDER_NO_ROOM_ALONE_MESSAGE, EMBEDDER_PORT_BUSY_MESSAGE, NO_EMBED_MODEL_MOBILE_MESSAGE, SINGLE_SLOT_CONFLICT_MESSAGE } from '../../../../lib/model-slot'

const S = AGENT_STRINGS.documents
const page = readFileSync(resolve(__dirname, '../DocumentsPage.tsx'), 'utf8')

describe('N-2: a failed reading says one next step', () => {
  it('after a restart, the memory sentence stands alone, with the "Choose file" button', () => {
    const text = failedRowText(EMBEDDER_NO_ROOM_ALONE_MESSAGE, 'single_slot_conflict', false)
    expect(text).toBe(`${S.failedState}. ${EMBEDDER_NO_ROOM_ALONE_MESSAGE}`)
    expect(text).not.toContain(S.failedRestart)
  })

  it('the same for the other sentences that carry their own step', () => {
    for (const [reason, code] of [
      [EMBEDDER_PORT_BUSY_MESSAGE, 'single_slot_conflict'],
      [SINGLE_SLOT_CONFLICT_MESSAGE, 'single_slot_conflict'],
      [NO_EMBED_MODEL_MOBILE_MESSAGE, undefined],
      ['"a.pdf" is too large for this device (90 MB, the limit is 40 MB). Split it into smaller files and add them one at a time.', 'document_too_large'],
    ] as const) {
      const text = failedRowText(reason, code, false)
      expect(text, reason).not.toContain(S.failedRestart)
      expect(text.match(/\. /g)?.length ?? 0, reason).toBeGreaterThan(0)
    }
  })

  it('a reason without a step of its own still gets "Choose the file again"', () => {
    expect(failedRowText(undefined, undefined, false)).toBe(`${S.failedState}. ${S.failed} ${S.failedRestart}`)
    expect(failedRowText('Failed to extract text from "a.pdf": bad xref', undefined, false)).toBe(`${S.failedState}. ${S.notReadable('a.pdf', 'bad xref')} ${S.failedRestart}`)
    expect(failedRowText('"a.txt" was not fully saved before LU closed, so it cannot be searched.', 'not_saved', false)).toContain(S.failedRestart)
  })

  it('a held file (Try again) and a file that was gone keep their one sentence', () => {
    expect(failedRowText(EMBEDDER_NO_ROOM_ALONE_MESSAGE, 'single_slot_conflict', true)).toBe(`${S.failedState}. ${EMBEDDER_NO_ROOM_ALONE_MESSAGE}`)
    expect(failedRowText(undefined, undefined, true)).toBe(`${S.failedState}. ${S.failed}`)
    expect(failedRowText('Failed to extract text from "lu-test.txt": The object can not be found here.', undefined, false)).toBe(`${S.failedState}. ${S.fileGone('lu-test.txt')}`)
  })

  it('the Documents page builds the row from this one function', () => {
    expect(page).toContain('{failedRowText(entry.reason, entry.code, held)}')
    expect(page).not.toMatch(/` \$\{S\.failedRestart\}`/)
  })
})
