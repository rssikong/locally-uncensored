/**
 * Files that are being read for a chat right now (a PDF or a Word file takes seconds, a scan takes longer).
 * The composer shows a chip "Reading ..." for each until the file is a chip of its own or the reading failed.
 * Kept outside the attach sheet, because the sheet closes the moment the file is picked.
 */
import { create } from 'zustand'

interface ReadingState {
  reading: Record<string, string[]>
  begin: (chat: string, name: string) => void
  end: (chat: string, name: string) => void
}

const NONE: readonly string[] = []

export const useReadingStore = create<ReadingState>((set) => ({
  reading: {},
  begin: (chat, name) => set((s) => ({ reading: { ...s.reading, [chat]: [...(s.reading[chat] ?? NONE), name] } })),
  end: (chat, name) =>
    set((s) => {
      const list = [...(s.reading[chat] ?? NONE)]
      const at = list.indexOf(name)
      if (at >= 0) list.splice(at, 1)
      const next = { ...s.reading }
      if (list.length > 0) next[chat] = list
      else delete next[chat]
      return { reading: next }
    }),
}))

/** The names being read for this chat, in the order they were picked. */
export function useReadingNames(chat: string): readonly string[] {
  return useReadingStore((s) => s.reading[chat] ?? NONE)
}
