/**
 * The rules of round 4 that need no DOM: where the footer goes, how far a
 * field is scrolled, what counts as the text zoom of the WebView.
 * (Acceptance android-knoepfe, findings M7, M8 and M9.)
 */
import { describe, expect, it } from 'vitest'
import { FIELD_MARGIN_PX, scrollDelta } from '../field-in-view'
import { footScrolls, nextFootState, screenShape } from '../screen-shape'
import { footBelowView } from '../FootJump'
import { unitFrom, zoomFromProbe } from '../text-zoom'

describe('footScrolls', () => {
  it('upright the footer stays fixed, also on the smallest phone at 200 percent', () => {
    expect(footScrolls(390, 844, 16)).toBe(false)
    expect(footScrolls(320, 568, 16)).toBe(false)
    expect(footScrolls(320, 568, 32)).toBe(false)
    expect(footScrolls(360, 592, 32)).toBe(false)
  })

  it('on its side a small phone puts the footer into the content', () => {
    // The phone of the acceptance run: 360 by 592 CSS px.
    expect(footScrolls(592, 360, 16)).toBe(true)
    expect(footScrolls(592, 360, 32)).toBe(true)
    expect(footScrolls(568, 320, 16)).toBe(true)
  })

  it('on its side a large phone keeps it at 100 percent and lets go at 200', () => {
    expect(footScrolls(915, 412, 16)).toBe(false)
    expect(footScrolls(915, 412, 32)).toBe(true)
    expect(footScrolls(844, 390, 16)).toBe(false)
    expect(footScrolls(844, 390, 32)).toBe(true)
  })

  it('a tablet is never that low', () => {
    expect(footScrolls(1180, 820, 32)).toBe(false)
  })
})

describe('nextFootState', () => {
  const base = { width: 360, height: 592, unitPx: 16, editing: false }

  it('the keyboard alone does not move the footer', () => {
    const before = nextFootState(null, base)
    expect(before.scrolls).toBe(false)
    // The keyboard takes 280 px while a field has the focus.
    const typing = nextFootState(before, { ...base, height: 240, editing: true })
    expect(typing).toBe(before)
  })

  it('a rotation is measured anew, also while a field has the focus', () => {
    const before = nextFootState(null, base)
    const turned = nextFootState(before, { width: 592, height: 360, unitPx: 16, editing: true })
    expect(turned.scrolls).toBe(true)
  })

  it('a new text size is measured anew', () => {
    const land = { width: 844, height: 390, unitPx: 16, editing: false }
    const before = nextFootState(null, land)
    expect(before.scrolls).toBe(false)
    expect(nextFootState(before, { ...land, unitPx: 32, editing: true }).scrolls).toBe(true)
  })

  it('once the field is left, the height counts again', () => {
    const before = nextFootState(null, { width: 592, height: 360, unitPx: 16, editing: false })
    expect(before.scrolls).toBe(true)
    expect(nextFootState(before, { width: 592, height: 500, unitPx: 16, editing: false }).scrolls).toBe(false)
  })
})

describe('screenShape counts in the size text is drawn at', () => {
  it('a phone at 200 percent is low, whichever way the text got large', () => {
    // iOS: the root is 32 px. Android: the root is 16 px and the zoom is 2. Both hand in 32.
    expect(screenShape(360, 592, 32)).toBe('low')
    expect(screenShape(360, 592, 16)).toBe('tall')
  })
})

describe('scrollDelta', () => {
  const view = { top: 100, bottom: 400 }

  it('leaves a field alone that is in sight', () => {
    expect(scrollDelta({ top: 150, bottom: 200 }, view)).toBe(0)
    expect(scrollDelta({ top: 100 + FIELD_MARGIN_PX, bottom: 400 - FIELD_MARGIN_PX }, view)).toBe(0)
  })

  it('brings up a field whose lower edge is under the keyboard or the footer', () => {
    expect(scrollDelta({ top: 380, bottom: 430 }, view)).toBe(430 - (400 - FIELD_MARGIN_PX))
  })

  it('brings down a field that is above the area', () => {
    expect(scrollDelta({ top: 60, bottom: 110 }, view)).toBe(60 - (100 + FIELD_MARGIN_PX))
  })

  it('a field higher than the area shows its first line', () => {
    expect(scrollDelta({ top: 300, bottom: 900 }, view)).toBe(300 - (100 + FIELD_MARGIN_PX))
    expect(scrollDelta({ top: 100 + FIELD_MARGIN_PX, bottom: 900 }, view)).toBe(0)
  })

  it('does nothing in an area without room', () => {
    expect(scrollDelta({ top: 0, bottom: 50 }, { top: 100, bottom: 110 })).toBe(0)
  })
})

