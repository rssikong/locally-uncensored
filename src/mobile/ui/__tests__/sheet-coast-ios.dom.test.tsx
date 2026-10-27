// @vitest-environment jsdom
/**
 * Check iOS package 11, F9: in the full customer flow on the iPhone 17 the tap on "Sampling" in the chat options
 * opened "Workflows", the row above (2 of 3 runs). Round 29 guards taps into coasting content (ui/Sheet.tsx,
 * guardCoastingTaps), written against the events of Chrome on Android. This file plays the order of events of
 * WebKit on iOS against the same guard:
 *
 *   - a swipe: pointerdown, touchstart, touchmove, pointercancel, touchend (WebKit sends pointer events since iOS 13)
 *   - momentum: the scroll view keeps moving after the finger is gone, the page gets one scroll event per frame
 *   - a finger that lands on coasting content stops it; WebKit syncs the last position (one more scroll event)
 *     and may still send the synthetic mouse events and the click of that tap
 *   - the rubber band at the end of the list: the content overshoots and springs back. Where WebKit reports the
 *     overshoot as scrolling, the guard sees it. Where it does not (scrollTop held at its end), no event tells the
 *     page that the rows still move, and the hit test runs on the resting rows while the eye sees them displaced:
 *     a tap on "Sampling" at the bottom of the list then lands on the row above it. That is the case the guard
 *     cannot see, so the sheets do not bounce at all (overscroll-behavior none, last block below).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SheetContext } from '../../nav/context'
import type { SheetEntry } from '../../nav/types'
import { Row, Sheet } from '..'

afterEach(() => {
  cleanup()
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const sheetEntry: SheetEntry = { kind: 'sheet', sheet: 'chat-options', props: undefined, sub: [], key: 's#31' } as SheetEntry

function mount() {
  const opened: string[] = []
  render(
    <SheetContext.Provider value={{ entry: sheetEntry, isTop: true, locked: false, title: 'Chat options', depth: 0 }}>
      <Sheet title="Chat options">
        <Row title="Workflows" onPress={() => opened.push('workflows')} testid="row-workflows" />
        <Row title="Sampling" onPress={() => opened.push('sampling')} testid="row-sampling" />
        <Row title="Context window" onPress={() => opened.push('context')} testid="row-context" />
      </Sheet>
    </SheetContext.Provider>,
  )
  const body = document.querySelector('.m-sheet-body') as HTMLElement
  return { opened, body }
}

/** A swipe as WebKit on iOS sends it: the finger moves, the scroll view takes it over, the finger goes. */
function iosSwipe(body: HTMLElement) {
  fireEvent.pointerDown(body, { pointerType: 'touch' })
  fireEvent.touchStart(body)
  fireEvent.touchMove(body)
  fireEvent.pointerCancel(body, { pointerType: 'touch' })
  fireEvent.touchMove(body)
  fireEvent.touchEnd(body)
}

/** Momentum: one scroll event per frame, the content moving on. Resolves after the last frame. */
async function coast(body: HTMLElement, frames: number, from = 0, step = 12) {
  for (let i = 1; i <= frames; i++) {
    body.scrollTop = from + i * step
    fireEvent.scroll(body)
    await sleep(16)
  }
}

/** The finger goes down; the hook `between` runs before WebKit sends the synthetic mouse events and the click. */
function iosTap(el: HTMLElement, between?: () => void) {
  fireEvent.pointerDown(el, { pointerType: 'touch' })
  fireEvent.touchStart(el)
  between?.()
  fireEvent.pointerUp(el, { pointerType: 'touch' })
  fireEvent.touchEnd(el)
  fireEvent.mouseDown(el, { detail: 1 })
  fireEvent.mouseUp(el, { detail: 1 })
  fireEvent.click(el, { detail: 1 })
}

describe('the guard against taps into coasting content, with the events of WebKit on iOS', () => {
  it('a tap during momentum (scroll events per frame) opens nothing', async () => {
    const { opened, body } = mount()
    iosSwipe(body)
    await coast(body, 6)
    iosTap(screen.getByTestId('row-sampling'))
    expect(opened).toEqual([])
  })

  it('a tap that stops the momentum opens nothing, also when the last position arrives between finger and click', async () => {
    const { opened, body } = mount()
    iosSwipe(body)
    await coast(body, 4)
    // The page was busy: the last frame came 80 ms before the finger, longer than the window of the guard.
    await sleep(80)
    iosTap(screen.getByTestId('row-sampling'), () => {
      body.scrollTop += 30
      fireEvent.scroll(body)
    })
    expect(opened).toEqual([])
  })

  it('a rubber band that WebKit reports as scrolling (overshoot, then back) drops the tap during it', async () => {
    const { opened, body } = mount()
    iosSwipe(body)
    await coast(body, 3, 100, 20)
    // Back from the overshoot, frame by frame.
    await coast(body, 3, 160, -10)
    iosTap(screen.getByTestId('row-sampling'))
    expect(opened).toEqual([])
  })

  it('a tap once the momentum has ended opens the row under the finger', async () => {
    const { opened, body } = mount()
    iosSwipe(body)
    await coast(body, 4)
    await sleep(120)
    iosTap(screen.getByTestId('row-sampling'))
    expect(opened).toEqual(['sampling'])
  })

  it('a plain tap without any swipe before opens its row', () => {
    const { opened } = mount()
    iosTap(screen.getByTestId('row-sampling'))
    expect(opened).toEqual(['sampling'])
  })
})

// The rubber band WebKit does not report cannot be seen by the guard: the sheets that scroll do not bounce.
describe('the scrolling parts of a sheet do not bounce', () => {
  const css = readFileSync(join(__dirname, '..', '..', 'styles', 'components.css'), 'utf8')
  /** The declarations of the rule with exactly this selector. */
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`)
    expect(at, selector).toBeGreaterThanOrEqual(0)
    return css.slice(at, css.indexOf('}', at))
  }

  it('the body of a sheet', () => {
    expect(rule('.m-sheet-body')).toMatch(/overscroll-behavior:\s*none;/)
  })

  it('a sheet that scrolls as one piece above the keyboard', () => {
    expect(rule("html.m-kb-open[data-m-room='cramped'] .m-app .m-sheet")).toMatch(/overscroll-behavior:\s*none;/)
  })
})
