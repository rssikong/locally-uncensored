/**
 * The texts of the shell, read the way a store build reads them.
 *
 * The page-by-page guard (e2e/mobile/store-waechter.mobile.ts) sees what is
 * drawn in the states it can reach. This file reads EVERY text under
 * src/mobile/strings/ in the presets `appstore` and `play` and judges it by
 * the same rules (e2e/mobile/store-rules.ts). A text that would be a finding
 * must either read differently in that preset (a getter with priced(),
 * marketed() or linked() from policy/gates.ts) or stand in the ledger below
 * with the switch that keeps it off the screen. So a new sentence about a
 * plan cannot be added without somebody deciding where it may show.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { storeFindings, type GuardedPreset } from '../../../e2e/mobile/store-rules'
import { STORE_PRESETS, setStorePresetForTests } from '../policy/storePolicy'
import { offeredCatalog, shownFacts } from '../screens/models/parts/policy'
import * as agent from '../strings/agent'
import * as chat from '../strings/chat'
import * as common from '../strings/common'
import * as create from '../strings/create'
import * as models from '../strings/models'
import * as policy from '../strings/policy'
import * as releaseNotes from '../strings/release-notes'
import * as remote from '../strings/remote'
import * as settings from '../strings/settings'
import { STORE_TEXT_LEDGER } from './store-woerter.ledger'

const CATALOGUES: Record<string, unknown> = { agent, chat, common, create, models, policy, releaseNotes, remote, settings }

interface Text {
  path: string
  text: string
}

/** Every text below a value. A function is a text with blanks: it is called with stand-ins. */
function collect(value: unknown, path: string, out: Text[], seen: Set<unknown>): void {
  if (typeof value === 'string') {
    out.push({ path, text: value })
    return
  }
  if (typeof value === 'function') {
    const fn = value as (...args: unknown[]) => unknown
    for (const args of [Array(fn.length).fill('Sample'), Array(fn.length).fill(2), Array(fn.length).fill(true)]) {
      try {
        const result = fn(...args)
        if (typeof result === 'string') out.push({ path: `${path}()`, text: result })
        else if (result && typeof result === 'object') collect(result, `${path}()`, out, seen)
      } catch {
        /* this stand-in does not fit the function, the next one may */
      }
    }
    return
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((item, i) => collect(item, `${path}[${i}]`, out, seen))
    return
  }
  for (const key of Object.keys(value)) collect((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key, out, seen)
}

function findingsIn(preset: GuardedPreset): Map<string, string[]> {
  setStorePresetForTests(preset)
  const texts: Text[] = []
  collect(CATALOGUES, '', texts, new Set())
  const byPath = new Map<string, string[]>()
  for (const { path, text } of texts) {
    // Where a model is picked the two words may stand in a Play build, and only with its switch (see store-rules.ts).
    const found = storeFindings(text, preset, { picker: /^(models|chat\.CHAT_STRINGS\.model|create\.CREATE_STRINGS\.(model|guided))\b/.test(path), designation: STORE_PRESETS[preset].unfilteredWords })
    if (found.length > 0) byPath.set(path, [...(byPath.get(path) ?? []), ...found])
  }
  return byPath
}

function covered(path: string, preset: GuardedPreset): boolean {
  return STORE_TEXT_LEDGER.some((entry) => (entry.presets ?? ['appstore', 'play']).includes(preset) && (path === entry.path || path.startsWith(`${entry.path}.`) || path.startsWith(`${entry.path}(`) || path.startsWith(`${entry.path}[`)))
}

afterEach(() => setStorePresetForTests(null))

describe('texts of the shell in a store build', () => {
  it('reads the catalogues', () => {
    setStorePresetForTests('appstore')
    const texts: Text[] = []
    collect(CATALOGUES, '', texts, new Set())
    expect(texts.length).toBeGreaterThan(1500)
  })

  for (const preset of ['appstore', 'play'] as const) {
    it(`${preset}: every text with a forbidden word reads differently or is in the ledger`, () => {
      const open = [...findingsIn(preset)].filter(([path]) => !covered(path, preset)).map(([path, found]) => `${path}: ${found[0]}`)
      if (process.env.LU_STORE_WORDS_DUMP) console.log(`${preset}\n${open.join('\n')}`)
      expect(open).toEqual([])
    })

    it(`${preset}: the ledger has no entry that covers nothing`, () => {
      const paths = [...findingsIn(preset).keys()]
      const idle = STORE_TEXT_LEDGER.filter((entry) => (entry.presets ?? ['appstore', 'play']).includes(preset))
        .filter((entry) => !paths.some((path) => path === entry.path || path.startsWith(`${entry.path}.`) || path.startsWith(`${entry.path}(`) || path.startsWith(`${entry.path}[`)))
        .map((entry) => entry.path)
      expect(idle).toEqual([])
    })
  }

  // The texts of the phone catalogue are not in strings/: names, tags and descriptions of the models (data/mobile-models.ts).
  // They are judged as the build offers and shows them: the models it lists, with the facts a card and the detail page draw.
  for (const preset of ['appstore', 'play'] as const) {
    it(`${preset}: no model the catalogue offers carries a forbidden word in its name or its description`, () => {
      const policy = STORE_PRESETS[preset]
      const open: string[] = []
      for (const model of offeredCatalog(policy)) {
        const shown = shownFacts(policy, model)
        for (const text of [shown.name, shown.description ?? '']) {
          for (const found of storeFindings(text, preset, { picker: true, designation: policy.unfilteredWords })) open.push(`${model.id}: ${found}`)
        }
      }
      expect(open).toEqual([])
      // The catalogue does hold such models: the open build offers them, so the check above had something to leave out.
      expect(offeredCatalog(STORE_PRESETS.open).some((model) => model.uncensored)).toBe(true)
      expect(offeredCatalog(policy).some((model) => model.uncensored)).toBe(false)
    })
  }

  it('play lists no model of the unfiltered kind since r56 (18.10.2026), with or without the words', () => {
    expect(offeredCatalog(STORE_PRESETS.play).filter((model) => model.uncensored)).toEqual([])
    expect(offeredCatalog({ ...STORE_PRESETS.play, unfilteredWords: true }).filter((model) => model.uncensored)).toEqual([])
  })

  it('play with the catalogue line of r56 back and the switch unfilteredWords: the models are listed by name, and still no card says what they promise', () => {
    const policy = { ...STORE_PRESETS.play, unfilteredCatalog: true, unfilteredWords: true }
    const listed = offeredCatalog(policy).filter((model) => model.uncensored)
    expect(listed.length).toBeGreaterThan(0)
    const open: string[] = []
    for (const model of listed) {
      const shown = shownFacts(policy, model)
      expect(shown.uncensored, model.id).toBe(false)
      for (const text of [shown.name, shown.description ?? '']) for (const found of storeFindings(text, 'play', { picker: true, designation: true })) open.push(`${model.id}: ${found}`)
    }
    expect(open).toEqual([])
  })

  it('the open build keeps its own wording', () => {
    setStorePresetForTests('open')
    expect(settings.SETTINGS_STRINGS.price.title).toBe('Price of this answer')
    setStorePresetForTests('appstore')
    expect(storeFindings(settings.SETTINGS_STRINGS.price.title, 'appstore')).toEqual([])
  })
})
