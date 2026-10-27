/**
 * The stack router as pure functions: what "back" closes, in which order,
 * and what survives a restart.
 */
import { describe, expect, it } from 'vitest'
import * as core from '../core'
import type { DialogEntry, NavState, SheetEntry } from '../types'

const ROOTS = { chat: '/chats', create: '/create', models: '/models', settings: '/settings' } as const

function keys() {
  let n = 0
  return (hint: string) => `${hint}#${++n}`
}

function fresh(): NavState {
  return core.initialState(ROOTS, keys())
}

const sheet = (id: string, key = `s-${id}`): SheetEntry => ({ kind: 'sheet', sheet: id, sub: [], key })
const dialog = (key = 'd1'): DialogEntry => ({ kind: 'dialog', key, dialog: { title: 'Delete this chat?', confirmLabel: 'Delete' } })
const routesOf = (state: NavState) => core.activeStack(state).map((p) => p.route)

/** Press back until nothing closes, and report what closed. */
function backUntilEmpty(start: NavState): string[] {
  const closed: string[] = []
  let state = start
  for (let i = 0; i < 50; i++) {
    const step = core.closeTop(state)
    if (step.closed.kind === 'none') return closed
    closed.push(step.closed.kind)
    state = step.state
  }
  throw new Error('back never reached the end')
}

describe('initial state', () => {
  it('has four tabs, each with its root, and starts on Chat', () => {
    const state = fresh()
    expect(state.tab).toBe('chat')
    expect(Object.keys(state.stacks).sort()).toEqual(['chat', 'create', 'models', 'settings'])
    expect(state.stacks.settings.map((p) => p.route)).toEqual(['/settings'])
    expect(core.depth(state)).toBe(0)
    expect(core.showsTabBar(state)).toBe(true)
  })
})

describe('one stack per tab', () => {
  it('a pushed page lands on the active tab only and hides the tab bar', () => {
    const state = core.push(fresh(), core.page('/chat/:id', { id: 'a' }, 'k1'))
    expect(routesOf(state)).toEqual(['/chats', '/chat/:id'])
    expect(state.stacks.create).toHaveLength(1)
    expect(core.showsTabBar(state)).toBe(false)
    expect(core.depth(state)).toBe(1)
  })

  it('switching the tab keeps the stack that was left', () => {
    let state = core.push(fresh(), core.page('/chat/:id', { id: 'a' }, 'k1'))
    state = core.switchTab(state, 'settings')
    expect(routesOf(state)).toEqual(['/settings'])
    state = core.push(state, core.page('/settings/account', {}, 'k2'))
    state = core.switchTab(state, 'chat')
    expect(routesOf(state)).toEqual(['/chats', '/chat/:id'])
    state = core.switchTab(state, 'settings')
    expect(routesOf(state)).toEqual(['/settings', '/settings/account'])
  })

  it('tapping the active tab goes to its root', () => {
    let state = core.push(fresh(), core.page('/chat/:id', { id: 'a' }, 'k1'))
    state = core.push(state, core.page('/chat/:id/documents', { id: 'a' }, 'k2'))
    state = core.switchTab(state, 'chat')
    expect(routesOf(state)).toEqual(['/chats'])
  })

  it('tapping the active tab on its root changes nothing', () => {
    const state = fresh()
    expect(core.switchTab(state, 'chat')).toBe(state)
  })

  it('switching the tab closes sheets and dialogs', () => {
    let state = core.openSheet(fresh(), sheet('model'))
    state = core.openDialog(state, dialog())
    state = core.switchTab(state, 'models')
    expect(state.overlays).toEqual([])
  })

  it('replace swaps the top page but never the root', () => {
    let state = core.push(fresh(), core.page('/chat/:id', { id: 'new' }, 'k1'))
    state = core.replace(state, core.page('/chat/:id', { id: 'abc' }, 'k2'))
    expect(core.activeStack(state).map((p) => p.params.id)).toEqual([undefined, 'abc'])
    const onRoot = core.replace(fresh(), core.page('/chat/:id', { id: 'x' }, 'k3'))
    expect(routesOf(onRoot)).toEqual(['/chats', '/chat/:id'])
  })

  it('resetTo rebuilds one tab above its root and goes there', () => {
    let state = core.push(fresh(), core.page('/chat/:id', { id: 'a' }, 'k1'))
    state = core.resetTo(state, 'models', [core.page('/models/:id', { id: 'm' }, 'k2')])
    expect(state.tab).toBe('models')
    expect(routesOf(state)).toEqual(['/models', '/models/:id'])
    expect(state.stacks.chat).toHaveLength(2)
  })
})

