// @vitest-environment jsdom
/**
 * A17, found in the Android emulator against a real desktop: the first tap
 * on Send with the keyboard open only closed the keyboard. Send and Stop now
 * keep the focus in the field, so the keyboard stays and the page does not
 * jump under the finger; the tap sends at once.
 *
 * Run: npx vitest run src/mobile/ui/__tests__/composer-focus.dom.test.tsx
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Composer } from '../Composer'

afterEach(cleanup)

describe('Send and Stop keep the keyboard', () => {
  it('pressing Send does not take the focus from the field, and one tap sends', () => {
    const onSend = vi.fn()
    render(<Composer value="hello" onChange={() => {}} onSend={onSend} idPrefix="m-x" />)
    const field = screen.getByTestId('m-x-input')
    field.focus()
    const send = screen.getByTestId('m-x-send')
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    send.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    const pointer = new Event('pointerdown', { bubbles: true, cancelable: true })
    send.dispatchEvent(pointer)
    expect(pointer.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(field)
    fireEvent.click(send)
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('Stop as well', () => {
    const onStop = vi.fn()
    render(<Composer value="" onChange={() => {}} onSend={() => {}} running onStop={onStop} idPrefix="m-x" />)
    const stop = screen.getByTestId('m-x-stop')
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    stop.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    fireEvent.click(stop)
    expect(onStop).toHaveBeenCalledTimes(1)
  })
})
