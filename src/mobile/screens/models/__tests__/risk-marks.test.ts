/**
 * Duty 6 of the acceptance frame: what removes something for good carries the
 * risk mark. The mark is written by the UI kit from the `risk` prop, so this
 * guard reads the sources: every target on the list has the prop in its tag.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DESTRUCTIVE_TARGETS, riskMark } from '../parts/risk'

const root = path.resolve(__dirname, '..')
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) sources(full, out)
    else if (entry.name.endsWith('.tsx')) out.push(fs.readFileSync(full, 'utf8'))
  }
  return out
}
const all = sources(root).join('\n')

/** The JSX tag a testid sits in: from the last "<Name" before it to the testid. */
function tagBefore(code: string, at: number): string {
  const start = Math.max(code.lastIndexOf('<Row', at), code.lastIndexOf('<Button', at), code.lastIndexOf('<IconButton', at))
  return code.slice(start, at)
}

describe('risk marks of models and onboarding', () => {
  it('hands the kit the prop it reads', () => {
    expect(riskMark('destructive')).toEqual({ risk: 'destructive' })
  })

  it.each(DESTRUCTIVE_TARGETS)('%s is marked destructive', (target) => {
    const needle = target.startsWith('t(') ? `testid={${target}}` : `testid="${target}"`
    const at = all.indexOf(needle)
    expect(at, `${target} is not in the sources any more`).toBeGreaterThan(-1)
    expect(all.indexOf(needle, at + 1), `${target} is used twice`).toBe(-1)
    expect(tagBefore(all, at)).toContain("{...riskMark('destructive')}")
  })

  it('nothing that deletes, clears, resets or removes is left without the mark', () => {
    const ids = [...all.matchAll(/testid="(m-[a-z0-9-]+)"/g)].map((m) => m[1])
    const risky = ids.filter((id) => /-(delete|clear|reset|remove|forget|wipe)$/.test(id))
    // Emptying a search field or a filter removes nothing.
    const harmless = new Set(['m-models-search-clear', 'm-models-filter-clear'])
    const listed = new Set<string>(DESTRUCTIVE_TARGETS)
    expect(risky.filter((id) => !harmless.has(id) && !listed.has(id))).toEqual([])
  })
})
