// @vitest-environment jsdom
/** The hook of the acceptance build: it moves the app the way a test needs, and says so when it cannot. */
import { beforeEach, describe, expect, it } from 'vitest'
import { CREDITS_EXHAUSTED_EVENT } from '../../../lib/credits-exhausted'
import { useAgentWorkflowStore } from '../../../stores/agentWorkflowStore'
import { useChatStore } from '../../../stores/chatStore'
import { useCreateStore } from '../../../stores/createStore'
import { useMemoryStore } from '../../../stores/memoryStore'
import { useModelStore } from '../../../stores/modelStore'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { __setNavSaveForTests, navApi } from '../../nav/api'
import * as core from '../../nav/core'
import { TAB_ROOT_ROUTES } from '../../nav/roots'
import { assessFit, setDeviceOverride } from '../../lib/device-fit'
import { getFitDevice, getFreeStorageBytes, setDeviceInfoPatchForTests } from '../../platform/device'
import { setStorePresetForTests, storePolicy } from '../../policy/storePolicy'
import { fencedBlockIndex, isHtmlBlock, parsePreviewBlockId } from '../../screens/chat/parts/logic/markdown'
import { TEST_CREATE_ITEM_ID, TEST_DEVICE_EVENT, TEST_GROUP_CHAT_TITLE, TEST_MEMORY_TITLE, TEST_PAGE_CHAT_TITLE, TEST_PRESET_KEY, TEST_STEP_IDS, TEST_WORKFLOW_NAME, applySavedTestPreset, createTestHook, installTestHook } from '../test-hook'

let n = 0
const hook = createTestHook()

beforeEach(() => {
  __setNavSaveForTests(false)
  navApi.load(core.initialState(TAB_ROOT_ROUTES, (hint) => `${hint}-${++n}`))
  setStorePresetForTests(null)
  hook.geraet(null)
  setDeviceInfoPatchForTests(null)
  setDeviceOverride(null)
  sessionStorage.clear()
  useSettingsStore.getState().updateSettings({ onboardingDone: true })
  useCloudAuthStore.setState({ status: 'signed-out', user: null, licenseActive: false, access: false, quota: null })
})

describe('where and go', () => {
  it('opens a page by its path, with the values in it', () => {
    expect(hook.go('/chat/abc')).toMatchObject({ ok: true, route: '/chat/:id' })
    expect(hook.where()).toMatchObject({ tab: 'chat', route: '/chat/:id', params: { id: 'abc' }, sheet: null, flow: null })
  })

  it('opens a page by its route id and params', () => {
    expect(hook.go('/models/:id', { id: 'qwen' })).toMatchObject({ ok: true })
    expect(hook.where()).toMatchObject({ tab: 'models', route: '/models/:id', params: { id: 'qwen' } })
  })

  it('a tab root switches the tab and leaves nothing above it', () => {
    hook.go('/settings/about')
    expect(hook.go('/settings')).toMatchObject({ ok: true })
    expect(hook.where()).toMatchObject({ tab: 'settings', route: '/settings' })
    expect(core.activeStack(navApi.getState())).toHaveLength(1)
  })

  it('a page of the onboarding starts the onboarding, a page of the app ends it', () => {
    expect(hook.go('/setup/model')).toMatchObject({ ok: true })
    expect(hook.where()).toMatchObject({ flow: 'onboarding', route: '/setup/model' })
    hook.go('/chats')
    expect(hook.where()).toMatchObject({ flow: null, tab: 'chat', route: '/chats' })
  })

  it('says no to a path nobody knows', () => {
    expect(hook.go('/no/such/page')).toEqual({ ok: false, reason: 'no route matches /no/such/page' })
  })

  it('lists every route and sheet, for a sweep', () => {
    expect(hook.where().routes).toContain('/settings/about')
    expect(hook.where().sheets).toContain('model')
  })
})

describe('sheets', () => {
  it('opens and closes a sheet it knows', () => {
    expect(hook.openSheet('price', { chatId: 'a' })).toMatchObject({ ok: true })
    expect(hook.where().sheet).toBe('price')
    hook.closeSheet()
    expect(hook.where().sheet).toBeNull()
  })

  it('says no to a sheet nobody knows', () => {
    expect(hook.openSheet('nope')).toMatchObject({ ok: false })
  })
})

