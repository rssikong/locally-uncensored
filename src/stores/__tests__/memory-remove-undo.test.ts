/**
 * A27 (3.0.8): deleting memories, one, several or all, with Undo, and what is
 * deleted stays out of the prompt.
 *
 * liam_2007, Discord 22.10.2026: the Memory panel "says you can remove
 * context, yet can only have context be viewed or added". These run the real
 * store, so "deleted" here means: gone from the list, gone from what the
 * prompt receives, and not written back by the extractor.
 *
 * NEGATIVE CONTROL (by hand): drop the `opts?.auto && isForgotten(...)` line
 * in memoryStore.addMemory and "an automatic write of a deleted fact is
 * refused" goes red; drop the revision check in restoreMemories and "Undo
 * after an account switch writes nothing" goes red.
 *
 * Run: npx vitest run src/stores/__tests__/memory-remove-undo.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMemoryStore, __setMemoryEmbedFn } from '../memoryStore'
import type { MemoryFile } from '../../types/agent-mode'

const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]))

beforeEach(() => {
  useMemoryStore.setState({ entries: [], forgotten: [], activeMemoryOwner: null })
  embed.mockClear()
  __setMemoryEmbedFn(embed)
})
afterEach(() => __setMemoryEmbedFn())

const add = (title: string, content: string, extra: Partial<MemoryFile> = {}) =>
  useMemoryStore.getState().addMemory({ type: 'user', title, description: content, content, tags: [], source: 'manual', ...extra })

const titles = () => useMemoryStore.getState().entries.map(e => e.title)
const prompt = () => useMemoryStore.getState().getMemoriesForPrompt('', 32768)

describe('removing', () => {
  it('removes one entry and it leaves the prompt', () => {
    add('Editor', 'The user writes code in Helix')
    const id = add('Project', 'The user builds a garden irrigation controller')
    expect(prompt()).toContain('garden irrigation')
    const removal = useMemoryStore.getState().removeMemory(id)
    expect(removal?.entries.map(e => e.id)).toEqual([id])
    expect(titles()).toEqual(['Editor'])
    expect(prompt()).not.toContain('garden irrigation')
    expect(prompt()).toContain('Helix')
  })

  it('removes several in one write and reports their old places', () => {
    const a = add('A', 'Fact alpha one')
    add('B', 'Fact bravo two')
    const c = add('C', 'Fact charlie three')
    add('D', 'Fact delta four')
    const removal = useMemoryStore.getState().removeMemories([c, a, 'missing-id'])
    expect(removal?.entries.map(e => e.title)).toEqual(['A', 'C'])
    expect(removal?.positions).toEqual([0, 2])
    expect(titles()).toEqual(['B', 'D'])
  })

  it('returns null and changes nothing when no id is there', () => {
    add('A', 'Fact alpha one')
    const before = useMemoryStore.getState().entries
    expect(useMemoryStore.getState().removeMemories(['nope'])).toBeNull()
    expect(useMemoryStore.getState().entries).toBe(before)
  })

  it('clearAll removes everything, and the prompt is empty', () => {
    add('A', 'Fact alpha one')
    add('B', 'Fact bravo two')
    const removal = useMemoryStore.getState().clearAll()
    expect(removal?.entries).toHaveLength(2)
    expect(titles()).toEqual([])
    expect(prompt()).toBe('')
  })
})

describe('undo', () => {
  it('puts several back in their old order', () => {
    const a = add('A', 'Fact alpha one')
    add('B', 'Fact bravo two')
    const c = add('C', 'Fact charlie three')
    add('D', 'Fact delta four')
    const removal = useMemoryStore.getState().removeMemories([a, c])
    expect(removal).not.toBeNull()
    expect(useMemoryStore.getState().restoreMemories(removal!)).toBe(true)
    expect(titles()).toEqual(['A', 'B', 'C', 'D'])
    expect(prompt()).toContain('Fact charlie three')
  })

  it('puts everything back after clearAll, ids unchanged', () => {
    const ids = [add('A', 'Fact alpha one'), add('B', 'Fact bravo two')]
    const removal = useMemoryStore.getState().clearAll()!
    useMemoryStore.getState().restoreMemories(removal)
    expect(useMemoryStore.getState().entries.map(e => e.id)).toEqual(ids)
  })

  it('re-embeds restored entries, but never a sensitive one', async () => {
    add('A', 'Fact alpha one')
    add('S', 'Sensitive fact', { sensitive: true })
    const removal = useMemoryStore.getState().clearAll()!
    embed.mockClear()
    useMemoryStore.getState().restoreMemories(removal)
    await vi.waitFor(() => expect(embed).toHaveBeenCalled())
    const texts = embed.mock.calls.flatMap(call => call[0])
    expect(texts.join('\n')).toContain('Fact alpha one')
    expect(texts.join('\n')).not.toContain('Sensitive fact')
  })

  it('does not double an entry that is already back', () => {
    const a = add('A', 'Fact alpha one')
    const removal = useMemoryStore.getState().removeMemory(a)!
    expect(useMemoryStore.getState().restoreMemories(removal)).toBe(true)
    expect(useMemoryStore.getState().restoreMemories(removal)).toBe(true)
    expect(titles()).toEqual(['A'])
  })

  it('Undo after an account switch writes nothing', () => {
    const a = add('A', 'Fact alpha one')
    const removal = useMemoryStore.getState().removeMemory(a)!
    // A collection switch bumps the revision (selectMemoryCollection).
    useMemoryStore.setState(s => ({ memoryCollectionRevision: s.memoryCollectionRevision + 1, entries: [] }))
    expect(useMemoryStore.getState().restoreMemories(removal)).toBe(false)
    expect(titles()).toEqual([])
  })
})

describe('deleted stays deleted', () => {
  const autoAdd = (title: string, content: string) =>
    useMemoryStore.getState().addMemory({ type: 'project', title, description: content, content, tags: [], source: 'conv-1' }, { auto: true })

  it('an automatic write of a deleted fact is refused', () => {
    const id = add('Garden', 'The user builds a garden irrigation controller')
    useMemoryStore.getState().removeMemory(id)
    expect(autoAdd('Garden', 'The user builds a garden irrigation controller')).toBe('')
    // Case, punctuation and spacing do not make it a new fact.
    expect(autoAdd('garden!', '  the user builds a GARDEN irrigation controller.')).toBe('')
    expect(titles()).toEqual([])
    expect(prompt()).toBe('')
  })

  it('the same title with new words is still the deleted memory', () => {
    const id = add('Garden project', 'The user builds a garden irrigation controller')
    useMemoryStore.getState().removeMemory(id)
    expect(autoAdd('Garden project', 'Working on an irrigation controller for the garden')).toBe('')
  })

  it('an unrelated fact is still written', () => {
    const id = add('Garden', 'The user builds a garden irrigation controller')
    useMemoryStore.getState().removeMemory(id)
    expect(autoAdd('Editor', 'The user writes code in Helix')).not.toBe('')
  })

  it('the user can write it again by hand, which lifts the mark', () => {
    const id = add('Garden', 'The user builds a garden irrigation controller')
    useMemoryStore.getState().removeMemory(id)
    expect(add('Garden', 'The user builds a garden irrigation controller')).not.toBe('')
    expect(useMemoryStore.getState().forgotten).toEqual([])
  })

  it('Undo lifts the mark', () => {
    const id = add('Garden', 'The user builds a garden irrigation controller')
    const removal = useMemoryStore.getState().removeMemory(id)!
    useMemoryStore.getState().restoreMemories(removal)
    expect(useMemoryStore.getState().forgotten).toEqual([])
  })

  it('keeps hashes only, never the deleted words', () => {
    const id = add('Secret plan', 'Synthetic secret that must not be stored')
    useMemoryStore.getState().removeMemory(id)
    const kept = JSON.stringify(useMemoryStore.getState().forgotten)
    expect(kept).not.toMatch(/secret|synthetic|stored/i)
    expect(useMemoryStore.getState().forgotten).toHaveLength(1)
  })

  it('persists the marks with the memories', () => {
    const id = add('Garden', 'The user builds a garden irrigation controller')
    useMemoryStore.getState().removeMemory(id)
    const partialize = useMemoryStore.persist.getOptions().partialize!
    const saved = partialize(useMemoryStore.getState()) as { forgotten?: unknown }
    expect(saved.forgotten).toEqual(useMemoryStore.getState().forgotten)
  })
})
