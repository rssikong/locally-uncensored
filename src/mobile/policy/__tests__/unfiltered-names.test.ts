/**
 * Second check on Android, F10: the search of a store build offered three
 * repositories under the spelling "lorablated". The list that reads a name
 * knew "abliterated" and not that.
 *
 * The list is policy/unfiltered-names.ts and there is one of it. Held here:
 * every spelling is found in a name a hub would write, an ordinary name is
 * not, the phone catalogue agrees with it, and no other file of the phone
 * app keeps a list of its own.
 *
 * Run: npx vitest run src/mobile/policy/__tests__/unfiltered-names.test.ts
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join, relative } from 'path'
import { fileURLToPath } from 'url'
import { MOBILE_CHAT_MODELS } from '../../data/mobile-models'
import { downloadVerdict, isUnfilteredName, repoOffered, type StorePolicy } from '../../screens/models/parts/policy'
import { UNFILTERED_SPELLINGS, namesUnfiltered } from '../unfiltered-names'

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), '../..')

/** A build that lets foreign files in and lists no unfiltered model: the one a name has to be read in. */
const READS_NAMES: StorePolicy = { unfilteredCatalog: false, unfilteredMarketing: false, unfilteredWords: false, customModelUrl: true, hubSearch: true, ageGate: 'declare-18' }

describe('the one list of spellings for a model that does not refuse', () => {
  it('the three hits of the check are not offered, and cannot be fetched by their address either', () => {
    for (const repo of ['mlabonne/Hermes-3-Llama-3.1-8B-lorablated-GGUF', 'mlabonne/Llama-3.1-70B-Instruct-lorablated-GGUF', 'mlabonne/Hermes-3-Llama-3.1-70B-lorablated-GGUF']) {
      expect(namesUnfiltered(repo), repo).toBe(true)
      expect(repoOffered(READS_NAMES, repo), repo).toBe(false)
      const filename = `${repo.split('/')[1].replace(/-GGUF$/, '')}.Q4_K_M.gguf`
      expect(downloadVerdict(READS_NAMES, [{ filename, url: `https://huggingface.co/${repo}/resolve/main/${filename}` }]), repo).toBe('unfiltered')
    }
    // The same model without the word is an ordinary model and stays one.
    expect(repoOffered(READS_NAMES, 'NousResearch/Hermes-3-Llama-3.1-8B-GGUF')).toBe(true)
  })

  it('every spelling is found in its sample, as a repository, as a file name, in any case', () => {
    expect(UNFILTERED_SPELLINGS.length).toBeGreaterThanOrEqual(30)
    for (const spelling of UNFILTERED_SPELLINGS) {
      expect(!!spelling.part !== !!spelling.word, `${spelling.what}: a part or a word, one of the two`).toBe(true)
      const leaf = spelling.sample.split('/').pop()!
      for (const name of [spelling.sample, leaf, leaf.toLowerCase(), leaf.toUpperCase(), `${leaf.replace(/-GGUF$/i, '')}.Q4_K_M.gguf`, `https://huggingface.co/${spelling.sample}/resolve/main/model.gguf`]) {
        expect(namesUnfiltered(name), `${spelling.what}: ${name}`).toBe(true)
      }
    }
  })

  it('each sample is found by its own spelling, not by a neighbour that happens to match too', () => {
    for (const spelling of UNFILTERED_SPELLINGS) {
      const alone = spelling.part
        ? new RegExp(spelling.part, 'i').test(spelling.sample)
        : spelling.sample.toLowerCase().split(/[^a-z0-9+]+/).includes(spelling.word!)
      expect(alone, `${spelling.what}: ${spelling.sample}`).toBe(true)
    }
  })

  it('the spellings the order named are all on it', () => {
    for (const name of ['Foo-abliterated', 'Foo-lorablated', 'Foo-uncensored', 'Foo-unfiltered', 'Foo-no-refusals', 'Foo no refusals', 'Foo-heretic', 'Foo-obliterated', 'Foo-decensored', 'Foo-jailbroken', 'Foo-NSFW', 'Foo-ERP-7B', 'Foo_erp_7b', 'FooERP-7B']) {
      expect(namesUnfiltered(name), name).toBe(true)
    }
  })

  it('an ordinary name is not taken for one', () => {
    const ordinary = [
      'bartowski/Qwen3-4B-GGUF', 'unsloth/gemma-3-4b-it-GGUF', 'NousResearch/Hermes-3-Llama-3.1-8B-GGUF', 'HuggingFaceTB/SmolLM2-360M-Instruct-GGUF',
      'microsoft/Phi-4-mini-instruct-gguf', 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF', 'bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF',
      // A word of the list inside another word is not the word.
      'x/Serpent-7B-GGUF', 'x/Hyperparameter-3B-GGUF', 'x/Orthography-Tutor-1B-GGUF', 'x/Flexible-Llama-3B-GGUF', 'x/Lexicon-2B-GGUF', 'x/Table-Reader-1B-GGUF', 'x/Enabler-3B-GGUF', 'x/Filter-Bank-Audio-1B-GGUF',
      'x/Collaboration-Assistant-3B-GGUF', 'x/Smuts-History-1B-GGUF',
    ]
    for (const name of ordinary) expect(namesUnfiltered(name), name).toBe(false)
    expect(namesUnfiltered('')).toBe(false)
    expect(namesUnfiltered(null)).toBe(false)
    expect(namesUnfiltered(undefined)).toBe(false)
  })

  it('agrees with the phone catalogue: a marked model is named so or carries the mark alone, an unmarked one is never caught by its name', () => {
    for (const model of MOBILE_CHAT_MODELS) {
      const names = [model.name, model.filename, model.repo, model.downloadUrl]
      if (!model.uncensored) for (const name of names) expect(namesUnfiltered(name), `${model.id}: ${name}`).toBe(false)
    }
    // And the other way round for the names that say it outright.
    for (const model of MOBILE_CHAT_MODELS) {
      if (/abliterat|uncensor/i.test(`${model.name} ${model.filename} ${model.repo}`)) expect(namesUnfiltered(`${model.name} ${model.filename} ${model.repo}`), model.id).toBe(true)
    }
  })

  it('the catalogue of the models strand reads names with this list and has none of its own', () => {
    for (const spelling of UNFILTERED_SPELLINGS) expect(isUnfilteredName(spelling.sample), spelling.sample).toBe(true)
  })

  it('no other file of the phone app keeps a list of such spellings', () => {
    // A second list is how "lorablated" got through: a regular expression that names two of the spellings in one
    // alternation is a list. Tests and texts are not code that decides.
    const second = /\/[^/\n]*(abliterat|uncensor)[^/\n]*\|[^/\n]*\/[a-z]*|\/[^/\n]*\|[^/\n]*(abliterat|uncensor)[^/\n]*\/[a-z]*/
    const found: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          if (entry !== '__tests__' && entry !== 'strings' && entry !== 'dev') walk(full)
          continue
        }
        if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue
        const file = relative(MOBILE, full)
        if (file === join('policy', 'unfiltered-names.ts')) continue
        // Reads the instruction of a persona, which is prose ("no topic is off limits"), not the name of a model.
        if (file === join('policy', 'personas.ts')) continue
        readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
          if (second.test(line)) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`)
        })
      }
    }
    walk(MOBILE)
    expect(found).toEqual([])
  })
})
