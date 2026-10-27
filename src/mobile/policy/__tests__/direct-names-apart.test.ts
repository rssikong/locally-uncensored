/**
 * Round 27: two models of the Play package never read as one.
 *
 * The Play preset cut the word out of a name and set the mark "Direct"
 * (policy/unfiltered.ts) until r56; since 18.10.2026 it lists no such model,
 * and the tests below hold the mark with the two lines turned back. A cut name can come out as the name of another
 * model of the same list ("Gemma 3 12B No Filter" next to "Gemma 3 12B").
 * The picker draws the mark next to the one, but the head of an answer, the
 * list of chats, Compare, the export and the line about a switch of models
 * show the name alone. So a model with the mark that shares its name says the
 * mark in its name. The open build and a name no other model carries are
 * not touched.
 *
 * The list below is the one the models route gives an app with a bearer
 * (mobile-docs/r27/modellnamen.md): the open-weight models under their
 * catalogue name, the direct models under the name the app reads and the
 * marker `unrestricted`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { storeFindings } from '../../../../e2e/mobile/store-rules'
import { useModelStore } from '../../../stores/modelStore'
import { modelLabel } from '../../screens/agent/parts/model-names'
import { storeCloudModels } from '../../screens/chat/parts/logic/policy'
import { chatModelDirect, chatModelLabel } from '../../screens/chat/parts/model-name'
import { STORE_PRESETS, setStorePresetForTests, type StorePolicy } from '../storePolicy'
import { cloudModelShownAmong, cloudModelsShown } from '../unfiltered'
import { carriesUnfilteredWord } from '../unfiltered-names'

const { open, play, appstore } = STORE_PRESETS
/**
 * The Play preset with the two lines of r56 turned back (unfilteredCatalog
 * and directBadge, decided 18.10.2026). No preset carries the mark any more;
 * these tests hold what the two lines bring back.
 */
const withMark: StorePolicy = { ...play, unfilteredCatalog: true, directBadge: true }

/** A policy no preset carries, for the places that ask storePolicy() themselves. */
const shownPolicy = vi.hoisted(() => ({ current: null as StorePolicy | null }))
vi.mock('../storePolicy', async (original) => {
  const real = await original<typeof import('../storePolicy')>()
  return { ...real, storePolicy: () => shownPolicy.current ?? real.storePolicy() }
})

const row = (id: string, name: string, more: Record<string, unknown> = {}) => ({ name: `lu-cloud::${id}`, provider: 'lu-cloud', type: 'text', displayName: name, ...more })
const direct = (id: string, name: string) => row(id, name, { unrestricted: true })

/** As the models route answers an app today (12.10.2026): no cookie, so the direct models travel under the app name. */
const TODAY = [
  row('google/gemma-4-26B-A4B-it', 'Gemma 4 26B'),
  row('google/gemma-4-31B-it-turbo', 'Gemma 4 31B Turbo'),
  row('zai-org/GLM-4.7', 'GLM 4.7'),
  row('zai-org/GLM-5.3-Flash', 'GLM 5.3 Flash'),
  row('moonshotai/Kimi-K2.6', 'Kimi K2.6'),
  row('Gryphe/MythoMax-L2-13b', 'MythoMax 13B'),
  direct('direct/v-1.2', 'Instruct 1.2'),
  direct('direct/role-play', 'Role Play'),
  direct('direct/gemma-4', 'Gemma 4 Unfiltered'),
  direct('direct/gemma-4-26b-a4b', 'Gemma 4 26B A4B Unfiltered'),
  direct('direct/glm-4.7-flash-heretic', 'GLM 4.7 Flash Heretic'),
  direct('direct/aion-3.0-mini', 'Aion 3.0 Mini'),
  direct('direct/aion-3.0', 'Aion 3.0'),
  direct('direct/abliterated-large-v2', 'Abliterated Large V2'),
]

/** The names the web shows since 12.10.2026, next to the stock models they share a lineage with. */
const NO_FILTER = [
  row('google/gemma-3-12b-it', 'Gemma 3 12B'),
  direct('direct/gemma-3-12b', 'Gemma 3 12B No Filter'),
  row('google/gemma-4-26B-A4B-it', 'Gemma 4 26B A4B'),
  direct('direct/gemma-4-26b-a4b', 'Gemma 4 26B A4B No Filter'),
  // Two models that both lose their word to the same name, and a stock model that already says the mark.
  direct('direct/gemma-4', 'Gemma 4 No Filter'),
  direct('direct/gemma-4-b', 'Gemma 4 Unfiltered'),
  row('x/gemma-4-direct', 'Gemma 4 Direct'),
]

const key = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim()
const tidy = /\s{2,}|\(\s*\)|\[\s*\]|^[\s,;:_-]|[\s,;:_-]$/

afterEach(() => {
  shownPolicy.current = null
  setStorePresetForTests(null)
  useModelStore.setState({ models: [] } as never)
})

