/**
 * Search hits from Hugging Face and their files.
 *
 * The search itself is api/discover.ts (`searchHuggingFaceModels`, GGUF
 * repositories only). A hit carries no size, and without a size there is no
 * verdict, so the files of each hit are read once and kept for the session.
 */
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { listHfVariants, type HfVariant } from './adapters/hf'

type Entry = { state: 'loading' } | { state: 'ready'; variants: HfVariant[] } | { state: 'failed' }

interface VariantState {
  byRepo: Record<string, Entry>
  load: (repo: string, again?: boolean) => Promise<void>
}

export const useVariantStore = create<VariantState>((set, get) => ({
  byRepo: {},
  load: async (repo, again = false) => {
    const known = get().byRepo[repo]
    if (known && !(again && known.state === 'failed')) return
    set((s) => ({ byRepo: { ...s.byRepo, [repo]: { state: 'loading' } } }))
    try {
      const variants = await listHfVariants(repo)
      set((s) => ({ byRepo: { ...s.byRepo, [repo]: { state: 'ready', variants } } }))
    } catch {
      set((s) => ({ byRepo: { ...s.byRepo, [repo]: { state: 'failed' } } }))
    }
  },
}))

/** The files of one repository, read on first use. */
export function useVariants(repo: string | null): Entry | null {
  const entry = useVariantStore((s) => (repo ? s.byRepo[repo] : undefined))
  useEffect(() => {
    if (repo) void useVariantStore.getState().load(repo)
  }, [repo])
  return entry ?? (repo ? { state: 'loading' } : null)
}

/** Read the files of several hits, a few at a time, so the cards get their verdict one after the other. */
export function loadVariantsOf(repos: readonly string[], parallel = 3): void {
  const queue = repos.filter((repo) => !useVariantStore.getState().byRepo[repo])
  const next = (): void => {
    const repo = queue.shift()
    if (!repo) return
    void useVariantStore.getState().load(repo).finally(next)
  }
  for (let i = 0; i < parallel; i += 1) next()
}

/** A value that follows `value` after it stood still for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [late, setLate] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setLate(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return late
}
