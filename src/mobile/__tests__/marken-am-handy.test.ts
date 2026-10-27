/**
 * The two marks of a model on the phone, the quiet capacity note and the Beta
 * mark, on the way a real listing takes: the answer of the catalogue route,
 * through the provider and the store's row, into the row the model sheet draws.
 *
 *  - open build: the app's own words and the real names, as on the desktop.
 *  - play build: since r56 (18.10.2026, Option c) the same list as the App
 *    Store build, no marked model at all. With the two lines of r56 turned
 *    back (unfilteredCatalog, directBadge) it has no word of its own and no
 *    mark of that kind: the name is the one the catalogue route gives, the
 *    marks and the group head are gone, and a model whose name itself carries
 *    the word is listed without the word under the mark "Direct"; without
 *    that switch it is listed only with unfilteredWords (policy/unfiltered.ts).
 *  - appstore build: no marked model at all, as before.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAIProvider } from '../../api/providers/openai-provider'
import { BETA_FEATURES } from '../../lib/beta'
import { cloudModelRow } from '../../lib/cloud-model-row'
import { LIMITED_CAPACITY_LABEL, pickerGroups, pickerRows } from '../../lib/model-picker'
import { STATEMENT_MARK_LABEL, UNFILTERED_MARK_LABEL } from '../../lib/unfiltered-mark'
import { storeFindings } from '../../../e2e/mobile/store-rules'
import { STORE_PRESETS, setStorePresetForTests, type StorePolicy } from '../policy/storePolicy'
import { unfilteredMarksShown } from '../policy/unfiltered'
import { offeredCloudRows, offeredPickerFilters, storeCloudModels } from '../screens/chat/parts/logic/policy'
import { chatModelLabel } from '../screens/chat/parts/model-name'
import { CHAT_STRINGS } from '../strings/chat'
import { CREATE_STRINGS } from '../strings/create'
import { MODELS_STRINGS } from '../strings/models'

vi.mock('../../api/backend', () => ({
  localFetch: vi.fn(async () => new Response('{}', { status: 404 })),
  localFetchStream: vi.fn(), isPrivateOrLanHost: () => false,
  isDirectFetchAllowed: () => true, hostnameOf: (url: string) => new URL(url).hostname,
  ensureProxyAllowsHost: vi.fn(), backendCall: vi.fn(), isTauri: () => false,
}))
afterEach(() => {
  vi.unstubAllGlobals()
  setStorePresetForTests(null)
})

// The listing as the route sends it: `name` is the name of the web app,
// `native_name` the published name, sent only where the two differ.
const LISTING = [
  { id: 'direct/v-1.2', name: 'Instruct 1.2', native_name: 'Venice Uncensored 1.2', unrestricted: true },
  { id: 'direct/aion-3.5', name: 'Aion 3.5', unrestricted: true, limited_capacity: true },
  { id: 'Qwen/Qwen3.6-27B', name: 'Qwen 3.6 27B' },
  { id: 'mlabonne/gemma-3-27b-it-abliterated', name: 'Gemma 3 27B', unfiltered: 'full' },
  // The name of the web app itself carries the word.
  { id: 'direct/gemma-4', name: 'Gemma 4 Unfiltered', native_name: 'Gemma 4 Uncensored', unrestricted: true },
]

async function storeModels() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ object: 'list', data: LISTING }))))
  const provider = new OpenAIProvider({ id: 'lu-cloud', name: 'LU Cloud', enabled: true, isLocal: false, apiKey: '', baseUrl: 'https://lu-labs.ai/api/inference/v1' })
  return (await provider.listModels()).map(cloudModelRow)
}

/** The rows exactly as ModelSheet.tsx builds them. */
async function sheetRows(preset: 'open' | 'play' | 'appstore', switches: Partial<StorePolicy> = {}) {
  const policy = { ...STORE_PRESETS[preset], ...switches }
  return offeredCloudRows(pickerRows(storeCloudModels(await storeModels(), policy), true), policy.unfilteredCatalog)
}

const SRC = join(__dirname, '..')
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, out)
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(path)
  }
  return out
}

describe('the name of the catalogue route travels with the row', () => {
  it('is kept only where the app shows another name', async () => {
    const models = await storeModels()
    expect(models.map((m) => [m.displayName, m.catalogName])).toEqual([
      ['Venice Uncensored 1.2', 'Instruct 1.2'],
      ['Aion 3.5', undefined],
      ['Qwen 3.6 27B', undefined],
      ['Gemma 3 27B', undefined],
      ['Gemma 4 Uncensored', 'Gemma 4 Unfiltered'],
    ])
  })
})

