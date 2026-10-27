// @vitest-environment jsdom
/**
 * The Beta mark of the phone comes from the one list of the app, lib/beta.ts:
 * the word, which features are Beta, and the sentence. The phone keeps no
 * list of its own. A feature that leaves the list loses its mark on the
 * phone in the same moment, and a store build, which has no statement group,
 * has no place for the mark and shows none.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BETA_FEATURES, BETA_LABEL, betaNote, type BetaFeature } from '../../lib/beta'
import { pickerGroups, pickerRows } from '../../lib/model-picker'
import { STATEMENT_MARK_LABEL } from '../../lib/unfiltered-mark'
import { STORE_PRESETS } from '../policy/storePolicy'
import { offeredCloudRows, storeCloudModels } from '../screens/chat/parts/logic/policy'
import { BetaTag, ListGroup, Row } from '../ui'

afterEach(() => cleanup())

const SRC = join(__dirname, '..')
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, out)
    else if (/\.(ts|tsx)$/.test(name) && !/__tests__/.test(path)) out.push(path)
  }
  return out
}

describe('the mark itself', () => {
  it('shows the word of lib/beta.ts and reads its sentence to a screen reader, for every feature of the list', () => {
    for (const feature of Object.keys(BETA_FEATURES) as BetaFeature[]) {
      render(<BetaTag feature={feature} />)
      const mark = screen.getByTestId('m-beta')
      expect(mark.textContent).toBe(BETA_LABEL)
      expect(mark.getAttribute('aria-label')).toBe(betaNote(feature))
      expect(mark.getAttribute('data-m-beta')).toBe(feature)
      cleanup()
    }
  })

  it('draws nothing for a feature that has left the list', () => {
    const kept = BETA_FEATURES['direct-models']
    delete BETA_FEATURES['direct-models']
    try {
      render(<BetaTag feature="direct-models" />)
      expect(screen.queryByTestId('m-beta')).toBeNull()
    } finally {
      BETA_FEATURES['direct-models'] = kept
    }
  })

  it('stands after the title of a group, and a group without one has none', () => {
    render(
      <>
        <ListGroup title="Uncensored" titleMark={<BetaTag feature="direct-models" />} testid="with">
          <Row title="A model" />
        </ListGroup>
        <ListGroup title="Qwen" testid="without">
          <Row title="Another model" />
        </ListGroup>
      </>,
    )
    expect(screen.getByTestId('with').querySelector('h2 [data-testid="m-beta"]')?.textContent).toBe(BETA_LABEL)
    expect(screen.getByTestId('without').querySelector('[data-testid="m-beta"]')).toBeNull()
  })
})

describe('one list', () => {
  it('the phone writes the word nowhere itself and keeps no second list', () => {
    const own = files(SRC).filter((path) => {
      const text = readFileSync(path, 'utf8')
      return /['"`>]Beta['"`<]/.test(text) || /BETA_FEATURES\s*[:=]/.test(text)
    })
    expect(own.map((path) => path.slice(SRC.length + 1))).toEqual([])
  })

  it('the one component reads word and sentence from lib/beta.ts', () => {
    const kit = readFileSync(join(SRC, 'ui/List.tsx'), 'utf8')
    expect(kit).toContain("import { BETA_LABEL, betaNote, type BetaFeature } from '../../lib/beta'")
    expect(kit).toContain('const note = betaNote(feature)')
    expect(kit).toContain('if (!note) return null')
  })

  it('every use on the phone names a feature of the list', () => {
    const uses = files(SRC).flatMap((path) => [...readFileSync(path, 'utf8').matchAll(/<BetaTag feature="([a-z-]+)"/g)].map((m) => m[1]))
    expect(uses.length).toBeGreaterThan(0)
    for (const feature of uses) expect(Object.keys(BETA_FEATURES), feature).toContain(feature)
  })
})

describe('the model sheet', () => {
  const model = (id: string, extra: Record<string, unknown>) => ({ name: `lu-cloud::${id}`, model: id, size: 0, type: 'text' as const, provider: 'lu-cloud', providerName: 'LU Cloud', ...extra })
  const MODELS = [
    model('direct/v-1.2', { displayName: 'Venice Uncensored 1.2', catalogName: 'Instruct 1.2', unrestricted: true }),
    model('Qwen/Qwen3.6-27B', { displayName: 'Qwen 3.6 27B' }),
  ]
  /** The heads that get the mark: exactly the condition ModelSheet.tsx writes. */
  const headsWithMark = (preset: 'open' | 'play' | 'appstore') => {
    const policy = STORE_PRESETS[preset]
    const rows = offeredCloudRows(pickerRows(storeCloudModels(MODELS as never, policy), true), policy.unfilteredCatalog)
    return pickerGroups(rows, false).filter((group) => group.family === STATEMENT_MARK_LABEL).length
  }

  it('hangs the mark on the head of the statement group and nowhere else', () => {
    const sheet = readFileSync(join(SRC, 'screens/chat/ModelSheet.tsx'), 'utf8')
    expect(sheet).toContain('titleMark={group.family === STATEMENT_MARK_LABEL ? <BetaTag feature="direct-models" /> : undefined}')
    expect(sheet.match(/<BetaTag/g)).toHaveLength(1)
  })

  it('open build: one head carries it', () => {
    expect(headsWithMark('open')).toBe(1)
  })

  it('store builds: there is no such head, so there is no mark', () => {
    expect(headsWithMark('play')).toBe(0)
    expect(headsWithMark('appstore')).toBe(0)
  })
})
