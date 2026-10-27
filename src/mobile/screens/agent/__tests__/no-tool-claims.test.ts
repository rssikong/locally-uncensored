/**
 * An answer that presents search results or sources although no tool ran is
 * not read as one that looked something up (acceptance Android, re-run, N4;
 * iOS small, N6).
 */
import { describe, expect, it } from 'vitest'
import type { Message } from '../../../../types/chat'
import { AGENT_STRINGS as T } from '../../../strings/agent'
import { claimsDone, claimsDoneWithoutStep, claimsResultsWithoutTool, claimsToolResults } from '../parts/blocks'

type Blocks = NonNullable<Message['agentBlocks']>
const answer = (content: string, agentBlocks?: Blocks): Pick<Message, 'role' | 'content' | 'agentBlocks'> => ({ role: 'assistant', content, agentBlocks })
const call = { id: 'b1', phase: 'tool_call', content: '', timestamp: 1, toolCall: { id: 'c1', toolName: 'web_search', args: {}, status: 'completed' } } as unknown as Blocks[number]
const block = (phase: string, content: string) => ({ id: `b-${phase}`, phase, content, timestamp: 1 }) as unknown as Blocks[number]

describe('what counts as a claim', () => {
  it.each([
    '<source></source>',
    'Here are the search results:\n1. Canberra',
    'According to my search, the capital is Canberra.',
    'Based on the search results above, it is Canberra.',
    'I searched the web and Canberra is the capital.',
    "I've found the following: Canberra.",
    'Canberra is the capital.\n\nSources:\n- Wikipedia',
    '1. Canberra is the capital. Source: Wikipedia',
    '**Sources:** Britannica',
  ])('claims: %s', (text) => {
    expect(claimsToolResults(text)).toBe(true)
  })

  it.each([
    'The capital of Australia is Canberra.',
    'I could not search the web, so this is from memory: Canberra.',
    'A river has a source and a mouth.',
    'You can research this in a library.',
    '',
  ])('does not claim: %s', (text) => {
    expect(claimsToolResults(text)).toBe(false)
  })
})

describe('the line under an answer', () => {
  it('is shown for an agent answer that names results and ran no tool', () => {
    expect(claimsResultsWithoutTool(answer('<source></source>', []))).toBe(true)
    expect(claimsResultsWithoutTool(answer('Search results:\n1. Canberra, Victoria. Source: Wikipedia', [block('thinking', 'hm')]))).toBe(true)
  })

  it('reads the text an agent run keeps in its answer blocks', () => {
    expect(claimsResultsWithoutTool(answer('', [block('answer', 'According to my search it is Canberra.')]))).toBe(true)
  })

  it('is not shown when a tool ran: then the answer may speak of results', () => {
    expect(claimsResultsWithoutTool(answer('Search results:\n1. Canberra. Source: Wikipedia', [call]))).toBe(false)
  })

  it('is not shown for a plain chat answer, which has no tools to claim', () => {
    expect(claimsResultsWithoutTool(answer('Sources: my training data'))).toBe(false)
  })

  it('is not shown for an agent answer that claims nothing', () => {
    expect(claimsResultsWithoutTool(answer('The capital of Australia is Canberra.', []))).toBe(false)
  })

  it('is never shown for the message of the user', () => {
    expect(claimsResultsWithoutTool({ role: 'user', content: 'show me search results', agentBlocks: [] })).toBe(false)
  })

  it('says what happened in plain words, without a dash', () => {
    expect(T.tools.noToolRan).toContain('No tool ran')
    for (const code of [0x2013, 0x2014]) expect(T.tools.noToolRan).not.toContain(String.fromCharCode(code))
  })
})

/**
 * Round 9, N7 on Android: the write was declined, and the answer said the
 * file "has been successfully written".
 */
describe('an answer that says something was done although no step ran', () => {
  const step = (status: string, id = 'c1') =>
    ({ id: `b-${id}`, phase: 'tool_call', content: '', timestamp: 1, toolCall: { id, toolName: 'file_write', args: {}, status } }) as unknown as Blocks[number]
  const said = 'The file notes.md has been successfully written.'

  it.each([
    said,
    'I have saved the note for you.',
    "I've created notes.md with your text.",
    'The note was saved to notes.md.',
    'Successfully wrote notes.md.',
    'File saved.',
  ])('says done: %s', (text) => {
    expect(claimsDone(text)).toBe(true)
  })

  it.each([
    'The step was declined, so the file was not written.',
    'Nothing was saved. Shall I try again?',
    'I could not write the file.',
    'Do you want me to write it to another place?',
    '',
  ])('does not say done: %s', (text) => {
    expect(claimsDone(text)).toBe(false)
  })

  it('the run of the report: two steps, both declined or failed, and a success in the answer', () => {
    expect(claimsDoneWithoutStep(answer(said, [step('rejected', 'c1'), step('failed', 'c2'), block('answer', said)]))).toBe(true)
  })

  it('not when one step went through, not without steps, not for an honest answer', () => {
    expect(claimsDoneWithoutStep(answer(said, [step('rejected', 'c1'), step('completed', 'c2')]))).toBe(false)
    expect(claimsDoneWithoutStep(answer(said, [step('cached')]))).toBe(false)
    expect(claimsDoneWithoutStep(answer(said, [step('running')]))).toBe(false)
    expect(claimsDoneWithoutStep(answer(said, [block('answer', said)]))).toBe(false)
    expect(claimsDoneWithoutStep(answer(said))).toBe(false)
    expect(claimsDoneWithoutStep(answer('The step was declined, so nothing was written.', [step('rejected')]))).toBe(false)
    expect(claimsDoneWithoutStep({ role: 'user', content: said, agentBlocks: [step('rejected')] })).toBe(false)
  })

  it('the line under such an answer is English and has no long dash', () => {
    expect(T.tools.nothingWasDone).toBe('No step ran for this answer. Nothing was written, saved or changed.')
    expect(T.tools.nothingWasDone).not.toMatch(/[\u2013\u2014]/)
  })
})
