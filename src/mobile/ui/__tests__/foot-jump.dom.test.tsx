// @vitest-environment jsdom
/**
 * Round 35, E1 (iOS check of package 15): the consent sheet on its side at
 * text size 1.0. Since round 30 the privacy link stands at the top of the
 * footer; the top of the footer was on screen, "Agree and continue" and
 * "Not now" were below the edge, and no arrow showed the way. The round
 * button has to look at the buttons of the footer, not at its top.
 *
 * Run: npx vitest run src/mobile/ui/__tests__/foot-jump.dom.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { FootJump, footJumpTarget, footReach } from '../FootJump'

type Box = { top: number; bottom: number }
const rects = new Map<string, Box>()

function rectOf(el: Element): DOMRect {
  const r = rects.get((el as HTMLElement).dataset.r ?? '') ?? { top: 0, bottom: 0 }
  return { top: r.top, bottom: r.bottom, left: 0, right: 100, width: 100, height: r.bottom - r.top, x: 0, y: r.top, toJSON: () => ({}) } as DOMRect
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return rectOf(this)
  })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  cleanup()
  rects.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function Harness() {
  const box = useRef<HTMLDivElement>(null)
  return (
    <>
      <div ref={box} data-r="box">
        <div data-r="text">text</div>
        <div className="m-sheet-foot m-sheet-foot--scrolls" data-r="foot">
          <a href="#privacy" data-r="link">Read the privacy policy</a>
          <button type="button" data-r="agree">Agree and continue</button>
          <button type="button" data-r="decline">Not now</button>
        </div>
      </div>
      <FootJump box={box} active of="sheet" />
    </>
  )
}

async function mount(): Promise<void> {
  await act(async () => {
    render(<Harness />)
  })
}

describe('E1: the round button looks at the buttons of the footer', () => {
  it('top of the footer and the link on screen, the answers below the edge: the button shows', async () => {
    // iPhone 17 on its side, text 1.0: the box ends at 340, the link is in view, Agree starts at 368.
    rects.set('box', { top: 60, bottom: 340 })
    rects.set('foot', { top: 300, bottom: 470 })
    rects.set('link', { top: 308, bottom: 356 })
    rects.set('agree', { top: 368, bottom: 412 })
    rects.set('decline', { top: 420, bottom: 464 })
    await mount()
    expect(screen.queryByTestId('m-foot-jump')).not.toBeNull()
  })

  it('every button of the footer on screen: no button', async () => {
    rects.set('box', { top: 60, bottom: 480 })
    rects.set('foot', { top: 300, bottom: 476 })
    rects.set('link', { top: 308, bottom: 356 })
    rects.set('agree', { top: 368, bottom: 412 })
    rects.set('decline', { top: 420, bottom: 464 })
    await mount()
    expect(screen.queryByTestId('m-foot-jump')).toBeNull()
  })

  it('the whole footer below the edge: the button shows (as before)', async () => {
    rects.set('box', { top: 60, bottom: 340 })
    rects.set('foot', { top: 600, bottom: 760 })
    rects.set('agree', { top: 610, bottom: 654 })
    await mount()
    expect(screen.queryByTestId('m-foot-jump')).not.toBeNull()
  })
})

describe('footReach', () => {
  it('is the lowest edge of the buttons, or the top of a footer without any', () => {
    expect(footReach(300, [356, 412, 464])).toBe(464)
    expect(footReach(300, [])).toBe(300)
  })
})

// Check Android package 16, H4: the consent sheet on its side at text 2.0. Its footer (198 px with the box padding
// 210) is higher than the box it scrolls in (153 px without the strip of the button). Rolled to the end, the privacy
// link at the top of the footer lay under the title of the sheet. Numbers as measured in Chromium at 511x272.
describe('footJumpTarget', () => {
  it('a footer that fits: to the end, as before', () => {
    expect(footJumpTarget({ scrollTop: 0, end: 300, footTop: 340, footHeight: 120, room: 153 })).toBe(300)
  })
  it('a footer higher than the box: first to its top, so nothing above the box covers its first control', () => {
    expect(footJumpTarget({ scrollTop: 0, end: 734, footTop: 617, footHeight: 210, room: 153 })).toBe(617)
  })
  it('then, standing at its top, on to the end', () => {
    expect(footJumpTarget({ scrollTop: 617, end: 734, footTop: 617, footHeight: 210, room: 153 })).toBe(734)
    expect(footJumpTarget({ scrollTop: 650, end: 734, footTop: 617, footHeight: 210, room: 153 })).toBe(734)
  })
})
