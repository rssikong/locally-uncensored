// @vitest-environment jsdom
/**
 * Round 5, the toast and the buttons under it. "Key saved" slid over the lower
 * buttons of the provider page, and a quick tap on "Test connection" hit the
 * toast, which only went away. The kit now puts a toast where it covers no
 * control; when every place covers one, away from the last tap.
 *
 * Run: npx vitest run src/mobile/ui/__tests__/toast-place.dom.test.tsx
 */
import { afterEach, describe, expect, it } from 'vitest'
import { TOAST_CLEAR_PX, choosePlace, coversAny, freeSpot, placeToast, toastTopFor, type Box } from '../Toast'

const box = (top: number, bottom: number, left = 16, right = 359): Box => ({ top, bottom, left, right })

describe('coversAny', () => {
  it('a box on a control covers it, a box beside or just touching it does not', () => {
    const button = box(500, 544)
    expect(coversAny(box(480, 530), [button])).toBe(true)
    expect(coversAny(box(440, 500), [button])).toBe(false)
    expect(coversAny(box(544, 600), [button])).toBe(false)
    expect(coversAny(box(480, 530, 400, 500), [button])).toBe(false)
    expect(coversAny(box(480, 530), [])).toBe(false)
  })
})

describe('choosePlace', () => {
  const mids = { bottomMid: 560, topMid: 90 }
  it('the bottom, as long as nothing to press is under it', () => {
    expect(choosePlace({ bottomCovers: false, topCovers: true, tapY: 550, ...mids })).toBe('bottom')
  })
  it('the top, when the bottom would cover a button and the top is free', () => {
    expect(choosePlace({ bottomCovers: true, topCovers: false, tapY: 550, ...mids })).toBe('top')
  })
  it('both cover something: away from where the finger just was', () => {
    expect(choosePlace({ bottomCovers: true, topCovers: true, tapY: 540, ...mids })).toBe('top')
    expect(choosePlace({ bottomCovers: true, topCovers: true, tapY: 100, ...mids })).toBe('bottom')
    expect(choosePlace({ bottomCovers: true, topCovers: true, tapY: null, ...mids })).toBe('bottom')
  })
})

describe('freeSpot: room between the controls', () => {
  const toast = { height: 52, left: 16, right: 359 }
  it('the screen of the report: a switch at the top, buttons at the bottom, a paragraph in between', () => {
    // Custom endpoint with a saved key (re-check Android 8 GB, A-22 a), in px of that phone.
    const controls = [box(84, 128), box(236, 280), box(304, 340), box(430, 470), box(480, 518), box(528, 564), box(617, 661), box(677, 713)]
    const spot = freeSpot({ ...toast, from: 96, to: 766, controls, prefer: 'low' })
    // Under "Remove key" (564) the room to "Test connection" (617) is 53 px: too little with the clearance. The next one up is the paragraph above the field.
    expect(spot).toBe(430 - TOAST_CLEAR_PX - 52)
    expect(coversAny(box(spot!, spot! + 52), controls)).toBe(false)
    // From the top the first room is under the switch.
    expect(freeSpot({ ...toast, from: 96, to: 766, controls, prefer: 'high' })).toBe(128 + TOAST_CLEAR_PX)
  })

  it('keeps its clearance: a gap of exactly the height of the toast is not enough', () => {
    const controls = [box(100, 144), box(196, 240)]
    expect(freeSpot({ ...toast, from: 100, to: 240, controls, prefer: 'low' })).toBeNull()
    expect(freeSpot({ ...toast, from: 100, to: 240, controls: [box(100, 144), box(204, 240)], prefer: 'low' })).toBe(148)
  })

  it('nothing in the way: the end it was asked from', () => {
    expect(freeSpot({ ...toast, from: 96, to: 600, controls: [], prefer: 'low' })).toBe(548)
    expect(freeSpot({ ...toast, from: 96, to: 600, controls: [], prefer: 'high' })).toBe(96)
  })

  it('a control beside the toast is not in its way', () => {
    expect(freeSpot({ ...toast, left: 16, right: 200, from: 96, to: 600, controls: [box(540, 596, 210, 359)], prefer: 'low' })).toBe(548)
  })

  it('a page of nothing but controls has no room, and neither has a range lower than the toast', () => {
    const rows = Array.from({ length: 12 }, (_, i) => box(96 + i * 48, 96 + i * 48 + 44))
    expect(freeSpot({ ...toast, from: 96, to: 672, controls: rows, prefer: 'low' })).toBeNull()
    expect(freeSpot({ ...toast, from: 96, to: 672, controls: rows, prefer: 'high' })).toBeNull()
    expect(freeSpot({ ...toast, from: 96, to: 120, controls: [], prefer: 'low' })).toBeNull()
  })
})

