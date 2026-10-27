// @vitest-environment jsdom
/**
 * A27 (3.0.8): the Memory panel in the top bar can delete, one, several and
 * all, with a question first and Undo after.
 *
 * liam_2007 (Discord, 22.10.2026, Bazzite/KDE): "Memory panel says you can
 * remove context, yet can only have context be viewed or added". The trash
 * icon sat behind `opacity-0 group-hover:opacity-100`; where WebKitGTK reports
 * `hover: none` it never showed. jsdom has no layout and no hover, which makes
 * it the right stand-in: everything below is clicked without a single hover.
 *
 * Run: npx vitest run src/components/chat/__tests__/memory-panel-delete.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { useMemoryStore, __setMemoryEmbedFn } from '../../../stores/memoryStore'
import { MemoryDebugToggle } from '../MemoryDebugPanel'
import { MEMORY_UNDO_MS } from '../MemoryDelete'

const here = dirname(fileURLToPath(import.meta.url))

const add = (title: string) => useMemoryStore.getState().addMemory({
  type: 'user', title, description: title, content: `${title} content`, tags: [], source: 'manual',
})
const titles = () => useMemoryStore.getState().entries.map(e => e.title)

function open() {
  render(<MemoryDebugToggle />)
  fireEvent.click(screen.getByTitle('Memory: view, add or delete the context injected into prompts'))
}

beforeEach(() => {
  __setMemoryEmbedFn(async (texts: string[]) => texts.map(() => []))
  useMemoryStore.setState({ entries: [], forgotten: [], activeMemoryOwner: null })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Memory panel delete', () => {
  it('every row has a delete button that is not hidden behind hover', () => {
    add('Alpha'); add('Bravo')
    open()
    const buttons = [screen.getByLabelText('Delete Alpha'), screen.getByLabelText('Delete Bravo')]
    for (const button of buttons) expect(button.className).not.toMatch(/opacity-0/)
  })

  it('deletes one row after a second click, and Undo brings it back', () => {
    add('Alpha'); add('Bravo')
    open()
    fireEvent.click(screen.getByLabelText('Delete Alpha'))
    expect(titles()).toEqual(['Alpha', 'Bravo'])
    fireEvent.click(screen.getByLabelText('Confirm delete of Alpha'))
    expect(titles()).toEqual(['Bravo'])
    expect(screen.getByRole('status').textContent).toContain('Deleted 1 memory')
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }))
    expect(titles()).toEqual(['Alpha', 'Bravo'])
  })

  it('deletes the selected ones after a question', () => {
    add('Alpha'); add('Bravo'); add('Charlie')
    open()
    fireEvent.click(screen.getByRole('button', { name: /Select$/ }))
    fireEvent.click(screen.getByLabelText('Select Alpha'))
    fireEvent.click(screen.getByLabelText('Select Charlie'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 memories' }))
    const question = screen.getByRole('alertdialog')
    expect(question.textContent).toContain('Delete 2 memories?')
    expect(titles()).toHaveLength(3)
    fireEvent.click(within(question).getByRole('button', { name: /Delete/ }))
    expect(titles()).toEqual(['Bravo'])
  })

  it('Delete all asks, Cancel keeps everything', () => {
    add('Alpha'); add('Bravo')
    open()
    fireEvent.click(screen.getByRole('button', { name: /Delete all/ }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(titles()).toEqual(['Alpha', 'Bravo'])
  })

  it('Delete all empties the list and Undo restores all of it', () => {
    add('Alpha'); add('Bravo')
    open()
    fireEvent.click(screen.getByRole('button', { name: /Delete all/ }))
    expect(screen.getByRole('alertdialog').textContent).toContain('Delete all 2 memories?')
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Delete/ }))
    expect(titles()).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }))
    expect(titles()).toEqual(['Alpha', 'Bravo'])
  })

  it('the Undo bar goes away after a while, the delete stays', () => {
    vi.useFakeTimers()
    add('Alpha')
    open()
    fireEvent.click(screen.getByLabelText('Delete Alpha'))
    fireEvent.click(screen.getByLabelText('Confirm delete of Alpha'))
    act(() => { vi.advanceTimersByTime(MEMORY_UNDO_MS + 10) })
    expect(screen.queryByRole('status')).toBeNull()
    expect(titles()).toEqual([])
  })

  it('lists and deletes past the first 50', () => {
    for (let i = 1; i <= 55; i++) add(`Entry ${i}`)
    open()
    fireEvent.click(screen.getByLabelText('Delete Entry 55'))
    fireEvent.click(screen.getByLabelText('Confirm delete of Entry 55'))
    expect(titles()).toHaveLength(54)
    expect(titles()).not.toContain('Entry 55')
  })
})

describe('hover never hides a delete control', () => {
  it('Tailwind hover is plain :hover, without the media query WebKitGTK can fail', () => {
    const css = readFileSync(resolve(here, '../../../index.css'), 'utf8')
    expect(css).toMatch(/^@custom-variant hover \(&:hover\);$/m)
  })

  it('the memory and document delete buttons carry no opacity-0', () => {
    for (const file of ['../MemoryDebugPanel.tsx', '../MemoryDelete.tsx', '../RAGPanel.tsx', '../../settings/MemorySettings.tsx']) {
      const src = readFileSync(resolve(here, file), 'utf8')
      expect(src, file).not.toMatch(/opacity-0 group-hover:opacity-100/)
    }
  })
})
