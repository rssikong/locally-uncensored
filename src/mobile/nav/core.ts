/**
 * The stack router as pure functions. No React, no DOM, no store.
 *
 * Everything that decides what "back" means lives here, so it can be tested
 * without a browser (nav/__tests__/core.test.ts). nav/store.ts holds the
 * state, nav/history.ts ties it to the system back gesture.
 *
 * Order in which back closes things (DESIGN.md 2.4):
 *   dialog, sub page of a sheet, sheet, top page, tab root to the Chat tab.
 * From /chats there is nothing left and Android leaves the app.
 */
import { TABS, type Closed, type DialogEntry, type FlowId, type NavState, type OverlayEntry, type PageEntry, type Params, type SheetEntry, type Tab } from './types'

export const HOME_TAB: Tab = 'chat'

export interface RootRoutes {
  root: Record<Tab, string>
}

export function page(route: string, params: Params, key: string): PageEntry {
  return { kind: 'page', route, params, key }
}

export function initialState(roots: Record<Tab, string>, key: (hint: string) => string): NavState {
  const stacks = {} as Record<Tab, PageEntry[]>
  for (const tab of TABS) stacks[tab] = [page(roots[tab], {}, key(`root-${tab}`))]
  return { flow: null, flowStack: [], tab: HOME_TAB, stacks, overlays: [] }
}

export function activeStack(state: NavState): PageEntry[] {
  return state.flow ? state.flowStack : state.stacks[state.tab]
}

export function topPage(state: NavState): PageEntry | undefined {
  const stack = activeStack(state)
  return stack[stack.length - 1]
}

export function topOverlay(state: NavState): OverlayEntry | undefined {
  return state.overlays[state.overlays.length - 1]
}

/** True when the visible page is the root of its tab and nothing lies above it. */
export function isAtTabRoot(state: NavState): boolean {
  return !state.flow && state.stacks[state.tab].length === 1
}

/** The tab bar shows on the four roots only (DESIGN.md 2.3). */
export function showsTabBar(state: NavState): boolean {
  return isAtTabRoot(state)
}

/**
 * How many times back can still close something. 0 means: nothing left, the
 * system may leave the app.
 */
export function depth(state: NavState): number {
  let n = 0
  for (const overlay of state.overlays) n += overlay.kind === 'sheet' ? 1 + overlay.sub.length : 1
  n += Math.max(0, activeStack(state).length - 1)
  if (!state.flow && state.tab !== HOME_TAB) n += 1
  return n
}

function withActiveStack(state: NavState, stack: PageEntry[]): NavState {
  if (state.flow) return { ...state, flowStack: stack }
  return { ...state, stacks: { ...state.stacks, [state.tab]: stack } }
}

/** Push a page. Sheets and dialogs above the stack are closed: a page never opens underneath one. */
export function push(state: NavState, entry: PageEntry): NavState {
  return { ...withActiveStack(state, [...activeStack(state), entry]), overlays: [] }
}

/** Swap the top page for another one. The root of a tab is never replaced. */
export function replace(state: NavState, entry: PageEntry): NavState {
  const stack = activeStack(state)
  if (stack.length <= 1 && !state.flow) return push(state, entry)
  return { ...withActiveStack(state, [...stack.slice(0, -1), entry]), overlays: [] }
}

/**
 * Switch the tab. The stack of the tab that is left stays as it is. Tapping
 * the active tab goes to its root.
 */
export function switchTab(state: NavState, tab: Tab): NavState {
  if (state.flow) return state
  if (state.tab === tab) {
    const stack = state.stacks[tab]
    if (stack.length === 1 && state.overlays.length === 0) return state
    return { ...state, stacks: { ...state.stacks, [tab]: stack.slice(0, 1) }, overlays: [] }
  }
  return { ...state, tab, overlays: [] }
}

/** Replace the stack of a tab and go there. `pages` comes without the root, the root stays. */
export function resetTo(state: NavState, tab: Tab, pages: PageEntry[]): NavState {
  const root = state.stacks[tab][0]
  return { ...state, flow: null, flowStack: [], tab, stacks: { ...state.stacks, [tab]: [root, ...pages] }, overlays: [] }
}

export function startFlow(state: NavState, flow: FlowId, first: PageEntry): NavState {
  return { ...state, flow, flowStack: [first], overlays: [] }
}

export function finishFlow(state: NavState): NavState {
  return { ...state, flow: null, flowStack: [], overlays: [] }
}

export function openSheet(state: NavState, entry: SheetEntry): NavState {
  return { ...state, overlays: [...state.overlays, entry] }
}

