/**
 * A13 (21.10.2026): image_generate and video_generate on a Mac, from the tool
 * call to what the chat shows.
 *
 * The real executors and reference rules; the Mac engines are stand-ins at
 * their API (mlx-image, mlx-video), so what each call hands them can be read.
 * Before A13, on a Mac: an input picture was dropped and a new one made from
 * text, "attachment 1" and a result's file name reached the video engine as
 * they were ("init_image not found"), and Stop reached neither engine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const io = vi.hoisted(() => ({
  conversations: [] as Array<{ id: string; messages: Array<Record<string, unknown>> }>,
  imageCalls: [] as Array<{ args: Record<string, unknown>; signal?: AbortSignal }>,
  videoCalls: [] as Array<Record<string, unknown>>,
  staged: 0,
  cancelVideo: 0,
  videoStatus: 'running' as string,
  imageModels: [
    { id: 'sd-turbo', name: 'SD-Turbo', installed: true, editImages: 0 },
    { id: 'qwen-image-2.1', name: 'Qwen-Image 2.1', installed: true, editImages: 3, loras: true },
  ] as Array<Record<string, unknown>>,
  imageHangs: false,
  evicted: 0,
  restored: 0,
}))

vi.mock('../../backend', async (orig) => ({
  ...(await orig<typeof import('../../backend')>()),
  backendCall: vi.fn(async () => null),
  isTauri: () => false,
}))
vi.mock('../../agents/sub-agent', () => ({
  DELEGATE_TASK_TOOL_DEF: { name: 'delegate_task', description: '', category: 'system', inputSchema: {} },
  buildDelegateExecutor: () => async () => 'stub',
}))
vi.mock('../../../lib/workflow-engine', () => ({ WorkflowEngine: class {} }))
vi.mock('../../../stores/chatStore', () => ({
  useChatStore: { getState: () => ({ conversations: io.conversations, activeConversationId: 'c1' }) },
}))
vi.mock('../../vram-handoff', async (orig) => ({
  ...(await orig<typeof import('../../vram-handoff')>()),
  evictChatBackendsForRender: async () => { io.evicted += 1; return { ollamaModel: 'chat' } },
  restoreChatBackendsAfterRender: async () => { io.restored += 1 },
}))
vi.mock('../../mlx-image', async (orig) => ({
  ...(await orig<typeof import('../../mlx-image')>()),
  isMlxImageHost: () => true,
  listMlxImageModels: async () => io.imageModels,
  generateMlxImageDataUrl: (args: Record<string, unknown>, watch: { signal?: AbortSignal } = {}) => {
    io.imageCalls.push({ args, signal: watch.signal })
    if (io.imageHangs) {
      return new Promise((_r, reject) => watch.signal?.addEventListener('abort', () => reject(new Error('The image was cancelled.'))))
    }
    return Promise.resolve({ dataUrl: 'data:image/png;base64,AA', width: 1024, height: 1024, localPath: '/Users/t/Library/LU/images/mlx-2.png' })
  },
}))
vi.mock('../../mlx-video', async (orig) => ({
  ...(await orig<typeof import('../../mlx-video')>()),
  stageStartImage: async () => { io.staged += 1; return `/Users/t/Library/LU/video/start-images/staged-${io.staged}.png` },
  getVideoStatus: async () => ({ available: true, mlxInstalled: true, ltx2MlxInstalled: true }),
  listVideoModels: async () => [
    { id: 'ltx-2.3', name: 'LTX 2.3', installed: true, fps: 24, acceptsImage: true, requiresImage: false, negativePrompt: false },
  ],
  generateVideo: async (p: Record<string, unknown>) => { io.videoCalls.push(p); return { output: '/Users/t/Library/LU/video/clip-1.mp4' } },
  getVideoProgress: async () => ({ status: io.videoStatus }),
  cancelVideo: async () => { io.cancelVideo += 1; return { ok: true } },
}))

import { registerBuiltinTools } from '../builtin-tools'
import { ToolRegistry } from '../tool-registry'
import type { AgentRunContext } from '../../agent-context'
import { mediaCallSucceeded } from '../../../lib/media-result'
import { localMediaUrlFromResult } from '../../../components/chat/ToolCallBlock'
import { fileUrlToPath } from '../../../lib/local-media-url'

const registry = new ToolRegistry()
registerBuiltinTools(registry)
const run = { token: 't', chatId: null, conversationId: 'c1', workspace: null, artifactMode: false, readOnlyShellTurn: false, mode: null } as unknown as AgentRunContext
const B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')

function earlierMacImage(path: string) {
  const name = path.split('/').pop()
  return {
    role: 'assistant', content: '',
    agentBlocks: [{ id: 'b', phase: 'tool_call', content: '', timestamp: 1, toolCalls: [{
      id: `call-${name}`, toolName: 'image_generate', args: {}, status: 'completed', timestamp: 1,
      result: `Image generated: ${name} (prompt: "x")\nfile://${path}`,
    }] }],
  }
}

beforeEach(() => {
  io.imageCalls.length = 0
  io.videoCalls.length = 0
  io.staged = 0
  io.cancelVideo = 0
  io.videoStatus = 'running'
  io.imageHangs = false
  io.evicted = 0
  io.restored = 0
  io.imageModels = [
    { id: 'sd-turbo', name: 'SD-Turbo', installed: true, editImages: 0 },
    { id: 'qwen-image-2.1', name: 'Qwen-Image 2.1', installed: true, editImages: 3, loras: true },
  ]
  io.conversations = [{ id: 'c1', messages: [{ role: 'user', content: 'hi' }] }]
})

describe('image_generate on a Mac', () => {
  it('a picture from text: a file on disk, shown in the chat after a restart too, memory handed over and back', async () => {
    const out = await registry.execute('image_generate', { prompt: 'a lighthouse', settings: { aspectRatio: '9:16' } }, 1, run)
    expect(out).toBe('Image generated: mlx-2.png (prompt: "a lighthouse")\nfile:///Users/t/Library/LU/images/mlx-2.png')
    expect(mediaCallSucceeded('image_generate', out)).toBe(true)
    expect(fileUrlToPath(localMediaUrlFromResult(out)!)).toBe('/Users/t/Library/LU/images/mlx-2.png')
    const a = io.imageCalls[0].args
    expect(Number(a.height)).toBeGreaterThan(Number(a.width))
    expect(a.images).toBeUndefined()
    expect([io.evicted, io.restored]).toEqual([1, 1])
  })

  it('an edit of "attachment 1": staged on disk, given to a model that edits, as the image of the edit', async () => {
    io.conversations[0].messages.push({ role: 'user', content: 'red sky', images: [{ name: 'beach.png', mimeType: 'image/png', data: B64 }] })
    const out = await registry.execute('image_generate', { prompt: 'make the sky red', inputImage: 'attachment 1' }, 1, run)
    expect(mediaCallSucceeded('image_generate', out)).toBe(true)
    const a = io.imageCalls[0].args
    expect(a.model).toBe('qwen-image-2.1')
    expect(a.images).toEqual(['/Users/t/Library/LU/video/start-images/staged-1.png'])
    expect(a.strength).toBe(1)
    expect(a.resolution).toBe(1056) // 1024 is the side the engine moves
  })

  it('an edit of an earlier picture of the chat: its path, no copy', async () => {
    io.conversations[0].messages.push(earlierMacImage('/Users/t/Library/LU/images/mlx-1.png'))
    await registry.execute('image_generate', { prompt: 'same at night', inputImage: 'mlx-1.png', denoise: 0.7 }, 1, run)
    expect(io.imageCalls[0].args.images).toEqual(['/Users/t/Library/LU/images/mlx-1.png'])
    expect(io.imageCalls[0].args.strength).toBe(0.7)
    expect(io.staged).toBe(0)
  })

  it('no model that edits: said plainly, and no picture from text in its place', async () => {
    io.imageModels = [{ id: 'sd-turbo', name: 'SD-Turbo', installed: true, editImages: 0 }]
    io.conversations[0].messages.push(earlierMacImage('/Users/t/Library/LU/images/mlx-1.png'))
    const out = await registry.execute('image_generate', { prompt: 'x', inputImage: 'mlx-1.png' }, 1, run)
    expect(out).toMatch(/No installed model on this Mac edits pictures/)
    expect(io.imageCalls).toHaveLength(0)
    expect(mediaCallSucceeded('image_generate', out)).toBe(false)
  })

  it('a guessed name: refused with what this chat has', async () => {
    io.conversations[0].messages.push(earlierMacImage('/Users/t/Library/LU/images/mlx-1.png'))
    const out = await registry.execute('image_generate', { prompt: 'x', inputImage: 'photo.png' }, 1, run)
    expect(out).toContain('There is no picture "photo.png" in this chat')
    expect(out).toContain('"mlx-1.png" (made in this chat)')
    expect(io.imageCalls).toHaveLength(0)
  })

  it('Stop reaches the engine: the signal goes along, the call ends as cancelled, memory comes back', async () => {
    io.imageHangs = true
    const stop = new AbortController()
    const pending = registry.execute('image_generate', { prompt: 'x' }, 1, run, stop.signal)
    await vi.waitFor(() => expect(io.imageCalls).toHaveLength(1))
    expect(io.imageCalls[0].signal).toBeDefined()
    stop.abort()
    const out = await pending
    expect(out).toBe('Image generation cancelled.')
    expect(mediaCallSucceeded('image_generate', out)).toBe(false)
    await vi.waitFor(() => expect(io.restored).toBe(1))
  })
})

describe('video_generate on a Mac', () => {
  it('a clip from an earlier picture of the chat: its path is the start image, the clip plays from disk', async () => {
    io.videoStatus = 'complete'
    io.conversations[0].messages.push(earlierMacImage('/Users/t/Library/LU/images/mlx-1.png'))
    const out = await registry.execute('video_generate', { prompt: 'waves', inputImage: 'mlx-1.png', seconds: 5 }, 1, run)
    expect(out).toBe('Video generated: clip-1.mp4 (prompt: "waves")\nfile:///Users/t/Library/LU/video/clip-1.mp4')
    expect(io.videoCalls[0].initImage).toBe('/Users/t/Library/LU/images/mlx-1.png')
    expect(mediaCallSucceeded('video_generate', out)).toBe(true)
  })

  it('a clip from "attachment 1": staged first, the path goes to the engine', async () => {
    io.videoStatus = 'complete'
    io.conversations[0].messages.push({ role: 'user', content: 'animate', images: [{ name: 'me.png', mimeType: 'image/png', data: B64 }] })
    await registry.execute('video_generate', { prompt: 'she waves', inputImage: 'attachment 1' }, 1, run)
    expect(io.videoCalls[0].initImage).toBe('/Users/t/Library/LU/video/start-images/staged-1.png')
  })

  it('Stop ends the engine\'s process instead of polling on for an hour', async () => {
    const stop = new AbortController()
    const pending = registry.execute('video_generate', { prompt: 'waves' }, 1, run, stop.signal)
    await vi.waitFor(() => expect(io.videoCalls).toHaveLength(1))
    stop.abort()
    const out = await pending
    expect(out).toBe('Video generation cancelled.')
    expect(io.cancelVideo).toBe(1)
    expect(mediaCallSucceeded('video_generate', out)).toBe(false)
  })

  it('a size or shape the Mac engine does not take: refused, not ignored', async () => {
    const out = await registry.execute('video_generate', { prompt: 'x', settings: { aspectRatio: '9:16' } }, 1, run)
    expect(out).toMatch(/renders each model at its own size/)
    expect(io.videoCalls).toHaveLength(0)
  })
})
