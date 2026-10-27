/**
 * The table of fence tags (ui/highlight.ts) and the grammars that are really
 * registered (ui/highlight-code.tsx) are two lists in two files, because the
 * second one is loaded on demand. This holds them together: a tag that maps
 * to a grammar nobody registered would be coloured as plain text without
 * anyone noticing.
 */
import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_GRAMMARS, highlightLanguage } from '../highlight'
import { GRAMMARS } from '../highlight-code'

describe('grammars of the code blocks', () => {
  it('every grammar the table names is registered, and none is registered for nothing', () => {
    expect(Object.keys(GRAMMARS).sort()).toEqual([...HIGHLIGHT_GRAMMARS])
  })

  it('every registered grammar answers to its own name', () => {
    for (const name of Object.keys(GRAMMARS)) expect(highlightLanguage(name), name).toBe(name)
  })
})
