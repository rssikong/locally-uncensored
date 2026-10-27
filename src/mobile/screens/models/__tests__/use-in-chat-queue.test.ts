/**
 * "Use in chat" while another model is still loading (acceptance Android,
 * re-run, N2): the tap had no effect and no feedback. Now it is kept, shown,
 * and runs when the engine is free.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../hooks/useModels', () => ({ useModels: () => ({ setActiveModel: async () => {}, fetchModels: async () => {} }) }))
vi.mock('../../settings/parts/cloud-mode', () => ({ cloudIsOn: () => false, leaveCloud: () => {} }))
const toasts: Array<{ text: string; testid?: string }> = []
/** The action of the last toast, and where the app was sent. */
const way = vi.hoisted(() => ({ flow: null as string | null, action: undefined as { label: string; onPress: () => void } | undefined, went: [] as unknown[] }))
vi.mock('../../../ui', () => ({
  toast: (text: string, options?: { testid?: string; action?: { label: string; onPress: () => void } }) => {
    way.action = options?.action
    toasts.push({ text, testid: options?.testid })
  },
}))
vi.mock('../../../nav', () => ({ nav: { push: () => {}, getState: () => ({ flow: way.flow }), resetTo: (...args: unknown[]) => way.went.push(args) } }))
vi.mock('../../../../api/engine', async (original) => ({
  ...(await original<typeof import('../../../../api/engine')>()),
  bundledEngineStatus: async () => ({ running: false, model_path: null }),
  listBundledModels: async () => [],
}))

import { SWAP_WATCH_MS, __resetLuEngineSwapLockForTests, releaseLuEngineSwap, tryAcquireLuEngineSwap } from '../../../../api/lu-engine-swap-lock'
import { useModelStore } from '../../../../stores/modelStore'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { useEngineUi } from '../parts/engine'
import { __setUseInChatDoorsForTests, makeChatModel, type UseInChatDoors } from '../parts/use-in-chat'

const A = { name: 'SmolLM2-360M-Instruct-Q4_K_M', path: '/m/a.gguf' }
const B = { name: 'Qwen3.5-2B-UD-IQ2_M', path: '/m/b.gguf' }
const C = { name: 'Qwen3-0.6B-Q4_K_M', path: '/m/c.gguf' }

interface Gate { open: () => void; fail: () => void }

/** Doors whose load only ends when the test says so. */
function doors(): { doors: UseInChatDoors; started: string[]; gates: Gate[] } {
  const started: string[] = []
  const gates: Gate[] = []
  return {
    started,
    gates,
    doors: {
      fetchModels: async () => {},
      setActiveModel: (id) =>
        new Promise<void>((resolve) => {
          started.push(id)
          gates.push({
            open: () => {
              useModelStore.setState({ activeModel: id })
              resolve()
            },
            fail: () => resolve(),
          })
        }),
    },
  }
}

const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

beforeEach(() => {
  toasts.length = 0
  useEngineUi.setState({ busy: null, queued: null, failure: null, unloaded: null })
  useModelStore.setState({ activeModel: null, models: [A, B, C].map((f) => ({ name: `openai::${f.name}` })) as never })
  __setUseInChatDoorsForTests(null)
})

describe('use in chat is never dropped', () => {
  it('a tap while another model loads is kept, not started and not lost', async () => {
    const d = doors()
    __setUseInChatDoorsForTests(d.doors)
    const first = makeChatModel(A, d.doors)
    await settle()
    expect(useEngineUi.getState().busy?.kind).toBe('loading')

    await expect(makeChatModel(B, d.doors)).resolves.toBe('queued')
    expect(useEngineUi.getState().queued).toEqual(B)
    expect(d.started).toEqual([`openai::${A.name}`])

    d.gates[0].open()
    await expect(first).resolves.toBe('superseded')
    await settle()
    // The wish started by itself once the engine was free.
    expect(d.started).toEqual([`openai::${A.name}`, `openai::${B.name}`])
    expect(useEngineUi.getState().queued).toBeNull()
    expect(useEngineUi.getState().busy?.name).toBe('Qwen 3.5 2B IQ2_M')

    d.gates[1].open()
    await settle()
    expect(useModelStore.getState().activeModel).toBe(`openai::${B.name}`)
    expect(useEngineUi.getState().busy).toBeNull()
    // One sentence, about the model the user ended up with.
    expect(toasts).toEqual([{ text: S.models.nowChatModel('Qwen 3.5 2B IQ2_M'), testid: 'chat-model' }])
  })

  it('the last tap wins', async () => {
    const d = doors()
    __setUseInChatDoorsForTests(d.doors)
    void makeChatModel(A, d.doors)
    await settle()
    await makeChatModel(B, d.doors)
    await makeChatModel(C, d.doors)
    expect(useEngineUi.getState().queued).toEqual(C)
    d.gates[0].open()
    await settle()
    expect(d.started).toEqual([`openai::${A.name}`, `openai::${C.name}`])
  })

  it('a wish also waits for a plain load or an unload of this strand', async () => {
    const d = doors()
    __setUseInChatDoorsForTests(d.doors)
    useEngineUi.getState().setBusy({ name: '', kind: 'unloading' })
    await expect(makeChatModel(B, d.doors)).resolves.toBe('queued')
    expect(d.started).toEqual([])
    useEngineUi.getState().setBusy(null)
    await settle()
    expect(d.started).toEqual([`openai::${B.name}`])
  })

  it('without anything in the way it runs at once and says so', async () => {
    const d = doors()
    const run = makeChatModel(A, d.doors)
    await settle()
    d.gates[0].open()
    await expect(run).resolves.toBe('done')
    expect(toasts.map((t) => t.testid)).toEqual(['chat-model'])
  })

  it('a load that fails is said', async () => {
    const d = doors()
    __setUseInChatDoorsForTests(d.doors)
    const run = makeChatModel(A, d.doors)
    await settle()
    d.gates[0].fail()
    await expect(run).resolves.toBe('failed')
    expect(toasts.map((t) => t.testid)).toEqual(['load-failed'])
  })

  it('a wish for the model that became the chat model meanwhile is dropped without a second load', async () => {
    const d = doors()
    __setUseInChatDoorsForTests(d.doors)
    useEngineUi.getState().setBusy({ name: 'x', kind: 'loading' })
    await makeChatModel(B, d.doors)
    useModelStore.setState({ activeModel: `openai::${B.name}` })
    useEngineUi.getState().setBusy(null)
    await settle()
    expect(d.started).toEqual([])
    expect(useEngineUi.getState().queued).toBeNull()
  })
})