describe('open build', () => {
  it('shows the real names, the statement in its own group and the measured mark', async () => {
    const rows = await sheetRows('open')
    expect(rows.map((r) => [r.label, r.mark])).toEqual([
      ['Venice Uncensored 1.2', 'statement'],
      ['Aion 3.5', 'statement'],
      ['Qwen 3.6 27B', null],
      ['Gemma 3 27B', 'measured'],
      ['Gemma 4 Uncensored', 'statement'],
    ])
    expect(pickerGroups(rows, false).map((g) => g.family)).toContain(STATEMENT_MARK_LABEL)
  })

  it('carries the capacity note on the row the server marked, and on no other', async () => {
    const rows = await sheetRows('open')
    expect(rows.filter((r) => r.limitedCapacity).map((r) => r.label)).toEqual(['Aion 3.5'])
  })

  it('names a model in the chat by its real name', async () => {
    setStorePresetForTests('open')
    expect(chatModelLabel(await storeModels(), 'lu-cloud::direct/v-1.2')).toBe('Venice Uncensored 1.2')
  })
})

/** The Play preset with the two lines of r56 turned back. No preset carries this any more. */
const WITH_MARK: Partial<StorePolicy> = { unfilteredCatalog: true, directBadge: true }

describe('play build', () => {
  it('since r56 lists no marked model at all, the same as the App Store build', async () => {
    const rows = await sheetRows('play')
    expect(rows.map((r) => [r.label, r.mark])).toEqual([['Qwen 3.6 27B', null]])
    expect(rows.map((r) => r.label)).toEqual((await sheetRows('appstore')).map((r) => r.label))
    expect(storeCloudModels(await storeModels(), STORE_PRESETS.play).some((m) => m.direct)).toBe(false)
  })

  it('with the two lines back: names the models the way the catalogue route does, with no mark of either kind and without the group', async () => {
    const rows = await sheetRows('play', WITH_MARK)
    expect(rows.map((r) => [r.label, r.mark])).toEqual([
      ['Instruct 1.2', null],
      ['Aion 3.5', null],
      ['Qwen 3.6 27B', null],
      ['Gemma 3 27B', null],
      // Decided 10.10.2026: the word is taken out of the name, the model carries the mark "Direct".
      ['Gemma 4', null],
    ])
    expect(pickerGroups(rows, false).map((g) => g.family)).not.toContain(STATEMENT_MARK_LABEL)
  })

  it('with the two lines back: shows a model whose name itself carries the word without the word and under the mark "Direct"', async () => {
    const policy = { ...STORE_PRESETS.play, ...WITH_MARK }
    const shown = storeCloudModels(await storeModels(), policy)
    expect(shown.map((m) => [m.displayName, m.direct === true])).toEqual([
      // Released that way by its makers: the mark stands at it, whatever its name.
      ['Instruct 1.2', true],
      ['Aion 3.5', true],
      ['Qwen 3.6 27B', false],
      // The measured mark alone is no reason for the mark, but this model's id says it.
      ['Gemma 3 27B', true],
      ['Gemma 4', true],
    ])
    for (const row of await sheetRows('play', WITH_MARK)) expect(row.label, row.label).not.toMatch(/unfiltered|uncensored|abliterated/i)
  })

  it('with the catalogue line back: does not list a model whose name itself carries the word without the mark "Direct", until the switch unfilteredWords is on', async () => {
    const strict = await sheetRows('play', { unfilteredCatalog: true, directBadge: false })
    expect(strict.map((r) => r.label)).toEqual(['Instruct 1.2', 'Aion 3.5', 'Qwen 3.6 27B', 'Gemma 3 27B'])
    const lenient = await sheetRows('play', { unfilteredCatalog: true, directBadge: false, unfilteredWords: true })
    expect(lenient.map((r) => [r.label, r.mark])).toContainEqual(['Gemma 4 Unfiltered', null])
    // The real name stays out either way: it is the app's own word.
    expect(lenient.map((r) => r.label)).not.toContain('Gemma 4 Uncensored')
  })

  it('has no filter for marks: there are none to filter by', () => {
    expect(offeredPickerFilters(['marked', 'vision', 'thinking', 'free'], unfilteredMarksShown(STORE_PRESETS.play))).toEqual(['vision', 'thinking', 'free'])
    expect(offeredPickerFilters(['marked', 'vision'], unfilteredMarksShown(STORE_PRESETS.open))).toEqual(['marked', 'vision'])
    expect(offeredPickerFilters(['marked', 'vision'], unfilteredMarksShown(STORE_PRESETS.appstore))).toEqual(['vision'])
  })

  it('draws nothing in the sheet that the store guard would find, also with the two lines back', async () => {
    for (const switches of [{}, WITH_MARK]) {
      const rows = await sheetRows('play', switches)
      const drawn = [
        ...rows.map((r) => r.label),
        ...pickerGroups(rows, false).map((g) => g.family ?? ''),
        ...rows.filter((r) => r.mark === 'measured').map(() => CHAT_STRINGS.model.tagMeasured),
        ...rows.filter((r) => r.mark === 'statement').map(() => CHAT_STRINGS.model.tagStatement),
        ...rows.filter((r) => r.limitedCapacity).map(() => CHAT_STRINGS.model.limitedCapacity),
      ]
      for (const text of drawn) expect(storeFindings(text, 'play', { picker: true, designation: false }), text).toEqual([])
    }
  })

  it('with the two lines back: keeps the capacity note, it says nothing a store minds', async () => {
    const rows = await sheetRows('play', WITH_MARK)
    expect(rows.filter((r) => r.limitedCapacity).map((r) => r.label)).toEqual(['Aion 3.5'])
  })

  it('names a model in the chat the way the catalogue route does', async () => {
    setStorePresetForTests('play')
    const models = await storeModels()
    expect(chatModelLabel(models, 'lu-cloud::direct/v-1.2')).toBe('Instruct 1.2')
    expect(chatModelLabel(models, 'lu-cloud::Qwen/Qwen3.6-27B')).toBe('Qwen 3.6 27B')
  })

  it('with the two lines back: does not change the rows of the store, the pick still names the same model', async () => {
    const models = await storeModels()
    const rows = await sheetRows('play', WITH_MARK)
    expect(rows.map((r) => r.name)).toEqual(models.map((m) => m.name))
    expect(models[0].unrestricted).toBe(true)
    expect(models[3].unfiltered).toBe('full')
  })
})

