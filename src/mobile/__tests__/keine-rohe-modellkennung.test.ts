// @vitest-environment jsdom
/**
 * No raw model id in a text a person reads.
 *
 * A model of this phone is stored as "openai::Qwen3.5-0.8B-Q4_K_M": the slot
 * of the engine, two colons, the name of the file. That is an address. On a
 * screen and in a file the user keeps it is wrong twice: it is not the name
 * the model was chosen by ("Qwen 3.5 0.8B"), and "openai" in front reads as
 * if the chat had run over OpenAI. The Markdown export of a chat wrote it
 * into its second line (acceptance android-4gb, F10), the sheet "price" had
 * shown it before (small iPhone, K11).
 *
 * Two nets:
 *  1. Every function of the phone that turns a model id into a text for a
 *     person is called with such an id, and the text may not contain "::".
 *     A new one belongs into SINKS.
 *  2. The sources of src/mobile are read: an id may not stand in a JSX text,
 *     a template text or a visible prop without passing through one of the
 *     naming functions.
 *
 * The JSON export is data for a restore and keeps the id; that is said here
 * and tested, so nobody "fixes" it.
 *
 * Not looked at on purpose: src/mobile/policy/unfiltered*.ts and the store
 * guards (names of cloud models in store presets, another strand).
 */
import { describe, expect, it } from 'vitest'
import { exportAsJSON, exportAsMarkdown } from '../../lib/chat-export'
import { useModelStore } from '../../stores/modelStore'
import type { Conversation } from '../../types/chat'
import { buildDiagnosticsReport, formatDiagnosticsReport, reportGenerationSpeed, type Diagnostics } from '../lib/diagnostics'
import { deviceFileLabel } from '../lib/model-facts'
import { modelLabel } from '../screens/agent/parts/model-names'
import { chatExportText } from '../screens/chat/parts/adapters/handover'
import { chatModelLabel } from '../screens/chat/parts/model-name'
import { displayName } from '../screens/models/parts/installed'
import { shownModelName } from '../screens/settings/parts/diagnostics'
import { MOBILE_DIR, sourceFiles, stripComments } from './scan'

/** The id of the finding, one of another packing of a catalogue model, and a file the catalogue does not know. */
const IDS = ['openai::Qwen3.5-0.8B-Q4_K_M', 'openai::Qwen3.5-0.8B-Q8_0', 'openai::import-probe-qwen08'] as const
const CATALOGUE_NAME = 'Qwen 3.5 0.8B'

function chat(model: string): Conversation {
  return {
    id: 'c1',
    title: 'What is the capital of France? One word.',
    model,
    systemPrompt: '',
    createdAt: Date.UTC(2026, 9, 10, 6, 58, 52),
    updatedAt: Date.UTC(2026, 9, 10, 6, 59, 0),
    messages: [
      { id: 'm1', role: 'user', content: 'What is the capital of France? One word.', timestamp: 1 },
      { id: 'm2', role: 'assistant', content: 'Paris.', modelId: model, timestamp: 2 },
    ],
  } as Conversation
}

const DIAGNOSTICS = (model: string): Diagnostics =>
  ({
    at: 0,
    device: { platform: 'android', model: 'Pixel', manufacturer: 'Google', appVersion: '3.0.7', source: 'native' },
    fit: { device: { ramGb: 4 }, source: 'native', simulator: false },
    persistentStorage: 'granted',
    engine: { state: 'running', model: 'Qwen3.5-0.8B-Q4_K_M', contextTokens: 4096, accelerator: 'cpu', note: null },
    speed: { tokens: 40, ms: 2000, model, where: 'device', tokensPerSecond: 20, at: 0 },
    fontScale: 1,
    theme: 'dark',
    nativeBridge: true,
    userAgent: 'test',
  }) as unknown as Diagnostics

