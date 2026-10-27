/**
 * Re-check on Android 8 GB, N2: "Search the web: who won the 2026 FIFA World
 * Cup?" with Agent off and Web search on. No search, an invented winner or
 * "I cannot search the web", and no line under the answer: the line that
 * exists looks at what the ANSWER claims, and these answers claim no source.
 *
 * On a phone the loop runs an ordered search itself
 * (src/hooks/__tests__/an-ordered-search-is-run.test.ts). This file holds
 * what is said where no search ran all the same.
 */
import { describe, expect, it } from 'vitest'
import type { Message } from '../../../../types/chat'
import { AGENT_STRINGS as T } from '../../../strings/agent'
import { claimsResultsWithoutTool, orderedSearchDidNotRun, userTextBefore } from '../parts/blocks'

type Blocks = NonNullable<Message['agentBlocks']>
const answer = (content: string, agentBlocks?: Blocks): Pick<Message, 'role' | 'content' | 'agentBlocks'> => ({ role: 'assistant', content, agentBlocks })
const ran = (toolName: string, status = 'completed') =>
  ({ id: `b-${toolName}`, phase: 'tool_call', content: '', timestamp: 1, toolCall: { id: `c-${toolName}`, toolName, args: {}, status } }) as unknown as Blocks[number]

const ORDER = 'Search the web: who won the 2026 FIFA World Cup?'
const INVENTED = 'The 2026 FIFA World Cup was won by the United States.'
const REFUSAL = 'I cannot search the web, but I can tell you what I know.'

describe('the user ordered a search and none ran', () => {
  it('SONDE: both answers of the report get the line, and the old check alone saw neither', () => {
    for (const text of [INVENTED, REFUSAL]) {
      expect(claimsResultsWithoutTool(answer(text, []))).toBe(false)
      expect(orderedSearchDidNotRun(ORDER, answer(text, []))).toBe(true)
    }
  })

  it('a search that ran, or failed in plain sight, needs no line', () => {
    expect(orderedSearchDidNotRun(ORDER, answer('It was played on 19 July.', [ran('web_search')]))).toBe(false)
    expect(orderedSearchDidNotRun(ORDER, answer('The search failed.', [ran('web_search', 'failed')]))).toBe(false)
    expect(orderedSearchDidNotRun(ORDER, answer('The page says so.', [ran('web_fetch')]))).toBe(false)
  })

  it('another tool is not a search', () => {
    expect(orderedSearchDidNotRun(ORDER, answer('Saved.', [ran('file_write')]))).toBe(true)
  })

  it('a question nobody ordered a search for gets no line', () => {
    expect(orderedSearchDidNotRun('who won the 2026 FIFA World Cup?', answer(INVENTED, []))).toBe(false)
    expect(orderedSearchDidNotRun(undefined, answer(INVENTED, []))).toBe(false)
  })

  it('a plain chat answer (Web search off, no tools in the run) is left alone, as before', () => {
    expect(orderedSearchDidNotRun(ORDER, answer(REFUSAL))).toBe(false)
  })

  it('never for the message of the user', () => {
    expect(orderedSearchDidNotRun(ORDER, { role: 'user', content: ORDER, agentBlocks: [] })).toBe(false)
  })

  it('says it in plain words, without a dash', () => {
    expect(T.tools.noSearchRan).toContain('No search ran')
    for (const code of [0x2013, 0x2014]) expect(T.tools.noSearchRan).not.toContain(String.fromCharCode(code))
  })
})

describe('what the user typed for an answer', () => {
  const messages = [
    { id: 'u1', role: 'user', content: 'hello' },
    { id: 'a1', role: 'assistant', content: 'hi' },
    { id: 'u2', role: 'user', content: `${ORDER}\n\n[Attached file: a.txt]`, displayContent: ORDER },
    { id: 'a2', role: 'assistant', content: INVENTED },
  ] as Array<Pick<Message, 'id' | 'role' | 'content' | 'displayContent'>>

  it('is the message of the user right before it, as typed', () => {
    expect(userTextBefore(messages, 'a2')).toBe(ORDER)
    expect(userTextBefore(messages, 'a1')).toBe('hello')
  })

  it('is nothing for an answer without one, or an unknown id', () => {
    expect(userTextBefore(messages.slice(1), 'a1')).toBeUndefined()
    expect(userTextBefore(messages, 'nope')).toBeUndefined()
  })
})
