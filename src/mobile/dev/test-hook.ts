/**
 * The hook of the acceptance build: window.__LU_TEST__.
 *
 * The acceptance frame (mobile-tests/) drives the app on a device. A few
 * things cannot be reached from outside by a finger: opening a page deep in
 * the app as a starting point, a full disk, an account without credits. For
 * those the acceptance build carries this object. It is documented in
 * mobile-tests/TESTIDS.md, section "Testhaken".
 *
 * It exists ONLY in a build made with VITE_LU_ABNAHME=1 (the web half of the
 * Rust feature `abnahme`). boot/index.tsx loads this file behind that
 * constant, so a store build does not even contain it. A guard in
 * src/mobile/__tests__/abnahme-haken.test.ts holds that.
 *
 * Nothing here signs in, pays or talks to a server.
 *
 * Version 2 (08.10.2026):
 *  - geraet({ ramBytes, freeBytes }) pretends a device. The memory reaches
 *    the fit calculation on every path (it is laid over the answer of the
 *    device AND set as the device of lib/device-fit.ts, which also wins over
 *    the rule for simulators). Screens that already asked are told to ask
 *    again (event lu-test-device).
 *  - speicherVoll and freeBytes act on what the WebView side asks
 *    (getDeviceInfo, getFreeStorageBytes: diagnostics, storage line where the
 *    native check has no folder). They do NOT act on the question before a
 *    download: that one is answered by the native check behind
 *    checkDownloadSpace (src/api/discover.ts), and no script of the WebView
 *    can make it lie. A full disk before a download can only be tested with
 *    a disk that is full. The answer of the hook says so in `nichtAuf`.
 *  - where() also names the store preset and the state of the account.
 *
 * Round 16:
 *  - testData() lays down one of each thing a detail page shows: a chat with
 *    an answer, a memory entry, a workflow with two steps, a group of the chat
 *    model in a second chat and a result in the gallery of Create. The frame
 *    opened about 25 pages with made up ids and only ever measured the page
 *    that says "This workflow is gone." (acceptance Android 4 GB, part 2).
 *    Nothing here asks the cloud: the result is a small picture kept in the
 *    page itself.
 */
import { CREDITS_EXHAUSTED_EVENT } from '../../lib/credits-exhausted'
import { useAgentWorkflowStore } from '../../stores/agentWorkflowStore'
import { useChatStore } from '../../stores/chatStore'
import { useCloudAuthStore } from '../../stores/cloudAuthStore'
import { useCreateStore, type GalleryItem } from '../../stores/createStore'
import { useMemoryStore } from '../../stores/memoryStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { navApi } from '../nav/api'
import * as core from '../nav/core'
import { TAB_ROOT_ROUTES } from '../nav/roots'
import { ROUTE_IDS, routeDef } from '../nav/routes'
import { SHEET_IDS } from '../nav/sheets'
import { TABS, type Params, type Tab } from '../nav/types'
import { NATIVE_EVENTS } from '../platform/contract'
import { setDeviceOverride } from '../lib/device-fit'
import { setDeviceInfoPatchForTests, type DeviceInfo } from '../platform/device'
import { previewBlockId } from '../screens/chat/parts/logic/markdown'
import { parseStorePreset, setStorePresetForTests, storePolicy, type StorePreset } from '../policy/storePolicy'

/** Survives a reload of the page, not a restart of the app. */
export const TEST_PRESET_KEY = 'lu-test-store-preset'

export type TestAnswer = { ok: true; [extra: string]: unknown } | { ok: false; reason: string }

