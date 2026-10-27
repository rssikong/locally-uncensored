/**
 * Acceptance on Android (buttons), H2: after a hard kill in the middle of an
 * answer only the question was left, and the app said the part was kept.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHECKPOINT_EVERY_MS, FIRST_TEXT_LOOK_MS, SECOND_RECORD_AFTER_MS, createCheckpointer, openAnswerOf, repairFromCheckpoint, type AnswerCheckpoint, type CheckpointMessage } from '../partial-answer-checkpoint'

const user: CheckpointMessage = { id: 'u', role: 'user', content: 'Tell me about the sea.' }
const cp = (patch: Partial<AnswerCheckpoint> = {}): AnswerCheckpoint => ({ conversationId: 'c', messageId: 'a', content: 'The sea is wide and', timestamp: 5, ...patch })

describe('the answer a run is writing', () => {
  it('is the last visible assistant message that nobody finished', () => {
    expect(openAnswerOf('c', [user, { id: 'a', role: 'assistant', content: 'The sea', thinking: 'hm', modelId: 'm', timestamp: 7 }])).toEqual({
      conversationId: 'c', messageId: 'a', content: 'The sea', thinking: 'hm', modelId: 'm', timestamp: 7,
    })
  })
  it('is nothing when the chat ends with the question, a finished answer or a hidden note', () => {
    expect(openAnswerOf('c', [user])).toBeNull()
    expect(openAnswerOf('c', [user, { id: 'a', role: 'assistant', content: 'Done.', finishReason: 'stop' }])).toBeNull()
    expect(openAnswerOf('c', [{ id: 'a', role: 'assistant', content: 'x', finishReason: 'stop' }, { id: 'h', role: 'assistant', content: 'y', hidden: true }])).toBeNull()
  })
})

describe('what a record puts back after a kill', () => {
  it('the text, when the history came off the disk with less of it', () => {
    const repair = repairFromCheckpoint([user, { id: 'a', role: 'assistant', content: '' }], cp())
    expect(repair).toEqual({ kind: 'longer', messageId: 'a', content: 'The sea is wide and' })
  })
  it('the thoughts too, and never a shorter text over a longer one', () => {
    const repair = repairFromCheckpoint([user, { id: 'a', role: 'assistant', content: 'The sea is wide and deep', thinking: 'a' }], cp({ thinking: 'a longer thought' }))
    expect(repair).toEqual({ kind: 'longer', messageId: 'a', content: 'The sea is wide and deep', thinking: 'a longer thought' })
    expect(repairFromCheckpoint([user, { id: 'a', role: 'assistant', content: 'The sea is wide and deep' }], cp())).toEqual({ kind: 'none' })
  })
  it('the whole answer, when the history ends with the question', () => {
    expect(repairFromCheckpoint([user], cp())).toEqual({ kind: 'missing', checkpoint: cp() })
  })
  it('nothing for a finished answer, another answer, an empty record or no record', () => {
    expect(repairFromCheckpoint([user, { id: 'a', role: 'assistant', content: 'Short.', finishReason: 'stop' }], cp())).toEqual({ kind: 'none' })
    expect(repairFromCheckpoint([user, { id: 'other', role: 'assistant', content: '' }], cp())).toEqual({ kind: 'none' })
    expect(repairFromCheckpoint([user], cp({ content: '  ' }))).toEqual({ kind: 'none' })
    expect(repairFromCheckpoint([user], null)).toEqual({ kind: 'none' })
    // The answer exists further up and the chat went on: the record is old.
    expect(repairFromCheckpoint([user, { id: 'a', role: 'assistant', content: 'x', finishReason: 'stop' }, { id: 'u2', role: 'user', content: 'More?' }], cp())).toEqual({ kind: 'none' })
  })
})

describe('the writer of the records', () => {
  afterEach(() => vi.useRealTimers())

  it('writes a running answer every while, only when it grew, and clears it when the run ends', async () => {
    vi.useFakeTimers()
    let text = 'The'
    const writes: string[] = []
    const cleared: string[] = []
    const keeper = createCheckpointer(
      () => cp({ content: text }),
      async (c) => void writes.push(c.content),
      async (id) => void cleared.push(id),
      1000,
    )
    keeper.open('c')
    keeper.open('c')
    await vi.advanceTimersByTimeAsync(1000)
    expect(writes).toEqual(['The'])
    await vi.advanceTimersByTimeAsync(1000)
    expect(writes).toEqual(['The'])
    text = 'The sea'
    await vi.advanceTimersByTimeAsync(1000)
    expect(writes).toEqual(['The', 'The sea'])
    // The app leaves the screen: written at once, without waiting for the next tick.
    text = 'The sea is'
    await keeper.saveAll()
    expect(writes).toEqual(['The', 'The sea', 'The sea is'])
    keeper.close('c')
    expect(cleared).toEqual(['c'])
    text = 'The sea is wide'
    await vi.advanceTimersByTimeAsync(3000)
    expect(writes).toHaveLength(3)
  })

  // Check on the iPhone, M2: until about 1.4 s after the send the beginning the user had read was gone after a
  // kill (6 of 6 at 1.0 and 1.4 s), because the first record was written with the first beat, 1.5 s in.
  it('the first record is written with the first text, not with the first beat', async () => {
    vi.useFakeTimers()
    let text = ''
    const writes: string[] = []
    const keeper = createCheckpointer(() => cp({ content: text }), async (c) => void writes.push(c.content), async () => {}, CHECKPOINT_EVERY_MS)
    keeper.open('c')
    // Nothing yet: looking writes nothing.
    await vi.advanceTimersByTimeAsync(400)
    expect(writes).toEqual([])
    text = 'The sea'
    await vi.advanceTimersByTimeAsync(FIRST_TEXT_LOOK_MS)
    expect(writes).toEqual(['The sea'])
    // One more early record, then the beat as before.
    text = 'The sea is wide and deep, and'
    await vi.advanceTimersByTimeAsync(SECOND_RECORD_AFTER_MS)
    expect(writes).toEqual(['The sea', 'The sea is wide and deep, and'])
    text = 'The sea is wide and deep, and it is old.'
    await vi.advanceTimersByTimeAsync(CHECKPOINT_EVERY_MS)
    expect(writes.at(-1)).toBe('The sea is wide and deep, and it is old.')
    // No more looking after the first text: only the beat writes from here on.
    const count = writes.length
    text += ' More.'
    await vi.advanceTimersByTimeAsync(FIRST_TEXT_LOOK_MS * 3)
    expect(writes).toHaveLength(count)
    keeper.stop()
  })

  // Finding N7 (Android review): the first look came up to 100 ms after the text was on screen.
  it('the first look comes within 30 ms of the first text', async () => {
    vi.useFakeTimers()
    let text = ''
    const writes: string[] = []
    const keeper = createCheckpointer(() => cp({ content: text }), async (c) => void writes.push(c.content), async () => {}, CHECKPOINT_EVERY_MS)
    keeper.open('c')
    await vi.advanceTimersByTimeAsync(333)
    text = 'The sea'
    await vi.advanceTimersByTimeAsync(30)
    expect(writes).toEqual(['The sea'])
    keeper.stop()
  })

  it('a thought counts as first text, and a run that ends before any text leaves no timer behind', async () => {
    vi.useFakeTimers()
    let thinking = ''
    const writes: AnswerCheckpoint[] = []
    const keeper = createCheckpointer(() => cp({ content: '', ...(thinking ? { thinking } : {}) }), async (c) => void writes.push(c), async () => {}, CHECKPOINT_EVERY_MS)
    keeper.open('c')
    thinking = 'Let me see'
    await vi.advanceTimersByTimeAsync(FIRST_TEXT_LOOK_MS)
    expect(writes.map((w) => w.thinking)).toEqual(['Let me see'])
    keeper.close('c')
    keeper.open('d')
    keeper.close('d')
    expect(vi.getTimerCount()).toBe(0)
  })
})