/** A page of the shell with rectangles, since jsdom lays nothing out. */
function page(opts: { footer?: boolean; buttons: Array<[number, number]>; covered?: boolean }): HTMLElement {
  document.body.innerHTML = `
    <div class="m-app" ${opts.covered ? 'data-covered' : ''}>
      <div class="m-stack"><div class="m-page"><div class="m-screen">
        <div class="m-body">${opts.buttons.map((_, i) => `<button id="b${i}">b</button>`).join('')}</div>
        ${opts.footer ? '<div class="m-foot" id="foot"></div>' : ''}
      </div></div></div>
      <div class="m-toast-layer" id="layer"><div class="m-toast" id="toast">Key saved</div></div>
    </div>`
  const rect = (top: number, bottom: number) => ({ top, bottom, left: 16, right: 359, width: 343, height: bottom - top, x: 16, y: top, toJSON: () => ({}) }) as DOMRect
  const at = (id: string, fn: () => DOMRect) => { (document.getElementById(id) as HTMLElement).getBoundingClientRect = fn }
  ;(document.querySelector('.m-app') as HTMLElement).getBoundingClientRect = () => ({ ...rect(0, 667), left: 0, right: 375, width: 375 }) as DOMRect
  ;(document.querySelector('.m-body') as HTMLElement).getBoundingClientRect = () => rect(88, opts.footer ? 587 : 667)
  opts.buttons.forEach(([top, bottom], i) => at(`b${i}`, () => rect(top, bottom)))
  if (opts.footer) Object.defineProperty(document.getElementById('foot'), 'offsetHeight', { value: 80 })
  const layer = document.getElementById('layer') as HTMLElement
  // The toast is 48 px high: at the bottom 76 px above the edge, at the top where the layer says.
  at('toast', () => (layer.dataset.place === 'top' || layer.dataset.place === 'gap' ? rect(parseFloat(layer.style.getPropertyValue('--m-toast-top')), parseFloat(layer.style.getPropertyValue('--m-toast-top')) + 48) : rect(543, 591)))
  return layer
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('placeToast', () => {
  it('"Key saved": the buttons stand low, the toast goes to the top of the content', () => {
    const layer = page({ buttons: [[500, 544], [552, 596]] })
    expect(placeToast(layer)).toBe(96)
    expect(layer.dataset.place).toBe('top')
    expect(layer.style.getPropertyValue('--m-toast-top')).toBe('96px')
  })

  it('nothing to press at the bottom: the usual place', () => {
    const layer = page({ buttons: [[100, 144]] })
    expect(placeToast(layer)).toBeNull()
    expect(layer.dataset.place).toBe('bottom')
    expect(layer.style.getPropertyValue('--m-toast-top')).toBe('')
  })

  it('a page with a footer keeps its rule: the top of the content', () => {
    const layer = page({ footer: true, buttons: [[200, 244]] })
    expect(toastTopFor(document.querySelector('.m-app'))).toBe(96)
    expect(placeToast(layer)).toBe(96)
    expect(layer.dataset.place).toBe('top')
  })

  it('A-22 a: controls at both ends, the toast takes the free room nearest to the bottom and lies on neither', () => {
    const layer = page({ buttons: [[96, 140], [552, 596]] })
    expect(placeToast(layer)).toBe(552 - TOAST_CLEAR_PX - 48)
    expect(layer.dataset.place).toBe('gap')
    expect(layer.style.getPropertyValue('--m-toast-top')).toBe('500px')
  })

  it('a control in the lowest room too: the next one up', () => {
    const layer = page({ buttons: [[96, 140], [470, 540], [552, 596]] })
    expect(placeToast(layer)).toBe(470 - TOAST_CLEAR_PX - 48)
    expect(layer.dataset.place).toBe('gap')
  })

  it('a control that has scrolled under the header is not in the way of the top', () => {
    // The body begins at 88. A button at 60 to 100 shows 12 px of itself, above the place of the toast (96).
    const layer = page({ buttons: [[60, 92], [552, 596]] })
    expect(placeToast(layer)).toBe(96)
    expect(layer.dataset.place).toBe('top')
  })

  it('no room anywhere and no tap known yet: the usual place (the rule for a known tap is choosePlace above)', () => {
    const rows = Array.from({ length: 12 }, (_, i): [number, number] => [92 + i * 48, 92 + i * 48 + 44])
    const layer = page({ buttons: rows })
    expect(placeToast(layer)).toBeNull()
    expect(layer.dataset.place).toBe('bottom')
  })

  it('a page with a footer and a control at the top of its content: the first free room under it', () => {
    const layer = page({ footer: true, buttons: [[92, 140], [300, 344]] })
    expect(placeToast(layer)).toBe(140 + TOAST_CLEAR_PX)
    expect(layer.dataset.place).toBe('gap')
  })

  it('under a sheet whose Close button stands at the top the toast moves under it, and what lies behind the sheet does not count', () => {
    const layer = page({ covered: true, buttons: [[552, 596]] })
    const body = document.querySelector('.m-body') as HTMLElement
    body.setAttribute('inert', '')
    const app = document.querySelector('.m-app') as HTMLElement
    app.insertAdjacentHTML('beforeend', '<div class="m-sheet"><button id="close">Close</button></div>')
    ;(document.getElementById('close') as HTMLElement).getBoundingClientRect = () => ({ top: 20, bottom: 64, left: 300, right: 344, width: 44, height: 44, x: 300, y: 20, toJSON: () => ({}) }) as DOMRect
    const toast = document.getElementById('toast') as HTMLElement
    const at = (top: number) => ({ top, bottom: top + 48, left: 16, right: 359, width: 343, height: 48, x: 16, y: top, toJSON: () => ({}) }) as DOMRect
    toast.getBoundingClientRect = () => (layer.dataset.place === 'gap' ? at(parseFloat(layer.style.getPropertyValue('--m-toast-top'))) : at(24))
    expect(placeToast(layer)).toBe(64 + TOAST_CLEAR_PX)
    expect(layer.dataset.place).toBe('gap')
    // Without that button the style sheet keeps the toast where it was.
    document.getElementById('close')!.remove()
    expect(placeToast(layer)).toBeNull()
    expect(layer.dataset.place).toBe('bottom')
  })

  it('under a sheet or a dialog the style sheet decides, nothing is measured', () => {
    const layer = page({ covered: true, buttons: [[552, 596]] })
    expect(placeToast(layer)).toBeNull()
  })

  it('no layer, no page: the bottom', () => {
    expect(placeToast(null)).toBeNull()
  })
})
