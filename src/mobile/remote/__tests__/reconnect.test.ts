/**
 * A17: reconnect by itself with a back off, at once on return and on a
 * network change, and the line that says how the phone is connected.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { LINE_TEXT, backoffSeconds, connectionLine, installReconnect, stopReconnect, useReconnect } from '../reconnect'
import { chatsRig, until, type ChatsRig } from './chatsRig'

let r: ChatsRig | null = null
afterEach(async () => {
  stopReconnect()
  await r?.desk.stop()
  r = null
})

describe('the connection line', () => {
  it('names Wi-Fi, the internet, reconnecting and not reachable', () => {
    const lan = { via: 'http://192.168.1.20:11435', baseUrl: 'http://192.168.1.20:11435' }
    const net = { via: 'https://quiet-river-lamp.trycloudflare.com', baseUrl: 'http://192.168.1.20:11435' }
    expect(connectionLine({ status: 'connected', connection: lan, attempts: 0 })).toBe('wifi')
    expect(connectionLine({ status: 'connected', connection: net, attempts: 0 })).toBe('internet')
    expect(connectionLine({ status: 'connecting', connection: net, attempts: 0 })).toBe('reconnecting')
    expect(connectionLine({ status: 'offline', connection: net, attempts: 1 })).toBe('reconnecting')
    expect(connectionLine({ status: 'offline', connection: net, attempts: 3 })).toBe('unreachable')
    expect(connectionLine({ status: 'unpaired', connection: null, attempts: 0 })).toBeNull()
    expect(LINE_TEXT.unreachable).toBe('Your computer is not reachable (asleep or LU closed)')
    expect([1, 2, 3, 4, 5, 6, 9].map(backoffSeconds)).toEqual([2, 4, 8, 15, 30, 60, 60])
  })
})

describe('reconnecting', () => {
  it('tries again with a back off until the computer answers, and at once on return and on a network change', async () => {
    r = await chatsRig()
    const rig = r
    let back: (() => void) | null = null
    let net: ((online: boolean) => void) | null = null
    let reconnected = 0
    installReconnect({
      store: rig.store,
      unitMs: 10,
      onForeground: (fn) => ((back = fn), () => (back = null)),
      onNetworkChange: (fn) => ((net = fn), () => (net = null)),
      reconnected: () => reconnected++,
    })
    const s = () => rig.store.useStore.getState()
    rig.down()
    await s().verifyConnection()
    expect(s().status).toBe('offline')
    await until(() => useReconnect.getState().attempts >= 3, 5_000)
    expect(connectionLine({ status: s().status, connection: s().connection, attempts: useReconnect.getState().attempts })).toBe('unreachable')
    rig.up()
    await until(() => s().status === 'connected', 5_000)
    expect(useReconnect.getState().attempts).toBe(0)
    expect(reconnected).toBe(1)
    expect(connectionLine({ status: s().status, connection: s().connection, attempts: 0 })).toBe('internet')

    // Back in the app after a loss: at once, no waiting for the back off.
    stopReconnect()
    installReconnect({ store: rig.store, unitMs: 60_000, onForeground: (fn) => ((back = fn), () => (back = null)), onNetworkChange: (fn) => ((net = fn), () => (net = null)) })
    rig.down()
    await s().verifyConnection()
    expect(s().status).toBe('offline')
    rig.up()
    back!()
    await until(() => s().status === 'connected')
    rig.down()
    await s().verifyConnection()
    rig.up()
    net!(true)
    await until(() => s().status === 'connected')
  })
})
