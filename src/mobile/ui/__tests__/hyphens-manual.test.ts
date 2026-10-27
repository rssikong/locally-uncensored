/**
 * Words are not cut by the engine (acceptance iPhone, K7).
 *
 * With hyphens: auto a phone cut words that had a line to themselves
 * ("docu-ments", "pass-word?", "Uncen-sored"). The shell brings its own
 * break points for long words (ui/hyphenate.tsx) and asks the engine for
 * nothing more. This test keeps it that way in every stylesheet of the shell.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HYPHEN_MIN_WORD, UNBROKEN, hyphenParts, hyphenPoints } from '../hyphenate'

const ROOT = join(__dirname, '..', '..')

function stylesheets(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...stylesheets(path))
    else if (name.endsWith('.css')) out.push(path)
  }
  return out
}

describe('hyphenation is the shell\'s own', () => {
  const files = stylesheets(ROOT)

  it('finds the stylesheets of the shell', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it('no stylesheet asks the engine to hyphenate', () => {
    const found: string[] = []
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(-webkit-)?hyphens:\s*auto\b/.test(line)) found.push(`${relative(ROOT, file)}:${i + 1}`)
        })
    }
    expect(found).toEqual([])
  })

  it('a title that takes break points says hyphens: manual, so the marks of the shell work', () => {
    const css = readFileSync(join(ROOT, 'styles', 'components.css'), 'utf8')
    for (const selector of ['.m-row-title', '.m-sheet-title', '.m-dlg-title', '.m-empty-title', '.m-card-title']) {
      const at = css.indexOf(`\n${selector} {`)
      expect(at, selector).toBeGreaterThan(-1)
      const rule = css.slice(at, css.indexOf('}', at))
      expect(rule, selector).toMatch(/\n\s*hyphens: manual;/)
      // The last resort for a word wider than a whole line.
      expect(rule, selector).toMatch(/overflow-wrap: (break-word|anywhere);/)
    }
  })

  it('the words the phone cut are left whole: they are shorter than a word the shell breaks', () => {
    for (const word of ['documents', 'Uncensored', 'downloads', 'password', 'characters', 'Character']) {
      expect(word.length, word).toBeLessThan(HYPHEN_MIN_WORD)
      expect(hyphenPoints(word), word).toEqual([])
    }
  })

  it('a name of the product is never cut, also inside a longer word', () => {
    expect(UNBROKEN).toContain('uncensored')
    for (const word of ['Uncensored', 'UNCENSORED', 'LocallyUncensored', 'Uncensoredness']) {
      expect(hyphenParts(word), word).toEqual([word])
    }
    // The check does not switch the rule off for other long words.
    expect(hyphenParts('Troubleshooting').length).toBeGreaterThan(1)
  })
})
