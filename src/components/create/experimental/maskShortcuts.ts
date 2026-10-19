/**
 * Kuerzel des Maskeneditors, je nach Betriebssystem.
 *
 * Box-Lauf d307-d (H-b): auf Windows stand "Undo (⌘Z)" und "Redo (⇧⌘Z)".
 * Ein Windows- oder Linux-Nutzer hat keine Befehlstaste. Dort stehen jetzt die
 * Ctrl-Kuerzel, auf dem Mac bleibt alles wie bisher. Die Tastenentscheidung
 * liegt hier daneben, damit Beschriftung und Verhalten zusammen geprueft werden.
 */
import { isMacOS } from '../../../api/backend'

export interface MaskShortcutLabels {
  undo: string
  redo: string
}

export function maskShortcutLabels(mac: boolean = isMacOS()): MaskShortcutLabels {
  return mac
    ? { undo: 'Undo (⌘Z)', redo: 'Redo (⇧⌘Z)' }
    : { undo: 'Undo (Ctrl+Z)', redo: 'Redo (Ctrl+Y)' }
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey'>

/** Was ein Tastendruck in der Maskenhistorie ausloest. Cmd und Ctrl gelten
 *  beide, damit Ctrl+Z auf Windows und Linux genauso wirkt wie Cmd+Z auf dem
 *  Mac. Redo: Mod+Shift+Z, Mod+Y und wie bisher ein einfaches y. */
export function maskHistoryAction(e: KeyLike): 'undo' | 'redo' | null {
  const mod = e.metaKey || e.ctrlKey
  const key = e.key.toLowerCase()
  if (mod && key === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (e.key === 'y' || (mod && key === 'y')) return 'redo'
  return null
}
