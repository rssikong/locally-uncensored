/**
 * A small model gives the app's note about a failed step back as its answer
 * (iPhone review, N11). The note goes; what the model said besides stays.
 */
import { describe, expect, it } from 'vitest'
import { stripFailureNoteEcho, toolFailureNote } from '../tool-failure-note'

const REPORT = 'The tool execution timed out, so there is no output. Do not state or guess what it would have returned. Either call it again with corrected arguments, or tell the user plainly that this step failed.'

describe('the echo of the note about a failed step', () => {
  it('the answer of the report is the note and nothing else', () => {
    expect(stripFailureNoteEcho(REPORT)).toEqual({ text: '', echoed: true })
  })

  it('the note word for word is recognised, quoted or not, with other spacing', () => {
    const note = toolFailureNote('timeout').trim()
    expect(stripFailureNoteEcho(note)).toEqual({ text: '', echoed: true })
    expect(stripFailureNoteEcho(`"${note}"`).text).toBe('')
    expect(stripFailureNoteEcho(note.replace(/ /g, '  ')).text).toBe('')
  })

  it('what the model said besides stays', () => {
    const answer = `The page could not be read in time.\n\n${REPORT}\n\nYou can open it in a browser instead.`
    const out = stripFailureNoteEcho(answer)
    expect(out.echoed).toBe(true)
    expect(out.text).toBe('The page could not be read in time.\n\nYou can open it in a browser instead.')
  })

  it('one of the two instruction sentences alone is the note too', () => {
    expect(stripFailureNoteEcho('Sorry. Do not state or guess what it would have returned.').text).toBe('Sorry.')
    expect(stripFailureNoteEcho('Either call it again with corrected arguments, or tell the user plainly that this step failed.').text).toBe('')
  })

  it('an ordinary answer is not touched, also one that speaks of output or of a failed step', () => {
    for (const answer of [
      'The script printed nothing, so there is no output.',
      'This step failed. I will try another way.',
      'I do not want to guess what the page says.',
      'The population of Iceland is 402,329.',
      '',
    ]) {
      expect(stripFailureNoteEcho(answer)).toEqual({ text: answer, echoed: false })
    }
  })

  it('the note itself is unchanged', () => {
    expect(toolFailureNote('timeout')).toBe('\n\nThis tool did NOT run, so there is no output. Do not state or guess what it would have returned. Either call it again with corrected arguments, or tell the user plainly that this step failed.')
    expect(toolFailureNote('done')).toBe('')
  })
})