/** Every way a model id becomes a text for a person on the phone. */
const SINKS: ReadonlyArray<{ name: string; text: (id: string) => string | Promise<string> }> = [
  { name: 'the Markdown export of a chat (chat menu, Export and Save to this phone)', text: (id) => chatExportText(chat(id), 'markdown') },
  { name: 'the name above an answer, in the composer, the list of chats, the model sheet and the sheet "price" (chatModelLabel)', text: (id) => chatModelLabel(useModelStore.getState().models, id) },
  { name: 'Compare, Group chat and the task list (modelLabel)', text: (id) => modelLabel(id, useModelStore.getState().models) },
  { name: 'the diagnostics page (shownModelName)', text: (id) => shownModelName(id) },
  { name: 'the diagnostics report that is shared (formatDiagnosticsReport)', text: (id) => formatDiagnosticsReport(DIAGNOSTICS(id)) },
  {
    name: 'the diagnostics report before the first reading (buildDiagnosticsReport)',
    text: (id) => {
      reportGenerationSpeed({ tokens: 40, ms: 2000, model: id, where: 'device' })
      return buildDiagnosticsReport()
    },
  },
  { name: 'Installed and Benchmark, by the file (displayName)', text: (id) => displayName({ name: id.slice(id.indexOf('::') + 2) }) },
]

describe('a model id never reaches a text for a person', () => {
  for (const sink of SINKS) {
    it(sink.name, async () => {
      for (const id of IDS) {
        const text = await sink.text(id)
        expect(text, id).not.toContain('::')
        expect(text, id).not.toMatch(/\bopenai\b/i)
      }
    })
  }

  it('the export names the model the way the chat does', async () => {
    const text = await chatExportText(chat(IDS[0]), 'markdown')
    expect(text.split('\n')[1]).toMatch(new RegExp(`^_Model: ${CATALOGUE_NAME} \\| `))
    // Another packing of the same model carries the packing, as in the list "Installed".
    expect((await chatExportText(chat(IDS[1]), 'markdown')).split('\n')[1]).toMatch(/^_Model: Qwen 3\.5 0\.8B Q8_0 \| /)
    // A file the catalogue does not know keeps the name of its file, without the slot.
    expect((await chatExportText(chat(IDS[2]), 'markdown')).split('\n')[1]).toMatch(/^_Model: import-probe-qwen08 \| /)
    expect(deviceFileLabel('Qwen3.5-0.8B-Q4_K_M')).toBe(CATALOGUE_NAME)
  })

  it('counter-check: this test finds the finding (the export without the naming writes the id)', () => {
    expect(exportAsMarkdown(chat(IDS[0])).split('\n')[1]).toContain('_Model: openai::Qwen3.5-0.8B-Q4_K_M | ')
  })

  it('the JSON export is data for a restore and keeps the id', async () => {
    expect(JSON.parse(exportAsJSON(chat(IDS[0]))).model).toBe(IDS[0])
    expect(JSON.parse(await chatExportText(chat(IDS[0]), 'json')).model).toBe(IDS[0])
  })
})

// ── the sources ───────────────────────────────────────────────────────────

