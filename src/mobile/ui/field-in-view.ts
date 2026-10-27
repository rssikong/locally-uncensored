/**
 * The field that has the focus stays in sight.
 *
 * When the keyboard opens, the shell gets lower by the height of the
 * keyboard (styles/base.css, --m-vh). The field that was just tapped then
 * often lies under the footer or under the new lower edge of the scrolling
 * area: the engine scrolled it into view BEFORE the keyboard was there and
 * does not look again. Measured on a phone on five fields, among them the
 * account password and the Hugging Face token (acceptance android-knoepfe,
 * finding M9).
 *
 * One answer for every page and every sheet: after a focus and after every
 * change of the visible height, each scrolling ancestor of the field is
 * moved so that the whole field, with its label above and its hint below,
 * lies inside it. A field that is higher than the room shows its first line.
 * Nothing moves when the field is in sight already, so a user who scrolls
 * while typing is left alone.
 *
 * A field can name what belongs to it: an ancestor with `data-m-field-group`
 * is kept in sight as a whole, for a field whose button stands right under
 * it ("Save key"). Without that the button lay under the fixed footer for as
 * long as the keyboard was open (acceptance on the small iPhone, round 5, N9).
 * A group that does not fit falls back to label, field and hint, then to the
 * field alone.
 *
 * A field of several lines (TextArea of the kit) is never higher than the
 * room it is shown in. On a phone on its side the keyboard leaves about 130
 * px, and a field of twelve rows lay partly under it (acceptance Android,
 * re-run, N8). While it has the focus such a field is capped to the visible
 * height of what scrolls around it, less its label and hint when those fit
 * too. Its text then scrolls inside the field and the line with the caret is
 * put in sight. The cap goes when the room is back or the focus leaves.
 */

export interface Span {
  top: number
  bottom: number
}

/** Room kept between the field and the edge of the scrolling area. */
export const FIELD_MARGIN_PX = 12

/**
 * Pure: how far to scroll (positive: content moves up) so that `field` lies
 * inside `view`. 0 when it does already. A field higher than the view is
 * aligned at its top.
 */
export function scrollDelta(field: Span, view: Span, margin = FIELD_MARGIN_PX): number {
  const top = view.top + margin
  const bottom = view.bottom - margin
  const room = bottom - top
  const height = field.bottom - field.top
  if (room <= 0) return 0
  if (height >= room) return Math.abs(field.top - top) < 1 ? 0 : field.top - top
  if (field.bottom > bottom) return field.bottom - bottom
  if (field.top < top) return field.top - top
  return 0
}

function isField(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT') return !['button', 'checkbox', 'radio', 'range', 'file', 'submit', 'reset', 'color'].includes((el.getAttribute('type') || 'text').toLowerCase())
  return el.isContentEditable
}

function scrollsY(el: HTMLElement): boolean {
  const overflow = getComputedStyle(el).overflowY
  return overflow === 'auto' || overflow === 'scroll'
}

/** The mark a page puts around a field and the button that belongs to it. */
export const FIELD_GROUP_ATTR = 'data-m-field-group'

/**
 * What has to be in sight, widest first: the group the page marked, the field with its label and hint (the Field
 * component wraps them), the frame of a field of several lines, the field alone. The first one that fits into the
 * room is taken.
 */
export function targetsOf(field: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  const group = field.closest<HTMLElement>(`[${FIELD_GROUP_ATTR}]`)
  if (group) out.push(group)
  const set = field.closest<HTMLElement>('.m-fieldset')
  if (set) out.push(set)
  // A field of several lines is drawn by its frame, so the frame stands for the field: under a keyboard on a
  // phone on its side it is what fits (fitFieldHeight).
  out.push(field.closest<HTMLElement>('.m-textarea') ?? field)
  return out
}

