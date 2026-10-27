/**
 * Ways into the Account page from a sheet. A sheet can come up over any
 * page, the Account page included; then there is nothing to push, and a
 * second copy of the page on top of itself would only cost a back step.
 */
import { nav } from '../../../nav'

/** Pure: is this route the page on top of the active stack. */
export function isTopRoute(state: { flow: unknown; flowStack: ReadonlyArray<{ route: string }>; tab: string; stacks: Record<string, ReadonlyArray<{ route: string }>> }, route: string): boolean {
  const stack = state.flow ? state.flowStack : (state.stacks[state.tab] ?? [])
  return stack[stack.length - 1]?.route === route
}

export function goToAccount(): void {
  if (isTopRoute(nav.getState(), '/settings/account')) return
  nav.push('/settings/account')
}