/** An expression that is a stored model id by its name. */
const RAW = /(?:\bactiveModel\b|\bmodelId\b|\.model\b(?![.(?[])|\bconversationModel(?:Of)?\([^()]*\)|\bmodel_path\b)/
/** The functions that turn an id into a name, a place or a yes/no. Text that passed through one of them is not raw. */
const NAMING = /\b(?:chatModelLabel|modelLabel|useModelLabel|deviceFileLabel|shownModelName|displayName|displayModelName|modelDisplayLabel|bareModelName|remoteModelLabel|catalogueModel|fileName)\s*\(/
/** Props a user reads or hears. */
const VISIBLE_PROP = /\b(?:title|subtitle|label|text|value|detail|meta|placeholder|aria-label|emptyText|name|hint|note)=\{([^{}]*)\}/g

interface Hit {
  where: string
  code: string
}

/** Pure: the places in one source text where a stored id stands in a text for a person. */
export function rawIdsInText(rel: string, source: string): Hit[] {
  const hits: Hit[] = []
  const lines = stripComments(source).split('\n')
  lines.forEach((line, i) => {
    const found = (code: string) => {
      // What is shown, not what is asked: in `id ? a : b` and `id && a` the id is only the condition.
      // And "model" as the name of a text in the tables of strings (S.engine.model) is a word, not an id.
      const shown = code
        .replace(/\b(?:S|T|C|[A-Z][A-Z_]*STRINGS)\.(?:\w+\.)*model\b/g, 'WORD')
        .replace(/^[^?:]*\?(?!\.)/, '')
        .replace(/^[^&]*&&/, '')
      if (RAW.test(shown) && !NAMING.test(shown)) hits.push({ where: `${rel}:${i + 1}`, code: code.trim().slice(0, 120) })
    }
    // A template text: `... ${id} ...`. Marks for tests and for the store of the app are not for a person.
    for (const m of line.matchAll(/\$\{([^{}]*)\}/g)) {
      const before = line.slice(0, m.index)
      if (/(?:data-[\w-]+|testid|key|id|href|src|to)=\{?`[^`]*$/.test(before)) continue
      // A text that is itself an id, a key or an address: "openai::<file>", "price:<model>", a route.
      if (/::\s*$|`(?:price|model|chat|task|lu-[\w-]*):[^`]*$|\/[\w/-]*$/.test(before)) continue
      found(m[1])
    }
    // A JSX text: >{id}< or a line that is only {id}.
    for (const m of line.matchAll(/>\s*\{([^{}]*)\}\s*</g)) found(m[1])
    const alone = /^\s*\{([^{}]*)\}\s*$/.exec(line)
    if (alone) found(alone[1])
    for (const m of line.matchAll(VISIBLE_PROP)) found(m[1])
  })
  return hits
}

/**
 * Places the net catches that are not an id shown to a person. Each with its reason.
 * A new entry needs one: "it is fine" is not a reason.
 */
const ALLOWED: ReadonlyArray<{ at: RegExp; why: string }> = [
  { at: /^mobile\/lib\/diagnostics\.ts:.*d\.device\.model|^mobile\/screens\/settings\/parts\/diagnostics\.ts:.*d\.device\.model/, why: 'the model of the PHONE ("Pixel 8"), not of the language model' },
  { at: /^mobile\/lib\/diagnostics\.ts:.*d\.engine\.model/, why: 'the file name the engine reports, read from model_path through fileName: it never carries a slot' },
  { at: /^mobile\/policy\/unfiltered/, why: 'store presets, another strand' },
]

describe('the sources of src/mobile', () => {
  const files = sourceFiles(MOBILE_DIR, ['.ts', '.tsx']).filter((f) => !f.rel.startsWith('mobile/dev/'))

  it('reads a real tree', () => {
    expect(files.length).toBeGreaterThan(200)
  })

  it('no stored model id stands in a JSX text, a template text or a visible prop without a naming function', () => {
    const hits = files.flatMap((f) => rawIdsInText(f.rel, f.text)).filter((hit) => !ALLOWED.some((a) => a.at.test(`${hit.where}:${hit.code}`)))
    expect(hits.map((h) => `${h.where}  ${h.code}`)).toEqual([])
  })

  it('counter-check: the net catches the forms the findings had', () => {
    const caught = (code: string) => rawIdsInText('x.tsx', code).length
    // F10 in the shape it would have in a page of the phone.
    expect(caught('lines.push(`_Model: ${conversation.model} | ${created}_`)')).toBe(1)
    // K11: the sheet "price" showed the id as its heading.
    expect(caught('<strong>{model.name}</strong>')).toBe(0) // a name of the catalogue is fine, the id is not:
    expect(caught('<strong>{message.modelId}</strong>')).toBe(1)
    expect(caught('<Row title={activeModel} />')).toBe(1)
    expect(caught('toast(`Loaded ${status.model}`)')).toBe(1)
    expect(caught('{conversationModel(chat)}')).toBe(1)
    // Hidden behind a condition it is still shown.
    expect(caught('<span>{ready ? status.model : S.none}</span>')).toBe(1)
  })

  it('the same text through a naming function passes, and so do marks for tests', () => {
    const caught = (code: string) => rawIdsInText('x.tsx', code).length
    expect(caught('lines.push(`_Model: ${chatModelLabel(models, conversation.model)}_`)')).toBe(0)
    expect(caught('<strong>{chatModelLabel(models, message.modelId)}</strong>')).toBe(0)
    expect(caught('<Row title={modelLabel(activeModel, models)} />')).toBe(0)
    expect(caught('<div data-m-model={view.model} data-testid={`m-x-${item.model}`} />')).toBe(0)
    expect(caught('nav.openSheet(`price:${row.model}`)')).toBe(0)
    // Asked, not shown.
    expect(caught('<p>{activeModel ? S.chat.emptyType : S.chat.emptyChoose}</p>')).toBe(0)
    expect(caught('<Row title={S.engine.model} />')).toBe(0)
  })
})
