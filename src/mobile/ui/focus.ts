/**
 * Focus handling for sheets and dialogs (DESIGN.md 10): the focus moves in
 * when the layer opens, Tab stays inside, and it goes back to the element
 * that opened the layer when it closes.
 */
import { useEffect, type RefObject } from 'react'

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getAttribute('aria-hidden') !== 'true' && !el.closest('[inert]'),
  )
}

/** Pure: which element gets the focus when Tab is pressed at the edge of a trap, or null to let the browser move on. */
export function trapTarget<T>(items: readonly T[], active: T | null, backwards: boolean): T | null {
  if (items.length === 0) return null
  const first = items[0]
  const last = items[items.length - 1]
  if (active === null || !items.includes(active)) return backwards ? last : first
  if (backwards && active === first) return last
  if (!backwards && active === last) return first
  return null
}

/**
 * Put the caret behind the text of a field. A field that is focused by the app, with a text
 * already in it, is there to be continued: with the caret in front, the first typed word
 * landed before the old text (acceptance on Android, N5).
 */
export function caretToEnd(el: Element | null | undefined): void {
  if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement)) return
  const end = el.value.length
  if (end === 0) return
  try {
    el.setSelectionRange(end, end)
  } catch {
    /* a field without a caret, like a number field */
  }
}

/**
 * Trap the focus inside `ref` while `active`.
 * `initial` picks the element to focus first; default is the element marked
 * data-m-autofocus, then the title (data-m-focus-title), then the container.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const root = ref.current
    if (!active || !root) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first =
      root.querySelector<HTMLElement>('[data-m-autofocus]') ??
      root.querySelector<HTMLElement>('[data-m-focus-title]') ??
      root
    first.focus({ preventScroll: true })
    caretToEnd(first)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = focusableIn(root)
      const current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const target = trapTarget(items, current && root.contains(current) ? current : null, event.shiftKey)
      if (target) {
        event.preventDefault()
        target.focus()
      } else if (items.length === 0) {
        event.preventDefault()
      }
    }
    root.addEventListener('keydown', onKeyDown)
    return () => {
      root.removeEventListener('keydown', onKeyDown)
      // Back to whoever opened the layer, if it is still there.
      if (opener && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [ref, active])
}
