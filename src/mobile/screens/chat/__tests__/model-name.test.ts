import { afterEach, describe, expect, it } from 'vitest'
import { __resetEngineViewForTests, withEngineThinking } from '../../../../lib/engine-view'
import { useModelStore } from '../../../../stores/modelStore'
import { __resetCatalogueFactsForTests, catalogueModel, chatModelLabel, installCatalogueFacts } from '../parts/model-name'

const rows = [
  { name: 'openai::SmolLM2-360M-Instruct-Q4_K_M', provider: 'openai', type: 'text' },
  { name: 'openai::Qwen3-0.6B-Q4_K_M', provider: 'openai', type: 'text' },
  { name: 'openai::my-own-finetune-Q5_K_M', provider: 'openai', type: 'text' },
  { name: 'lu-cloud::moonshotai/Kimi-K2.6', provider: 'lu-cloud', type: 'text', displayName: 'Kimi K2.6' },
]

describe('chatModelLabel', () => {
  it('shows the name of the catalogue for a file the catalogue offers', () => {
    expect(chatModelLabel(rows, 'openai::SmolLM2-360M-Instruct-Q4_K_M')).toBe('SmolLM2 360M')
    expect(chatModelLabel(rows, 'openai::Qwen3-0.6B-Q4_K_M')).toBe('Qwen3 0.6B')
    // A message keeps the bare name of its model.
    expect(chatModelLabel(rows, 'SmolLM2-360M-Instruct-Q4_K_M')).toBe('SmolLM2 360M')
    expect(chatModelLabel(rows, 'SmolLM2-360M-Instruct-Q4_K_M.gguf')).toBe('SmolLM2 360M')
  })
  it('keeps the name of a file the catalogue does not know, exactly', () => {
    expect(chatModelLabel(rows, 'openai::my-own-finetune-Q5_K_M')).toBe('my-own-finetune-Q5_K_M')
    // A file of another model with a similar name is not passed off as a model of the catalogue.
    expect(chatModelLabel(rows, 'openai::SmolLM2-360M-Coder-Q4_K_M')).toBe('SmolLM2-360M-Coder-Q4_K_M')
  })
  it('names a file the way the list "Installed" names it (round 6, acceptance Android 8 GB, N1)', () => {
    // Another packing of a catalogue model: the model with its packing, not the file.
    expect(chatModelLabel(rows, 'openai::HuggingFaceTB_SmolLM3-3B-IQ2_M')).toBe('SmolLM3 3B IQ2_M')
    expect(chatModelLabel(rows, 'openai::Qwen3.5-2B-UD-IQ2_M')).toBe('Qwen 3.5 2B IQ2_M')
    // The listed file in another spelling is the same file on a phone, and "Installed" has called it by the
    // catalogue since round 5. The chat said the file name there until round 6.
    expect(chatModelLabel(rows, 'openai::smollm2-360m-instruct-q4_k_m')).toBe('SmolLM2 360M')
  })
  it('leaves a cloud model to the name its catalogue gives it', () => {
    expect(chatModelLabel(rows, 'lu-cloud::moonshotai/Kimi-K2.6')).toBe('Kimi K2.6')
    expect(catalogueModel('lu-cloud::moonshotai/Kimi-K2.6')).toBeUndefined()
    expect(catalogueModel(null)).toBeUndefined()
  })
})

describe('the catalogue tells the logic layer which files think', () => {
  afterEach(() => {
    __resetCatalogueFactsForTests()
    __resetEngineViewForTests()
    useModelStore.setState({ models: [] } as never)
  })

  it('SmolLM2 does not think, Qwen3 does, an unknown file stays a guess', () => {
    useModelStore.setState({ models: rows } as never)
    installCatalogueFacts()
    const after = useModelStore.getState().models as Array<{ name: string; thinkMode?: string }>
    expect(after.find((m) => m.name.endsWith('SmolLM2-360M-Instruct-Q4_K_M'))?.thinkMode).toBe('never')
    expect(after.find((m) => m.name.endsWith('Qwen3-0.6B-Q4_K_M'))?.thinkMode).toBe('toggle')
    expect(after.find((m) => m.name.endsWith('my-own-finetune-Q5_K_M'))?.thinkMode).toBeUndefined()
    expect(after.find((m) => m.name.startsWith('lu-cloud::'))?.thinkMode).toBeUndefined()
  })

  it('what the running engine says wins over the catalogue', () => {
    const hint = (bare: string) => (bare === 'SmolLM2-360M-Instruct-Q4_K_M' ? false : undefined)
    const said = withEngineThinking(rows as never[], { 'SmolLM2-360M-Instruct-Q4_K_M': true }, hint) as Array<{ name: string; thinkMode?: string }>
    expect(said[0].thinkMode).toBe('toggle')
    const silent = withEngineThinking(rows as never[], {}, hint) as Array<{ name: string; thinkMode?: string }>
    expect(silent[0].thinkMode).toBe('never')
    expect(silent[1].thinkMode).toBeUndefined()
    // Without a hint and without facts nothing is touched: the desktop.
    expect(withEngineThinking(rows as never[], {})).toBe(rows)
    // A hint that throws is no answer.
    expect(
      withEngineThinking(rows as never[], {}, () => {
        throw new Error('x')
      }),
    ).toBe(rows)
  })
})
