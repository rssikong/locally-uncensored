/**
 * What a page or a sheet knows about itself: its entry in the stack and
 * whether it is the one on top.
 */
import { createContext, useContext, useEffect } from 'react'
import { navApi } from './api'
import { useNavStore } from './store'
import type { NavState, PageEntry, Params, SheetEntry } from './types'

/** Where a mounted page is in its stack: the visible one, the one kept below it, or the one sliding out. */
export type PagePlace = 'top' | 'under' | 'leaving'

export interface PageContextValue {
  entry: PageEntry
  /** True while this page is the visible one and no sheet or dialog lies above it. */
  isTop: boolean
  /** True for the root of a tab. */
  isRoot: boolean
  /** Default 'top'. Unlike isTop it does not change while a sheet or a dialog covers the page. */
  place?: PagePlace
}

export interface SheetContextValue {
  entry: SheetEntry
  isTop: boolean
  locked: boolean
  /** Title from the sheet table, used until the content has loaded. */
  title: string
  /** How many sheets lie above this one: 0 for the top sheet. A dialog above does not count. */
  depth?: number
}

/**
 * The data-testid of a control that every page or every sheet has (Back,
 * Close). Two pages stay mounted and sheets stack, so the bare id would be
 * in the document twice. It belongs to the one on top; the others carry a
 * suffix, so every id is there once:
 *
 *   m-page-back    m-page-back-under    m-page-back-leaving
 *   m-sheet-close  m-sheet-close-under-1  m-sheet-close-under-2
 */
export function pageControlId(base: string, place: PagePlace | undefined): string {
  return !place || place === 'top' ? base : `${base}-${place}`
}

export function sheetControlId(base: string, depth: number | undefined): string {
  return !depth || depth <= 0 ? base : `${base}-under-${depth}`
}

export const PageContext = createContext<PageContextValue | null>(null)
export const SheetContext = createContext<SheetContextValue | null>(null)

/** The page this component is rendered in. Throws outside a page, which is a programming error. */
export function usePage(): PageContextValue {
  const ctx = useContext(PageContext)
  if (!ctx) throw new Error('usePage must be used inside a page of the mobile stack')
  return ctx
}

export function useRoute(): { route: string; params: Params; key: string } {
  const { entry } = usePage()
  return { route: entry.route, params: entry.params, key: entry.key }
}

/** Parameters of the current page, for example { id } on /chat/:id. */
export function useParams<T extends Params = Params>(): T {
  return usePage().entry.params as T
}

export function useIsTop(): boolean {
  const page = useContext(PageContext)
  const sheet = useContext(SheetContext)
  if (sheet) return sheet.isTop
  return page ? page.isTop : false
}

/** Inside a sheet: its props, the open sub page and how to move. */
export function useSheet<P = unknown>(): {
  props: P
  /** The sub page on top, or null on the first page of the sheet. */
  sub: string | null
  subs: string[]
  pushSub: (sub: string) => void
  close: () => void
  back: () => void
  key: string
} {
  const ctx = useContext(SheetContext)
  if (!ctx) throw new Error('useSheet must be used inside a sheet')
  const { entry } = ctx
  return {
    props: entry.props as P,
    sub: entry.sub.length > 0 ? entry.sub[entry.sub.length - 1] : null,
    subs: entry.sub,
    pushSub: navApi.sheetPush,
    close: navApi.closeSheet,
    back: navApi.back,
    key: entry.key,
  }
}

/** Subscribe to a slice of the router state. */
export function useNavState<T>(selector: (state: NavState) => T): T {
  return useNavStore(selector)
}

/**
 * Unsaved input on this page: while `dirty` is true, back asks
 * "Discard changes?" before the page closes (DESIGN.md 2.4).
 */
export function useLeaveGuard(dirty: boolean): void {
  const { entry } = usePage()
  useEffect(() => {
    if (!dirty) return
    navApi.setLeaveGuard(entry.key, () => true)
    return () => navApi.setLeaveGuard(entry.key, null)
  }, [dirty, entry.key])
}
