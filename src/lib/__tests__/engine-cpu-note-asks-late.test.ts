/**
 * The sentence about the processor fallback is chosen when it is said, not
 * when the module is loaded (mobile round 5). A phone learns what it is a
 * moment after the first import, and the toast then read "see the log file
 * in Settings > Troubleshoot", a place a phone does not have.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const device = vi.hoisted(() => ({ mobile: false }))
vi.mock('../device-kind', async (original) => ({
  ...(await original<typeof import('../device-kind')>()),
  isMobile: () => device.mobile,
}))

import { ENGINE_CPU_ONLY_NOTE, engineStandingNote } from '../engine-offload'
import { PLATFORM_TEXTS } from '../platform-text'

afterEach(() => {
  device.mobile = false
})

const status = { running: true, cpuOnly: true } as Parameters<typeof engineStandingNote>[0]

describe('the standing note of a processor fallback', () => {
  it('a desktop reads the sentence it always read', () => {
    expect(engineStandingNote(status)).toBe(PLATFORM_TEXTS.engineCpuOnly.desktop)
    expect(engineStandingNote(status)).toBe(ENGINE_CPU_ONLY_NOTE)
  })

  it('a device that turns out to be a phone after the import reads the phone sentence', () => {
    device.mobile = true
    const note = engineStandingNote(status)
    expect(note).toBe(PLATFORM_TEXTS.engineCpuOnly.mobile)
    expect(note).not.toContain('Troubleshoot')
    expect(note).not.toContain('log file')
  })

  it('the sentence the engine itself wrote still wins', () => {
    device.mobile = true
    expect(engineStandingNote({ ...status, sanityNote: 'The engine says so.' } as typeof status)).toBe('The engine says so.')
  })
})
