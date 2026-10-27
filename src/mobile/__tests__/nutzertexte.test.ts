/**
 * Words the phone never shows, and one character nobody writes here.
 *
 * - "click": a phone is tapped.
 * - The names of the desktop engines: the phone has its own engine and the
 *   cloud, the user never meets the three desktop programs.
 * - Long dashes, in texts, comments and styles alike.
 *
 * The words are looked for in string literals and JSX text, not in
 * identifiers: `onClick` and a provider id like 'ollama' are code.
 */
import { describe, expect, it } from 'vitest'
import { MOBILE_DIR, shownTexts, sourceFiles } from './scan'

// Written as escapes so this file passes its own rule.
const DASHES = /[\u2012\u2013\u2014\u2015]/

const WORDS: readonly { name: string; re: RegExp }[] = [
  { name: 'click', re: /(?<![A-Za-z0-9_.$])click(s|ed|ing|able)?(?![A-Za-z0-9_$(])/i },
  { name: 'Ollama', re: /(?<![A-Za-z0-9_$./-])Ollama(?![A-Za-z0-9_$])/ },
  { name: 'LM Studio', re: /\bLM\s?Studio\b/i },
  { name: 'ComfyUI', re: /(?<![A-Za-z0-9_$./-])Comfy\s?UI(?![A-Za-z0-9_$])/ },
]

/** Event and attribute names that are code although they sit in a string. */
const CODE_STRINGS = new Set(['click', 'dblclick'])

describe('texts of the mobile shell', () => {
  const code = sourceFiles(MOBILE_DIR, ['.ts', '.tsx'])
  const all = sourceFiles(MOBILE_DIR, ['.ts', '.tsx', '.css', '.md'])

  it('finds the mobile sources', () => {
    expect(code.length).toBeGreaterThan(100)
    expect(all.some((f) => f.rel.endsWith('.css'))).toBe(true)
  })

  it('has no long dash anywhere', () => {
    const hits: string[] = []
    for (const file of all) {
      file.text.split('\n').forEach((line, i) => {
        if (DASHES.test(line)) hits.push(`${file.rel}:${i + 1}`)
      })
    }
    expect(hits).toEqual([])
  })

  it('never says click and never names a desktop engine', () => {
    const hits: string[] = []
    for (const file of code) {
      for (const text of shownTexts(file)) {
        if (CODE_STRINGS.has(text)) continue
        for (const word of WORDS) {
          if (word.re.test(text)) hits.push(`${file.rel}: "${text.trim().slice(0, 60)}" (${word.name})`)
        }
      }
    }
    expect(hits).toEqual([])
  })

  it('the word rules catch what they are meant to catch', () => {
    const find = (text: string) => WORDS.filter((w) => w.re.test(text)).map((w) => w.name)
    expect(find('Click here to start')).toEqual(['click'])
    expect(find('Double clicking opens it')).toEqual(['click'])
    expect(find('Start Ollama first')).toEqual(['Ollama'])
    expect(find('Open LM Studio')).toEqual(['LM Studio'])
    expect(find('ComfyUI is not running')).toEqual(['ComfyUI'])
    expect(find('Tap to start')).toEqual([])
    expect(find('ollama')).toEqual([])
    expect(DASHES.test('a \u2014 b')).toBe(true)
    expect(DASHES.test('a - b')).toBe(false)
  })
})