export interface LuTestHook {
  /** Marks the object, so a flow can tell it from a leftover. */
  readonly version: 2
  /** Every route and sheet the app knows, and where it is right now. */
  where(): { flow: string | null; tab: Tab; route: string | null; params: Params; sheet: string | null; storePreset: StorePreset; account: string; routes: readonly string[]; sheets: readonly string[] }
  /** Open a page. A path with real values ("/chat/abc") or a route id with params. A tab root switches the tab. */
  go(path: string, params?: Params): TestAnswer
  /** Open a sheet by its id, with the props its opener would pass. */
  openSheet(id: string, props?: unknown): TestAnswer
  /** Close the top sheet. */
  closeSheet(): TestAnswer
  /** Merge values into the settings store (for example { onboardingDone: true }). */
  setSettings(patch: Record<string, unknown>): TestAnswer
  /** The onboarding counts as done (true) or as never done (false). True also leaves a running onboarding. */
  onboardingDone(done: boolean): TestAnswer
  /** Show a store preset. Kept for reloads of this page; null goes back to the preset of the build. Reloads the page unless told not to. */
  storePreset(preset: StorePreset | null, options?: { reload?: boolean }): TestAnswer
  /** Pretend a device: memory for the fit calculation, free storage for what the WebView asks. null is the real device again. */
  geraet(device: { ramBytes?: number; freeBytes?: number } | null): TestAnswer
  /** What the WebView asks about free storage answers 0 bytes (true) or what the phone says (false). Not the native check before a download. */
  speicherVoll(full: boolean): TestAnswer
  /** The account has no credits left: the meter reads 0 and the app is told a paid call was refused. */
  guthabenLeer(empty: boolean): TestAnswer
  /** The session ended without the user asking for it. The next look at the account asks the server again. */
  sitzungAblaufen(): TestAnswer
  /** The app is told that memory is low, as the native layer would tell it. Not the warning of the system itself. */
  speicherWarnung(): TestAnswer
  /**
   * A chat with one answer that holds a web page block, for the page preview (/chat/:id/preview/:blockId), which
   * no tap path reaches without a model that writes such an answer. Made once and found again by its title. The
   * hook only lays the chat down; the way to the preview is tapped (chat list, the chat, Preview on the block).
   */
  chatWithPage(): TestAnswer
  /**
   * One of each thing a detail page needs, so the frame opens the page itself and not the page that says the
   * thing is gone. Made once and found again (by title, or by a fixed id). Answers with the ids:
   * { chatId, messageId, blockId, memoryId, workflowId, stepId, groupChatId, groupModel, createItemId }. An id is null where
   * the thing could not be made, with the reason in `missing`. Asks no server and costs nothing.
   */
  testData(): TestAnswer
}

/** The title that marks the chat of chatWithPage, so a second call finds it instead of making another. */
export const TEST_PAGE_CHAT_TITLE = 'Test chat with a page'
const TEST_PAGE_ANSWER = ['Here is the page.', '', '```html', '<!doctype html>', '<html><body><h1>Sample page</h1><p>Made for the acceptance run.</p></body></html>', '```'].join('\n')

function chatWithPage(): TestAnswer {
  const store = useChatStore.getState()
  const known = store.conversations.find((c) => c.title === TEST_PAGE_CHAT_TITLE)
  const answerOf = (messages: readonly { id: string; role: string }[]) => messages.find((m) => m.role === 'assistant')?.id
  if (known) {
    const messageId = answerOf(known.messages)
    if (messageId) return { ok: true, id: known.id, messageId, blockId: previewBlockId(messageId, 0), made: false }
  }
  const id = known?.id ?? store.createConversation('', '')
  const stamp = Date.now()
  const messageId = `test-page-answer-${stamp}`
  store.addMessage(id, { id: `test-page-question-${stamp}`, role: 'user', content: 'Write a small web page.', timestamp: stamp })
  store.addMessage(id, { id: messageId, role: 'assistant', content: TEST_PAGE_ANSWER, timestamp: stamp + 1 })
  // After the messages: the first user message would otherwise name the chat.
  useChatStore.getState().renameConversation(id, TEST_PAGE_CHAT_TITLE)
  return { ok: true, id, messageId, blockId: previewBlockId(messageId, 0), made: true }
}

/** The marks testData finds its things by on a second call. */
export const TEST_MEMORY_TITLE = 'Test memory entry'
export const TEST_WORKFLOW_NAME = 'Test workflow'
export const TEST_GROUP_CHAT_TITLE = 'Test group chat'
export const TEST_CREATE_ITEM_ID = 'test-create-item'
export const TEST_STEP_IDS = ['test-step-1', 'test-step-2'] as const
/** A grey square of 8 by 8 pixels: the picture of the result in Create. Kept in the page, nothing is fetched. */
const TEST_PICTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR4nGNowAEYhpYEAILzYAGc7g8kAAAAAElFTkSuQmCC'

