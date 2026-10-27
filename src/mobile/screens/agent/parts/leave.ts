import { useCallback } from 'react'
import { nav, useLeaveGuard, useRoute } from '../../../nav'
import { navApi } from '../../../nav/api'

/**
 * An editor page with unsaved input: while `dirty` is true, back asks
 * "Discard changes?". The returned function leaves the page WITHOUT that
 * question, for the moment after Save or Delete: it takes the guard of this
 * page away and goes back in the same step, so the page never asks about
 * changes that were just saved, and a page whose record was just deleted
 * does not get to draw itself once more.
 */
export function useGuardedLeave(dirty: boolean): () => void {
  const { key } = useRoute()
  useLeaveGuard(dirty)
  return useCallback(() => {
    navApi.setLeaveGuard(key, null)
    void nav.back()
  }, [key])
}
