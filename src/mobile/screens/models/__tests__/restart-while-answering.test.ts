/**
 * "Restart engine" while the model on this phone writes an answer (acceptance iPhone, second part, P3).
 *
 * The restart cut the answer without a word, and the box under it promised a part its button threw away. The
 * engine page asks first, and the chat goes on from the part that arrived.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { answerIsRunning } from '../parts/restart-question'
import { continuableError } from '../../chat/parts/logic/messages'
import { MODELS_STRINGS as S } from '../../../strings/models'

const page = readFileSync(join(__dirname, '..', 'EnginePage.tsx'), 'utf8')

describe('the question before a restart', () => {
  it('is asked while a chat is between its send and its end, and not otherwise', () => {
    expect(answerIsRunning({ c1: Symbol('run') })).toBe(true)
    expect(answerIsRunning({})).toBe(false)
    expect(answerIsRunning(null)).toBe(false)
  })

  it('stands in front of the restart on the engine page, and "Let it finish" restarts nothing', () => {
    const restart = page.slice(page.indexOf('const restart = async () => {'), page.indexOf('const selfTest = async () => {'))
    expect(restart).toContain('if (answerIsRunning(useChatSendPending.getState().pending)) {')
    expect(restart).toContain("testid: 'engine-restart-answering'")
    expect(restart.indexOf('if (!go) return')).toBeGreaterThan(0)
    expect(restart.indexOf('if (!go) return')).toBeLessThan(restart.indexOf('await restartEngine('))
    // The row calls this and nothing else.
    expect(page).toContain('onPress={() => void restart()}')
    expect(page.match(/restartEngine\(/g)?.length).toBe(1)
  })

  it('says what happens to the answer', () => {
    expect(S.engine.restartAnsweringText).toContain('stops that answer')
    expect(S.engine.restartAnsweringText).toContain('The part that arrived stays in the chat.')
    expect(S.engine.restartAnsweringCancel).toBe('Let it finish')
    for (const text of [S.engine.restartAnsweringTitle, S.engine.restartAnsweringText]) expect(text).not.toMatch(/[‒-―]/)
  })
})

describe('going on after the engine stopped under an answer', () => {
  it('an answer of a model on this phone can be gone on with, one of a server cannot', () => {
    expect(continuableError('network', false)).toBe(true)
    expect(continuableError('network', true)).toBe(false)
    expect(continuableError('interrupted', false)).toBe(true)
    expect(continuableError('interrupted', true)).toBe(true)
    expect(continuableError('engine', false)).toBe(false)
    expect(continuableError(undefined, false)).toBe(false)
  })
})
