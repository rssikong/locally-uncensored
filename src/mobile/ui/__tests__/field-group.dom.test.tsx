// @vitest-environment jsdom
/**
 * Round 5, N9: a field and the button that belongs to it stay in sight
 * together when the keyboard opens ("Save key" under the Brave key on the
 * page Web search lay under the fixed footer).
 *
 * Run: npx vitest run src/mobile/ui/__tests__/field-group.dom.test.tsx
 */
import { afterEach, describe, expect, it } from 'vitest'
import { FIELD_MARGIN_PX, keepFieldInView, targetsOf } from '../field-in-view'

function page(heights: { view: number; group: number; set: number; field: number; groupTop: number }): { input: HTMLInputElement; scroller: HTMLElement } {
  document.body.innerHTML = `
    <div id="scroller" style="overflow-y: auto">
      <div id="group" data-m-field-group="">
        <div class="m-fieldset" id="set"><label>Brave API key</label><input id="key" /></div>
        <button id="save">Save key</button>
      </div>
    </div>`
  const scroller = document.getElementById('scroller') as HTMLElement
  const rect = (top: number, height: number) => ({ top: top - scroller.scrollTop, bottom: top + height - scroller.scrollTop, height, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: heights.view, height: heights.view, left: 0, right: 300, width: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  ;(document.getElementById('group') as HTMLElement).getBoundingClientRect = () => rect(heights.groupTop, heights.group)
  ;(document.getElementById('set') as HTMLElement).getBoundingClientRect = () => rect(heights.groupTop, heights.set)
  const input = document.getElementById('key') as HTMLInputElement
  input.getBoundingClientRect = () => rect(heights.groupTop + heights.set - heights.field, heights.field)
  Object.defineProperty(window, 'innerHeight', { value: 2000, configurable: true })
  return { input, scroller }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('what is kept in sight for a field', () => {
  it('the marked group first, then label and field, then the field', () => {
    const { input } = page({ view: 300, group: 130, set: 78, field: 48, groupTop: 0 })
    expect(targetsOf(input).map((el) => el.id)).toEqual(['group', 'set', 'key'])
  })

  it('a field without a group is as before', () => {
    document.body.innerHTML = '<div class="m-fieldset" id="set"><input id="key" /></div>'
    expect(targetsOf(document.getElementById('key') as HTMLElement).map((el) => el.id)).toEqual(['set', 'key'])
  })

  it('the group fits: it is scrolled so that the button under the field is in sight too', () => {
    // The group ends at 400, the room ends at 240: without the group only the field set (ends at 348) was brought in.
    const { input, scroller } = page({ view: 240, group: 130, set: 78, field: 48, groupTop: 270 })
    expect(keepFieldInView(input)).toBe(true)
    expect(scroller.scrollTop).toBe(270 + 130 - (240 - FIELD_MARGIN_PX))
  })

  it('the group does not fit, label and field do: those are brought in', () => {
    const { input, scroller } = page({ view: 110, group: 130, set: 78, field: 48, groupTop: 270 })
    expect(keepFieldInView(input)).toBe(true)
    expect(scroller.scrollTop).toBe(270 + 78 - (110 - FIELD_MARGIN_PX))
  })

  it('in sight already: nothing moves', () => {
    const { input, scroller } = page({ view: 300, group: 130, set: 78, field: 48, groupTop: 40 })
    expect(keepFieldInView(input)).toBe(false)
    expect(scroller.scrollTop).toBe(0)
  })
})