export function openDialog(state: NavState, entry: DialogEntry): NavState {
  return { ...state, overlays: [...state.overlays, entry] }
}

/** Open a sub page in the top sheet. Without a sheet on top nothing happens. */
export function sheetPush(state: NavState, sub: string): NavState {
  const top = topOverlay(state)
  if (!top || top.kind !== 'sheet') return state
  const next: SheetEntry = { ...top, sub: [...top.sub, sub] }
  return { ...state, overlays: [...state.overlays.slice(0, -1), next] }
}

/** Remove one overlay by key, wherever it sits. Used when a dialog is answered by its buttons. */
export function removeOverlay(state: NavState, key: string): NavState {
  if (!state.overlays.some((o) => o.key === key)) return state
  return { ...state, overlays: state.overlays.filter((o) => o.key !== key) }
}

/** Close the top sheet with all its sub pages at once (the close button of a sheet). */
export function closeSheet(state: NavState): NavState {
  const top = topOverlay(state)
  if (!top || top.kind !== 'sheet') return state
  return { ...state, overlays: state.overlays.slice(0, -1) }
}

/** One step back. Returns the new state and what was closed. */
export function closeTop(state: NavState): { state: NavState; closed: Closed } {
  const overlay = topOverlay(state)
  if (overlay) {
    if (overlay.kind === 'dialog') {
      return { state: { ...state, overlays: state.overlays.slice(0, -1) }, closed: { kind: 'dialog', entry: overlay } }
    }
    if (overlay.sub.length > 0) {
      const sub = overlay.sub[overlay.sub.length - 1]
      const next: SheetEntry = { ...overlay, sub: overlay.sub.slice(0, -1) }
      return {
        state: { ...state, overlays: [...state.overlays.slice(0, -1), next] },
        closed: { kind: 'sheet-sub', entry: overlay, sub },
      }
    }
    return { state: { ...state, overlays: state.overlays.slice(0, -1) }, closed: { kind: 'sheet', entry: overlay } }
  }
  const stack = activeStack(state)
  if (stack.length > 1) {
    const entry = stack[stack.length - 1]
    return { state: withActiveStack(state, stack.slice(0, -1)), closed: { kind: 'page', entry } }
  }
  if (!state.flow && state.tab !== HOME_TAB) {
    return { state: { ...state, tab: HOME_TAB }, closed: { kind: 'tab', from: state.tab } }
  }
  return { state, closed: { kind: 'none' } }
}

/** Every overlay that a transition dropped, so pending dialogs can be answered with "no". */
export function droppedOverlays(before: NavState, after: NavState): OverlayEntry[] {
  const kept = new Set(after.overlays.map((o) => o.key))
  return before.overlays.filter((o) => !kept.has(o.key))
}

// ---------------------------------------------------------------------------
// Saving and restoring (ARCHITEKTUR.md 3.5). Sheets and dialogs are not saved.
// ---------------------------------------------------------------------------

export interface SavedPage {
  route: string
  params: Params
}

export interface SavedNav {
  v: 1
  tab: Tab
  stacks: Record<Tab, SavedPage[]>
  flow: FlowId | null
  flowStack: SavedPage[]
}

function savePages(pages: PageEntry[]): SavedPage[] {
  return pages.map((p) => ({ route: p.route, params: p.params }))
}

export function serialize(state: NavState): SavedNav {
  const stacks = {} as Record<Tab, SavedPage[]>
  for (const tab of TABS) stacks[tab] = savePages(state.stacks[tab])
  return { v: 1, tab: state.tab, stacks, flow: state.flow, flowStack: savePages(state.flowStack) }
}

export interface RestoreRules {
  roots: Record<Tab, string>
  /** May this page come back: the route exists, is allowed on this tab, and what it points at still exists. */
  isValid: (page: SavedPage, where: Tab | FlowId) => boolean
  key: (hint: string) => string
}

function isSavedPage(value: unknown): value is SavedPage {
  if (!value || typeof value !== 'object') return false
  const v = value as { route?: unknown; params?: unknown }
  if (typeof v.route !== 'string') return false
  if (!v.params || typeof v.params !== 'object' || Array.isArray(v.params)) return false
  return Object.values(v.params as Record<string, unknown>).every((p) => typeof p === 'string')
}