describe('the card and the detail page show the wish', () => {
  const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8')

  it('the button of the card is not locked just because another model loads', () => {
    const card = read('parts/ModelCard.tsx')
    const use = card.slice(card.indexOf('testid="m-models-use"'), card.indexOf('{S.models.useInChat}'))
    expect(use).toContain('disabled={loadingHere || queued}')
    expect(use).not.toContain('disabled={!!busy}')
    expect(card).toContain('data-testid="m-models-item-queued"')
  })

  it('the button of the detail page says why it waits', () => {
    const page = read('ModelDetailPage.tsx')
    const use = page.slice(page.indexOf('testid="m-models-detail-use"'), page.indexOf('{S.detail.useInChat}'))
    expect(use).toContain('disabledReason={queuedForChat ? S.models.loadsAfter(')
    expect(use).not.toContain('disabled={!!busy}')
  })

  it('the sentence names the model that is in the way', () => {
    expect(S.models.loadsAfter('Qwen 3.5 2B')).toBe('Loads after Qwen 3.5 2B')
    expect(S.models.loadsAfter('')).toBe('Loads next')
  })
})

describe('G10: "Use in chat" says where the model is used now', () => {
  beforeEach(() => {
    way.flow = null
    way.action = undefined
    way.went.length = 0
  })

  /** Doors that load at once. */
  const quick: UseInChatDoors = {
    fetchModels: async () => {},
    setActiveModel: async (id) => {
      useModelStore.setState({ activeModel: id })
    },
  }

  it('the toast carries the way into a new chat with this model', async () => {
    expect(await makeChatModel(A, quick)).toBe('done')
    expect(toasts.at(-1)).toEqual({ text: S.models.nowChatModel('SmolLM2 360M'), testid: 'chat-model' })
    expect(way.action?.label).toBe('New chat')
    way.action?.onPress()
    expect(way.went).toEqual([['chat', [{ route: '/chat/:id', params: { id: 'new' } }]]])
  })

  it('during the onboarding the toast has no way out of the flow', async () => {
    way.flow = 'onboarding'
    expect(await makeChatModel(A, quick)).toBe('done')
    expect(toasts.at(-1)?.testid).toBe('chat-model')
    expect(way.action).toBeUndefined()
  })
})

// Small iPhone, K15: "Use in chat" did nothing while the chat model was one that is too large for the phone.
// Two ways a tap could end without the right word were found in the code and are closed here.
describe('use in chat says something in every case (K15)', () => {
  beforeEach(() => __resetLuEngineSwapLockForTests())

  it('a swap of the engine that this page did not start: the wish waits and runs when the swap is over', async () => {
    const d = doors()
    __setUseInChatDoorsForTests(d.doors)
    // The model sheet of the chat, or a load that hangs, holds the engine.
    expect(tryAcquireLuEngineSwap()).toBe(true)
    expect(await makeChatModel(A, d.doors)).toBe('queued')
    expect(useEngineUi.getState().queued).toEqual(A)
    expect(d.started).toEqual([])
    // The card shows a line for it also without a name to wait for.
    expect(S.models.loadsAfter('')).toBe('Loads next')
    // Not "could not be loaded": nothing was tried yet.
    expect(toasts).toEqual([])

    releaseLuEngineSwap()
    await new Promise((r) => setTimeout(r, SWAP_WATCH_MS + 150))
    await settle()
    expect(d.started).toEqual([`openai::${A.name}`])
    d.gates[0].open()
    await settle()
    expect(useModelStore.getState().activeModel).toBe(`openai::${A.name}`)
    expect(toasts.at(-1)?.testid).toBe('chat-model')
  })

  it('the door of the logic layer throws: the tap ends with a sentence, not in silence', async () => {
    const failing: UseInChatDoors = { fetchModels: async () => {}, setActiveModel: async () => { throw new Error('engine gone') } }
    expect(await makeChatModel(A, failing)).toBe('failed')
    expect(toasts.at(-1)?.testid).toBe('load-failed')
    expect(useEngineUi.getState().busy).toBeNull()
  })
})
