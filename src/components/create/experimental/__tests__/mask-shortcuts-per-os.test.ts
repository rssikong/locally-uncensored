/**
 * Maskeneditor: Kuerzel passend zum Betriebssystem (Box-Lauf d307-d, H-b).
 *
 * Auf Windows stand "Undo (⌘Z)". Geprueft wird: Windows und Linux zeigen
 * Ctrl-Kuerzel, der Mac behaelt seine Zeichen, Ctrl+Z und Ctrl+Y wirken
 * wirklich, und der Editor nimmt Beschriftung und Taste aus dem Helfer statt
 * aus festem Text.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/mask-shortcuts-per-os.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { maskHistoryAction, maskShortcutLabels } from '../maskShortcuts'

const here = dirname(fileURLToPath(import.meta.url))
const MASK_EDITOR = readFileSync(join(here, '..', 'MaskEditor.tsx'), 'utf8')

const key = (k: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) => ({
  key: k, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift,
})

function onPlatform(platform: string, userAgent: string) {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
}

afterEach(() => { vi.restoreAllMocks() })

describe('mask editor shortcut labels', () => {
  it('Windows shows Ctrl, no command glyph', () => {
    onPlatform('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/130')
    const l = maskShortcutLabels()
    expect(l.undo).toBe('Undo (Ctrl+Z)')
    expect(l.redo).toBe('Redo (Ctrl+Y)')
    expect(l.undo + l.redo).not.toMatch(/[⌘⇧]/)
  })

  it('Linux shows Ctrl too', () => {
    onPlatform('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)')
    expect(maskShortcutLabels().undo).toBe('Undo (Ctrl+Z)')
  })

  it('the Mac keeps its glyphs', () => {
    onPlatform('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    expect(maskShortcutLabels()).toEqual({ undo: 'Undo (⌘Z)', redo: 'Redo (⇧⌘Z)' })
  })
})

describe('mask editor history keys', () => {
  it('Ctrl+Z undoes and Ctrl+Y / Ctrl+Shift+Z redo (Windows, Linux)', () => {
    expect(maskHistoryAction(key('z', { ctrl: true }))).toBe('undo')
    expect(maskHistoryAction(key('y', { ctrl: true }))).toBe('redo')
    expect(maskHistoryAction(key('Z', { ctrl: true, shift: true }))).toBe('redo')
  })

  it('Cmd+Z and Cmd+Shift+Z still work on the Mac', () => {
    expect(maskHistoryAction(key('z', { meta: true }))).toBe('undo')
    expect(maskHistoryAction(key('Z', { meta: true, shift: true }))).toBe('redo')
  })

  it('a plain z does nothing, a plain y still redoes', () => {
    expect(maskHistoryAction(key('z'))).toBeNull()
    expect(maskHistoryAction(key('y'))).toBe('redo')
    expect(maskHistoryAction(key('b'))).toBeNull()
  })

  it('the editor takes label and key from the helper, no fixed command glyph', () => {
    expect(MASK_EDITOR).not.toContain('⌘')
    expect(MASK_EDITOR).toContain('title={shortcuts.undo}')
    expect(MASK_EDITOR).toContain('title={shortcuts.redo}')
    expect(MASK_EDITOR).toContain('maskHistoryAction(e)')
  })
})