describe('zoomFromProbe', () => {
  it('reads the text zoom of an Android WebView from a line of 100 px', () => {
    expect(zoomFromProbe(100)).toBe(1)
    expect(zoomFromProbe(130)).toBe(1.3)
    expect(zoomFromProbe(200)).toBe(2)
  })

  it('counts rounding of a font and a missing layout as no zoom', () => {
    expect(zoomFromProbe(101)).toBe(1)
    expect(zoomFromProbe(98)).toBe(1)
    expect(zoomFromProbe(0)).toBe(1)
    expect(zoomFromProbe(Number.NaN)).toBe(1)
  })
})

describe('dialogRisk', () => {
  it('the action button of a question carries the mark of what was asked', async () => {
    const { dialogRisk } = await import('../Dialog')
    // A red question deletes, a cloud violet one pays (acceptance android-knoepfe, M2a).
    expect(dialogRisk({ tone: 'danger' })).toBe('destructive')
    expect(dialogRisk({ tone: 'cloud' })).toBe('paid')
    expect(dialogRisk({ tone: 'default' })).toBeUndefined()
    expect(dialogRisk({})).toBeUndefined()
    // The opener says it where the colour does not.
    expect(dialogRisk({ risk: 'destructive' })).toBe('destructive')
    expect(dialogRisk({ tone: 'cloud', risk: 'none' })).toBeUndefined()
  })
})

// Acceptance android-4gb, F8 and F15: on the phone (360 by 592 px, system text at 2.0) the footer of every
// page stood at the end of the scrolling content, although the rule above says "fixed" for that size.
describe('unitFrom: one text unit, as it is drawn', () => {
  it('takes the drawn height of the rem probe, whatever the computed root size says', () => {
    // Android at 200 percent: the WebView reports a root of 32 px AND a zoom of 2. The probe is 200 px high.
    expect(unitFrom(200, 32, 2)).toBe(32)
    // The same phone, should a WebView report the root without its zoom.
    expect(unitFrom(200, 16, 2)).toBe(32)
    // iOS and a browser: the root itself is 32 px, no zoom.
    expect(unitFrom(200, 32, 1)).toBe(32)
    expect(unitFrom(130, 20.8, 1.3)).toBe(20.8)
    expect(unitFrom(100, 16, 1)).toBe(16)
    expect(unitFrom(101, 16, 1)).toBe(16)
  })

  it('the phone of the finding keeps its footer fixed with that unit, and lost it with the old product', () => {
    expect(footScrolls(360, 592, unitFrom(200, 32, 2))).toBe(false)
    expect(footScrolls(320, 568, unitFrom(200, 32, 2))).toBe(false)
    // What the code counted before: root size times zoom.
    expect(footScrolls(360, 592, 32 * 2)).toBe(true)
  })

  it('without a layout the unit is the root size times the zoom', () => {
    expect(unitFrom(0, 16, 2)).toBe(32)
    expect(unitFrom(Number.NaN, 32, 1)).toBe(32)
    expect(unitFrom(0, 0, 0)).toBe(16)
  })
})

describe('footBelowView', () => {
  it('a footer that starts under the visible part is out of sight', () => {
    expect(footBelowView(900, 360)).toBe(true)
    expect(footBelowView(360, 360)).toBe(true)
  })
  it('a footer that shows more than a sliver is in sight', () => {
    expect(footBelowView(300, 360)).toBe(false)
    expect(footBelowView(351, 360)).toBe(false)
  })
})
