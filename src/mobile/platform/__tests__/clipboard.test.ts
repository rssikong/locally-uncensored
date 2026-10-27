/**
 * "Paste" and "Copy" ask the system first (H1 of the Android acceptance: the
 * WebView refuses navigator.clipboard.readText, every Paste button was dead),
 * the browser second, and a Paste that finds nothing says so.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { __setBridgeForTests } from '../bridge'
import { CLIPBOARD_TEXT, copyText, readClipboard, readClipboardText } from '../clipboard'
import { useToastStore } from '../../ui/Toast'

function webClipboard(clipboard: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
}

afterEach(() => {
  __setBridgeForTests(undefined)
  webClipboard(undefined)
  useToastStore.getState().dismiss()
})

describe('paste', () => {
  it('takes the text from the native layer and never asks the WebView', async () => {
    const readText = vi.fn(async () => 'from the web')
    webClipboard({ readText })
    __setBridgeForTests({ clipboardReadText: async () => 'hf_token' })
    expect(await readClipboard()).toEqual({ status: 'text', text: 'hf_token' })
    expect(await readClipboardText()).toBe('hf_token')
    expect(readText).not.toHaveBeenCalled()
    expect(useToastStore.getState().current).toBeNull()
  })

  it('says "Nothing to paste" for an empty clipboard', async () => {
    __setBridgeForTests({ clipboardReadText: async () => null })
    expect(await readClipboard()).toEqual({ status: 'empty' })
    expect(await readClipboardText()).toBeNull()
    expect(useToastStore.getState().current?.text).toBe(CLIPBOARD_TEXT.empty)
    expect(CLIPBOARD_TEXT.empty).toBe('Nothing to paste')
  })

  it('falls back to the WebView when the build has no native clipboard', async () => {
    __setBridgeForTests({})
    webClipboard({ readText: async () => 'from the web' })
    expect(await readClipboardText()).toBe('from the web')
  })

  it('falls back to the WebView when the native read fails', async () => {
    __setBridgeForTests({ clipboardReadText: async () => { throw new Error('The clipboard could not be read.') } })
    webClipboard({ readText: async () => 'from the web' })
    expect(await readClipboard()).toEqual({ status: 'text', text: 'from the web' })
  })

  it('names the way by hand when nobody can read the clipboard', async () => {
    __setBridgeForTests(null)
    webClipboard({ readText: async () => { throw new DOMException('denied', 'NotAllowedError') } })
    expect(await readClipboard()).toEqual({ status: 'unavailable' })
    expect(await readClipboardText()).toBeNull()
    expect(useToastStore.getState().current?.text).toBe(CLIPBOARD_TEXT.unavailable)
  })
})

describe('copy', () => {
  it('is true only when the system took the text', async () => {
    const writeText = vi.fn(async () => {})
    webClipboard({ writeText })
    const native = vi.fn(async () => true)
    __setBridgeForTests({ clipboardWriteText: native })
    expect(await copyText('an answer')).toBe(true)
    expect(native).toHaveBeenCalledWith('an answer')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('asks the WebView when the native write fails, and is false when both fail', async () => {
    __setBridgeForTests({ clipboardWriteText: async () => { throw new Error('The text could not be copied.') } })
    const writeText = vi.fn(async () => {})
    webClipboard({ writeText })
    expect(await copyText('x')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('x')
    webClipboard({ writeText: async () => { throw new Error('no') } })
    expect(await copyText('x')).toBe(false)
  })
})
