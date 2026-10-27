/**
 * Acceptance on Android, M9: learning from the last answer ran on the one
 * small model of the phone and the next question waited behind it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const phone = { on: true }
vi.mock('../capabilities', () => ({ singleModelSlot: () => phone.on }))

import { useGenerationStore } from '../../stores/generationStore'
import { MEMORY_LEARNING_SUFFIX, yieldMemoryLearning } from '../memory-learning-yield'

describe('a new question ends learning from the last answer', () => {
  beforeEach(() => {
    phone.on = true
    useGenerationStore.setState({ aborters: {}, runs: {}, generating: {} })
  })

  it('ends a learning run on the phone and leaves the answer of another chat alone', () => {
    const learning = vi.fn()
    const answer = vi.fn()
    useGenerationStore.getState().registerAborter(`chat-a${MEMORY_LEARNING_SUFFIX}`, learning)
    useGenerationStore.getState().registerAborter('chat-b', answer)
    expect(yieldMemoryLearning()).toBe(1)
    expect(learning).toHaveBeenCalledTimes(1)
    expect(answer).not.toHaveBeenCalled()
    expect(Object.keys(useGenerationStore.getState().aborters)).toEqual(['chat-b'])
  })

  it('reaches a learning run that only waits in the queue', () => {
    useGenerationStore.getState().bookRun(`chat-a${MEMORY_LEARNING_SUFFIX}`, 'local', Symbol('run'))
    expect(yieldMemoryLearning()).toBe(1)
    expect(useGenerationStore.getState().runs).toEqual({})
  })

  it('does nothing where two models fit', () => {
    phone.on = false
    const learning = vi.fn()
    useGenerationStore.getState().registerAborter(`chat-a${MEMORY_LEARNING_SUFFIX}`, learning)
    expect(yieldMemoryLearning()).toBe(0)
    expect(learning).not.toHaveBeenCalled()
  })
})