describe('stores', () => {
  it('sets a setting', () => {
    hook.setSettings({ onboardingDone: false })
    expect(useSettingsStore.getState().settings.onboardingDone).toBe(false)
  })

  it('onboardingDone(false) shows the onboarding, onboardingDone(true) leaves it', () => {
    hook.onboardingDone(false)
    expect(hook.where().flow).toBe('onboarding')
    hook.onboardingDone(true)
    expect(hook.where().flow).toBeNull()
    expect(useSettingsStore.getState().settings.onboardingDone).toBe(true)
  })
})

describe('store preset', () => {
  it('shows a preset and keeps it for a reload of the page', () => {
    expect(hook.storePreset('appstore', { reload: false })).toEqual({ ok: true, preset: 'appstore' })
    expect(storePolicy().purchase).toBe('none')
    expect(sessionStorage.getItem(TEST_PRESET_KEY)).toBe('appstore')
    setStorePresetForTests(null)
    applySavedTestPreset()
    expect(storePolicy().preset).toBe('appstore')
  })

  it('null goes back to the preset of the build', () => {
    hook.storePreset('play', { reload: false })
    hook.storePreset(null, { reload: false })
    expect(storePolicy().preset).toBe('open')
    expect(sessionStorage.getItem(TEST_PRESET_KEY)).toBeNull()
  })

  it('says no to a preset nobody knows', () => {
    expect(hook.storePreset('bazaar' as never, { reload: false })).toMatchObject({ ok: false })
    expect(storePolicy().preset).toBe('open')
  })
})

describe('where says what a flow has to know first', () => {
  it('names the store preset and the state of the account', () => {
    expect(hook.where()).toMatchObject({ storePreset: 'open', account: 'signed-out' })
    hook.storePreset('appstore', { reload: false })
    useCloudAuthStore.setState({ status: 'signed-in', user: { id: 'u', email: 'a@b.co' }, licenseActive: true, access: true })
    expect(hook.where()).toMatchObject({ storePreset: 'appstore', account: 'signed-in' })
  })

  it('is version 2', () => {
    expect(hook.version).toBe(2)
  })
})

describe('a pretended device', () => {
  const GIB = 1_073_741_824

  it('the memory reaches the fit calculation: a model that fits a big phone does not fit a small one', async () => {
    let told = 0
    const listen = () => { told += 1 }
    window.addEventListener(TEST_DEVICE_EVENT, listen)
    expect(hook.geraet({ ramBytes: 12 * GIB })).toMatchObject({ ok: true, ramBytes: 12 * GIB })
    const big = await getFitDevice()
    expect(big.resolved.device.ramGb).toBe(12)
    expect(hook.geraet({ ramBytes: 2 * GIB })).toMatchObject({ ok: true })
    const small = await getFitDevice()
    expect(small.resolved.device.ramGb).toBe(2)
    expect(small.resolved.source).toBe('override')
    expect(small.info.ramTotalBytes).toBe(2 * GIB)
    const model = { fileBytes: 3 * GIB }
    expect(assessFit({ device: big.resolved.device, model }).verdict).not.toBe('too-large')
    expect(assessFit({ device: small.resolved.device, model }).verdict).toBe('too-large')
    expect(told).toBe(2)
    window.removeEventListener(TEST_DEVICE_EVENT, listen)
  })

  it('free storage is set apart from memory, and says where it does not reach', async () => {
    hook.geraet({ ramBytes: 4 * GIB })
    const answer = hook.geraet({ freeBytes: 1000 })
    expect(answer).toMatchObject({ ok: true, ramBytes: 4 * GIB, freeBytes: 1000 })
    expect(String((answer as { nichtAuf?: string }).nichtAuf)).toContain('download')
    expect(await getFreeStorageBytes()).toBe(1000)
    expect((await getFitDevice()).resolved.device.ramGb).toBe(4)
    // A full disk and back leaves the pretended memory alone.
    hook.speicherVoll(true)
    expect(await getFreeStorageBytes()).toBe(0)
    hook.speicherVoll(false)
    expect((await getFitDevice()).resolved.device.ramGb).toBe(4)
  })

  it('null is the real device again', async () => {
    hook.geraet({ ramBytes: 2 * GIB, freeBytes: 0 })
    expect(hook.geraet(null)).toEqual({ ok: true, geraet: null })
    expect((await getFitDevice()).resolved.source).not.toBe('override')
    expect(await getFreeStorageBytes()).not.toBe(0)
  })

  it('says no to figures that are none', () => {
    expect(hook.geraet({})).toMatchObject({ ok: false })
    expect(hook.geraet({ ramBytes: 0 })).toMatchObject({ ok: false })
    expect(hook.geraet({ freeBytes: -1 })).toMatchObject({ ok: false })
    expect(hook.geraet('small' as never)).toMatchObject({ ok: false })
  })
})

