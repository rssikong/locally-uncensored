// @vitest-environment jsdom
/**
 * A tap on a button while the keyboard is open keeps the layout of the open keyboard until the tap is over.
 *
 * Android with adjustResize: the keyboard counts as open while the window is shorter and a field has the
 * focus. A tap on Send moves the focus to the button between the press and the release. Measured at that
 * moment the keyboard counted as closed, the notice after a return unfolded, the button moved and the tap
 * arrived on nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function setHeight(px: number): void {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: px })
  window.dispatchEvent(new Event('resize'))
}

describe('keyboard: the focus on a button does not close the layout before the tap is over', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    document.body.innerHTML = '<textarea id="field"></textarea><button id="send">Send</button>'
    document.documentElement.className = ''
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 640 })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays open while the button takes the focus and is measured again a moment later', async () => {
    const { installKeyboard, keyboardState, FOCUS_LEFT_MS } = await import('../keyboard')
    installKeyboard()
    const field = document.getElementById('field') as HTMLTextAreaElement
    const send = document.getElementById('send') as HTMLButtonElement

    field.focus()
    setHeight(317)
    expect(keyboardState().open).toBe(true)
    expect(document.documentElement.classList.contains('m-kb-open')).toBe(true)

    // The press of the tap: the focus goes to the button. Nothing moves yet.
    send.focus()
    expect(document.activeElement).toBe(send)
    expect(keyboardState().open).toBe(true)
    expect(document.documentElement.classList.contains('m-kb-open')).toBe(true)

    // The tap is over: the keyboard is measured as what it is now.
    vi.advanceTimersByTime(FOCUS_LEFT_MS)
    expect(keyboardState().open).toBe(false)
    expect(document.documentElement.classList.contains('m-kb-open')).toBe(false)
  })

  it('a field that takes the focus is measured at once', async () => {
    const { installKeyboard, keyboardState } = await import('../keyboard')
    installKeyboard()
    setHeight(317)
    expect(keyboardState().open).toBe(false)
    ;(document.getElementById('field') as HTMLTextAreaElement).focus()
    expect(keyboardState().open).toBe(true)
  })
})
