/**
 * Clipboard.
 *
 * The native layer comes first (plugin lu-native, `clipboard_read_text` and
 * `clipboard_write_text`): the Android WebView refuses
 * navigator.clipboard.readText with NotAllowedError, so without it every
 * "Paste" button was dead there. The web way stays as the fallback for a
 * browser and for a build without the plugin.
 *
 * The result is honest: callers show "Copied" only when copyText resolves
 * true, and a "Paste" that finds nothing says so instead of doing nothing.
 */
import { tryBridge } from './bridge'

/** What a tap on "Paste" found. */
export type PasteResult =
  | { status: 'text'; text: string }
  /** The clipboard is empty, or holds something that is not text. */
  | { status: 'empty' }
  /** Nobody could be asked: no native layer, and the browser refused. */
  | { status: 'unavailable' }

export const CLIPBOARD_TEXT = {
  empty: 'Nothing to paste',
  unavailable: 'LU could not read the clipboard. Press and hold the field, then tap Paste.',
} as const

async function copyOnTheWeb(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the old way */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/** True when the text is on the clipboard. Never throws. */
export async function copyText(text: string): Promise<boolean> {
  try {
    const native = await tryBridge((bridge) => bridge.clipboardWriteText?.(text))
    if (native.ok && native.value === true) return true
  } catch {
    /* the system refused this text: the web way is asked */
  }
  try {
    return await copyOnTheWeb(text)
  } catch {
    return false
  }
}

async function readOnTheWeb(): Promise<PasteResult> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
      const text = await navigator.clipboard.readText()
      return text ? { status: 'text', text } : { status: 'empty' }
    }
  } catch {
    /* not allowed */
  }
  return { status: 'unavailable' }
}

/** Ask the clipboard and say what was there. Never throws. */
export async function readClipboard(): Promise<PasteResult> {
  try {
    const native = await tryBridge((bridge) => bridge.clipboardReadText?.())
    if (native.ok) return native.value ? { status: 'text', text: native.value } : { status: 'empty' }
  } catch {
    /* the native read failed: the web way is asked */
  }
  return readOnTheWeb()
}

/** Tell the user why a tap on "Paste" filled nothing. The toast of the kit, loaded only when it is needed. */
async function say(text: string, testid: string): Promise<void> {
  try {
    const { toast } = await import('../ui/Toast')
    toast(text, { testid })
  } catch {
    /* no kit in this context (a test without a DOM): nothing to show it with */
  }
}

/**
 * Text from the clipboard, or null when there is none. This is what every
 * "Paste" button calls, so the reason for a null is said here, once, for all
 * of them: "Nothing to paste" for an empty clipboard, and the way by hand
 * when the clipboard could not be asked at all.
 */
export async function readClipboardText(): Promise<string | null> {
  const result = await readClipboard()
  if (result.status === 'text') return result.text
  await say(result.status === 'empty' ? CLIPBOARD_TEXT.empty : CLIPBOARD_TEXT.unavailable, result.status === 'empty' ? 'paste-empty' : 'paste-unavailable')
  return null
}