function testMemory(): string | null {
  const store = useMemoryStore.getState()
  const known = store.entries.find((e) => e.title === TEST_MEMORY_TITLE)
  if (known) return known.id
  const id = store.addMemory({
    type: 'reference',
    title: TEST_MEMORY_TITLE,
    description: 'Laid down by the acceptance run.',
    content: 'The acceptance run of LU laid this entry down. It may be deleted.',
    tags: ['test'],
    source: 'manual',
  })
  return id || null
}

function testWorkflow(): { workflowId: string; stepId: string } {
  const store = useAgentWorkflowStore.getState()
  const known = store.workflows.find((w) => w.name === TEST_WORKFLOW_NAME && !w.isBuiltIn)
  const steps = [
    { id: TEST_STEP_IDS[0], type: 'prompt' as const, label: 'Summarise the text', prompt: 'Summarise {{text}} in three sentences.' },
    { id: TEST_STEP_IDS[1], type: 'user_input' as const, label: 'Ask what to change' },
  ]
  if (known) {
    // A run of the frame may have removed a step: the page of the first step must have its step.
    if (!known.steps.some((step) => step.id === TEST_STEP_IDS[0])) store.updateWorkflow(known.id, { steps })
    return { workflowId: known.id, stepId: TEST_STEP_IDS[0] }
  }
  const workflowId = store.addWorkflow({ name: TEST_WORKFLOW_NAME, description: 'Laid down by the acceptance run.', icon: 'Workflow', steps, variables: { text: '' }, isBuiltIn: false })
  return { workflowId, stepId: TEST_STEP_IDS[0] }
}

/** A second chat whose group holds the chat model. Without a model there is nobody to put in the group. */
function testGroupChat(): { groupChatId: string; groupModel: string } | null {
  const model = useModelStore.getState().activeModel
  if (!model) return null
  const store = useChatStore.getState()
  const known = store.conversations.find((c) => c.title === TEST_GROUP_CHAT_TITLE)
  const id = known?.id ?? store.createConversation('', '')
  if (!known) {
    const stamp = Date.now()
    store.addMessage(id, { id: `test-group-question-${stamp}`, role: 'user', content: 'Hello to the group.', timestamp: stamp })
    store.addMessage(id, { id: `test-group-answer-${stamp}`, role: 'assistant', content: 'Hello.', timestamp: stamp + 1 })
    useChatStore.getState().renameConversation(id, TEST_GROUP_CHAT_TITLE)
  }
  if (!(useChatStore.getState().conversations.find((c) => c.id === id)?.groupModels ?? []).includes(model)) useChatStore.getState().setGroupModels(id, [model])
  return { groupChatId: id, groupModel: model }
}

function testCreateItem(): string {
  const store = useCreateStore.getState()
  const known = store.gallery.find((g) => g.id === TEST_CREATE_ITEM_ID)
  // The picture is kept in memory only (the store does not save it): given again after a restart of the app.
  if (known) {
    if (!known.dataUrl) store.updateGalleryItem(TEST_CREATE_ITEM_ID, { dataUrl: TEST_PICTURE })
    return TEST_CREATE_ITEM_ID
  }
  const item: GalleryItem = {
    id: TEST_CREATE_ITEM_ID,
    type: 'image',
    filename: 'test-result.png',
    subfolder: '',
    prompt: 'A grey square, laid down by the acceptance run.',
    negativePrompt: '',
    model: 'test-fixture',
    modelType: 'unknown',
    seed: 1,
    steps: 1,
    cfgScale: 1,
    sampler: 'none',
    scheduler: 'none',
    width: 8,
    height: 8,
    batchSize: 1,
    createdAt: Date.now(),
    dataUrl: TEST_PICTURE,
  }
  // Set directly, not through addToGallery: that one also moves the model choice of Create to the model of the item.
  useCreateStore.setState((state) => ({ gallery: [item, ...state.gallery] }))
  return TEST_CREATE_ITEM_ID
}

function testData(): TestAnswer {
  const chat = chatWithPage()
  if (!chat.ok) return chat
  const missing: Record<string, string> = {}
  const memoryId = testMemory()
  if (!memoryId) missing.memoryId = 'the memory store did not take the entry'
  const { workflowId, stepId } = testWorkflow()
  const group = testGroupChat()
  if (!group) missing.groupChatId = 'no chat model is chosen, so there is nobody to put in a group'
  const createItemId = testCreateItem()
  return { ok: true, chatId: chat.id, messageId: chat.messageId, blockId: chat.blockId, memoryId, workflowId, stepId, groupChatId: group?.groupChatId ?? null, groupModel: group?.groupModel ?? null, createItemId, missing }
}

