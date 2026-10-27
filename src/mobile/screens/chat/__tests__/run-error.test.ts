import { describe, expect, it } from 'vitest'
import { CREDITS_EXHAUSTED_MESSAGE } from '../../../../lib/credits-exhausted'
import { answerBody, viewAnswer } from '../parts/adapters/run-error'

describe('viewAnswer', () => {
  it('leaves a clean answer alone', () => {
    expect(viewAnswer({ content: 'All good.' })).toEqual({ body: 'All good.', error: null })
  })
  it('never judges an answer that is still being written', () => {
    expect(viewAnswer({ content: '' }, { streaming: true }).error).toBeNull()
    expect(viewAnswer({ content: 'Half\n\nError: x' }, { streaming: true }).body).toBe('Half\n\nError: x')
  })
  it('reads the credits message of the logic layer, and keeps the part that arrived', () => {
    expect(viewAnswer({ content: CREDITS_EXHAUSTED_MESSAGE }, { cloud: true })).toEqual({ body: '', error: { kind: 'credits', detail: '' } })
    expect(viewAnswer({ content: `Half an answer\n\n${CREDITS_EXHAUSTED_MESSAGE}` }, { cloud: true }).body).toBe('Half an answer')
  })
  it('reads an ended session from a cloud answer', () => {
    expect(viewAnswer({ content: 'Error: Session expired. Sign in again.' }, { cloud: true }).error?.kind).toBe('session')
    expect(viewAnswer({ content: 'Sign in to your LU Cloud account to use this model.' }, { cloud: true }).error?.kind).toBe('session')
    expect(viewAnswer({ content: 'Part\n\nError: 401 Unauthorized' }, { cloud: true })).toEqual({ body: 'Part', error: { kind: 'session', detail: '' } })
  })
  it('tells a broken connection from an engine that did not answer', () => {
    expect(viewAnswer({ content: 'Part\n\nError: Failed to fetch' }, { cloud: true })).toEqual({ body: 'Part', error: { kind: 'network', detail: 'Failed to fetch' } })
    expect(viewAnswer({ content: 'Error: connection refused' }, { cloud: true }).error?.kind).toBe('network')
    expect(viewAnswer({ content: 'Error: connection refused' }).error?.kind).toBe('engine')
    expect(viewAnswer({ content: 'Error: The model is still loading' }).error?.kind).toBe('engine')
    expect(viewAnswer({ content: 'Error from LU Engine: out of memory' }).error).toEqual({ kind: 'engine', detail: 'out of memory' })
  })
  it('keeps the reason of anything else', () => {
    expect(viewAnswer({ content: 'Error: Something odd' }, { cloud: true }).error).toEqual({ kind: 'generic', detail: 'Something odd' })
  })
  it('knows a run the app cut off and a stream that broke', () => {
    expect(viewAnswer({ content: 'Start of it', finishReason: 'interrupted' }).error?.kind).toBe('interrupted')
    expect(viewAnswer({ content: 'Start', finishReason: 'disconnect' })).toEqual({ body: 'Start', error: { kind: 'network', detail: '' } })
  })
  it('calls an answer without text and without thoughts empty', () => {
    expect(viewAnswer({ content: '  ' }).error?.kind).toBe('empty')
    expect(viewAnswer({ content: '', thinking: 'hm' }).error).toBeNull()
  })
  it('does not take an answer that only talks about errors for one', () => {
    const text = 'An "Error: x" line in the middle of a sentence is fine.'
    expect(viewAnswer({ content: text })).toEqual({ body: text, error: null })
  })
})

describe('answerBody', () => {
  it('is the text without the error tail', () => {
    expect(answerBody({ content: 'Kept\n\nError: timeout' })).toBe('Kept')
  })
})
