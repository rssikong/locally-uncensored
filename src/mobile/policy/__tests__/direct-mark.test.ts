/**
 * Decided 10.10.2026: no store package shows a word about answers without
 * refusals in the name of a LU Cloud model. The name the server gives is not
 * changed. A build with the mark "Direct" (the Play preset until r56, now
 * no preset) shows the name
 * without the word and the mark next to it; a build without the catalogue
 * (the App Store preset, and Play since 18.10.2026) does not list such a model; the open build shows
 * what it always showed. And no build shows the routed id of a model.
 *
 * The server answers are played: the word in the name, in the id, in a
 * description, in a group.
 */
import { describe, expect, it } from 'vitest'
import { storeFindings } from '../../../../e2e/mobile/store-rules'
import { exportAsMarkdown } from '../../../lib/chat-export'
import type { Conversation } from '../../../types/chat'
import { storeCloudModels } from '../../screens/chat/parts/logic/policy'
import { STORE_PRESETS } from '../storePolicy'
import { DIRECT_MARK, DIRECT_MARK_SHORT, DIRECT_SENTENCE, UNNAMED_CLOUD_MODEL, cloudModelListed, cloudModelShown, directMarkShown, shownDescription, shownName } from '../unfiltered'
import { UNFILTERED_SPELLINGS, carriesUnfilteredWord, namesUnfiltered, withoutUnfilteredWords } from '../unfiltered-names'

const { open, play, appstore } = STORE_PRESETS
/**
 * The Play preset with the two lines of r56 turned back (unfilteredCatalog
 * and directBadge, decided 18.10.2026). No preset carries this any more; the
 * mark stays built, and these tests hold what the two lines bring back.
 */
const withMark = { ...play, unfilteredCatalog: true, directBadge: true }

/** A list as the models route of LU Cloud answers it, read into rows the way lib/cloud-model-row.ts does. */
const row = (id: string, name?: string, more: Record<string, unknown> = {}) => ({ name: `lu-cloud::${id}`, provider: 'lu-cloud', displayName: name, ...more })
const SERVER = [
  row('moonshotai/Kimi-K2.6', 'Kimi K2.6'),
  row('e2e-lab/Qwen3-8B-abliterated', 'Qwen3 8B Abliterated'),
  row('e2e-lab/Castor-12B', 'Castor 12B (Uncensored)'),
  row('e2e-lab/Llama-3-Uncensored-8B', 'Atlas 8B'),
  row('e2e-lab/Mistral-NoFilter-7B'),
  row('e2e-lab/Borealis-9B', 'Borealis 9B', { description: 'An uncensored model with no refusals. NSFW.', group: 'Unfiltered' }),
  row('e2e-lab/Plain-7B'),
  row('e2e-lab/unfiltered', 'Uncensored'),
]

const clean = (text: string, preset: 'play' | 'appstore') => storeFindings(text, preset, { picker: true, designation: false })

describe('the switch', () => {
  it('is in effect in no preset since r56, and comes back with the two lines in play', () => {
    // Decided 18.10.2026: the Play package lists no such model, so it shows no mark either.
    expect([play.unfilteredCatalog, play.directBadge]).toEqual([false, false])
    expect(directMarkShown(play)).toBe(false)
    expect(directMarkShown(withMark)).toBe(true)
    // Prepared in the App Store preset: without effect while it lists no such model, in effect with the one line.
    expect(appstore.directBadge).toBe(true)
    expect(directMarkShown(appstore)).toBe(false)
    expect(directMarkShown({ ...appstore, unfilteredCatalog: true })).toBe(true)
    // The open build shows the words themselves.
    expect(directMarkShown(open)).toBe(false)
    // And each of the two lines that takes it back.
    expect(directMarkShown({ ...withMark, directBadge: false })).toBe(false)
    expect(directMarkShown({ ...withMark, unfilteredWords: true })).toBe(false)
  })

  it('the mark and its sentence are the decided wording, and a store build may show them', () => {
    expect(DIRECT_MARK).toBe('Direct')
    expect(DIRECT_MARK_SHORT).toBe('D')
    expect(DIRECT_SENTENCE).toBe('Direct models follow instructions closely and add fewer refusals of their own. Your content settings still apply.')
    for (const preset of ['play', 'appstore'] as const) for (const text of [DIRECT_MARK, DIRECT_MARK_SHORT, DIRECT_SENTENCE, UNNAMED_CLOUD_MODEL]) expect(storeFindings(text, preset), text).toEqual([])
  })
})