describe('back', () => {
  it('closes in the order dialog, sub page of the sheet, sheet, page, tab', () => {
    let state = core.switchTab(fresh(), 'settings')
    state = core.push(state, core.page('/settings/account', {}, 'k1'))
    state = core.openSheet(state, sheet('price'))
    state = core.sheetPush(state, 'details')
    state = core.openDialog(state, dialog())
    expect(core.depth(state)).toBe(5)
    expect(backUntilEmpty(state)).toEqual(['dialog', 'sheet-sub', 'sheet', 'page', 'tab'])
  })

  it('depth always equals the number of back presses that close something', () => {
    const cases: NavState[] = [fresh()]
    let state = core.push(fresh(), core.page('/chat/:id', { id: 'a' }, 'k1'))
    cases.push(state)
    state = core.openSheet(state, sheet('model'))
    cases.push(state)
    state = core.sheetPush(core.sheetPush(state, 'one'), 'two')
    cases.push(state)
    state = core.openSheet(state, sheet('attach'))
    cases.push(state)
    cases.push(core.switchTab(fresh(), 'create'))
    cases.push(core.startFlow(fresh(), 'onboarding', core.page('/welcome', {}, 'f1')))
    for (const c of cases) expect(backUntilEmpty(c)).toHaveLength(core.depth(c))
  })

  it('from the root of another tab back goes to Chat, from Chat nothing is left', () => {
    const onModels = core.switchTab(fresh(), 'models')
    const step = core.closeTop(onModels)
    expect(step.closed).toEqual({ kind: 'tab', from: 'models' })
    expect(step.state.tab).toBe('chat')
    const end = core.closeTop(step.state)
    expect(end.closed.kind).toBe('none')
    expect(end.state).toBe(step.state)
  })

  it('a sheet is closed before the page under it', () => {
    let state = core.push(fresh(), core.page('/chat/:id', { id: 'a' }, 'k1'))
    state = core.openSheet(state, sheet('model'))
    const step = core.closeTop(state)
    expect(step.closed.kind).toBe('sheet')
    expect(routesOf(step.state)).toEqual(['/chats', '/chat/:id'])
  })

  it('a dialog above a sheet leaves the sheet open', () => {
    let state = core.openSheet(fresh(), sheet('model'))
    state = core.openDialog(state, dialog())
    const step = core.closeTop(state)
    expect(step.closed.kind).toBe('dialog')
    expect(step.state.overlays.map((o) => o.kind)).toEqual(['sheet'])
  })

  it('the close button of a sheet takes its sub pages with it', () => {
    let state = core.openSheet(fresh(), sheet('model'))
    state = core.sheetPush(state, 'details')
    expect(core.closeSheet(state).overlays).toEqual([])
  })

  it('sheetPush without a sheet on top does nothing', () => {
    const state = fresh()
    expect(core.sheetPush(state, 'x')).toBe(state)
    const withDialog = core.openDialog(core.openSheet(state, sheet('model')), dialog())
    expect(core.sheetPush(withDialog, 'x')).toBe(withDialog)
  })

  it('pushing a page closes what lies above the stack', () => {
    let state = core.openSheet(fresh(), sheet('chat-menu'))
    state = core.push(state, core.page('/chat/:id/documents', { id: 'a' }, 'k1'))
    expect(state.overlays).toEqual([])
  })

  it('removeOverlay takes one entry by key and reports dropped ones', () => {
    const before = core.openDialog(core.openSheet(fresh(), sheet('model', 's1')), dialog('d1'))
    const after = core.removeOverlay(before, 's1')
    expect(after.overlays.map((o) => o.key)).toEqual(['d1'])
    expect(core.droppedOverlays(before, after).map((o) => o.key)).toEqual(['s1'])
    expect(core.removeOverlay(before, 'nope')).toBe(before)
  })
})

describe('flow', () => {
  it('runs without tab bar on its own stack and leaves the tabs untouched', () => {
    let state = core.push(fresh(), core.page('/chat/:id', { id: 'a' }, 'k1'))
    state = core.startFlow(state, 'onboarding', core.page('/welcome', {}, 'f1'))
    expect(core.showsTabBar(state)).toBe(false)
    expect(routesOf(state)).toEqual(['/welcome'])
    state = core.push(state, core.page('/setup/model', {}, 'f2'))
    expect(core.depth(state)).toBe(1)
    expect(core.switchTab(state, 'models')).toBe(state)
    const first = core.closeTop(state)
    expect(first.closed.kind).toBe('page')
    expect(core.closeTop(first.state).closed.kind).toBe('none')
    const done = core.finishFlow(state)
    expect(done.flow).toBeNull()
    expect(routesOf(done)).toEqual(['/chats', '/chat/:id'])
  })
})