function restorePages(raw: unknown, where: Tab | FlowId, rules: RestoreRules): PageEntry[] {
  if (!Array.isArray(raw)) return []
  const out: PageEntry[] = []
  for (const item of raw) {
    // Cut at the first page that cannot come back: everything above it was
    // opened from it and would hang in the air.
    if (!isSavedPage(item) || !rules.isValid(item, where)) break
    out.push(page(item.route, { ...item.params }, rules.key(item.route)))
  }
  return out
}

/**
 * Build a state from what was saved. Anything unreadable falls back to the
 * initial state, anything invalid is cut off. Never throws.
 */
export function restore(raw: unknown, rules: RestoreRules): NavState {
  const fresh = initialState(rules.roots, rules.key)
  if (!raw || typeof raw !== 'object') return fresh
  const saved = raw as Partial<SavedNav>
  if (saved.v !== 1 || !saved.stacks || typeof saved.stacks !== 'object') return fresh
  const state = fresh
  for (const tab of TABS) {
    const pages = (saved.stacks as Record<string, unknown>)[tab]
    if (!Array.isArray(pages) || pages.length === 0) continue
    // Index 0 must be the root of this tab, otherwise the whole stack is discarded.
    const first = pages[0]
    if (!isSavedPage(first) || first.route !== rules.roots[tab]) continue
    const rest = restorePages(pages.slice(1), tab, rules)
    state.stacks[tab] = [state.stacks[tab][0], ...rest]
  }
  if (TABS.includes(saved.tab as Tab)) state.tab = saved.tab as Tab
  if (saved.flow === 'onboarding') {
    const flowPages = restorePages(saved.flowStack, 'onboarding', rules)
    if (flowPages.length > 0) {
      state.flow = 'onboarding'
      state.flowStack = flowPages
    }
  }
  return state
}

// ---------------------------------------------------------------------------
// Paths. Route ids are patterns ("/chat/:id"); a path is a pattern with values.
// ---------------------------------------------------------------------------

export function buildPath(route: string, params: Params = {}): string {
  return route.replace(/:([A-Za-z]+)/g, (_, name: string) => encodeURIComponent(params[name] ?? ''))
}

/** Find the route a path belongs to. Routes without parameters win over patterns. */
export function matchPath(path: string, routes: readonly string[]): { route: string; params: Params } | null {
  const clean = path.split('?')[0].replace(/\/+$/, '') || '/'
  if (routes.includes(clean)) return { route: clean, params: {} }
  const parts = clean.split('/')
  let best: { route: string; params: Params; statics: number } | null = null
  for (const route of routes) {
    const pattern = route.split('/')
    if (pattern.length !== parts.length) continue
    const params: Params = {}
    let statics = 0
    let ok = true
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i].startsWith(':')) {
        if (!parts[i]) {
          ok = false
          break
        }
        try {
          params[pattern[i].slice(1)] = decodeURIComponent(parts[i])
        } catch {
          ok = false
          break
        }
      } else if (pattern[i] === parts[i]) {
        statics++
      } else {
        ok = false
        break
      }
    }
    if (ok && (!best || statics > best.statics)) best = { route, params, statics }
  }
  return best ? { route: best.route, params: best.params } : null
}

// ---------------------------------------------------------------------------
// History: one entry in the browser history while anything can be closed.
// ---------------------------------------------------------------------------

/**
 * What to do with the history so it matches the stack.
 *
 * The shell keeps exactly ONE extra history entry (the "sentinel") while
 * depth > 0, and none at depth 0. The system back gesture pops it, the shell
 * closes its top state and puts the sentinel back if something is still open.
 * At depth 0 there is no entry, so Android leaves the app.
 *
 * ARCHITEKTUR.md 3.2 sketches one history entry per closable state. One
 * sentinel gives the same behaviour for the user and cannot drift apart from
 * the stack: there is no count to keep in step across tab switches, resets
 * and restores.
 */
export type HistoryAction = 'push' | 'pop' | 'none'

export function historyAction(hasSentinel: boolean, stateDepth: number): HistoryAction {
  if (stateDepth > 0 && !hasSentinel) return 'push'
  if (stateDepth === 0 && hasSentinel) return 'pop'
  return 'none'
}

// ---------------------------------------------------------------------------
// iOS edge swipe (DESIGN.md 9): finish beyond 40 percent or on a fast flick.
// ---------------------------------------------------------------------------

export const SWIPE_FINISH_SHARE = 0.4
export const SWIPE_FINISH_SPEED = 0.5

export function swipeFinishes(dx: number, width: number, speedPxPerMs: number): boolean {
  if (width <= 0 || dx <= 0) return false
  return dx / width >= SWIPE_FINISH_SHARE || speedPxPerMs >= SWIPE_FINISH_SPEED
}
