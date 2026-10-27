/**
 * The route table and the sheet table: every entry has its file, every
 * screen its own test id, every tab its root. The files are named in
 * nav/loaders.ts, apart from the tables.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ROUTES, ROUTE_IDS } from '../routes'
import { SHEETS, SHEET_IDS } from '../sheets'
import { ROUTE_LOADERS, SHEET_LOADERS } from '../loaders'
import { FLOW_FIRST_ROUTES, NEW_CHAT_ROUTE, TAB_ROOT_ROUTES } from '../roots'
import { TABS } from '../types'
import type { RouteDef, SheetDef } from '../define'

const NAV = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MOBILE = path.resolve(NAV, '..')
const STRANDS = ['chat', 'agent', 'create', 'onboarding', 'models', 'settings', 'remote'] as const

const routes = ROUTES as Record<string, RouteDef>
const sheets = SHEETS as Record<string, SheetDef>

function loaderTargets(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8')
  // Comments carry examples of loaders; only real code counts.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return [...code.matchAll(/import\(\s*'([^']+)'\s*\)/g)].map((m) => path.resolve(path.dirname(file), m[1]))
}

function exists(base: string): boolean {
  return ['.tsx', '.ts', '/index.tsx', '/index.ts'].some((end) => fs.existsSync(base + end))
}

describe('route table', () => {
  it('knows the pages of the design', () => {
    expect(ROUTE_IDS.length).toBeGreaterThanOrEqual(57)
  })

  it('has a root for each of the four tabs', () => {
    for (const tab of TABS) {
      const def = routes[TAB_ROOT_ROUTES[tab]]
      expect(def, tab).toBeDefined()
      expect(def.kind).toBe('root')
      expect(def.tab).toBe(tab)
    }
    const roots = Object.values(routes).filter((r) => r.kind === 'root')
    expect(roots).toHaveLength(4)
  })

  it('knows the first page of the onboarding and the new chat', () => {
    expect(routes[FLOW_FIRST_ROUTES.onboarding]?.kind).toBe('flow')
    expect(routes[NEW_CHAT_ROUTE]).toBeDefined()
  })

  it('gives every screen its own test id', () => {
    const seen = new Map<string, string>()
    const twice: string[] = []
    for (const [id, def] of Object.entries(routes)) {
      const other = seen.get(def.screen)
      if (other) twice.push(`${def.screen}: ${other} and ${id}`)
      seen.set(def.screen, id)
      expect(def.screen, id).toMatch(/^[a-z][a-z0-9-]*$/)
    }
    expect(twice).toEqual([])
  })

  it('route ids are paths with named parts', () => {
    for (const id of ROUTE_IDS) expect(id).toMatch(/^(\/(:[A-Za-z]+|[a-z][a-z0-9-]*))+$/)
  })

  it('developer pages are marked and nothing else lives under /dev', () => {
    for (const [id, def] of Object.entries(routes)) expect(!!def.dev, id).toBe(id.startsWith('/dev/'))
  })

  it('titles are short English names without a full stop', () => {
    for (const [id, def] of Object.entries(routes)) {
      expect(def.title.length, id).toBeGreaterThan(0)
      expect(def.title.length, id).toBeLessThanOrEqual(28)
      expect(def.title.endsWith('.'), id).toBe(false)
    }
  })
})

describe('sheet table', () => {
  it('knows the sheets of the design', () => {
    expect(SHEET_IDS.length).toBeGreaterThanOrEqual(15)
    for (const id of SHEET_IDS) expect(id).toMatch(/^[a-z][a-z0-9-]*$/)
  })

  it('only the approval of a step cannot be swiped away', () => {
    expect(Object.entries(sheets).filter(([, s]) => s.locked).map(([id]) => id)).toEqual(['approval'])
  })
})

describe('files behind the tables', () => {
  const loaderFiles = [path.join(NAV, 'loaders.ts')]
  const tables = [path.join(NAV, 'routes.ts'), path.join(NAV, 'sheets.ts')]
  for (const strand of STRANDS) {
    tables.push(path.join(MOBILE, 'screens', strand, 'routes.ts'), path.join(MOBILE, 'screens', strand, 'sheets.ts'))
    loaderFiles.push(path.join(MOBILE, 'screens', strand, 'loaders.ts'))
  }

  it('every strand has its registries', () => {
    for (const file of [...tables, ...loaderFiles]) expect(fs.existsSync(file), file).toBe(true)
  })

  it('every route and every sheet has a loader, and no loader is left over', () => {
    expect(Object.keys(ROUTE_LOADERS).sort()).toEqual([...ROUTE_IDS].sort())
    expect(Object.keys(SHEET_LOADERS).sort()).toEqual([...SHEET_IDS].sort())
  })

  it('every loader points at a file that exists', () => {
    const missing: string[] = []
    let count = 0
    for (const file of loaderFiles) {
      for (const target of loaderTargets(file)) {
        count++
        if (!exists(target)) missing.push(path.relative(MOBILE, target))
      }
    }
    expect(missing).toEqual([])
    // Two more than the tables: the page and the sheet a closed route or sheet shows (policy/gates.ts).
    expect(count).toBe(ROUTE_IDS.length + SHEET_IDS.length + 2)
  })

  it('the tables themselves import no screen', () => {
    // A loader in a table closes a circle from every screen back to itself, see nav/loaders.ts.
    for (const table of tables) expect(loaderTargets(table), path.relative(MOBILE, table)).toEqual([])
  })

  it('a page file of a strand lies in the folder of that strand', () => {
    const wrong: string[] = []
    const text = fs.readFileSync(path.join(NAV, 'loaders.ts'), 'utf8')
    const start = text.indexOf('export const ROUTE_LOADERS')
    const body = text.slice(start, text.indexOf('export const SHEET_LOADERS'))
    const core = new Set<string>()
    for (const m of body.matchAll(/^\s+'([^']+)': \(\) => import\('\.\.\/([a-z]+)\/([a-z]+)?/gm)) {
      const [, id, top, folder] = m
      core.add(id)
      const owner = routes[id]?.owner
      if (owner === 'shell') {
        if (top !== 'dev') wrong.push(id)
      } else if (top !== 'screens' || folder !== owner) {
        wrong.push(`${id}: ${top}/${folder} is not the folder of ${owner}`)
      }
    }
    // A page a strand registered itself (screens/<strand>/routes.ts): its
    // loader stands in the loaders.ts of the strand that owns it and points
    // into that same folder.
    const extra = ROUTE_IDS.filter((id) => !core.has(id))
    for (const id of extra) {
      const owner = routes[id]?.owner
      if (!(STRANDS as readonly string[]).includes(owner)) {
        wrong.push(`${id}: registered by a strand, but owned by ${owner}`)
        continue
      }
      const code = fs.readFileSync(path.join(MOBILE, 'screens', owner, 'loaders.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      const line = code.split('\n').find((l) => l.trimStart().startsWith(`'${id}':`))
      if (!line) wrong.push(`${id}: no loader in screens/${owner}/loaders.ts`)
      else if (!/import\('\.\/[A-Za-z]/.test(line)) wrong.push(`${id}: its file is not in screens/${owner}`)
    }
    expect(wrong).toEqual([])
    expect(core.size + extra.length).toBe(ROUTE_IDS.length)
  })

  it('a strand may register pages of its own, and the table tells whose they are', () => {
    // Every id is either a page of the design (nav/routes.ts) or comes from exactly one strand table.
    const tableText = (file: string) => fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const coreText = tableText(path.join(NAV, 'routes.ts'))
    for (const id of ROUTE_IDS) {
      const homes = STRANDS.filter((strand) => tableText(path.join(MOBILE, 'screens', strand, 'routes.ts')).includes(`'${id}':`))
      if (coreText.includes(`'${id}':`)) expect(homes, id).toEqual([])
      else expect(homes, id).toEqual([routes[id].owner])
    }
  })
})