describe('a name without the word', () => {
  it('is tidy: no doubled blank, no empty bracket, no separator left hanging', () => {
    const cases: Array<[string, string]> = [
      ['Qwen3 8B Abliterated', 'Qwen3 8B'],
      ['Llama 3 (Uncensored) 8B', 'Llama 3 8B'],
      ['Castor 12B (Uncensored)', 'Castor 12B'],
      ['NSFW-Flux XL', 'Flux XL'],
      ['Hermes 3 - Uncensored', 'Hermes 3'],
      ['Flux Uncensored XL (fast)', 'Flux XL (fast)'],
      ['Qwen3 4B no refusals', 'Qwen3 4B'],
      ['Aurora, unfiltered, v2', 'Aurora, v2'],
      ['Un-Censored Llama', 'Llama'],
      ['Llama [abliterated]', 'Llama'],
      ['Lyra Video (Unfiltered)', 'Lyra Video'],
      ['Foo ERP 7B', 'Foo 7B'],
      ['Kimi K2.6', 'Kimi K2.6'],
      ['Serpent 7B', 'Serpent 7B'],
    ]
    for (const [name, want] of cases) {
      const got = withoutUnfilteredWords(name)
      expect(got, name).toBe(want)
      expect(got, name).not.toMatch(/\s{2,}|\(\s*\)|\[\s*\]|^[\s,;:_-]|[\s,;:_-]$/)
    }
    // Nothing of the name is left: the caller names the model itself.
    expect(withoutUnfilteredWords('Uncensored')).toBe('')
    expect(withoutUnfilteredWords('NSFW (abliterated)')).toBe('')
  })

  it('holds for every spelling of the one list', () => {
    for (const spelling of UNFILTERED_SPELLINGS) {
      const name = (spelling.sample.split('/').pop() ?? '').replace(/\.gguf$/i, '').replace(/[-_.]+/g, ' ')
      if (spelling.everyday) {
        // Everyday words and the proper names of model lines stay: the store guards do not look for them either.
        expect(carriesUnfilteredWord(name), name).toBe(false)
        continue
      }
      expect(carriesUnfilteredWord(name), name).toBe(true)
      const got = withoutUnfilteredWords(name)
      expect(got, name).not.toBe('')
      expect(carriesUnfilteredWord(got), `${name} -> ${got}`).toBe(false)
      for (const preset of ['play', 'appstore'] as const) expect(clean(got, preset), `${preset}: ${name} -> ${got}`).toEqual([])
    }
  })
})

