/**
 * @vitest-environment jsdom
 *
 * 3.0.5: in Agent mode an attached file is copied into the chat's working
 * folder before the turn starts, so the file and shell tools can work on the
 * real bytes, and the message tells the model where it is. In Chat Tools mode
 * (plain chat that reaches for a tool) nothing is written to disk.
 *
 * Driven through the real `useAgentChat().sendAgentMessage`; only the network
 * is replaced. Outside Tauri the fs commands are HTTP calls to the dev
 * server, so the upload shows up here as requests to /local-api/fs-write-bytes.
 *
 * Run: npx vitest run src/hooks/__tests__/agent-files-land-in-the-working-folder.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../api/cloud/supabase', () => ({ getAccessToken: async () => 'session-token-abc' }))
vi.mock('../../api/rag', () => ({
  retrieveContext: async () => ({ context: { chunks: [], query: '', documentIds: [] }, scoredChunks: [] }),
  generateEmbeddings: async () => [[0.1, 0.2]],
}))
vi.mock('../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../useMemory', () => ({
  useMemory: () => ({ extractAndSave: async () => {} }),
  extractMemoriesFromPair: async () => {},
}))

import { useAgentChat } from '../useAgentChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useAgentModeStore } from '../../stores/agentModeStore'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useAgentLoopStore } from '../../stores/agentLoopStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useTodoStore } from '../../stores/todoStore'
import { useToolAuditStore } from '../../stores/toolAuditStore'
import { useChatNoticeStore } from '../../stores/chatNoticeStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'
import { CHAT_TOOLS } from '../../lib/chat-tool-intent'
import type { ChatFileInput } from '../../lib/chat-files'

const MODEL = 'lu-cloud::zai-org/GLM-5.3'
const BYTES = new Uint8Array([0x4e, 0x45, 0x53, 0x1a, 0x00, 0xff, 0x80, 0x0a])

function attached(): ChatFileInput {
  return {
    attachment: {
      name: 'mario.nes',
      size: BYTES.length,
      kind: 'NES ROM (iNES)',
      sha256: 'ab'.repeat(32),
      summary: 'This is a binary file. SUMMARY-MARKER',
    },
    file: new File([BYTES], 'mario.nes'),
  }
}

const answer = () =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'It is an NES ROM.' } }] })}\n\ndata: [DONE]\n\n`, {
    status: 200, headers: { 'content-type': 'text/event-stream' },
  })

interface Upload { path: string; base64: string; offset: number; last: boolean; chatId?: string; workingDirectory?: string }
let uploads: Upload[] = []
let modelRequests: string[] = []
/** How the fake backend answers an upload. */
let uploadAnswer: () => Response = () => new Response(JSON.stringify({ status: 'saved' }), { status: 200 })

function seed(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  useAgentModeStore.getState().setAgentModeActive(convId, true)
  return convId
}

beforeEach(() => {
  uploads = []
  modelRequests = []
  uploadAnswer = () => new Response(JSON.stringify({ status: 'saved' }), { status: 200 })
  registerBuiltinTools(toolRegistry)
  __resetRunStopsForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useAgentTaskStore.setState({ byConv: {} })
  useAgentLoopStore.setState({ loops: {} })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentModeStore.setState({ agentModeActive: {}, workspaces: {}, workspaceSlugs: {} })
  useTodoStore.setState({ byConversation: {}, updatedAt: {} })
  useToolAuditStore.setState({ entries: {} })
  useChatNoticeStore.getState().clear()
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' } })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } },
  }))
  useModelStore.setState({ models: [], activeModel: MODEL })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/local-api/fs-write-bytes')) {
      uploads.push(JSON.parse(String(init?.body)))
      return uploadAnswer()
    }
    if (url.includes('/chat/completions')) {
      modelRequests.push(String(init?.body))
      return answer()
    }
    return new Response('{}', { status: 200 })
  })
})
afterEach(() => vi.restoreAllMocks())

const userMessage = (convId: string) =>
  useChatStore.getState().conversations.find((c) => c.id === convId)!.messages.find((m) => m.role === 'user')!

