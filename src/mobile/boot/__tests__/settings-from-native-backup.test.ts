// @vitest-environment jsdom
/**
 * L5 (check of package 17 on Android, mobile-docs/r41/funde.md). "Thinking"
 * switched 0.1 s before the phone ran full was back at its old value after
 * the start in 6 of 9 runs: its write to localStorage fell into the full
 * phase, and the copy in IndexedDB (settings-durable.ts) was dropped with all
 * of IndexedDB at the start. The native backup now carries the stamp of the
 * settings and is written within a second of a change; without the copy the
 * start takes the settings of the backup when they are newer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STORE_KEYS } from '../../../lib/store-backup'
import {
  SETTINGS_STAMP_KEY, installSettingsDurability, mirrorFromBackup, onSettingsChanged, parseMirror, recoverSettingsAtStart,
  type MirrorDoor, type SettingsMirror,
} from '../settings-durable'

const chat = (thinking: boolean) => JSON.stringify({ state: { settings: { thinkingEnabled: thinking, braveApiKey: '' } }, version: 9 })

function door(held: SettingsMirror | null): MirrorDoor & { reads: number } {
  const d = {
    reads: 0,
    read: async () => {
      d.reads += 1
      return held ? parseMirror(JSON.parse(JSON.stringify(held))) : null
    },
    write: async () => {},
    drop: async () => {},
  }
  return d
}

/** The native backup as `restore_stores` hands it back. */
function backup(stamp: number, values: Record<string, string>): MirrorDoor & { reads: number } {
  return door(mirrorFromBackup(JSON.stringify({ __ts: 'x', ...values, [SETTINGS_STAMP_KEY]: String(stamp) }), (key) => localStorage.getItem(key)))
}

let stop: () => void = () => {}
beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  stop()
  stop = () => {}
})

describe('settings from the native backup (L5)', () => {
  it('the stamp of the settings goes into the backup, after the settings', () => {
    expect(STORE_KEYS).toContain(SETTINGS_STAMP_KEY)
    expect(STORE_KEYS.indexOf(SETTINGS_STAMP_KEY)).toBe(STORE_KEYS.length - 1)
  })

  it('no copy in IndexedDB and a newer backup: the switch comes back', async () => {
    // localStorage as the disk had it: the change never got there.
    localStorage.setItem('chat-settings', chat(false))
    localStorage.setItem(SETTINGS_STAMP_KEY, '1000')
    const native = backup(5_000, { 'chat-settings': chat(true), 'chat-conversations': '{"x":1}' })
    await expect(recoverSettingsAtStart(door(null), native)).resolves.toBe('recovered')
    expect(JSON.parse(localStorage.getItem('chat-settings') ?? '{}').state.settings.thinkingEnabled).toBe(true)
    expect(localStorage.getItem(SETTINGS_STAMP_KEY)).toBe('5000')
    // Not a settings key: left alone.
    expect(localStorage.getItem('chat-conversations')).toBeNull()
  })

  it('an older backup changes nothing, and keys it does not hold are never removed', async () => {
    localStorage.setItem('chat-settings', chat(true))
    localStorage.setItem('lu-mobile-theme', 'dark')
    localStorage.setItem(SETTINGS_STAMP_KEY, '9000')
    await expect(recoverSettingsAtStart(door(null), backup(5_000, { 'chat-settings': chat(false) }))).resolves.toBe('nothing')
    localStorage.setItem(SETTINGS_STAMP_KEY, '1000')
    await expect(recoverSettingsAtStart(door(null), backup(5_000, { 'lu-mobile-download-wifi-only': '1' }))).resolves.toBe('recovered')
    expect(localStorage.getItem('lu-mobile-theme')).toBe('dark')
    expect(localStorage.getItem('chat-settings')).toBe(chat(true))
  })

  it('an ordinary start with the copy in IndexedDB does not read the backup', async () => {
    localStorage.setItem('chat-settings', chat(false))
    localStorage.setItem(SETTINGS_STAMP_KEY, '1000')
    const native = backup(5_000, { 'chat-settings': chat(true) })
    await expect(recoverSettingsAtStart(door({ stamp: 1000, values: { 'chat-settings': chat(false) } }), native)).resolves.toBe('nothing')
    expect(native.reads).toBe(0)
  })

  it('a store whose credentials the backup left out is not put over one that holds them', () => {
    localStorage.setItem('chat-settings', JSON.stringify({ state: { settings: { braveApiKey: 'typed-by-user' } } }))
    const copy = mirrorFromBackup(JSON.stringify({ 'chat-settings': chat(true), [SETTINGS_STAMP_KEY]: '5000' }), (key) => localStorage.getItem(key))
    expect(copy?.values['chat-settings']).toBeUndefined()
  })

  it('every change of a setting is heard in the tick of the write', () => {
    stop = installSettingsDurability(door(null))
    let heard = 0
    const off = onSettingsChanged(() => {
      heard += 1
    })
    localStorage.setItem('chat-settings', chat(true))
    localStorage.setItem('chat-settings', chat(true))
    localStorage.setItem('not-a-setting', '1')
    off()
    expect(heard).toBe(1)
  })
})
