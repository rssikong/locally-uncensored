/**
 * An answer that is stored and draws nothing.
 *
 * Check on the iPhone, round 23, N16: after a question that was too long, one of the next short answers
 * was a blank bubble with only the buttons "Report" and "More". The stored text was not empty, so the chat
 * took it for an answer, and it drew nothing (characters without a width, markup that has no picture).
 * An answer that shows no word is an empty answer and says so, with the way to ask again.
 */
import { useLayoutEffect, useState, type RefObject } from 'react'

/** Characters that take no room: zero width spaces and joiners, direction marks, the byte order mark, the soft hyphen. */
const NO_WIDTH = new RegExp(
  ['\\u00ad', '\\u034f', '\\u061c', '\\u115f', '\\u1160', '\\u17b4', '\\u17b5', '\\u180e', '[\\u200b-\\u200f]', '[\\u202a-\\u202e]', '[\\u2060-\\u206f]', '\\u3164', '\\ufeff', '\\uffa0'].join('|'),
  'g',
)

/** Pure: does this text hold anything a reader could see? Blanks and characters without a width are nothing. */
export function holdsVisibleText(text: string): boolean {
  return text.replace(NO_WIDTH, '').trim().length > 0
}

/** What counts as something drawn although it has no letters: a picture, a table, a rule, a code block, a formula. */
const DRAWN = 'img, svg, table, hr, video, audio, canvas, pre, .katex, .math, input'

/** The element draws a word or a picture. Reads the document, so it is not pure. */
export function drawsSomething(el: Element): boolean {
  if (holdsVisibleText(el.textContent ?? '')) return true
  return !!el.querySelector(DRAWN)
}

/**
 * True once the answer is on screen and draws nothing. Looks again whenever the element changes (a formula
 * or a code block that is drawn later), so an answer that fills in late is never taken for empty.
 */
export function useDrawsNothing(ref: RefObject<HTMLElement | null>, active: boolean, key: string): boolean {
  const [blank, setBlank] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!active || !el) return
    const look = () => setBlank(!drawsSomething(el))
    look()
    if (typeof MutationObserver === 'undefined') return
    const watch = new MutationObserver(look)
    watch.observe(el, { childList: true, subtree: true, characterData: true })
    return () => watch.disconnect()
  }, [ref, active, key])
  return active && blank
}
