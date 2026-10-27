/**
 * The colour tokens: dark and light define the same set of keys, and the
 * values are the ones in the table of mobile-docs/design/DESIGN.md 7.1.
 *
 * A key that exists in one theme only shows up as a missing colour on a
 * phone in the other theme, usually on a screen nobody looked at twice.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STYLES = path.resolve(HERE, '..')
const css = fs.readFileSync(path.join(STYLES, 'tokens.css'), 'utf8')
const DESIGN = path.resolve(STYLES, '../../../mobile-docs/design/DESIGN.md')

function block(marker: string): Map<string, string> {
  const start = css.indexOf(`/* tokens:${marker} */`)
  if (start === -1) throw new Error(`marker tokens:${marker} is missing in tokens.css`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('\n}', open)
  const body = css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '')
  const out = new Map<string, string>()
  for (const m of body.matchAll(/(--m-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (out.has(m[1])) throw new Error(`${m[1]} is declared twice in tokens:${marker}`)
    out.set(m[1], m[2].trim())
  }
  return out
}

/** "rgba(0,0,0,.55)" and "rgba(0, 0, 0, 0.55)" are the same colour. */
function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(^|[^0-9])\.(\d)/g, '$10.$2')
    .replace(/(\.\d*?)0+(?=[,)])/g, '$1')
}

const shared = block('shared')
const dark = block('dark')
const light = block('light')

describe('tokens.css', () => {
  it('has the three blocks with content', () => {
    expect(shared.size).toBeGreaterThan(30)
    expect(dark.size).toBeGreaterThan(20)
  })

  it('dark and light define the same keys', () => {
    expect([...light.keys()].sort()).toEqual([...dark.keys()].sort())
  })

  it('no theme key is also a shared key', () => {
    expect([...dark.keys()].filter((k) => shared.has(k))).toEqual([])
  })

  it('light is scoped to the light class, dark is the default', () => {
    expect(css).toMatch(/\/\* tokens:dark \*\/\s*html\[data-shell='mobile'\]\s*\{/)
    expect(css).toMatch(/\/\* tokens:light \*\/\s*html\[data-shell='mobile'\]\.light\s*\{/)
  })

  it('every token carries the prefix --m- and nothing leaks to :root', () => {
    expect(css).not.toMatch(/:root/)
    const names = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])
    expect(names.filter((n) => !n.startsWith('--m-'))).toEqual([])
  })

  it('sizes of type are rem, spacing and targets are px', () => {
    for (const [key, value] of shared) {
      if (key.startsWith('--m-text-')) expect(value, key).toMatch(/rem/)
      if (/^--m-s\d$/.test(key)) expect(value, key).toMatch(/^\d+px$/)
    }
    expect(shared.get('--m-touch')).toBe('44px')
  })
})

/**
 * Where tokens.css leaves the table on purpose. Nowhere at the moment: the
 * one deviation, --m-warn as a calm grey instead of a yellow, was decided on
 * 08.10.2026 and written into the table (the app has a rule against yellow
 * notes, src/lib/hinweis.ts, and it holds on the phone too).
 */
const DEVIATIONS: Record<string, { dark: string; light: string }> = {}

describe('tokens against DESIGN.md 7.1', () => {
  const design = fs.readFileSync(DESIGN, 'utf8')
  const rows = [...design.matchAll(/^\|\s*`(--m-[a-z0-9-]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/gm)]

  it('finds the colour table', () => {
    expect(rows.length).toBeGreaterThanOrEqual(20)
  })

  it('every colour of the table has exactly its value in both themes', () => {
    const wrong: string[] = []
    for (const [, key, tableDark, tableLight] of rows) {
      const darkValue = DEVIATIONS[key]?.dark ?? tableDark
      const lightValue = DEVIATIONS[key]?.light ?? tableLight
      if (!dark.has(key)) {
        wrong.push(`${key} is missing`)
        continue
      }
      if (norm(dark.get(key) ?? '') !== norm(darkValue)) wrong.push(`${key} dark: ${dark.get(key)} instead of ${darkValue}`)
      if (norm(light.get(key) ?? '') !== norm(lightValue)) wrong.push(`${key} light: ${light.get(key)} instead of ${lightValue}`)
    }
    expect(wrong).toEqual([])
  })

  it('the note colour is the calm grey of the table, never a yellow', () => {
    const warn = rows.find((r) => r[1] === '--m-warn')
    expect(warn?.[2]).toBe('#9ca3af')
    expect(warn?.[3]).toBe('#4b5563')
  })

  it('leaves the table only where it says so', () => {
    expect(Object.keys(DEVIATIONS)).toEqual([])
    for (const key of Object.keys(DEVIATIONS)) expect(rows.some((r) => r[1] === key), key).toBe(true)
  })
})
