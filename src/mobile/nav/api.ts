/**
 * The controller of the stack router and the only way to change it.
 *
 * Every change runs through commit(): answer dialogs that were dropped, set
 * the state, save it, bring the browser history in step. Screens use the
 * `nav` object from nav/index.ts and never touch the store.
 */
import * as core from './core'
import { hasSentinel, installHistory, syncHistory } from './history'
import { FLOW_FIRST_ROUTES, NAV_STORAGE_KEY, TAB_ROOT_ROUTES } from './roots'
import { newKey, useNavStore } from './store'
import type { DialogSpec, FlowId, NavState, PageEntry, Params, Tab } from './types'
import { setNativeBackHandler } from '../platform/back'
import { dismissKeyboard } from '../platform/keyboard'

type DialogAnswer = boolean | string | null
const dialogResolvers = new Map<string, (answer: DialogAnswer) => void>()

/** Guards of pages with unsaved input, by page key. A guard returns true while leaving would lose something. */
const leaveGuards = new Map<string, () => boolean>()

let saveEnabled = true

/** Key of the page the last change pushed, so the stack can let exactly that page slide in. */
let pushedKey: string | null = null
export function lastPushedKey(): string | null {
  return pushedKey
}

function save(state: NavState): void {
  if (!saveEnabled) return
  try {
    localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(core.serialize(state)))
  } catch {
    /* storage full or blocked: the stack still works for this session */
  }
}

function settle(key: string, answer: DialogAnswer): void {
  const resolve = dialogResolvers.get(key)
  if (!resolve) return
  dialogResolvers.delete(key)
  resolve(answer)
}

function commit(next: NavState, pushed: string | null = null): void {
  const prev = useNavStore.getState()
  if (next === prev) return
  pushedKey = pushed
  // A dialog that vanished without an answer was answered with the safe choice.
  for (const dropped of core.droppedOverlays(prev, next)) {
    if (dropped.kind === 'dialog') settle(dropped.key, dropped.dialog.field ? null : false)
  }
  // Guards of pages that are gone have nothing left to guard.
  if (leaveGuards.size > 0) {
    const alive = new Set<string>()
    for (const stack of Object.values(next.stacks)) for (const p of stack) alive.add(p.key)
    for (const p of next.flowStack) alive.add(p.key)
    for (const key of [...leaveGuards.keys()]) if (!alive.has(key)) leaveGuards.delete(key)
  }
  useNavStore.setState(next, true)
  save(next)
  syncHistory(core.depth(next))
}

function pageEntry(route: string, params: Params | undefined): PageEntry {
  return core.page(route, params ?? {}, newKey(route))
}

export const DISCARD_DIALOG: DialogSpec = {
  title: 'Discard changes?',
  text: 'What you changed on this page has not been saved.',
  confirmLabel: 'Discard',
  cancelLabel: 'Keep editing',
  tone: 'danger',
  testid: 'discard',
}

function confirmDialog(spec: DialogSpec): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const key = newKey('dialog')
    dialogResolvers.set(key, (answer) => resolve(answer === true))
    commit(core.openDialog(useNavStore.getState(), { kind: 'dialog', dialog: spec, key }))
  })
}

function promptDialog(spec: DialogSpec): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const key = newKey('dialog')
    dialogResolvers.set(key, (answer) => resolve(typeof answer === 'string' ? answer : null))
    const withField: DialogSpec = { ...spec, field: spec.field ?? { label: spec.title } }
    commit(core.openDialog(useNavStore.getState(), { kind: 'dialog', dialog: withField, key }))
  })
}

/**
 * One step back. Returns false when there was nothing to close (the root of
 * the Chat tab, or the first step of the onboarding).
 */
function back(): boolean {
  const state = useNavStore.getState()
  if (core.depth(state) === 0) {
    syncHistory(0)
    return false
  }
  if (state.overlays.length === 0) {
    const top = core.topPage(state)
    const guard = top ? leaveGuards.get(top.key) : undefined
    if (top && guard && guard()) {
      // Keep the page, ask first. commit() inside confirmDialog restores the sentinel.
      void confirmDialog(DISCARD_DIALOG).then((discard) => {
        if (!discard) return
        leaveGuards.delete(top.key)
        back()
      })
      return true
    }
  }
  dismissKeyboard()
  commit(core.closeTop(state).state)
  return true
}

