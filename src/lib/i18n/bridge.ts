/**
 * Applies the dictionary to what is actually on screen.
 *
 * This is what makes the fork mergeable: no component carries a `t('…')` call,
 * so `git merge upstream/master` never has to resolve a translated line. The
 * bridge walks the rendered DOM instead — text nodes and a short whitelist of
 * attributes — and replaces whatever the dictionary knows.
 *
 * Rules that keep it from doing damage:
 *   - It never guesses. A miss leaves the English text exactly as it was.
 *   - It skips code (`CODE`, `PRE`, `KBD`, `SAMP`, `SCRIPT`, `STYLE`,
 *     `TEXTAREA`) and anything under `[data-no-i18n]`. Paths, model names and
 *     snippets live in exactly those places.
 *   - It is idempotent: replacing "Save" with "保存" produces text the
 *     dictionary does not know, so the observer's own mutation cannot loop.
 *   - It is installed only in Chinese mode. Tests run English and never touch
 *     it (see src/lib/i18n/index.ts), which is why 1660 unit tests keep passing.
 */

import { translate } from './pack'

/** Put this on any subtree that must render verbatim (a path, a model id). */
export const NO_TRANSLATE_ATTR = 'data-no-i18n'

const SKIP_TAGS = new Set(['CODE', 'PRE', 'KBD', 'SAMP', 'SCRIPT', 'STYLE', 'TEXTAREA'])
/**
 * For attributes the rules are narrower: a textarea's placeholder is UI copy
 * and must be translated, while its *value* is what the user typed and is never
 * touched (only the four attributes below are ever written).
 */
const ATTR_SKIP_TAGS = new Set(['CODE', 'PRE', 'KBD', 'SAMP', 'SCRIPT', 'STYLE'])
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'] as const

let installed = false
let observer: MutationObserver | null = null
let scheduled = false
let applying = false
const pending = new Set<Node>()

function isSkipped(element: Element | null, forAttributes = false): boolean {
  if (!element) return true
  if (element.closest(`[${NO_TRANSLATE_ATTR}]`) !== null) return true
  return (forAttributes ? ATTR_SKIP_TAGS : SKIP_TAGS).has(element.tagName)
}

/** Returns true when the node actually changed. */
function translateTextNode(node: Text): boolean {
  if (isSkipped(node.parentElement)) return false
  const raw = node.nodeValue ?? ''
  // JSX text that wrapped over several lines carries its indentation; the
  // dictionary is keyed by the sentence, so collapse first and put the
  // original leading/trailing whitespace back afterwards.
  const key = raw.replace(/\s+/g, ' ').trim()
  if (!key) return false
  const chinese = translate(key)
  if (chinese === null || chinese === key) return false
  const lead = raw.slice(0, raw.length - raw.trimStart().length)
  const trail = raw.slice(raw.trimEnd().length)
  node.nodeValue = `${lead}${chinese}${trail}`
  return true
}

function translateAttributes(element: Element): boolean {
  if (isSkipped(element, true)) return false
  let changed = false
  for (const name of ATTRS) {
    const value = element.getAttribute(name)
    if (!value) continue
    const chinese = translate(value.replace(/\s+/g, ' ').trim())
    if (chinese === null || chinese === value) continue
    element.setAttribute(name, chinese)
    changed = true
  }
  return changed
}

function walkTextNodes(root: Node, visit: (node: Text) => void): void {
  const doc = root.ownerDocument ?? document
  if (root.nodeType === Node.TEXT_NODE) {
    visit(root as Text)
    return
  }
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    visit(current as Text)
    current = walker.nextNode()
  }
}

/** One pass over a subtree. Exported for tests and for the initial sweep. */
export function translateWithin(root: Node): number {
  if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root as Element)
  let changed = 0
  walkTextNodes(root, (node) => {
    if (translateTextNode(node)) changed += 1
  })
  if (root.nodeType === Node.ELEMENT_NODE) {
    for (const element of (root as Element).querySelectorAll('*')) {
      if (translateAttributes(element)) changed += 1
    }
  }
  return changed
}

function flush(): void {
  scheduled = false
  applying = true
  try {
    for (const node of pending) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text)
      else if (node.nodeType === Node.ELEMENT_NODE) translateWithin(node)
    }
  } finally {
    pending.clear()
    applying = false
  }
}

/**
 * Start translating. Safe to call twice; the second call is a no-op, which
 * matters because `applyDocumentLocale()` may run on every boot path (the main
 * window and the onboarding window are different documents).
 */
export function installI18nBridge(): void {
  if (installed) return
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (!document.body) return

  installed = true
  translateWithin(document.body)

  observer = new MutationObserver((records) => {
    // Our own writes arrive back as mutations; ignoring them is what keeps a
    // five-line list from turning into an endless translate/settle loop.
    if (applying) return
    for (const record of records) {
      if (record.type === 'characterData' || record.type === 'attributes') pending.add(record.target)
      for (const node of record.addedNodes) pending.add(node)
    }
    if (pending.size === 0 || scheduled) return
    scheduled = true
    queueMicrotask(flush)
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    // A placeholder or a title is often set after mount, when the state that
    // decides it arrives. Without this the dictionary had the string and the
    // screen still showed English.
    attributes: true,
    attributeFilter: [...ATTRS],
  })
}

/** For tests, and for a future "switch back to English without a reload". */
export function uninstallI18nBridge(): void {
  observer?.disconnect()
  observer = null
  pending.clear()
  scheduled = false
  installed = false
}

export function isBridgeInstalled(): boolean {
  return installed
}