/** Bring the field into the visible part of every scrolling ancestor. Returns whether anything moved. */
export function keepFieldInView(field: HTMLElement): boolean {
  let moved = false
  const targets = targetsOf(field)
  const target = targets[0]
  const viewportBottom = (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? window.innerHeight)
  for (let el = target.parentElement; el && el !== document.body; el = el.parentElement) {
    if (!scrollsY(el)) continue
    const box = el.getBoundingClientRect()
    const view = { top: box.top, bottom: Math.min(box.bottom, viewportBottom) }
    // The widest of them that fits with its margin. In a room so low that none does (a sheet above the keyboard of
    // a phone on its side), the widest that fits at all, with the margin that is left. Otherwise the field itself.
    const room = view.bottom - view.top
    const heightOf = (t: HTMLElement) => t.getBoundingClientRect().height
    const roomy = targets.find((t) => heightOf(t) + 2 * FIELD_MARGIN_PX <= room)
    const fitting = roomy ?? targets.find((t) => heightOf(t) <= room) ?? targets[targets.length - 1]
    const rect = fitting.getBoundingClientRect()
    const margin = roomy ? FIELD_MARGIN_PX : Math.max(0, Math.min(FIELD_MARGIN_PX, (room - rect.height) / 2))
    const delta = scrollDelta({ top: rect.top, bottom: rect.bottom }, view, margin)
    if (Math.abs(delta) < 1) continue
    const before = el.scrollTop
    el.scrollTop = before + delta
    if (el.scrollTop !== before) moved = true
  }
  return moved
}

/** The mark and the style a capped field carries (styles/components.css lifts its minimum height by the mark). */
export const FIELD_CAPPED_ATTR = 'data-m-capped'

export interface CapInput {
  /** Visible height of the scrolling area around the field. */
  room: number
  /** Height the field has without a cap. */
  natural: number
  /** What label, hint and frame add to the field (height of the whole field set less the field). */
  around: number
  /** What the frame alone adds (padding and border around the textarea). */
  frame: number
  /** Height of one line of text in the field. */
  line: number
}

/**
 * Pure: the height a field of several lines may have, or null when it fits
 * as it is. With label and hint when at least two lines are left then,
 * otherwise the field with its frame alone, in a very low room without the
 * margin. Never under one line.
 */
export function fieldHeightCap(input: CapInput, margin = FIELD_MARGIN_PX): number | null {
  const { room, natural, around, frame } = input
  const line = input.line > 0 ? input.line : 20
  if (!(room > 0) || !(natural > 0)) return null
  const free = room - 2 * margin
  if (natural + around <= free) return null
  const withAll = free - around
  // In a room too low for one line with a margin, the margin gives way.
  const cap = withAll >= 2 * line ? withAll : free - frame >= line ? free - frame : room - frame
  return Math.max(Math.ceil(line), Math.floor(Math.min(cap, natural)))
}

/**
 * The mark of a field of several lines that is not drawn by the TextArea of the kit and follows the same rule:
 * while it has the focus it is never higher than the room it is shown in. The page that edits an answer has such
 * a field, as tall as its text, and with the keyboard open a part of it lay under the keyboard (check 4 on
 * Android, F9: upright at the largest text, and on its side).
 */
export const FIELD_FITS_ROOM_ATTR = 'data-m-fits-room'

function isCappable(field: HTMLElement): field is HTMLTextAreaElement {
  if (field.tagName !== 'TEXTAREA') return false
  if (field.closest('.m-textarea')) return true
  // Only under the keyboard: without it such a field is as tall as its text and the page scrolls, as before.
  return field.hasAttribute(FIELD_FITS_ROOM_ATTR) && document.documentElement.classList.contains('m-kb-open')
}

/** The nearest ancestor that scrolls, and the part of it the user sees. */
function roomAround(field: HTMLElement): number | null {
  const viewportBottom = (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? window.innerHeight)
  for (let el = field.parentElement; el && el !== document.body; el = el.parentElement) {
    if (!scrollsY(el)) continue
    const box = el.getBoundingClientRect()
    return Math.min(box.bottom, viewportBottom) - box.top
  }
  return null
}

/**
 * Where the line with the caret starts inside the text of the field, in px
 * from the top of the text. A textarea does not tell, so the text up to the
 * caret is laid out once more in a box of the same width and type.
 */