function fail(reason: string): TestAnswer {
  return { ok: false, reason }
}

function isTab(value: string): value is Tab {
  return (TABS as readonly string[]).includes(value)
}

function go(path: string, params?: Params): TestAnswer {
  const match = params && (ROUTE_IDS as readonly string[]).includes(path) ? { route: path, params } : core.matchPath(path, ROUTE_IDS)
  if (!match) return fail(`no route matches ${path}`)
  const def = routeDef(match.route)
  if (!def) return fail(`unknown route ${match.route}`)
  if (def.kind === 'flow') {
    if (!navApi.getState().flow) navApi.startFlow('onboarding')
    if (match.route !== core.activeStack(navApi.getState()).at(-1)?.route) navApi.push(match.route, match.params)
    return { ok: true, route: match.route }
  }
  if (navApi.getState().flow) navApi.finishFlow('chat')
  if (def.kind === 'root') {
    const tab = (Object.keys(TAB_ROOT_ROUTES) as Tab[]).find((t) => TAB_ROOT_ROUTES[t] === match.route)
    if (!tab) return fail(`no tab for ${match.route}`)
    navApi.resetTo(tab, [])
    return { ok: true, route: match.route }
  }
  const tab = isTab(def.tab) ? def.tab : navApi.getState().tab
  navApi.resetTo(tab, [{ route: match.route, params: match.params }])
  return { ok: true, route: match.route }
}

function storePreset(preset: StorePreset | null, options?: { reload?: boolean }): TestAnswer {
  if (preset !== null && !parseStorePreset(preset)) return fail(`unknown preset ${String(preset)}`)
  try {
    if (preset === null) sessionStorage.removeItem(TEST_PRESET_KEY)
    else sessionStorage.setItem(TEST_PRESET_KEY, preset)
  } catch {
    /* without session storage the preset holds until the next load */
  }
  setStorePresetForTests(preset)
  // Screens read the switches when they are drawn, and the age question sits in front of everything.
  if (options?.reload !== false) window.setTimeout(() => location.reload(), 0)
  return { ok: true, preset: storePolicy().preset }
}

/** The preset a test picked before this page was loaded again. Called before the first screen is drawn. */
export function applySavedTestPreset(): void {
  try {
    const saved = parseStorePreset(sessionStorage.getItem(TEST_PRESET_KEY))
    if (saved) setStorePresetForTests(saved)
  } catch {
    /* nothing saved */
  }
}

/** Told to every screen that keeps an answer of the device: ask again. */
export const TEST_DEVICE_EVENT = 'lu-test-device'

const GIB = 1_073_741_824
/** What the hook lays over the device. Memory and storage are set apart, so one does not wipe the other. */
const pretended: { ram?: number; free?: number } = {}

function applyPretended(): void {
  const patch: Partial<DeviceInfo> = {}
  if (pretended.ram !== undefined) {
    patch.ramTotalBytes = pretended.ram
    // A simulator reports the memory of the Mac as its own: the pretended phone is none.
    patch.simulator = false
  }
  if (pretended.free !== undefined) patch.storageFreeBytes = pretended.free
  setDeviceInfoPatchForTests(Object.keys(patch).length > 0 ? patch : null)
  setDeviceOverride(pretended.ram !== undefined ? { ramGb: pretended.ram / GIB, label: 'test device' } : null)
  window.dispatchEvent(new CustomEvent(TEST_DEVICE_EVENT))
  // The models strand keeps one answer of the device for all its screens (fit marks, storage line).
  void import('../screens/models/parts/device').then((m) => m.refreshDevice()).catch(() => undefined)
}

const usable = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** Where a pretended free storage does not reach. */
const NOT_THE_DOWNLOAD = 'the question before a download (native check, checkDownloadSpace)'