describe('Agent mode: the file is in the working folder before the model is asked', () => {
  it('uploads the bytes into this chat\'s folder and names the path to the model', async () => {
    const convId = seed()
    const { result } = renderHook(() => useAgentChat())
    await act(async () => { await result.current.sendAgentMessage('what is this file?', undefined, { files: [attached()] }) })

    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatchObject({ path: 'mario.nes', offset: 0, last: true })
    // The same folder the file tools of this run use: the pinned chat slug.
    expect(uploads[0].chatId).toBe(useAgentModeStore.getState().workspaceSlugs[convId])
    expect(uploads[0].chatId).toBeTruthy()
    expect([...atob(uploads[0].base64)].map((c) => c.charCodeAt(0))).toEqual([...BYTES])

    expect(modelRequests.length).toBeGreaterThan(0)
    expect(modelRequests[0]).toContain('[Attached file: mario.nes]')
    expect(modelRequests[0]).toContain('Path in your working folder: mario.nes')
    // A binary in the folder: the facts and the path, no dump. The tools read
    // the bytes, and nothing is run without being asked (3.0.7).
    expect(modelRequests[0]).toContain('SHA-256: ')
    expect(modelRequests[0]).toContain('Do not run the file or open it as a program unless the user asks you to.')
    expect(modelRequests[0]).not.toContain('SUMMARY-MARKER')

    const stored = userMessage(convId)
    expect(stored.displayContent).toBe('what is this file?')
    expect(stored.files).toEqual([{ ...attached().attachment, workspacePath: 'mario.nes' }])
    expect(useChatNoticeStore.getState().notices).toEqual([])
  })

  // Discord feature request, 03.10.2026: a tool of a plugin (REA) runs in its own
  // folder, so the model gets the full path the backend saved the file under.
  it('the full path the backend saved the file under reaches the model and the chip', async () => {
    const convId = seed()
    uploadAnswer = () => new Response(JSON.stringify({ status: 'saved', path: '/home/me/agent-workspace/c1/mario.nes', bytes: 8 }), { status: 200 })
    const { result } = renderHook(() => useAgentChat())
    await act(async () => { await result.current.sendAgentMessage('what is this file?', undefined, { files: [attached()] }) })
    expect(modelRequests[0]).toContain('Full path on this computer: /home/me/agent-workspace/c1/mario.nes')
    expect(userMessage(convId).files![0]).toMatchObject({ workspacePath: 'mario.nes', absolutePath: '/home/me/agent-workspace/c1/mario.nes' })
  })

  it('a picked project folder is where the file goes', async () => {
    const convId = seed()
    useAgentModeStore.setState({ workspaces: { [convId]: { kind: 'folder', path: '/home/me/project' } } })
    const { result } = renderHook(() => useAgentChat())
    await act(async () => { await result.current.sendAgentMessage('look at it', undefined, { files: [attached()] }) })
    expect(uploads[0].workingDirectory).toBe('/home/me/project')
  })

  it('a name that is taken in the folder is never overwritten', async () => {
    const convId = seed()
    let first = true
    uploadAnswer = () => {
      if (!first) return new Response(JSON.stringify({ status: 'saved' }), { status: 200 })
      first = false
      return new Response(JSON.stringify({ error: 'File already exists: /ws/mario.nes' }), { status: 400 })
    }
    const { result } = renderHook(() => useAgentChat())
    await act(async () => { await result.current.sendAgentMessage('look at it', undefined, { files: [attached()] }) })
    expect(uploads.map((u) => u.path)).toEqual(['mario.nes', 'mario (1).nes'])
    expect(userMessage(convId).files![0].workspacePath).toBe('mario (1).nes')
    expect(modelRequests[0]).toContain('Path in your working folder: mario (1).nes')
  })

  it('a copy that fails does not stop the turn, and nobody is told the file is there', async () => {
    const convId = seed()
    uploadAnswer = () => new Response(JSON.stringify({ error: 'Write error: No space left on device' }), { status: 400 })
    const { result } = renderHook(() => useAgentChat())
    await act(async () => { await result.current.sendAgentMessage('look at it', undefined, { files: [attached()] }) })

    expect(modelRequests.length).toBeGreaterThan(0)
    expect(modelRequests[0]).toContain('The file could not be copied into your working folder. Only this summary is available.')
    expect(modelRequests[0]).not.toContain('Path in your working folder')
    expect(userMessage(convId).files![0].workspacePath).toBeUndefined()
    expect(useChatNoticeStore.getState().notices.map((n) => n.text)).toEqual([
      '"mario.nes" could not be copied into the working folder. The model only gets a summary of it.',
    ])
  })
})

describe('Chat Tools mode writes nothing to disk', () => {
  it('the model gets the summary and no path', async () => {
    const convId = seed()
    useAgentModeStore.getState().setAgentModeActive(convId, false)
    const { result } = renderHook(() => useAgentChat())
    await act(async () => {
      await result.current.sendAgentMessage('search the web for this rom', undefined, {
        curatedTools: CHAT_TOOLS,
        chatToolsMode: true,
        files: [attached()],
      })
    })
    expect(uploads).toEqual([])
    expect(modelRequests[0]).toContain('[Attached file: mario.nes]')
    expect(modelRequests[0]).toContain('The file itself is not available to you in this chat.')
    expect(userMessage(convId).files).toEqual([attached().attachment])
  })
})
