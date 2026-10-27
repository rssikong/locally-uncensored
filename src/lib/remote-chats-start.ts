/**
 * Shared chats: the bridge (lib/remote-chats-bridge.ts) wired to the real
 * desktop. Started once for the life of the window, like the Create runner.
 */
import { backendCall, isTauri } from '../api/backend'
import { createChatsBridge, chatMode, REMOTE_CHATS_EVENT, type ChatsAction, type ChatsBridgeDeps } from './remote-chats-bridge'
import { createDeskGate, setWindowDeskGate } from './remote-desk-gate'

let started: Promise<() => void> | null = null

async function realDeps(): Promise<ChatsBridgeDeps> {
  const [
    { useChatStore }, { useGenerationStore }, { useCodexStore }, { useAgentModeStore }, { useUIStore }, { useModelStore },
    { usePermissionStore }, { useCodexConfirmStore, subscribeCodexAnswers }, approvals, caps, files, senders, { isActiveCodexStatus },
    { toolRegistry }, { requestGenerationCancel }, { useSettingsStore }, { stopRun }, { useAgentTaskStore },
    chatModels, { useStagedChangesStore }, stagedApply, stagedAlways, { useRemoteStore },
  ] = await Promise.all([
    import('../stores/chatStore'), import('../stores/generationStore'), import('../stores/codexStore'), import('../stores/agentModeStore'),
    import('../stores/uiStore'), import('../stores/modelStore'), import('../stores/permissionStore'), import('../stores/codexConfirmStore'),
    import('./approval-queue'), import('./remote-turn-caps'), import('./chat-files'), import('./remote-chat-senders'), import('../types/codex'),
    import('../api/mcp/tool-registry'), import('../api/vram-handoff'), import('../stores/settingsStore'), import('./run-stop'), import('../stores/agentTaskStore'),
    import('./remote-chat-models'), import('../stores/stagedChangesStore'), import('./staged-apply'), import('./remote-staged-always'), import('../stores/remoteStore'),
  ])
  const isOpen = (convId: string) => useChatStore.getState().activeConversationId === convId && useUIStore.getState().currentView === 'chat'
  const deskGate = createDeskGate({ now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>), isOpen })
  setWindowDeskGate(deskGate)
  // Any key at the desktop counts as typing there.
  window.addEventListener('keydown', () => deskGate.typed(), { capture: true })
  useChatStore.subscribe((s, prev) => { if (s.activeConversationId !== prev.activeConversationId) deskGate.check() })
  useUIStore.subscribe((s, prev) => { if (s.currentView !== prev.currentView) deskGate.check() })
  const isBusy = (id: string) => !!useGenerationStore.getState().generating[id]
    || isActiveCodexStatus(useCodexStore.getState().threads[id]?.status ?? 'idle')
  return {
    conversations: () => useChatStore.getState().conversations,
    subscribeConversations: (fn) => useChatStore.subscribe(fn),
    isBusy,
    subscribeBusy: (fn) => {
      const a = useGenerationStore.subscribe(fn)
      const b = useCodexStore.subscribe(fn)
      return () => { a(); b() }
    },
    modeOf: (conv) => chatMode(conv, useAgentModeStore.getState().isActive(conv.id)),
    sync: (chats) => backendCall('remote_chats_sync', { chats }),
    report: (chatId, event) => backendCall('remote_chats_event', { chatId, event }),
    reply: (requestId, value) => backendCall('remote_chats_reply', { requestId, value }),
    focus: (convId) => {
      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)
      useCodexStore.getState().setChatMode(conv?.mode === 'codex' ? 'codex' : 'lu')
      useChatStore.getState().setActiveConversation(convId)
      useUIStore.getState().setView('chat')
    },
    waitForDesk: (convId, title) => deskGate.wait(convId, title),
    send: async (convId, mode, content, images, chatFiles) => {
      const sender = await senders.waitForChatSender(mode === 'code' ? 'code' : 'chat')
      if (!sender) throw new Error('The chat did not open on the computer.')
      // The send path writes into the open chat: it has to be this one.
      if (useChatStore.getState().activeConversationId !== convId) throw new Error('Another chat was opened on the computer before the message could go out.')
      await sender.send(content, images, chatFiles)
    },
    stop: (convId, mode) => {
      // The view's own Stop when it is open, otherwise the same steps by hand.
      const sender = senders.currentChatSender(mode === 'code' ? 'code' : 'chat')
      if (sender?.stop && (mode === 'code' || useChatStore.getState().activeConversationId === convId)) {
        sender.stop(convId)
        return
      }
      stopRun(convId)
      useAgentTaskStore.getState().cancelAll(convId)
      useGenerationStore.getState().abortConversation(convId)
      requestGenerationCancel(convId)
      approvals.drainApprovals(convId)
    },
    chatModels: () => {
      return chatModels.chatModelChoices(useModelStore.getState().models, useSettingsStore.getState().settings.appMode)
    },
    lastUsedModel: () => {
      const s = useModelStore.getState()
      return s.activeModel || (useSettingsStore.getState().settings.appMode === 'cloud' ? s.lastCloudModel : s.lastLocalModel) || null
    },
    useModel: (model) => {
      if (useModelStore.getState().activeModel !== model) useModelStore.getState().setActiveModel(model)
    },
    createChat: (title, mode, model) => {
      const store = useChatStore.getState()
      const useModel = model || useModelStore.getState().activeModel || ''
      const settings = useSettingsStore.getState()
      const persona = settings.settings.personasEnabled ? settings.getActivePersona() : null
      const id = store.createConversation(useModel, mode === 'code' ? '' : persona?.systemPrompt || '', mode === 'code' ? 'codex' : 'lu', mode === 'code' ? undefined : { persona })
      if (mode === 'code') useCodexStore.getState().startConversationMode(id)
      if (mode === 'agent') useAgentModeStore.getState().setAgentModeActive(id, true)
      if (title) store.renameConversation(id, title)
      // A chat the phone makes is shared from the start.
      store.setRemoteShared(id, true)
      return id
    },
    markFromPhone: (convId, messageId) => useChatStore.getState().markFromPhone(convId, messageId),
    prepareFile: (file) => files.prepareChatFile(file),
    setCaps: caps.setTurnCaps,
    clearCaps: caps.clearTurnCaps,
    approvals: {
      list: approvals.listApprovals,
      subscribe: approvals.subscribeApprovals,
      subscribeAnswers: approvals.subscribeApprovalAnswers,
      answer: (convId, id, approved) => approvals.answerApproval(convId, id, approved, 'phone'),
      allowForChat: (convId, toolName) => {
        const category = toolRegistry.getToolByName(toolName)?.category
        if (category) usePermissionStore.getState().setConversationOverride(convId, category, 'auto')
      },
      categoryOf: (toolName) => {
        const def = toolRegistry.getToolByName(toolName)
        return def ? caps.capCategory(def) : 'terminal'
      },
    },
    onStagedAlways: (convId, deviceId) => {
      if (deviceId === null) { stagedAlways.setStagedAlways(convId, null); return }
      const name = useRemoteStore.getState().pairedDevices.find((d) => d.device_id === deviceId)?.name
      stagedAlways.setStagedAlways(convId, name || 'your phone')
    },
    staged: {
      list: (convId) => useStagedChangesStore.getState().list(convId).map((c) => ({ id: c.id, path: c.path, created: !c.oldContent, diff: c.diff ?? '' })),
      subscribe: (fn) => useStagedChangesStore.subscribe(fn),
      subscribeApplied: (fn) => stagedApply.subscribeStagedApplied(fn),
      apply: async (convId, id) => {
        const change = useStagedChangesStore.getState().get(convId, id)
        return change ? stagedApply.applyStagedChange(convId, change) : false
      },
      reject: (convId, id) => useStagedChangesStore.getState().remove(convId, id),
    },
    codex: {
      queue: () => useCodexConfirmStore.getState().queue.map((w) => w.req),
      subscribe: (fn) => useCodexConfirmStore.subscribe(fn),
      subscribeAnswers: (fn) => subscribeCodexAnswers(fn),
      answer: (req, allow) => useCodexConfirmStore.getState().answerRequest(req as never, allow),
    },
  }
}

/** Listen for the phone's actions for the life of the window. Once. */
export function startRemoteChatsBridge(): Promise<() => void> {
  if (!isTauri()) return Promise.resolve(() => {})
  if (started) return started
  started = (async () => {
    const [{ listen }, deps] = await Promise.all([import('@tauri-apps/api/event'), realDeps()])
    const bridge = createChatsBridge(deps)
    const off = await listen<ChatsAction>(REMOTE_CHATS_EVENT, (e) => { void bridge.handle(e.payload) })
    bridge.refresh()
    return () => { off(); bridge.dispose() }
  })()
  return started
}