describe('failure cases', () => {
  it('a full disk: the check for free storage answers 0, and the real answer comes back', async () => {
    const answer = hook.speicherVoll(true)
    expect(await getFreeStorageBytes()).toBe(0)
    // Honest about its reach: the native check before a download is not touched.
    expect(String((answer as { nichtAuf?: string }).nichtAuf)).toContain('checkDownloadSpace')
    hook.speicherVoll(false)
    expect(await getFreeStorageBytes()).not.toBe(0)
  })

  it('no credits: needs an account, then empties the meter and tells the app', () => {
    expect(hook.guthabenLeer(true)).toMatchObject({ ok: false })
    const quota = { tier: 'hosted', period: '2026-10', limits: { credits: 1000 }, costs: { image: 1, video: 10 }, used: { credits_used: 0 }, remaining: { credits: 400 } }
    useCloudAuthStore.setState({ status: 'signed-in', user: { id: 'u', email: 'a@b.co' }, licenseActive: true, access: true, quota: quota as never })
    let told = 0
    const on = () => {
      told += 1
    }
    window.addEventListener(CREDITS_EXHAUSTED_EVENT, on)
    expect(hook.guthabenLeer(true)).toMatchObject({ ok: true })
    window.removeEventListener(CREDITS_EXHAUSTED_EVENT, on)
    expect(told).toBe(1)
    expect(useCloudAuthStore.getState().quota?.remaining.credits).toBe(0)
  })

  it('an ended session: needs an account, then the account is signed out', () => {
    expect(hook.sitzungAblaufen()).toMatchObject({ ok: false })
    useCloudAuthStore.setState({ status: 'signed-in', user: { id: 'u', email: 'a@b.co' }, licenseActive: true, access: true })
    expect(hook.sitzungAblaufen()).toMatchObject({ ok: true })
    expect(useCloudAuthStore.getState().status).toBe('signed-out')
  })

  it('low memory reaches the app as the event of the native layer', () => {
    let heard = 0
    const on = () => {
      heard += 1
    }
    window.addEventListener('lu:memory-warning', on)
    hook.speicherWarnung()
    window.removeEventListener('lu:memory-warning', on)
    expect(heard).toBe(1)
  })
})

describe('install', () => {
  it('puts the object on the window and marks the document', () => {
    const installed = installTestHook()
    expect(window.__LU_TEST__).toBe(installed)
    expect(document.documentElement.dataset.luAbnahme).toBe('1')
    delete window.__LU_TEST__
    delete document.documentElement.dataset.luAbnahme
  })
})

describe('chatWithPage', () => {
  beforeEach(() => useChatStore.setState({ conversations: [], activeConversationId: null }))

  it('lays down one chat whose answer holds a web page block, and names the block the preview opens', () => {
    const answer = hook.chatWithPage() as { ok: true; id: string; messageId: string; blockId: string; made: boolean }
    expect(answer).toMatchObject({ ok: true, made: true })
    const chat = useChatStore.getState().conversations.find((c) => c.id === answer.id)
    expect(chat?.title).toBe(TEST_PAGE_CHAT_TITLE)
    const message = chat?.messages.find((m) => m.id === answer.messageId)
    expect(message?.role).toBe('assistant')
    const fence = /```(\w+)\n([\s\S]*?)\n```/.exec(message?.content ?? '')
    expect(fence && isHtmlBlock(fence[1], fence[2])).toBe(true)
    const line = (message?.content ?? '').split('\n').findIndex((l) => l.startsWith('```')) + 1
    expect(parsePreviewBlockId(answer.blockId)).toEqual({ messageId: answer.messageId, index: fencedBlockIndex(message?.content ?? '', line) })
  })

  it('finds its chat again instead of making a second one', () => {
    const first = hook.chatWithPage() as { ok: true; id: string; blockId: string }
    const second = hook.chatWithPage() as { ok: true; id: string; blockId: string; made: boolean }
    expect(second).toMatchObject({ id: first.id, blockId: first.blockId, made: false })
    expect(useChatStore.getState().conversations.filter((c) => c.title === TEST_PAGE_CHAT_TITLE)).toHaveLength(1)
  })
})