describe('a played models route with the word in name, id, description and group', () => {
  it('play with the two lines back: every model is listed under a name without the word, with the mark where the word stood', () => {
    const shown = storeCloudModels(SERVER, withMark)
    expect(shown.map((m) => [m.displayName, m.direct === true])).toEqual([
      ['Kimi K2.6', false],
      ['Qwen3 8B', true],
      ['Castor 12B', true],
      ['Atlas 8B', true],
      ['Mistral 7B', true],
      ['Borealis 9B', true],
      ['Plain 7B', false],
      [UNNAMED_CLOUD_MODEL, true],
    ])
    for (const model of shown) {
      expect(clean(model.displayName ?? '', 'play'), model.name).toEqual([])
      // The id is the id: what is sent to the server is not touched.
      expect(SERVER.some((m) => m.name === model.name)).toBe(true)
    }
  })

  it('appstore: a model that its name, its id or its description names by the word is not listed, and no mark is shown', () => {
    const shown = storeCloudModels(SERVER, appstore)
    // "Atlas 8B" has a neutral name over an id with the word, "Borealis 9B" a description with it: both are such models.
    expect(shown.map((m) => m.displayName)).toEqual(['Kimi K2.6', 'Plain 7B'])
    expect(shown.some((m) => m.direct)).toBe(false)
    for (const model of shown) expect(clean(model.displayName ?? '', 'appstore'), model.name).toEqual([])
    // A model the server marks is not listed there either, whatever it is called.
    expect(cloudModelListed({ name: 'lu-cloud::a/b', displayName: 'Atlas 8B', unfiltered: 'full' }, appstore)).toBe(false)
    expect(cloudModelListed({ name: 'lu-cloud::a/b', displayName: 'Atlas 8B', unrestricted: true }, appstore)).toBe(false)
  })

  it('appstore with the catalogue switched on: the models come with the mark and never with the word', () => {
    const later = { ...appstore, unfilteredCatalog: true }
    const shown = storeCloudModels(SERVER, later)
    expect(shown).toHaveLength(SERVER.length)
    expect(shown.filter((m) => m.direct).map((m) => m.displayName)).toEqual(['Qwen3 8B', 'Castor 12B', 'Atlas 8B', 'Mistral 7B', 'Borealis 9B', UNNAMED_CLOUD_MODEL])
    for (const model of shown) expect(clean(model.displayName ?? '', 'appstore'), model.name).toEqual([])
  })

  it('play since r56: lists what the App Store build lists, and no mark', () => {
    const shown = storeCloudModels(SERVER, play)
    expect(shown.map((m) => m.displayName)).toEqual(['Kimi K2.6', 'Plain 7B'])
    expect(shown.some((m) => m.direct)).toBe(false)
    for (const model of shown) expect(clean(model.displayName ?? '', 'play'), model.name).toEqual([])
    expect(cloudModelListed({ name: 'lu-cloud::a/b', displayName: 'Atlas 8B', unfiltered: 'full' }, play)).toBe(false)
    expect(cloudModelListed({ name: 'lu-cloud::a/b', displayName: 'Atlas 8B', unrestricted: true }, play)).toBe(false)
    expect(cloudModelShown({ name: 'lu-cloud::e2e-lab/Llama-3-Uncensored-8B' }, play)).toEqual({ name: UNNAMED_CLOUD_MODEL, direct: false })
    expect(shownDescription('An uncensored model with no refusals. NSFW.', play)).toBe('')
    expect(shownName('Vega 2 NSFW', play, { also: ['vega-2'] })).toEqual({ name: UNNAMED_CLOUD_MODEL, direct: false })
  })

  it('play with the catalogue and without the mark: the strict side, such a model is not listed', () => {
    const strict = { ...withMark, directBadge: false }
    expect(storeCloudModels(SERVER, strict).map((m) => m.displayName)).toEqual(['Kimi K2.6', 'Atlas 8B', 'Borealis 9B', 'Plain 7B'])
  })

  it('open: names and marks of the server, as before', () => {
    const shown = storeCloudModels(SERVER, open)
    expect(shown).toHaveLength(SERVER.length)
    expect(shown.map((m) => m.displayName)).toEqual(SERVER.map((m) => m.displayName))
    expect(shown.some((m) => m.direct)).toBe(false)
  })

  it('a model the catalogue marks as released that way carries the mark, the measured mark alone does not', () => {
    expect(cloudModelShown({ name: 'lu-cloud::a/Vela-9B', displayName: 'Vela 9B', unrestricted: true }, withMark)).toEqual({ name: 'Vela 9B', direct: true })
    expect(cloudModelShown({ name: 'lu-cloud::a/Vela-9B', displayName: 'Vela 9B', unfiltered: 'full' }, withMark)).toEqual({ name: 'Vela 9B', direct: false })
    // The name of a model line that is known for it: the name stays, the mark is added.
    expect(namesUnfiltered('Dolphin 3.0 Mistral 24B')).toBe(true)
    expect(cloudModelShown({ name: 'lu-cloud::a/d', displayName: 'Dolphin 3.0 Mistral 24B' }, withMark)).toEqual({ name: 'Dolphin 3.0 Mistral 24B', direct: true })
  })

  it('no build shows the routed id, also for a model that is in no list', () => {
    for (const policy of [play, withMark, appstore, { ...withMark, directBadge: false }]) {
      for (const id of ['lu-cloud::e2e-lab/Llama-3-Uncensored-8B', 'openai::e2e-lab/Mistral-NoFilter-7B', 'lu-cloud::e2e-lab/Plain-7B']) {
        const shown = cloudModelShown({ name: id }, policy)
        expect(shown.name, id).not.toContain('::')
        expect(shown.name, id).not.toContain('/')
        expect(carriesUnfilteredWord(shown.name), `${id} -> ${shown.name}`).toBe(false)
      }
    }
    expect(cloudModelShown({ name: 'lu-cloud::e2e-lab/Plain-7B' }, appstore).name).toBe('Plain 7B')
    expect(cloudModelShown({ name: 'lu-cloud::e2e-lab/Llama-3-Uncensored-8B' }, appstore).name).toBe(UNNAMED_CLOUD_MODEL)
    expect(cloudModelShown({ name: 'lu-cloud::e2e-lab/Llama-3-Uncensored-8B' }, withMark)).toEqual({ name: 'Llama 3 8B', direct: true })
  })

  it('a description of the server with the word is not shown: the sentence of the mark stands in its place, or nothing', () => {
    const said = 'An uncensored model with no refusals. NSFW.'
    expect(shownDescription(said, withMark)).toBe(DIRECT_SENTENCE)
    expect(shownDescription(said, appstore)).toBe('')
    expect(shownDescription(said, open)).toBe(said)
    for (const policy of [withMark, appstore, open]) expect(shownDescription('A fast model for everyday questions.', policy)).toBe('A fast model for everyday questions.')
  })

  it('the models of Create: the label without the word, the mark, and a group head without the word', () => {
    expect(shownName('Vega 2 NSFW', withMark, { also: ['vega-2'] })).toEqual({ name: 'Vega 2', direct: true })
    expect(shownName('Aurora XL', withMark, { also: ['aurora-uncensored-xl'] })).toEqual({ name: 'Aurora XL', direct: true })
    expect(shownName('Flux Schnell (fast)', withMark, { also: ['flux-schnell'] })).toEqual({ name: 'Flux Schnell (fast)', direct: false })
    expect(shownName('Uncensored', withMark)).toEqual({ name: UNNAMED_CLOUD_MODEL, direct: true })
    expect(shownName('Vega 2 NSFW', appstore, { also: ['vega-2'] })).toEqual({ name: UNNAMED_CLOUD_MODEL, direct: false })
    expect(shownName('Vega 2 NSFW', open)).toEqual({ name: 'Vega 2 NSFW', direct: false })
  })
})

describe('the Markdown export of a chat', () => {
  const chat = { id: 'c', title: 'Trip', model: 'openai::Qwen3.5-0.8B-Q4_K_M', systemPrompt: '', createdAt: 0, updatedAt: 0, messages: [{ id: 'a', role: 'assistant', content: 'Hello.', timestamp: 0, modelId: 'lu-cloud::e2e-lab/Llama-3-Uncensored-8B' }] } as unknown as Conversation

  it('names the model the way the caller knows it, never by its routed id', () => {
    const text = exportAsMarkdown(chat, { modelLabel: (id) => cloudModelShown({ name: id }, withMark).name })
    expect(text).toContain('_Model: Llama 3 8B |')
    expect(text).not.toContain('::')
    expect(text).not.toMatch(/uncensored/i)
  })

  it('reads as it always did without a naming function (the desktop)', () => {
    expect(exportAsMarkdown(chat)).toContain('_Model: lu-cloud::e2e-lab/Llama-3-Uncensored-8B |')
  })
})
