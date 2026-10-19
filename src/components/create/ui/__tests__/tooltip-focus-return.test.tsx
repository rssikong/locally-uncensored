// @vitest-environment jsdom
/**
 * How-to recording 12.10.2026: after the Advanced settings drawer closed, the
 * focus went back to its button and the button's tooltip stood over the
 * composer. A focus tooltip is for a control the user walked to with Tab, not
 * for a focus something else handed back.
 *
 * Run: npx vitest run src/components/create/ui/__tests__/tooltip-focus-return.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react'
import { Tooltip } from '../Tooltip'

// jsdom has no `:focus-visible` heuristic of its own; the browser's answer
// after a key press is "yes", which is the case under test.
const realMatches = Element.prototype.matches
beforeEach(() => {
  vi.useFakeTimers()
  Element.prototype.matches = function (sel: string) {
    return sel === ':focus-visible' ? true : realMatches.call(this, sel)
  }
})
afterEach(() => {
  Element.prototype.matches = realMatches
  vi.useRealTimers()
  cleanup()
})

function mount() {
  render(<Tooltip content="All advanced settings."><button>open</button></Tooltip>)
  return screen.getByText('open')
}
const wait = () => act(() => { vi.advanceTimersByTime(500) })

describe('the tooltip of a focused control', () => {
  it('shows when the user walked there with Tab', () => {
    const button = mount()
    fireEvent.keyDown(window, { key: 'Tab' })
    fireEvent.focus(button)
    wait()
    expect(screen.queryByRole('tooltip')).not.toBeNull()
  })

  it('stays away when Escape closed something that hands the focus back', () => {
    const button = mount()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.focus(button)
    wait()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('stays away after a click, as before', () => {
    const button = mount()
    fireEvent.keyDown(window, { key: 'Tab' })
    fireEvent.pointerDown(window)
    fireEvent.focus(button)
    wait()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