describe('testData', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [], activeConversationId: null })
    useMemoryStore.setState({ entries: [] })
    useAgentWorkflowStore.setState({ workflows: useAgentWorkflowStore.getState().workflows.filter((w) => w.isBuiltIn) })
    useCreateStore.setState({ gallery: [] })
    useModelStore.setState({ activeModel: 'openai::Qwen3.5-0.8B-Q4_K_M' })
  })

  type Data = { ok: true; chatId: string; messageId: string; blockId: string; memoryId: string | null; workflowId: string; stepId: string; groupChatId: string | null; groupModel: string | null; createItemId: string; missing: Record<string, string> }

  it('lays down one of each thing a detail page shows, and every id it names exists', () => {
    const data = hook.testData() as Data
    expect(data.ok).toBe(true)
    expect(data.missing).toEqual({})
    const chat = useChatStore.getState().conversations.find((c) => c.id === data.chatId)
    expect(chat?.messages.some((m) => m.id === data.messageId && m.role === 'assistant')).toBe(true)
    expect(useMemoryStore.getState().entries.find((e) => e.id === data.memoryId)?.title).toBe(TEST_MEMORY_TITLE)
    const workflow = useAgentWorkflowStore.getState().workflows.find((w) => w.id === data.workflowId)
    expect(workflow?.name).toBe(TEST_WORKFLOW_NAME)
    expect(workflow?.steps.map((step) => step.id)).toEqual([...TEST_STEP_IDS])
    expect(workflow?.steps.some((step) => step.id === data.stepId)).toBe(true)
    const group = useChatStore.getState().conversations.find((c) => c.id === data.groupChatId)
    expect(group?.title).toBe(TEST_GROUP_CHAT_TITLE)
    expect(group?.groupModels).toEqual(['openai::Qwen3.5-0.8B-Q4_K_M'])
    expect(data.groupModel).toBe('openai::Qwen3.5-0.8B-Q4_K_M')
    expect(group?.messages.length).toBe(2)
    const item = useCreateStore.getState().gallery.find((g) => g.id === data.createItemId)
    expect(item?.id).toBe(TEST_CREATE_ITEM_ID)
    // The picture is in the page itself: nothing is fetched, no cloud job stands behind it.
    expect(item?.dataUrl?.startsWith('data:image/png;base64,')).toBe(true)
    expect(item?.remoteUrl).toBeUndefined()
    expect(item?.jobId).toBeUndefined()
  })

  it('finds everything again on a second call and makes nothing twice', () => {
    const first = hook.testData() as Data
    const second = hook.testData() as Data
    expect({ ...second }).toEqual({ ...first })
    expect(useChatStore.getState().conversations).toHaveLength(2)
    expect(useMemoryStore.getState().entries.filter((e) => e.title === TEST_MEMORY_TITLE)).toHaveLength(1)
    expect(useAgentWorkflowStore.getState().workflows.filter((w) => w.name === TEST_WORKFLOW_NAME)).toHaveLength(1)
    expect(useCreateStore.getState().gallery.filter((g) => g.id === TEST_CREATE_ITEM_ID)).toHaveLength(1)
  })

  it('gives the picture back after a restart, and the step back after it was removed', () => {
    const data = hook.testData() as Data
    useCreateStore.getState().updateGalleryItem(TEST_CREATE_ITEM_ID, { dataUrl: undefined })
    useAgentWorkflowStore.getState().updateWorkflow(data.workflowId, { steps: [] })
    hook.testData()
    expect(useCreateStore.getState().gallery.find((g) => g.id === TEST_CREATE_ITEM_ID)?.dataUrl).toBeTruthy()
    expect(useAgentWorkflowStore.getState().workflows.find((w) => w.id === data.workflowId)?.steps.map((s) => s.id)).toEqual([...TEST_STEP_IDS])
  })

  it('without a chat model there is no group, and the answer says why', () => {
    useModelStore.setState({ activeModel: null })
    const data = hook.testData() as Data
    expect(data.ok).toBe(true)
    expect(data.groupChatId).toBeNull()
    expect(data.missing.groupChatId).toMatch(/no chat model/)
    expect(data.workflowId).toBeTruthy()
  })
})