describe('the names the server gives today', () => {
  it('play since r56: only the open-weight models are listed, none with the mark', () => {
    const shown = storeCloudModels(TODAY, play)
    expect(shown.map((m) => m.displayName)).toEqual(['Gemma 4 26B', 'Gemma 4 31B Turbo', 'GLM 4.7', 'GLM 5.3 Flash', 'Kimi K2.6', 'MythoMax 13B'])
    expect(shown.some((m) => m.direct)).toBe(false)
    expect(storeCloudModels(TODAY, play)).toEqual(storeCloudModels(TODAY, appstore))
  })

  it('play with the two lines back: every name is tidy, carries no word and is the name of one model only', () => {
    const shown = storeCloudModels(TODAY, withMark)
    expect(shown).toHaveLength(TODAY.length)
    const names = shown.map((m) => m.displayName ?? '')
    expect(new Set(names.map(key)).size).toBe(names.length)
    for (const name of names) {
      expect(name).not.toMatch(tidy)
      expect(carriesUnfilteredWord(name), name).toBe(false)
      expect(storeFindings(name, 'play', { picker: true, designation: false }), name).toEqual([])
    }
    expect(shown.filter((m) => m.direct).map((m) => m.displayName)).toEqual(['Instruct 1.2', 'Role Play', 'Gemma 4', 'Gemma 4 26B A4B', 'GLM 4.7 Flash', 'Aion 3.0 Mini', 'Aion 3.0', 'Large V2'])
  })

  it('no real name carries an everyday word of the list ("Unrestricted" and the like)', () => {
    for (const model of TODAY) expect(model.displayName, model.name).not.toMatch(/unrestrict|unlock|unalign|unchain|unhinged|unshackl|no[-_ .]?(limit|restrict|guardrail|censor)/i)
  })
})

describe('a name that comes out as the name of another model', () => {
  it('play since r56: such a model is not listed, so nothing is told apart', () => {
    expect(storeCloudModels(NO_FILTER, play).map((m) => m.displayName)).toEqual(['Gemma 3 12B', 'Gemma 4 26B A4B', 'Gemma 4 Direct'])
  })

  it('play with the two lines back: the model with the mark says the mark in its name, and two of them are counted', () => {
    const shown = storeCloudModels(NO_FILTER, withMark)
    expect(shown.map((m) => [m.displayName, m.direct === true])).toEqual([
      ['Gemma 3 12B', false],
      ['Gemma 3 12B Direct', true],
      ['Gemma 4 26B A4B', false],
      ['Gemma 4 26B A4B Direct', true],
      ['Gemma 4 Direct 2', true],
      ['Gemma 4 Direct 3', true],
      ['Gemma 4 Direct', false],
    ])
    const names = shown.map((m) => m.displayName ?? '')
    expect(new Set(names.map(key)).size).toBe(names.length)
    for (const name of names) expect(storeFindings(name, 'play', { picker: true, designation: false }), name).toEqual([])
  })

  it('every place that names a model alone says the same name: answer, chat list, export, Compare, the line about a switch', () => {
    shownPolicy.current = withMark
    useModelStore.setState({ models: NO_FILTER } as never)
    const stock = 'lu-cloud::google/gemma-3-12b-it'
    const tuned = 'lu-cloud::direct/gemma-3-12b'
    expect(chatModelLabel(NO_FILTER, stock)).toBe('Gemma 3 12B')
    expect(chatModelLabel(NO_FILTER, tuned)).toBe('Gemma 3 12B Direct')
    expect(chatModelDirect(NO_FILTER, tuned)).toBe(true)
    expect(modelLabel(tuned, NO_FILTER as never)).toBe('Gemma 3 12B Direct')
    expect(modelLabel(stock, NO_FILTER as never)).toBe('Gemma 3 12B')
    // The chat says "ran on another model" only when the two names differ (ChatPage, modelHint).
    expect(chatModelLabel(NO_FILTER, stock)).not.toBe(chatModelLabel(NO_FILTER, tuned))
  })

  it('play since r56: an answer of such a model from before is named without the word and without the mark', () => {
    setStorePresetForTests('play')
    useModelStore.setState({ models: NO_FILTER } as never)
    const tuned = 'lu-cloud::direct/gemma-3-12b'
    expect(chatModelDirect(NO_FILTER, tuned)).toBe(false)
    for (const name of [chatModelLabel(NO_FILTER, tuned), modelLabel(tuned, NO_FILTER as never)]) {
      expect(carriesUnfilteredWord(name), name).toBe(false)
      expect(name).not.toContain('Direct')
      expect(storeFindings(name, 'play', { picker: true, designation: false }), name).toEqual([])
    }
  })

  it('a model that is not in the list is named on its own, as before', () => {
    expect(cloudModelShownAmong(NO_FILTER, { name: 'lu-cloud::direct/gone', displayName: 'Mira 7B No Filter' }, withMark)).toEqual({ name: 'Mira 7B', direct: true })
  })

  it('open: the names of the server, untouched', () => {
    expect(storeCloudModels(NO_FILTER, open).map((m) => m.displayName)).toEqual(NO_FILTER.map((m) => m.displayName))
    expect([...cloudModelsShown(NO_FILTER, open).values()].map((m) => m.name)).toEqual(NO_FILTER.map((m) => m.displayName))
  })

  it('appstore: such a model is not listed, so nothing is told apart', () => {
    expect(storeCloudModels(NO_FILTER, appstore).map((m) => m.displayName)).toEqual(['Gemma 3 12B', 'Gemma 4 26B A4B', 'Gemma 4 Direct'])
  })
})
