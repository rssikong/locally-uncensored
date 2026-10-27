/**
 * Mobile, acceptance on Android with 8 GB, B6: "the model "OMIT" is not
 * installed here", and no sub-agent ever ran.
 *
 * Run: npx vitest run src/lib/__tests__/delegate-model.test.ts
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let mobile = false
vi.mock('../device-kind', async (orig) => ({ ...(await orig() as object), isMobile: () => mobile }))

import { chooseSubAgentModel, isFillerModelName } from '../delegate-model'
import { unresolvedModelNote } from '../agent-fanout'

const INSTALLED = [
  { name: 'openai::Qwen3-1.7B-Q4_K_M' },
  { name: 'openai::Qwen3.5-2B-Q4_K_M' },
  { name: 'lu-cloud::Qwen/Qwen3-32B', displayName: 'Qwen3 32B' },
]
const ACTIVE = 'openai::Qwen3.5-2B-Q4_K_M'
const isCloud = (name: string) => name.startsWith('lu-cloud::')
const phone = { singleSlot: true, isCloud }
const desktop = { singleSlot: false, isCloud }

afterEach(() => { mobile = false })

describe('a filler word is no wish, on every device', () => {
  it('knows the words of the acceptance and their kin', () => {
    for (const word of ['OMIT', 'user', 'none', 'null', 'default', 'current', 'same', ' Auto ', 'this model', '<model>', 'N/A', '']) {
      expect(isFillerModelName(word), word).toBe(true)
    }
    for (const name of ['Qwen3-1.7B', 'glm 5.2', 'gemma3:4b', 'user-tuned-llama']) {
      expect(isFillerModelName(name), name).toBe(false)
    }
  })

  it('runs on the model of the chat for "user" and "OMIT", phone and desktop alike', () => {
    for (const device of [phone, desktop]) {
      for (const word of ['user', 'OMIT', undefined, '  ']) {
        expect(chooseSubAgentModel(word, ACTIVE, INSTALLED, device)).toEqual({ model: ACTIVE })
      }
    }
  })
})

describe('a phone holds one local model', () => {
  it('a model nobody has falls back to the model of the chat, without an error', () => {
    expect(chooseSubAgentModel('glm 5.2', ACTIVE, INSTALLED, phone)).toEqual({ model: ACTIVE })
  })

  it('another local model that is installed still runs on the model of the chat: the slot is taken', () => {
    expect(chooseSubAgentModel('Qwen3 1.7B', ACTIVE, INSTALLED, phone)).toEqual({ model: ACTIVE })
  })

  it('a cloud model that exists is honoured, and so is the model of the chat by name', () => {
    expect(chooseSubAgentModel('Qwen3 32B', ACTIVE, INSTALLED, phone)).toEqual({ model: 'lu-cloud::Qwen/Qwen3-32B' })
    expect(chooseSubAgentModel('Qwen3.5 2B', ACTIVE, INSTALLED, phone)).toEqual({ model: ACTIVE })
  })

  it('no model at all stays no model', () => {
    expect(chooseSubAgentModel('OMIT', null, INSTALLED, phone)).toEqual({ model: null })
  })
})

describe('the desktop keeps its rule', () => {
  it('a wish that cannot be met is reported and never switched silently', () => {
    expect(chooseSubAgentModel('glm 5.2', ACTIVE, INSTALLED, desktop)).toEqual({ model: null, missing: 'glm 5.2' })
  })

  it('a wish that can be met wins over the model of the chat, local or cloud', () => {
    expect(chooseSubAgentModel('Qwen3 1.7B', ACTIVE, INSTALLED, desktop)).toEqual({ model: 'openai::Qwen3-1.7B-Q4_K_M' })
    expect(chooseSubAgentModel('Qwen3 32B', ACTIVE, INSTALLED, desktop)).toEqual({ model: 'lu-cloud::Qwen/Qwen3-32B' })
  })
})

describe('the note for a named model that is missing', () => {
  const ids = INSTALLED.map((m) => m.name)

  it('on the desktop it stops the run and lists what is installed, word for word as before', () => {
    expect(unresolvedModelNote('glm 5.2', ids)).toBe(
      'The model "glm 5.2" is not installed here, so do NOT start the agents yet.'
      + ' Tell the user it is missing and name what is installed instead (openai::Qwen3-1.7B-Q4_K_M, openai::Qwen3.5-2B-Q4_K_M, lu-cloud::Qwen/Qwen3-32B),'
      + ' then ask which one to use.',
    )
  })

  it('on a phone it names no identifier of the app and lets the run go on', () => {
    mobile = true
    const note = unresolvedModelNote('glm 5.2', ids)
    expect(note).not.toContain('::')
    expect(note).not.toContain('lu-cloud')
    expect(note).toContain('"glm 5.2"')
    expect(note).toContain('the model of this chat')
  })
})

describe('the runner and the lane lookup both ask here', () => {
  const src = readFileSync(resolve(__dirname, '../../api/agents/sub-agent.ts'), 'utf8')

  it('sub-agent.ts resolves the model in one way only', () => {
    expect(src.match(/chooseSubAgentModel\(/g)?.length).toBe(2)
    expect(src).not.toContain('resolveRequestedModel(')
  })
})