describe('saving and restoring', () => {
  const rules = (isValid: core.RestoreRules['isValid'] = () => true): core.RestoreRules => ({ roots: ROOTS, key: keys(), isValid })

  it('pages come back, sheets and dialogs do not', () => {
    let state = core.switchTab(fresh(), 'settings')
    state = core.push(state, core.page('/settings/account', {}, 'k1'))
    state = core.openSheet(state, sheet('price'))
    const saved = JSON.parse(JSON.stringify(core.serialize(state)))
    const back = core.restore(saved, rules())
    expect(back.tab).toBe('settings')
    expect(routesOf(back)).toEqual(['/settings', '/settings/account'])
    expect(back.overlays).toEqual([])
  })

  it('an invalid page is cut off together with everything above it', () => {
    let state = core.push(fresh(), core.page('/chat/:id', { id: 'gone' }, 'k1'))
    state = core.push(state, core.page('/chat/:id/documents', { id: 'gone' }, 'k2'))
    const back = core.restore(core.serialize(state), rules((p) => p.params.id !== 'gone'))
    expect(routesOf(back)).toEqual(['/chats'])
  })

  it('a stack whose first page is not the root of its tab is discarded', () => {
    const saved = core.serialize(fresh())
    saved.stacks.models = [{ route: '/settings', params: {} }, { route: '/models/:id', params: { id: 'x' } }]
    const back = core.restore(saved, rules())
    expect(back.stacks.models.map((p) => p.route)).toEqual(['/models'])
  })

  it('rubbish falls back to the initial state and never throws', () => {
    const start = (raw: unknown) => core.restore(raw, rules())
    for (const raw of [null, undefined, 7, 'x', [], {}, { v: 2 }, { v: 1 }, { v: 1, stacks: 3 }, { v: 1, stacks: { chat: 'x' }, tab: 'nope' }]) {
      const state = start(raw)
      expect(state.tab).toBe('chat')
      expect(core.depth(state)).toBe(0)
    }
    const odd = start({ v: 1, tab: 'create', stacks: { chat: [{ route: '/chats', params: {} }, { route: '/chat/:id', params: { id: 5 } }] } })
    expect(odd.tab).toBe('create')
    expect(odd.stacks.chat).toHaveLength(1)
  })

  it('a running flow comes back only with valid pages', () => {
    const state = core.startFlow(fresh(), 'onboarding', core.page('/welcome', {}, 'f1'))
    expect(core.restore(core.serialize(state), rules()).flow).toBe('onboarding')
    expect(core.restore(core.serialize(state), rules(() => false)).flow).toBeNull()
  })
})

describe('paths', () => {
  const routes = ['/chats', '/chat/:id', '/chat/:id/documents', '/models', '/models/downloads', '/models/:id', '/dev/ui']

  it('builds a path from a pattern', () => {
    expect(core.buildPath('/chat/:id', { id: 'a b' })).toBe('/chat/a%20b')
    expect(core.buildPath('/chats')).toBe('/chats')
  })

  it('finds the route of a path, fixed routes before patterns', () => {
    expect(core.matchPath('/models/downloads', routes)).toEqual({ route: '/models/downloads', params: {} })
    expect(core.matchPath('/models/gemma', routes)).toEqual({ route: '/models/:id', params: { id: 'gemma' } })
    expect(core.matchPath('/chat/a%20b/documents/', routes)).toEqual({ route: '/chat/:id/documents', params: { id: 'a b' } })
    expect(core.matchPath('/dev/ui?x=1', routes)).toEqual({ route: '/dev/ui', params: {} })
  })

  it('returns null for what is not a route', () => {
    expect(core.matchPath('/nope', routes)).toBeNull()
    expect(core.matchPath('/chat/', routes)).toBeNull()
    expect(core.matchPath('/chat/%E0%A4%A', routes)).toBeNull()
  })
})

describe('history sentinel', () => {
  it('one extra entry while something can be closed, none at the bottom', () => {
    expect(core.historyAction(false, 0)).toBe('none')
    expect(core.historyAction(false, 2)).toBe('push')
    expect(core.historyAction(true, 2)).toBe('none')
    expect(core.historyAction(true, 0)).toBe('pop')
  })
})

describe('edge swipe', () => {
  it('finishes beyond 40 percent or on a fast flick', () => {
    expect(core.swipeFinishes(160, 390, 0.1)).toBe(true)
    expect(core.swipeFinishes(100, 390, 0.1)).toBe(false)
    expect(core.swipeFinishes(40, 390, 0.8)).toBe(true)
    expect(core.swipeFinishes(-20, 390, 2)).toBe(false)
    expect(core.swipeFinishes(100, 0, 2)).toBe(false)
  })
})

// ---- Runde 2: stacked sheets ----
import { sheetsAbove } from '../Overlays'

describe('sheetsAbove', () => {
  const sheet = { kind: 'sheet' }
  const dialog = { kind: 'dialog' }

  it('counts the sheets above an overlay, so only the top sheet carries the bare ids', () => {
    expect(sheetsAbove([sheet], 0)).toBe(0)
    expect(sheetsAbove([sheet, sheet], 0)).toBe(1)
    expect(sheetsAbove([sheet, sheet], 1)).toBe(0)
    expect(sheetsAbove([sheet, sheet, sheet], 0)).toBe(2)
  })

  it('a dialog above a sheet does not take the ids away from it', () => {
    expect(sheetsAbove([sheet, dialog], 0)).toBe(0)
    expect(sheetsAbove([sheet, dialog, sheet], 0)).toBe(1)
  })
})
