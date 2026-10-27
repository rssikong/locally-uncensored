/**
 * Small iPhone, K9: after a thinking pass that was stopped, "Say ok." was
 * answered with an essay about the question before it. A round that never got
 * an answer is left out of the next request (lib/unanswered-turns.ts).
 *
 * Run: npx vitest run src/lib/__tests__/unanswered-turns.test.ts
 */
import { describe, expect, it } from 'vitest'
import { withoutUnansweredTurns } from '../unanswered-turns'

type M = { id: string; role: string; content: string; hidden?: boolean; thinking?: string; tool_calls?: unknown[] }
const u = (id: string, content = `question ${id}`): M => ({ id, role: 'user', content })
const a = (id: string, content = `answer ${id}`, extra: Partial<M> = {}): M => ({ id, role: 'assistant', content, ...extra })
const ids = (list: M[]) => list.map((m) => m.id)

describe('withoutUnansweredTurns', () => {
  it('the case of the report: the stopped question and its empty answer are gone, the new question stays', () => {
    const list = [u('1'), a('2'), u('sky'), a('thought-only', '', { thinking: 'The sky is blue because' }), u('ok', 'Say ok.'), a('now', '')]
    expect(ids(withoutUnansweredTurns(list))).toEqual(['1', '2', 'ok', 'now'])
  })

  it('a question without any answer message behind it (stopped before the first word) is gone as well', () => {
    expect(ids(withoutUnansweredTurns([u('a'), u('b'), u('c')]))).toEqual(['c'])
  })

  it('an answer that was cut after some words is an answer', () => {
    const list = [u('1'), a('2', 'The sky is'), u('3')]
    expect(ids(withoutUnansweredTurns(list))).toEqual(['1', '2', '3'])
  })

  it('a call of a tool and its result are an answer, also when the text of the message is empty', () => {
    const list = [u('1'), a('call', '', { tool_calls: [{ id: 't' }] }), { id: 'result', role: 'tool', content: 'found' }, u('2')]
    expect(ids(withoutUnansweredTurns(list))).toEqual(['1', 'call', 'result', '2'])
  })

  it('the last question is never taken out, whatever follows it', () => {
    expect(ids(withoutUnansweredTurns([u('1')]))).toEqual(['1'])
    expect(ids(withoutUnansweredTurns([u('1'), a('running', '')]))).toEqual(['1', 'running'])
  })

  it('hidden messages and app notices are neither question nor answer and stay', () => {
    const list = [u('1'), { id: 'note', role: 'system', content: 'Model changed' }, { id: 'steer', role: 'user', content: 'keep going', hidden: true }, a('empty', ''), u('2')]
    expect(ids(withoutUnansweredTurns(list))).toEqual(['note', 'steer', '2'])
  })

  it('a chat in which every question was answered comes back as it is, and the input is not changed', () => {
    const list = [u('1'), a('2'), u('3'), a('4'), u('5')]
    const copy = [...list]
    expect(withoutUnansweredTurns(list)).toEqual(list)
    expect(list).toEqual(copy)
  })
})