function caretTop(field: HTMLTextAreaElement): number {
  const style = getComputedStyle(field)
  const mirror = document.createElement('div')
  for (const name of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'textIndent', 'tabSize', 'paddingLeft', 'paddingRight', 'paddingTop', 'borderLeftWidth', 'borderRightWidth', 'boxSizing'] as const) {
    mirror.style[name] = style[name]
  }
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  mirror.style.top = '0'
  mirror.style.left = '-9999px'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.width = `${field.clientWidth}px`
  mirror.textContent = field.value.slice(0, field.selectionEnd ?? field.value.length)
  const mark = document.createElement('span')
  mark.textContent = '\u200b'
  mirror.appendChild(mark)
  document.body.appendChild(mirror)
  const top = mark.offsetTop
  mirror.remove()
  return top
}

function lineHeightOf(field: HTMLElement): number {
  const style = getComputedStyle(field)
  const line = parseFloat(style.lineHeight)
  return Number.isFinite(line) && line > 0 ? line : (parseFloat(style.fontSize) || 16) * 1.45
}

/** Take the cap off a field. */
export function releaseFieldHeight(field: HTMLElement): void {
  if (!field.hasAttribute(FIELD_CAPPED_ATTR)) return
  field.removeAttribute(FIELD_CAPPED_ATTR)
  field.style.maxHeight = ''
}

/**
 * Cap a field of several lines to the room it is shown in, or take the cap
 * off when it fits again. Returns the cap in px, or null without one.
 */
export function fitFieldHeight(field: HTMLElement): number | null {
  if (!isCappable(field)) {
    // The keyboard went: a field that was capped under it is as tall as its text again.
    releaseFieldHeight(field)
    return null
  }
  const room = roomAround(field)
  if (room === null) {
    releaseFieldHeight(field)
    return null
  }
  const had = field.hasAttribute(FIELD_CAPPED_ATTR) ? field.style.maxHeight : ''
  const scrolled = field.scrollTop
  // Measured without the cap: what the field wants, and what stands around it.
  field.removeAttribute(FIELD_CAPPED_ATTR)
  field.style.maxHeight = ''
  const natural = field.getBoundingClientRect().height
  const frame = (field.closest<HTMLElement>('.m-textarea')?.getBoundingClientRect().height ?? natural) - natural
  const around = (field.closest<HTMLElement>('.m-fieldset')?.getBoundingClientRect().height ?? natural + frame) - natural
  const line = lineHeightOf(field)
  const cap = fieldHeightCap({ room, natural, around: Math.max(around, frame), frame, line })
  if (cap === null) return null
  field.setAttribute(FIELD_CAPPED_ATTR, '')
  field.style.maxHeight = `${cap}px`
  field.scrollTop = scrolled
  // A new cap can leave the caret outside of what is shown. Looked at only then: a reader who scrolls inside
  // the field while the room stays the same is left alone.
  if (had !== field.style.maxHeight) {
    const top = caretTop(field)
    const shown = field.clientHeight
    if (top < field.scrollTop) field.scrollTop = top
    else if (top + line > field.scrollTop + shown) field.scrollTop = top + line - shown
  }
  return cap
}

let installed = false

/**
 * Start watching. Safe to call more than once. The keyboard takes up to a
 * third of a second to arrive and the shell follows it a frame later, so the
 * field is looked at several times after each signal.
 */
export function installFieldInView(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  let timers: number[] = []
  const look = () => {
    const el = document.activeElement
    if (!isField(el)) return
    // First the height, then the place: a capped field is what has to be in sight.
    fitFieldHeight(el)
    keepFieldInView(el)
  }
  const schedule = () => {
    for (const t of timers) window.clearTimeout(t)
    timers = [0, 120, 350, 600].map((ms) => window.setTimeout(() => requestAnimationFrame(look), ms))
  }
  document.addEventListener('focusin', (event) => {
    if (isField(event.target as Element | null)) schedule()
  })
  document.addEventListener('focusout', (event) => {
    if (event.target instanceof HTMLElement) releaseFieldHeight(event.target)
  })
  window.addEventListener('resize', schedule)
  window.addEventListener('orientationchange', schedule)
  window.visualViewport?.addEventListener('resize', schedule)
}