describe('appstore build', () => {
  it('lists no marked model at all, neither kind', async () => {
    const rows = await sheetRows('appstore')
    expect(rows.map((r) => r.label)).toEqual(['Qwen 3.6 27B'])
  })
})

describe('the words', () => {
  it('are the app\'s two words, read from lib/unfiltered-mark.ts', () => {
    expect(UNFILTERED_MARK_LABEL).toBe('No Filter')
    expect(STATEMENT_MARK_LABEL).toBe('Uncensored')
    expect(CHAT_STRINGS.model.filterMarked).toBe(UNFILTERED_MARK_LABEL)
    expect(CHAT_STRINGS.model.tagMeasured).toBe(UNFILTERED_MARK_LABEL)
    expect(CHAT_STRINGS.model.tagStatement).toBe(STATEMENT_MARK_LABEL)
    expect(CHAT_STRINGS.model.limitedCapacity).toBe(LIMITED_CAPACITY_LABEL)
    expect(CREATE_STRINGS.model.noFilter).toBe(UNFILTERED_MARK_LABEL)
    expect(CREATE_STRINGS.guided.noFilter).toBe(UNFILTERED_MARK_LABEL)
    expect(MODELS_STRINGS.models.tagNoFilter).toBe(UNFILTERED_MARK_LABEL)
  })

  it('the old word stands nowhere in the phone app', () => {
    // The files that hold the rule against it keep their samples: the guards of the words (also the one over the
    // store texts), the test of the list of spellings (policy/unfiltered-names.ts), which must find the word in a
    // model name, and the test of the mark "Direct", which must find it in what a server writes about a model.
    const keep = /__tests__\/(store-regeln|store-unterlagen|marken-am-handy|unfiltered-names|direct-mark)\.test\.ts$/
    const hits = files(SRC).filter((path) => !keep.test(path) && /no refusals/i.test(readFileSync(path, 'utf8')))
    expect(hits.map((path) => path.slice(SRC.length + 1))).toEqual([])
  })

  it('the sheet draws the statement in the accent and the measured mark quiet', () => {
    const sheet = readFileSync(join(SRC, 'screens/chat/ModelSheet.tsx'), 'utf8')
    expect(sheet).toContain("row.mark === 'statement' ? <Tag accent>{S.tagStatement}</Tag>")
    expect(sheet).toContain("row.mark === 'measured' ? <Tag>{S.tagMeasured}</Tag>")
    expect(sheet).toContain('data-testid="m-chat-model-limited"')
    // Create: the measured mark is the quiet one everywhere.
    for (const file of ['screens/create/CreateModelSheet.tsx', 'screens/create/PresetSheet.tsx']) {
      expect(readFileSync(join(SRC, file), 'utf8')).toMatch(/<Tag>\{T\.(model|guided)\.noFilter\}<\/Tag>/)
    }
  })
})

describe('the Beta mark', () => {
  const users = files(SRC)
    .filter((path) => !/__tests__|\/ui\/List\.tsx$|\/ui\/index\.ts$/.test(path))
    .flatMap((path) => [...readFileSync(path, 'utf8').matchAll(/<BetaTag feature="([a-z-]+)"/g)].map((m) => `${path.slice(SRC.length + 1)}:${m[1]}`))

  it('stands at the head of the statement group, the one Beta surface the phone has', () => {
    expect(users).toEqual(['screens/chat/ModelSheet.tsx:direct-models'])
    expect(BETA_FEATURES['direct-models']).toBeTruthy()
  })

  it('the phone has neither of the other Beta surfaces, so nothing is left unmarked', () => {
    // Voice (the spoken session of the desktop) and computer control: no file of the phone app draws them.
    const imports = files(SRC).filter((path) => /from '[./]+\/components\/(voice|computer)\//.test(readFileSync(path, 'utf8')))
    expect(imports).toEqual([])
    // Create in chat is locked on the phone (lib/create-order-surface.ts).
    expect(readFileSync(join(SRC, '../lib/create-order-surface.ts'), 'utf8')).toContain('return !isMobile()')
  })
})
