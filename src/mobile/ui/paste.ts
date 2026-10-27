/**
 * What a "Paste" button of a field does, with an honest end either way.
 *
 * The button used to do nothing when the clipboard could not be read: no
 * text in the field and no word about it (acceptance android-knoepfe, H1:
 * five pages with a dead button). Now it ends in one of three ways: the text
 * is in the field, or a sentence says that the clipboard is empty, or a
 * sentence says that LU could not read it and how to paste by hand, with the
 * cursor already in the field so that the system menu is one long press away.
 */
import { tryBridge } from '../platform/bridge'
import * as clipboard from '../platform/clipboard'
import { COMMON } from '../strings/common'
import { toast } from './Toast'

export type PasteOutcome = 'pasted' | 'empty' | 'blocked'

/** Pure: what a read of the clipboard means. null: it could not be read. */
export function pasteOutcome(text: string | null): PasteOutcome {
  if (text === null) return 'blocked'
  return text.trim() ? 'pasted' : 'empty'
}

/** What the clipboard held: a text, nothing, or nobody could be asked. */
export type ClipboardRead = { status: 'text'; text: string } | { status: 'empty' } | { status: 'unavailable' }

/** The ways to ask, in the order they are tried. Tests hand in their own. */
export interface ClipboardWays {
  /** platform/clipboard.readClipboard() once it exists: it asks the system first and says nothing itself. */
  full?: () => Promise<ClipboardRead>
  /** The command of the native layer (plugin lu-native, clipboard_read_text). undefined: the command is not there. */
  native?: () => Promise<string | null | undefined>
  /** The way that was there before: text, or null when it could not be read. */
  web: () => Promise<string | null>
}

type NativeRead = { clipboardReadText?: () => Promise<string | null> }

function ways(): ClipboardWays {
  const full = (clipboard as { readClipboard?: () => Promise<ClipboardRead> }).readClipboard
  return {
    full: typeof full === 'function' ? full : undefined,
    native: async () => {
      const answer = await tryBridge((bridge) => (bridge as NativeRead).clipboardReadText?.())
      return answer.ok ? answer.value : undefined
    },
    web: () => clipboard.readClipboardText(),
  }
}

/**
 * Ask the clipboard. The Android WebView refuses navigator.clipboard.readText,
 * so the system is asked first through the native layer. A build without that
 * command (an older app, a browser) falls back to the way that was there
 * before. Never throws.
 */
export async function readForPaste(w: ClipboardWays = ways()): Promise<ClipboardRead> {
  if (w.full) {
    try {
      return await w.full()
    } catch {
      /* the next way is asked */
    }
  }
  if (w.native) {
    try {
      const text = await w.native()
      if (typeof text === 'string') return text.trim() ? { status: 'text', text } : { status: 'empty' }
      // null: the system was asked and holds no text. undefined: the command is not there.
      if (text === null) return { status: 'empty' }
    } catch {
      /* the native read failed: the way before is asked */
    }
  }
  try {
    const text = await w.web()
    if (text === null) return { status: 'unavailable' }
    return text.trim() ? { status: 'text', text } : { status: 'empty' }
  } catch {
    return { status: 'unavailable' }
  }
}

export async function pasteInto(onChange: (value: string) => void, field?: HTMLElement | null, w?: ClipboardWays): Promise<PasteOutcome> {
  const read = await readForPaste(w)
  if (read.status === 'text') {
    onChange(read.text.trim())
    return 'pasted'
  }
  const outcome: PasteOutcome = read.status === 'empty' ? 'empty' : 'blocked'
  if (outcome === 'blocked') field?.focus()
  toast(outcome === 'blocked' ? COMMON.pasteBlocked : COMMON.pasteEmpty, { testid: outcome === 'blocked' ? 'paste-blocked' : 'paste-empty' })
  return outcome
}
