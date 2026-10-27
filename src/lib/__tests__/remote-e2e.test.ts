/**
 * The window's half of the device test hook (lib/remote-e2e.ts): Remote is
 * started only when Rust says the test mode is on.
 */
import { describe, it, expect, vi } from 'vitest'
import { startRemoteForDeviceTests } from '../remote-e2e'

const deps = (answer: () => Promise<unknown>, running = false) => {
  const start = vi.fn(async () => {})
  const shareNewChats = vi.fn()
  const startTunnel = vi.fn(async () => {})
  const askBeforeTools = vi.fn()
  return { start, shareNewChats, startTunnel, askBeforeTools, d: { ask: answer, running: () => running, start, shareNewChats, startTunnel, askBeforeTools } }
}

describe('Remote for device tests', () => {
  it('starts Remote when the build and its environment say so', async () => {
    const { start, shareNewChats, d } = deps(async () => ({ active: true }))
    expect(await startRemoteForDeviceTests(d)).toBe(true)
    expect(start).toHaveBeenCalledOnce()
    expect(shareNewChats).toHaveBeenCalledOnce()
  })

  it('starts the tunnel only when the test asks for it, after Remote', async () => {
    const off = deps(async () => ({ active: true }))
    await startRemoteForDeviceTests(off.d)
    expect(off.startTunnel).not.toHaveBeenCalled()
    const order: string[] = []
    const on = deps(async () => ({ active: true, tunnel: true }))
    on.start.mockImplementation(async () => { order.push('start') })
    on.startTunnel.mockImplementation(async () => { order.push('tunnel') })
    expect(await startRemoteForDeviceTests(on.d)).toBe(true)
    expect(order).toEqual(['start', 'tunnel'])
    // A tunnel that fails leaves Remote on in the Wi-Fi.
    const failing = deps(async () => ({ active: true, tunnel: true }))
    failing.startTunnel.mockRejectedValue(new Error('no tunnel'))
    expect(await startRemoteForDeviceTests(failing.d)).toBe(true)
    // Mode off: no tunnel either.
    const none = deps(async () => ({ active: false, tunnel: true }))
    await startRemoteForDeviceTests(none.d)
    expect(none.startTunnel).not.toHaveBeenCalled()
  })

  it('does nothing in a build without the feature (no command) or with the mode off', async () => {
    for (const answer of [async () => { throw new Error('unknown command') }, async () => ({ active: false }), async () => null, async () => ({ active: 'yes' })]) {
      const { start, shareNewChats, d } = deps(answer)
      expect(await startRemoteForDeviceTests(d)).toBe(false)
      expect(start).not.toHaveBeenCalled()
      expect(shareNewChats).not.toHaveBeenCalled()
    }
  })

  it('makes the desktop ask before tools only when the test says so', async () => {
    const off = deps(async () => ({ active: true }))
    await startRemoteForDeviceTests(off.d)
    expect(off.askBeforeTools).not.toHaveBeenCalled()
    const on = deps(async () => ({ active: true, approvals: 'ask' }))
    await startRemoteForDeviceTests(on.d)
    expect(on.askBeforeTools).toHaveBeenCalledOnce()
    const inactive = deps(async () => ({ active: false, approvals: 'ask' }))
    await startRemoteForDeviceTests(inactive.d)
    expect(inactive.askBeforeTools).not.toHaveBeenCalled()
  })

  it('leaves a running Remote as it is', async () => {
    const { start, d } = deps(async () => ({ active: true }), true)
    expect(await startRemoteForDeviceTests(d)).toBe(true)
    expect(start).not.toHaveBeenCalled()
  })
})
