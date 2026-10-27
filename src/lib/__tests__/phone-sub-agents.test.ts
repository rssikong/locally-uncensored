/**
 * Sub agents with a model of the phone: not in 3.0.7 (decision of 09.10.2026).
 *
 * A phone whose chat model runs on its own engine does not offer the tool
 * "Sub agents": not in the list a run draws on, not through the executor,
 * and no fan-out directive names it. A cloud model on a phone and every
 * desktop keep what they had. Every phone assertion has a desktop twin.
 *
 * Run: npx vitest run src/lib/__tests__/phone-sub-agents.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DESKTOPS, HANDHELDS, standOn } from '../../test-support/devices'
import { ToolRegistry } from '../../api/mcp/tool-registry'
import { registerBuiltinTools } from '../../api/mcp/builtin-tools'
import { DEFAULT_PERMISSIONS } from '../../api/mcp/types'
import { useModelStore } from '../../stores/modelStore'
import { placeOfProvider } from '../../mobile/lib/model-place'
import { getProviderIdFromModel } from '../../api/providers/model-name'
import { parseFanoutRequest } from '../agent-fanout'
import {
  SUB_AGENT_TOOLS, SUB_AGENTS_NEED_CLOUD, SUB_AGENTS_NEED_CLOUD_FOR_MODEL,
  isEngineModelName, subAgentsOffered, toolOfferedToChatModel,
} from '../phone-sub-agents'

const LOCAL = 'openai::Qwen3.5-2B-Q4_K_M'
const CLOUD = 'lu-cloud::glm-5.3'
const OWN = ['anthropic::claude-sonnet', 'openai-myhost::some-model']
const SUB = [...SUB_AGENT_TOOLS]

const choose = (name: string | null) => useModelStore.setState({ activeModel: name })

function registryHere(): ToolRegistry {
  const registry = new ToolRegistry()
  registerBuiltinTools(registry)
  return registry
}
const names = () => registryHere().getAll().map((t) => t.name)

afterEach(() => {
  vi.unstubAllGlobals()
  choose(null)
})

describe('which model runs on the phone', () => {
  it('the same answer as the model place of the phone pages', () => {
    for (const name of [LOCAL, CLOUD, ...OWN, 'qwen3:4b', 'openai::x']) {
      expect(isEngineModelName(name), name).toBe(placeOfProvider(getProviderIdFromModel(name)) === 'device')
    }
    expect(isEngineModelName(null)).toBe(false)
    expect(isEngineModelName('')).toBe(false)
  })
})

describe('a phone with a model of its own engine', () => {
  for (const device of HANDHELDS) {
    it(`${device}: the three sub agent tools are in no list`, () => {
      standOn(device)
      choose(LOCAL)
      expect(subAgentsOffered()).toBe(false)
      const have = names()
      for (const name of SUB) expect(have).not.toContain(name)
      // Everything else of the phone catalog is still there.
      for (const name of ['web_search', 'web_fetch', 'file_read', 'file_write', 'run_workflow', 'todo_write']) expect(have).toContain(name)
      const roster = registryHere().getAvailableTools(DEFAULT_PERMISSIONS).map((t) => t.name)
      for (const name of SUB) expect(roster).not.toContain(name)
      const wire = registryHere().toOpenAITools(DEFAULT_PERMISSIONS).map((t) => t.function.name)
      for (const name of SUB) expect(wire).not.toContain(name)
    })

    it(`${device}: a call by name does not start a run and names no model identifier`, async () => {
      standOn(device)
      choose(LOCAL)
      for (const name of SUB) {
        const answer = await registryHere().execute(name, { goal: 'write two sentences', background: true })
        expect(answer).toBe(SUB_AGENTS_NEED_CLOUD_FOR_MODEL)
        expect(answer).not.toMatch(/::|openai|Installed/)
      }
    })

    it(`${device}: "use 3 agents" is no fan-out wish`, () => {
      standOn(device)
      choose(LOCAL)
      expect(parseFanoutRequest('use 3 agents to research this')).toBeNull()
    })
  }
})

describe('a phone with a model that does not run on it: as before', () => {
  for (const device of HANDHELDS) {
    for (const model of [CLOUD, ...OWN]) {
      it(`${device}, ${model}: the tools are offered`, () => {
        standOn(device)
        choose(model)
        expect(subAgentsOffered()).toBe(true)
        const have = names()
        for (const name of SUB) expect(have).toContain(name)
        expect(parseFanoutRequest('use 3 agents to research this')?.count).toBe(3)
      })
    }
    it(`${device}: no model chosen offers them, as before`, () => {
      standOn(device)
      choose(null)
      for (const name of SUB) expect(names()).toContain(name)
    })
  }
})

describe('a desktop: unchanged, whatever the model', () => {
  for (const device of DESKTOPS) {
    for (const model of [LOCAL, 'qwen3:4b', CLOUD]) {
      it(`${device}, ${model}`, () => {
        standOn(device)
        choose(model)
        expect(subAgentsOffered()).toBe(true)
        for (const name of SUB) {
          expect(toolOfferedToChatModel(name)).toBe(true)
          expect(names()).toContain(name)
        }
        expect(parseFanoutRequest('use 3 agents to research this')?.count).toBe(3)
      })
    }
  }
})

describe('one rule, and the hook is not where it lives', () => {
  const src = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8')

  it('the agent hook reads its tools from the registry and knows nothing of this rule', () => {
    const hook = src('hooks/useAgentChat.ts')
    expect(hook).not.toMatch(/phone-sub-agents|subAgentsOffered/)
    expect(hook).toMatch(/toolRegistry\.getAll\(\)/)
    expect(hook).toMatch(/toolRegistry\.getAvailableTools\(permissions\)/)
  })

  it('the model store hands the chat model to the rule', () => {
    expect(src('stores/modelStore.ts')).toMatch(/setChatModelSource\(\(\) => useModelStore\.getState\(\)\.activeModel\)/)
  })

  it('the text for the user has no dash and no identifier', () => {
    expect(SUB_AGENTS_NEED_CLOUD).not.toMatch(/[–—]|::/)
  })
})
