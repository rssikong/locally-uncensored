/**
 * Create in chat only where the order card exists (answer 2 of the desktop
 * session, 09.10.2026): the phone has no card, so nothing there switches the
 * two tools on, whatever the stored switch says.
 *
 * Three places, three blocks:
 *  1. the platform condition itself, in front of the mirrored rules,
 *  2. hooks/useChat.ts and hooks/useAgentChat.ts ask only through it, and the
 *     two claim guards of the agent loop promise no card on a phone,
 *  3. a backup does not bring the stored switch onto a phone.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const device = vi.hoisted(() => ({ mobile: false }))
vi.mock('../device-kind', async (orig) => ({ ...((await orig()) as object), isMobile: () => device.mobile }))

import { createActiveHere, createLiveHere, hasCreateOrderSurface } from '../create-order-surface'
import { createActive, createChatLive } from '../create/chat-switch'
import { storeValueForPhone } from '../../mobile/boot/restore'

const ROOT = resolve(__dirname, '../../..')
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8')

/** Arguments with which the mirrored rule says yes: switch on, live, window large enough, model released. */
const YES = [{ createEnabled: true }, 'lu-cloud::big', true, 128_000, true] as const

beforeEach(() => { device.mobile = false })
afterEach(() => { device.mobile = false })

describe('the platform condition', () => {
  it('the arguments of this test really switch Create on by the mirrored rule', () => {
    expect(createActive(...YES)).toBe(true)
    expect(createChatLive(true, true)).toBe(true)
  })

  it('on the desktop the answer is the mirrored rule, yes and no alike', () => {
    expect(hasCreateOrderSurface()).toBe(true)
    expect(createActiveHere(...YES)).toBe(true)
    expect(createActiveHere({ createEnabled: false }, YES[1], YES[2], YES[3], YES[4])).toBe(false)
    expect(createLiveHere(true, true)).toBe(true)
    expect(createLiveHere(true, false)).toBe(false)
  })

  it('on a phone the answer is no, with the switch stored as on and everything else in favour', () => {
    device.mobile = true
    expect(hasCreateOrderSurface()).toBe(false)
    expect(createActiveHere(...YES)).toBe(false)
    expect(createLiveHere(true, true)).toBe(false)
  })
})

describe('the two hooks ask only through the platform condition', () => {
  const chat = read('src/hooks/useChat.ts')
  const agent = read('src/hooks/useAgentChat.ts')

  it('useChat.ts forms createActive and createLive through it, at every place', () => {
    expect(chat).not.toMatch(/[^A-Za-z]createActive\(/)
    expect(chat).not.toMatch(/[^A-Za-z]createChatLive\(/)
    expect(chat.match(/createActiveHere\(/g)).toHaveLength(3)
    expect(chat).toContain('const createLive = createLiveHere()')
    expect(chat).toContain('const createOn = !inGroup && createActiveHere(settings, activeModel, createLive)')
    // The registry follows that answer: on a phone the two tools are in no catalogue.
    expect(chat).toContain('syncCreateTools(toolRegistry, createOn)')
  })

  it('useAgentChat.ts takes its texts from it', () => {
    expect(agent).not.toMatch(/[^A-Za-z]createChatLive\(/)
    expect(agent).toContain('const createLive = createLiveHere()')
  })

  it('the claim guards of the agent loop cannot promise a card on a phone: they run only for a turn that carries the tools', () => {
    // The two guards write "the order appears here with its price". Their
    // condition is the desktop's, word for word (pinned by
    // lib/create/__tests__/order-claim-guard.test.ts), and it starts with the
    // turn carrying the Create tools.
    for (const guard of ['claimsCreateWork(turnContent)', 'claimsCreateOrder(turnContent)']) {
      const at = agent.indexOf(`&& ${guard}`)
      expect(at, guard).toBeGreaterThan(0)
      expect(agent.slice(agent.lastIndexOf('if (', at), at), guard).toContain('isFinalTurn && opts?.createTools &&')
      expect(agent.split(guard)).toHaveLength(2)
    }
    // Only useChat.ts hands a turn the tools, and every place there hangs on
    // the platform condition: the value is `createOn`, or the line stands
    // behind a check of createOn or createActiveHere.
    const givers = chat.split('\n').map((line, index) => ({ line: line.trim(), index })).filter((l) => /createTools:/.test(l.line))
    // The sixth (3.0.8, A11) is the settings turn: `if (createOn) return sendAgentMessage(...)`.
    expect(givers).toHaveLength(6)
    const lines = chat.split('\n')
    for (const { line, index } of givers) {
      if (/createTools: createOn\b/.test(line)) continue
      expect(line, `line ${index + 1}`).toContain('createTools: true')
      const above = lines.slice(Math.max(0, index - 12), index + 1).join('\n')
      expect(above, `line ${index + 1}`).toMatch(/if \(createOn\)|&& createOn\)|if \(!createActiveHere\(/)
    }
    // Nobody else in the app starts an agent turn with the tools.
    for (const file of ['src/hooks/useCodex.ts', 'src/api/voice-session.ts', 'src/mobile/screens/chat/parts/controller.ts']) {
      expect(read(file), file).not.toMatch(/createTools:\s*true/)
    }
  })
})

describe('a backup does not bring the stored switch onto a phone', () => {
  const stored = (settings: Record<string, unknown>) => JSON.stringify({ state: { settings }, version: 3 })

  it('createEnabled is left out, everything else comes back as written', () => {
    const taken = JSON.parse(storeValueForPhone('chat-settings', stored({ createEnabled: true, temperature: 0.7, appMode: 'cloud' })))
    expect(taken).toEqual({ state: { settings: { temperature: 0.7, appMode: 'cloud' } }, version: 3 })
    expect('createEnabled' in taken.state.settings).toBe(false)
  })

  it('a stored "off" is left out as well: the field is not the phone\'s to keep', () => {
    expect(storeValueForPhone('chat-settings', stored({ createEnabled: false, theme: 'dark' }))).not.toContain('createEnabled')
  })

  it('settings without the field, other stores and unreadable values are returned untouched', () => {
    const plain = stored({ temperature: 0.7 })
    expect(storeValueForPhone('chat-settings', plain)).toBe(plain)
    const other = JSON.stringify({ state: { settings: { createEnabled: true } } })
    expect(storeValueForPhone('chat-conversations', other)).toBe(other)
    expect(storeValueForPhone('chat-settings', 'not json')).toBe('not json')
    expect(storeValueForPhone('chat-settings', '[]')).toBe('[]')
  })

  it('both ways a store comes back on a phone go through it', () => {
    const restore = read('src/mobile/boot/restore.ts')
    expect(restore.match(/storeValueForPhone\(key, /g)).toHaveLength(2)
    expect(restore).not.toMatch(/setItem\(key, value\)/)
  })
})
