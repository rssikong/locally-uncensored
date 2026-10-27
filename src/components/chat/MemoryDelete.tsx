import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2, Undo2 } from 'lucide-react'
import { useMemoryStore, type MemoryRemoval } from '../../stores/memoryStore'

// Deleting memories, shared by the Memory panel (top bar) and Settings → Agent
// → Memory (A27, 3.0.8).
//
// liam_2007 (Discord, 22.10.2026, Bazzite/KDE): the panel "says you can remove
// context, yet can only have context be viewed or added". The trash icon was
// there, but invisible (`opacity-0`) until a `group-hover`, and Tailwind 4 only applies
// `hover:` under `@media (hover: hover)`. WebKitGTK answers that query from
// the GDK seat; a seat it does not see a pointer on reports `hover: none`, and
// the icon then never shows. Even with a working hover it was an 11px gray
// glyph that appeared only under the cursor. So: the delete control is always
// visible, several or all entries can go at once, every delete asks first, and
// every delete can be undone for a few seconds.

/** How long the Undo bar stays after a delete. */
export const MEMORY_UNDO_MS = 10_000

/** Plural that reads right for one memory and for many. */
export function memoriesWord(n: number): string {
  return n === 1 ? '1 memory' : `${n} memories`
}

/**
 * The last delete and its Undo. One removal at a time: a second delete
 * replaces the first, which can then no longer be undone, the same as every
 * undo bar that only offers the latest step.
 */
export function useMemoryUndo() {
  const [removal, setRemoval] = useState<MemoryRemoval | null>(null)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const remember = useCallback((next: MemoryRemoval | null) => {
    clearTimeout(timer.current)
    setFailed(false)
    setRemoval(next)
    if (next) timer.current = setTimeout(() => setRemoval(null), MEMORY_UNDO_MS)
  }, [])

  const remove = useCallback((ids: readonly string[]) => {
    remember(useMemoryStore.getState().removeMemories(ids))
  }, [remember])

  const undo = useCallback(() => {
    if (!removal) return
    clearTimeout(timer.current)
    if (useMemoryStore.getState().restoreMemories(removal)) setRemoval(null)
    else setFailed(true)
  }, [removal])

  const dismiss = useCallback(() => remember(null), [remember])

  return { removal, failed, remove, undo, dismiss }
}

export function MemoryUndoBar({ removal, failed, onUndo, onDismiss }: {
  removal: MemoryRemoval | null
  failed: boolean
  onUndo: () => void
  onDismiss: () => void
}) {
  if (!removal) return null
  return (
    <div role="status" className="flex items-center gap-2 px-3 py-1.5 border-t border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-white/[0.03] t-micro text-gray-600 dark:text-gray-300 shrink-0">
      <Trash2 size={11} className="text-red-400 shrink-0" />
      <span className="flex-1 min-w-0 truncate">
        {failed
          ? 'Could not undo: the memory list changed (account switched).'
          : `Deleted ${memoriesWord(removal.entries.length)}. ${removal.entries.length === 1 ? 'It is' : 'They are'} no longer sent to the model.`}
      </span>
      {!failed && (
        <button onClick={onUndo} className="flex items-center gap-1 px-2 py-0.5 rounded font-medium text-purple-600 dark:text-purple-300 hover:bg-purple-500/10">
          <Undo2 size={11} /> Undo
        </button>
      )}
      <button onClick={onDismiss} className="px-1.5 py-0.5 rounded text-gray-500 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Dismiss">OK</button>
    </div>
  )
}

/** The question before a delete of several or all memories. */
export function MemoryDeleteConfirm({ count, all, onConfirm, onCancel }: {
  count: number
  all: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div role="alertdialog" aria-label="Confirm delete" className="flex items-center gap-2 px-3 py-1.5 border-b border-red-500/20 bg-red-500/[0.06] t-micro text-gray-700 dark:text-gray-200 shrink-0">
      <span className="flex-1 min-w-0">
        {all ? `Delete all ${memoriesWord(count)}?` : `Delete ${memoriesWord(count)}?`} You can undo right after.
      </span>
      <button onClick={onCancel} className="px-2 py-0.5 rounded text-gray-500 hover:bg-black/5 dark:hover:bg-white/10">Cancel</button>
      <button onClick={onConfirm} autoFocus className="flex items-center gap-1 px-2 py-0.5 rounded font-medium bg-red-500/15 border border-red-500/30 text-red-600 dark:text-red-300 hover:bg-red-500/25">
        <Trash2 size={10} /> Delete
      </button>
    </div>
  )
}

/**
 * The trash button of one row. Always visible. First click arms it (red,
 * "Delete?"), the second within three seconds deletes, the same two steps as
 * a chat message (D#81).
 */
export function MemoryRowDelete({ title, onDelete }: { title: string; onDelete: () => void }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const click = () => {
    if (armed) {
      clearTimeout(timer.current)
      setArmed(false)
      onDelete()
      return
    }
    setArmed(true)
    timer.current = setTimeout(() => setArmed(false), 3000)
  }
  return (
    <button
      onClick={click}
      title={armed ? 'Click again to delete' : 'Delete this memory'}
      aria-label={armed ? `Confirm delete of ${title}` : `Delete ${title}`}
      className={'shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded transition-colors ' + (armed
        ? 'text-red-500 bg-red-500/10 t-micro font-medium'
        : 'text-gray-400 dark:text-gray-500 hover:text-red-400 hover:bg-red-500/10')}
    >
      <Trash2 size={11} />{armed && 'Delete?'}
    </button>
  )
}
