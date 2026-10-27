/**
 * A7 (3.0.8): what changes with every message rides behind the newest user
 * message, so the system prompt and every older message stay byte-identical
 * from turn to turn and a prefix cache can keep them.
 */
import { describe, it, expect } from 'vitest'
import { buildTurnContext, withTurnContext, MEMORY_PREAMBLE } from '../turn-context'
import { buildRagSuffix } from '../rag-prompt'
import { hostClockLine } from '../host-platform'

type M = { role: string; content: string }

describe('buildTurnContext', () => {
  it('says nothing when there is nothing to say', () => {
    expect(buildTurnContext({})).toBe('')
    expect(buildTurnContext({ memory: '  ', rag: '', clock: '' })).toBe('')
  })

  it('memory, then retrieval, then the clock, each once', () => {
    const clock = hostClockLine(new Date('2026-10-20T15:01:00Z'))
    const rag = buildRagSuffix([{ content: 'Passage A' }])
    const note = buildTurnContext({ memory: '- lives in Berlin', rag, clock })
    expect(note.startsWith(`${MEMORY_PREAMBLE}\n- lives in Berlin`)).toBe(true)
    expect(note.indexOf('[Source 1]')).toBeGreaterThan(note.indexOf('lives in Berlin'))
    expect(note.endsWith(clock)).toBe(true)
    // The suffix arrives with its own leading blank line; the note does not keep it.
    expect(note).not.toMatch(/\n\n\n/)
  })
})

describe('withTurnContext', () => {
  const sys: M = { role: 'system', content: 'You are LU.' }

  it('puts the note right behind the newest user message', () => {
    const msgs: M[] = [sys, { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }]
    const out = withTurnContext(msgs, 'NOTE')
    expect(out.map((m) => m.content)).toEqual(['You are LU.', 'a', 'b', 'c', 'NOTE'])
    expect(out[4].role).toBe('user')
    // A copy: the array the caller holds is left alone.
    expect(msgs).toHaveLength(4)
  })

  it('stays in front of anything pushed behind the user message later in the run', () => {
    const msgs: M[] = [sys, { role: 'user', content: 'q' }, { role: 'assistant', content: '' }]
    expect(withTurnContext(msgs, 'NOTE').map((m) => m.content)).toEqual(['You are LU.', 'q', 'NOTE', ''])
  })

  it('without a note or a user message, the same array comes back', () => {
    const msgs: M[] = [sys, { role: 'user', content: 'q' }]
    expect(withTurnContext(msgs, '')).toBe(msgs)
    expect(withTurnContext([sys], 'NOTE')).toEqual([sys])
  })

  it('two turns a minute apart, with other memories, share everything up to the new message', () => {
    // The finding itself: before A7 the clock and the memories sat in the
    // system prompt, so the second turn differed from byte 0 and the whole
    // chat was read again (box, 20.10.2026).
    const history: M[] = [sys, { role: 'user', content: 'first' }, { role: 'assistant', content: 'answer' }]
    const turn1 = withTurnContext([...history.slice(0, 2)], buildTurnContext({
      memory: '- one', clock: hostClockLine(new Date('2026-10-20T15:01:00Z')),
    }))
    const turn2 = withTurnContext([...history, { role: 'user', content: 'second' }], buildTurnContext({
      memory: '- two', clock: hostClockLine(new Date('2026-10-20T15:03:00Z')),
    }))
    // System prompt and the first user message are the same bytes in both.
    expect(JSON.stringify(turn2.slice(0, 2))).toBe(JSON.stringify(turn1.slice(0, 2)))
    expect(turn2[0].content).toBe('You are LU.')
  })
})
