/**
 * A phone turn does not take the desktop away from someone typing there
 * (lib/remote-desk-gate.ts): it waits with a bar until they open it or
 * nobody typed for a minute; when nobody typed, it runs at once.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createDeskGate, useDeskGateStore, DESK_BUSY_MS, setWindowDeskGate, openWaitingTurn } from '../remote-desk-gate'

function clock() {
  let now = 1_000_000
  let timers: Array<{ at: number; fn: () => void; id: number }> = []
  let ids = 0
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => { const id = ++ids; timers.push({ at: now + ms, fn, id }); return id },
    clearTimer: (h: unknown) => { timers = timers.filter((t) => t.id !== h) },
    advance: (ms: number) => {
      const end = now + ms
      for (;;) {
        const next = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0]
        if (!next) break
        timers = timers.filter((t) => t !== next)
        now = next.at
        next.fn()
      }
      now = end
    },
  }
}

const settled = async (p: Promise<boolean>) => {
  let v: boolean | 'pending' = 'pending'
  void p.then((x) => { v = x })
  await Promise.resolve(); await Promise.resolve()
  return v
}

beforeEach(() => useDeskGateStore.setState({ waiting: [] }))

describe('a phone turn and someone at the desktop', () => {
  it('runs at once when nobody typed in the last minute, or when its chat is open', async () => {
    const c = clock()
    let open = ''
    const gate = createDeskGate({ ...c, isOpen: (id) => id === open })
    const first = gate.wait('c1', 'Plans')
    expect(first.waiting).toBe(false)
    expect(await settled(first.ready)).toBe(true)
    gate.typed()
    c.advance(DESK_BUSY_MS)
    expect(await settled(gate.wait('c1', 'Plans').ready)).toBe(true)
    gate.typed()
    open = 'c1'
    expect(await settled(gate.wait('c1', 'Plans').ready)).toBe(true)
    expect(useDeskGateStore.getState().waiting).toEqual([])
  })

  it('waits with the bar while someone types, and runs after a quiet minute', async () => {
    const c = clock()
    const gate = createDeskGate({ ...c, isOpen: () => false })
    gate.typed()
    c.advance(10_000)
    const { ready, waiting } = gate.wait('c1', 'Plans')
    expect(waiting).toBe(true)
    expect(useDeskGateStore.getState().waiting).toMatchObject([{ convId: 'c1', title: 'Plans' }])
    c.advance(40_000)
    gate.typed() // still typing: the minute starts again
    c.advance(DESK_BUSY_MS - 1)
    expect(await settled(ready)).toBe('pending')
    c.advance(1)
    expect(await settled(ready)).toBe(true)
    expect(useDeskGateStore.getState().waiting).toEqual([])
  })

  it('Open in the bar runs it now; opening the chat by hand does as well', async () => {
    const c = clock()
    let open = ''
    const gate = createDeskGate({ ...c, isOpen: (id) => id === open })
    setWindowDeskGate(gate)
    gate.typed()
    const a = gate.wait('c1', 'Plans')
    const b = gate.wait('c2', 'Trip')
    const key = useDeskGateStore.getState().waiting[0].key
    openWaitingTurn(key)
    expect(await settled(a.ready)).toBe(true)
    expect(await settled(b.ready)).toBe('pending')
    open = 'c2'
    gate.check()
    expect(await settled(b.ready)).toBe(true)
    setWindowDeskGate(null)
  })

  it('a turn stopped while it waits never runs', async () => {
    const c = clock()
    const gate = createDeskGate({ ...c, isOpen: () => false })
    gate.typed()
    const t = gate.wait('c1', 'Plans')
    t.cancel()
    expect(await settled(t.ready)).toBe(false)
    expect(useDeskGateStore.getState().waiting).toEqual([])
    c.advance(DESK_BUSY_MS * 2)
    expect(await settled(t.ready)).toBe(false)
  })
})
