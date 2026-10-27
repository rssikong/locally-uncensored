/**
 * The state of the stack router. A plain zustand store without `persist`:
 * saving is done by the controller (nav/api.ts), which also keeps the browser
 * history in step.
 */
import { create } from 'zustand'
import { initialState } from './core'
import { TAB_ROOT_ROUTES } from './roots'
import type { NavState } from './types'

let seq = 0

/** A key that is unique for the life of the page. Used as React key and for scroll positions. */
export function newKey(hint: string): string {
  seq += 1
  return `${hint}#${seq}`
}

export const useNavStore = create<NavState>(() => initialState(TAB_ROOT_ROUTES, newKey))