let installed = false

/** Wire the router to the browser history and to the native back event. Called once from boot. */
export function installNav(): void {
  if (installed) return
  installed = true
  installHistory(() => {
    // The user went back and the sentinel is gone. Close the top state; if
    // nothing closed (a guard asked, or depth was 0) commit did not run, so
    // sync here.
    back()
    syncHistory(core.depth(useNavStore.getState()))
  })
  setNativeBackHandler(() => {
    if (core.depth(useNavStore.getState()) === 0) return false
    back()
    return true
  })
  syncHistory(core.depth(useNavStore.getState()))
}

export const navApi = {
  /** Push a page on the active stack. Open sheets and dialogs close. */
  push(route: string, params?: Params): void {
    const entry = pageEntry(route, params)
    commit(core.push(useNavStore.getState(), entry), entry.key)
  },
  /** Swap the top page (a new chat got its id, a wizard moved on). */
  replace(route: string, params?: Params): void {
    commit(core.replace(useNavStore.getState(), pageEntry(route, params)))
  },
  back,
  /** Switch the tab; tapping the active tab goes to its root. */
  switchTab(tab: Tab): void {
    const state = useNavStore.getState()
    const next = core.switchTab(state, tab)
    if (next === state && state.tab === tab) {
      window.dispatchEvent(new CustomEvent('lu:tab-root', { detail: { tab } }))
      return
    }
    commit(next)
  },
  /** Replace the pages above the root of a tab and go there. */
  resetTo(tab: Tab, pages: Array<{ route: string; params?: Params }> = []): void {
    commit(core.resetTo(useNavStore.getState(), tab, pages.map((p) => pageEntry(p.route, p.params))))
  },
  openSheet(sheet: string, props?: unknown): void {
    dismissKeyboard()
    commit(core.openSheet(useNavStore.getState(), { kind: 'sheet', sheet, props, sub: [], key: newKey(`sheet-${sheet}`) }))
  },
  /** Open a sub page inside the top sheet. Back returns to the sheet's first page. */
  sheetPush(sub: string): void {
    commit(core.sheetPush(useNavStore.getState(), sub))
  },
  /** Close the top sheet with all its sub pages. */
  closeSheet(): void {
    commit(core.closeSheet(useNavStore.getState()))
  },
  /** Ask before something destructive. Resolves true only when the action button was tapped. */
  confirm: confirmDialog,
  /** A dialog with one text field (rename). Resolves with the text, or null when cancelled. */
  prompt: promptDialog,
  /** Used by the Dialog component: the user tapped a button. */
  answerDialog(key: string, answer: DialogAnswer): void {
    settle(key, answer)
    commit(core.removeOverlay(useNavStore.getState(), key))
  },
  /** Unsaved input: while `isDirty` returns true, leaving the page asks "Discard changes?". */
  setLeaveGuard(pageKey: string, isDirty: (() => boolean) | null): void {
    if (isDirty) leaveGuards.set(pageKey, isDirty)
    else leaveGuards.delete(pageKey)
  },
  startFlow(flow: FlowId): void {
    commit(core.startFlow(useNavStore.getState(), flow, pageEntry(FLOW_FIRST_ROUTES[flow], {})))
  },
  /** End the onboarding and land on the given tab stack. */
  finishFlow(tab: Tab = 'chat', pages: Array<{ route: string; params?: Params }> = []): void {
    const ended = core.finishFlow(useNavStore.getState())
    commit(core.resetTo(ended, tab, pages.map((p) => pageEntry(p.route, p.params))))
  },
  /** Replace the whole state (restore at boot). */
  load(state: NavState): void {
    commit(state)
  },
  getState: (): NavState => useNavStore.getState(),
  depth: (): number => core.depth(useNavStore.getState()),
  hasHistoryEntry: hasSentinel,
  roots: TAB_ROOT_ROUTES,
}

/** Only for tests: run without touching localStorage. */
export function __setNavSaveForTests(enabled: boolean): void {
  saveEnabled = enabled
}
