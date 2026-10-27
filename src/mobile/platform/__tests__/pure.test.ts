/** The parts of the platform seam that decide something and need no phone to be tested. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mobileOS, ownsBackSwipe, readDevSwitches } from '../detect'
import { KEYBOARD_MIN_PX, keyboardStateFrom } from '../keyboard'
import { nextOrientation, orientationOf } from '../viewport'
import { NATIVE_COMMANDS, NATIVE_EVENTS } from '../contract'

describe('mobileOS', () => {
  it('reads Android and iPhone from the user agent', () => {
    expect(mobileOS({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36' })).toBe('android')
    expect(mobileOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', platform: 'iPhone' })).toBe('ios')
  })

  it('an iPad that reports a Mac is still iOS, a Mac is not', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
    expect(mobileOS({ userAgent: ua, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios')
    expect(mobileOS({ userAgent: ua, platform: 'MacIntel', maxTouchPoints: 0 })).toBeNull()
  })

  it('a desktop is no phone', () => {
    expect(mobileOS({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126', platform: 'Win32', maxTouchPoints: 10 })).toBeNull()
    expect(mobileOS({})).toBeNull()
  })

  it('the shell owns the back swipe on iOS only', () => {
    expect(ownsBackSwipe('ios')).toBe(true)
    expect(ownsBackSwipe('android')).toBe(false)
    expect(ownsBackSwipe(null)).toBe(false)
  })
})

describe('readDevSwitches', () => {
  const none = { getItem: () => null }

  it('reads text scale, route, platform and theme from the address', () => {
    const s = readDevSwitches('?fs=200&route=/dev/ui&os=ios&theme=light&dev=1', none)
    expect(s).toMatchObject({ fontScale: 200, route: '/dev/ui', os: 'ios', theme: 'light', devPages: true })
  })

  it('ignores values that make no sense', () => {
    const s = readDevSwitches('?fs=9000&os=windows&theme=pink', none)
    expect(s).toMatchObject({ fontScale: null, os: null, theme: null, devPages: false })
    expect(readDevSwitches('?fs=abc', none).fontScale).toBeNull()
  })

  it('developer pages need the switch or a developer build', () => {
    expect(readDevSwitches('', none).devPages).toBe(false)
    expect(readDevSwitches('', none, true).devPages).toBe(true)
    expect(readDevSwitches('', { getItem: () => '1' }).devPages).toBe(true)
  })

  // Review N11: a store build has no door into the developer pages.
  it('in a store build neither the query nor the stored key opens the developer pages', () => {
    const stored = { getItem: () => '1' }
    const s = readDevSwitches('?dev=1&onboarding=skip&device=ios:6&route=/dev/ui', stored, false, false)
    expect(s.devPages).toBe(false)
    expect(s.skipOnboarding).toBe(false)
    expect(s.device).toBeNull()
    // The same build flags with the door open (developer server, acceptance build).
    expect(readDevSwitches('?dev=1', none, false, true).devPages).toBe(true)
    expect(readDevSwitches('', stored, false, true).devPages).toBe(true)
    // The door is the build: DEV or VITE_LU_ABNAHME, nothing a link or a page can set.
    const src = readFileSync(resolve(__dirname, '../detect.ts'), 'utf8')
    const gate = src.slice(src.indexOf('export function buildAllowsDevPages()'), src.indexOf('export function readDevSwitches('))
    expect(gate).toContain("import.meta.env.DEV === true || import.meta.env.VITE_LU_ABNAHME === '1'")
    expect(gate).not.toMatch(/localStorage|location|searchParams/)
  })

  it('skipping the onboarding works only together with the developer switch', () => {
    expect(readDevSwitches('?onboarding=skip', none).skipOnboarding).toBe(false)
    expect(readDevSwitches('?onboarding=skip&dev=1', none).skipOnboarding).toBe(true)
  })

  it('survives a storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readDevSwitches('', broken).devPages).toBe(false)
  })
})

describe('keyboardStateFrom', () => {
  const base = { layoutHeight: 844, visualHeight: 844, visualOffsetTop: 0, tallestLayoutHeight: 844, editing: false }

  it('nothing covered: closed', () => {
    expect(keyboardStateFrom(base)).toEqual({ inset: 0, open: false })
  })

  it('the visual viewport shrank: open, inset is the covered part', () => {
    expect(keyboardStateFrom({ ...base, visualHeight: 508, editing: true })).toEqual({ inset: 336, open: true })
  })

  it('iOS pushed the page up: the offset is not counted as keyboard', () => {
    expect(keyboardStateFrom({ ...base, visualHeight: 508, visualOffsetTop: 100, editing: true })).toEqual({ inset: 236, open: true })
  })

  it('a browser bar is no keyboard', () => {
    expect(keyboardStateFrom({ ...base, visualHeight: 844 - (KEYBOARD_MIN_PX - 1) })).toEqual({ inset: 0, open: false })
  })

  it('Android resized the window itself: open without an inset, the layout already fits', () => {
    expect(keyboardStateFrom({ ...base, layoutHeight: 508, visualHeight: 508, editing: true })).toEqual({ inset: 0, open: true })
    expect(keyboardStateFrom({ ...base, layoutHeight: 508, visualHeight: 508, editing: false })).toEqual({ inset: 0, open: false })
  })
})

describe('nextOrientation', () => {
  it('measures portrait and landscape', () => {
    expect(orientationOf(390, 844)).toBe('port')
    expect(orientationOf(844, 390)).toBe('land')
    expect(nextOrientation(null, { width: 844, height: 390, editing: false })).toEqual({ orientation: 'land', width: 844 })
  })

  it('a keyboard that makes the window wider than tall does not flip the layout', () => {
    const prev = { orientation: 'port' as const, width: 390 }
    expect(nextOrientation(prev, { width: 390, height: 300, editing: true })).toBe(prev)
    expect(nextOrientation(prev, { width: 390, height: 300, editing: false }).orientation).toBe('land')
  })

  it('a real turn changes the width and wins even while editing', () => {
    const prev = { orientation: 'port' as const, width: 390 }
    expect(nextOrientation(prev, { width: 844, height: 390, editing: true })).toEqual({ orientation: 'land', width: 844 })
  })
})

describe('native contract', () => {
  it('command and event names are unique and in their own spelling', () => {
    const commands = Object.keys(NATIVE_COMMANDS)
    const events = Object.values(NATIVE_EVENTS) as string[]
    expect(commands.length).toBeGreaterThan(10)
    expect(new Set(events).size).toBe(events.length)
    for (const c of commands) expect(c).toMatch(/^[a-z][a-z0-9_]*$/)
    for (const e of events) expect(e).toMatch(/^lu:[a-z][a-z-]*$/)
  })

  it('every command names the file of the seam that calls it', () => {
    for (const [name, spec] of Object.entries(NATIVE_COMMANDS)) {
      expect(spec.usedBy, name).toMatch(/^(platform|nav)\/[a-z-]+\.ts$/)
      expect(spec.returns.length, name).toBeGreaterThan(0)
    }
  })
})
