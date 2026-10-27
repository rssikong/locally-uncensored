// Where the LoRA stack was left: the search and how far the list was
// scrolled. The drawer unmounts its content when it closes, so the list came
// back at the top and the search was gone, after a close on purpose as much as
// after a click beside the drawer (Discord 2026-10-23). Kept for as long as
// the app runs, not on disk: a new start opens the stack at the top.

interface LoraStackView {
  query: string
  scrollTop: number
}

const view: LoraStackView = { query: '', scrollTop: 0 }

export function loraStackView(): Readonly<LoraStackView> {
  return view
}

/** A new search starts the list at the top again. */
export function setLoraStackQuery(query: string): void {
  if (query !== view.query) view.scrollTop = 0
  view.query = query
}

export function setLoraStackScroll(scrollTop: number): void {
  view.scrollTop = Math.max(0, scrollTop)
}

/** For tests: the state of a fresh start. */
export function resetLoraStackView(): void {
  view.query = ''
  view.scrollTop = 0
}