export function createTestHook(): LuTestHook {
  return {
    version: 2,
    where() {
      const state = navApi.getState()
      const stack = core.activeStack(state)
      const top = stack.at(-1)
      const overlay = state.overlays.at(-1)
      return {
        flow: state.flow ?? null,
        tab: state.tab,
        route: top?.route ?? null,
        params: top?.params ?? {},
        sheet: overlay?.kind === 'sheet' ? overlay.sheet : null,
        storePreset: storePolicy().preset,
        account: useCloudAuthStore.getState().status,
        routes: ROUTE_IDS,
        sheets: SHEET_IDS,
      }
    },
    go,
    openSheet(id, props) {
      if (!(SHEET_IDS as readonly string[]).includes(id)) return fail(`unknown sheet ${id}`)
      navApi.openSheet(id, props)
      return { ok: true, sheet: id }
    },
    closeSheet() {
      navApi.closeSheet()
      return { ok: true }
    },
    setSettings(patch) {
      if (!patch || typeof patch !== 'object') return fail('a patch object is needed')
      useSettingsStore.getState().updateSettings(patch as Parameters<ReturnType<typeof useSettingsStore.getState>['updateSettings']>[0])
      return { ok: true }
    },
    onboardingDone(done) {
      useSettingsStore.getState().updateSettings({ onboardingDone: !!done })
      if (done && navApi.getState().flow) navApi.finishFlow('chat')
      if (!done && !navApi.getState().flow) navApi.startFlow('onboarding')
      return { ok: true, onboardingDone: !!done }
    },
    storePreset,
    chatWithPage,
    testData,
    geraet(device) {
      if (device === null) {
        pretended.ram = undefined
        pretended.free = undefined
        applyPretended()
        return { ok: true, geraet: null }
      }
      if (!device || typeof device !== 'object') return fail('an object with ramBytes or freeBytes is needed, or null')
      const { ramBytes, freeBytes } = device
      if (ramBytes === undefined && freeBytes === undefined) return fail('ramBytes or freeBytes is needed')
      if (ramBytes !== undefined && (!usable(ramBytes) || ramBytes === 0)) return fail('ramBytes must be a number above 0')
      if (freeBytes !== undefined && !usable(freeBytes)) return fail('freeBytes must be a number, 0 or more')
      if (ramBytes !== undefined) pretended.ram = ramBytes
      if (freeBytes !== undefined) pretended.free = freeBytes
      applyPretended()
      return { ok: true, ramBytes: pretended.ram ?? null, freeBytes: pretended.free ?? null, ...(pretended.free !== undefined ? { nichtAuf: NOT_THE_DOWNLOAD } : {}) }
    },
    speicherVoll(full) {
      pretended.free = full ? 0 : undefined
      applyPretended()
      return { ok: true, full: !!full, wirktAuf: 'getDeviceInfo, getFreeStorageBytes', nichtAuf: NOT_THE_DOWNLOAD }
    },
    guthabenLeer(empty) {
      const store = useCloudAuthStore.getState()
      if (!store.quota) return fail('no account is signed in, there is no meter to empty')
      if (empty) {
        const quota = store.quota
        store.setQuota({ ...quota, remaining: { ...quota.remaining, credits: 0 } })
        window.dispatchEvent(new CustomEvent(CREDITS_EXHAUSTED_EVENT, { detail: { reason: 'credits' } }))
      } else {
        window.dispatchEvent(new CustomEvent('lu-models-refresh'))
      }
      return { ok: true, empty: !!empty }
    },
    sitzungAblaufen() {
      const store = useCloudAuthStore.getState()
      if (store.status !== 'signed-in') return fail('no account is signed in')
      // What the logic layer writes when the server refuses the token for good.
      useCloudAuthStore.setState({ status: 'signed-out', user: null, licenseActive: false, access: false, quota: null })
      return { ok: true }
    },
    speicherWarnung() {
      window.dispatchEvent(new CustomEvent(NATIVE_EVENTS.memoryWarning))
      return { ok: true, weg: 'app-ereignis' }
    },
  }
}

declare global {
  interface Window {
    __LU_TEST__?: LuTestHook
  }
}

/** Put the hook on the window. Called by the boot of an acceptance build only. */
export function installTestHook(): LuTestHook {
  const hook = createTestHook()
  window.__LU_TEST__ = hook
  document.documentElement.dataset.luAbnahme = '1'
  return hook
}
