/**
 * A13 (21.10.2026): image_generate and video_generate on ComfyUI, from the
 * tool call to what the chat shows.
 *
 * The real executors, the real hand-off (vram-handoff) with its picker step,
 * cancel channel and polling, the real reference rules (lib/chat-media-refs),
 * the real result parsers of the chat (ToolCallBlock) and the real check of a
 * delivered result (lib/media-result). Only ComfyUI itself is a stand-in: its
 * model lists, /prompt, /history, /upload/image and /view by folder.
 *
 * One walk per way in: a picture from text, an edit of an attachment, an
 * edit of an earlier result in a subfolder, a clip from text, a clip from an
 * earlier picture, a character's picture. And the ways it used to go wrong:
 * a guessed name, a clip as input, Stop at the model picker, Stop while it
 * renders, a ComfyUI that is not installed, and a render that ends without
 * media yet was counted as delivered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const io = vi.hoisted(() => ({
  conversations: [] as Array<{ id: string; messages: Array<Record<string, unknown>> }>,
  folders: { input: new Map<string, Uint8Array>(), output: new Map<string, Uint8Array>() },
  uploads: [] as string[],
  built: [] as Array<Record<string, unknown>>,
  submitted: 0,
  abandoned: [] as string[],
  history: (_id: string): unknown => null,
  status: { running: true, found: true } as Record<string, unknown>,
  imageModels: [{ name: 'flux1-schnell-fp8.safetensors', type: 'flux' }] as Array<{ name: string; type: string }>,
  videoModels: [{ name: 'wan2.2_ti2v_5B_fp16.safetensors', type: 'wan22' }] as Array<{ name: string; type: string }>,
  pick: null as null | (() => Promise<string | null>),
  started: 0,
}))

vi.mock('../../backend', async (orig) => ({
  ...(await orig<typeof import('../../backend')>()),
  backendCall: vi.fn(async (cmd: string) => {
    if (cmd === 'start_comfyui') { io.started += 1; io.status = { running: true, found: true }; return null }
    return cmd === 'comfyui_status' ? io.status : null
  }),
  localFetch: vi.fn(async () => { throw new Error('no ollama here') }),
  isOllamaLocal: () => false,
  isTauri: () => false,
}))
vi.mock('../../agents/sub-agent', () => ({
  DELEGATE_TASK_TOOL_DEF: { name: 'delegate_task', description: '', category: 'system', inputSchema: {} },
  buildDelegateExecutor: () => async () => 'stub',
}))
vi.mock('../../../lib/workflow-engine', () => ({ WorkflowEngine: class {} }))
vi.mock('../../mlx-image', async (orig) => ({
  ...(await orig<typeof import('../../mlx-image')>()),
  isMlxImageHost: () => false,
}))
vi.mock('../../../stores/chatStore', () => ({
  useChatStore: { getState: () => ({ conversations: io.conversations, activeConversationId: 'c1' }) },
}))
vi.mock('../../model-pick', () => ({
  pickModelForGeneration: () => (io.pick ? io.pick() : Promise.resolve(null)),
}))
vi.mock('../../comfyui-ws', () => ({
  comfyWS: { on: () => () => {}, connect: () => Promise.resolve(), connected: false },
  CLIENT_ID: 'lu-test-client',
}))
vi.mock('../../comfyui-nodes', async (orig) => ({
  ...(await orig<typeof import('../../comfyui-nodes')>()),
  getModelCapabilities: async () => null,
}))
vi.mock('../../dynamic-workflow', async (orig) => ({
  ...(await orig<typeof import('../../dynamic-workflow')>()),
  buildDynamicWorkflow: async (params: Record<string, unknown>) => { io.built.push(params); return { '1': { class_type: 'X', inputs: {} } } },
}))
vi.mock('../../comfyui', async (orig) => {
  const real = await orig<typeof import('../../comfyui')>()
  return {
    ...real,
    getImageModels: async () => io.imageModels,
    getVideoModels: async () => io.videoModels,
    detectVideoBackend: async () => 'wan',
    getSystemVRAM: async () => 24,
    submitWorkflow: async () => { io.submitted += 1; return `prompt-${io.submitted}` },
    getHistory: async (id: string) => io.history(id),
    checkComfyConnection: async () => true,
    abandonPrompt: async (id: string) => { io.abandoned.push(id) },
    freeMemory: async () => {},
    sweepOrphanedLuJobs: async () => {},
    isPromptQueued: async () => true,
    buildTxt2VidWorkflow: async (params: Record<string, unknown>) => { io.built.push(params); return {} },
  }
})

import { registerBuiltinTools } from '../builtin-tools'
import { ToolRegistry } from '../tool-registry'
import type { AgentRunContext } from '../../agent-context'
import { __resetGenerationStateForTests } from '../../vram-handoff'
import { mediaCallSucceeded } from '../../../lib/media-result'
import { comfyViewUrlFromResult, isInlineVideoUrl } from '../../../components/chat/ToolCallBlock'

const registry = new ToolRegistry()
registerBuiltinTools(registry)
const run = { token: 't', chatId: null, conversationId: 'c1', workspace: null, artifactMode: false, readOnlyShellTurn: false, mode: null } as unknown as AgentRunContext

const PIXELS = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const B64 = Buffer.from(PIXELS).toString('base64')

/** ComfyUI's answer for a finished prompt with one output file. */
function finished(filename: string, subfolder = '') {
  return { status: { completed: true, status_str: 'success' }, outputs: { '9': { images: [{ filename, subfolder, type: 'output' }] } } }
}

/** An earlier media call of the chat, as the agent loop stores it. */
function earlier(toolName: string, filename: string, subfolder = '') {
  return {
    role: 'assistant', content: '',
    agentBlocks: [{ id: 'b', phase: 'tool_call', content: '', timestamp: 1, toolCalls: [{
      id: `call-${filename}`, toolName, args: {}, status: 'completed', timestamp: 1,
      result: `${toolName === 'video_generate' ? 'Video' : 'Image'} generated: ${filename} (prompt: "x")\nhttp://localhost:8188/view?filename=${filename}&subfolder=${subfolder}&type=output`,
    }] }],
  }
}

function fakeComfy() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost:8188')
    if (url.pathname.endsWith('/upload/image') && init?.method === 'POST') {
      const file = (init.body as FormData).get('image') as File
      io.folders.input.set(file.name, new Uint8Array(await file.arrayBuffer()))
      io.uploads.push(file.name)
      return new Response(JSON.stringify({ name: file.name, subfolder: '', type: 'input' }))
    }
    if (url.pathname.endsWith('/view')) {
      const folder = url.searchParams.get('type') as 'input' | 'output'
      const sub = url.searchParams.get('subfolder') ?? ''
      const key = sub ? `${sub}/${url.searchParams.get('filename')}` : url.searchParams.get('filename') ?? ''
      const bytes = io.folders[folder]?.get(key)
      return bytes ? new Response(new Blob([bytes as BlobPart], { type: 'image/png' })) : new Response('Not Found', { status: 404 })
    }
    return new Response('Not Found', { status: 404 })
  })
}

beforeEach(() => {
  __resetGenerationStateForTests()
  io.folders.input.clear()
  io.folders.output.clear()
  io.uploads.length = 0
  io.built.length = 0
  io.submitted = 0
  io.abandoned.length = 0
  io.history = () => finished('LU_00002_.png')
  io.status = { running: true, found: true }
  io.pick = null
  io.started = 0
  io.conversations = [{ id: 'c1', messages: [{ role: 'user', content: 'hi' }] }]
  vi.stubGlobal('fetch', fakeComfy())
  vi.stubGlobal('createImageBitmap', async () => ({ width: 1024, height: 768, close() {} }))
})

/** What the chat does with a result: is it delivered, and what does it show. */
function shown(result: string) {
  return { delivered: mediaCallSucceeded('image_generate', result), url: comfyViewUrlFromResult(result) }
}

describe('image_generate on ComfyUI, from the call to the picture in the chat', () => {
  it('a picture from text: the model the picker chose, the result line, the picture shown', async () => {
    io.pick = async () => 'flux1-schnell-fp8.safetensors'
    const out = await registry.execute('image_generate', { prompt: 'a lighthouse at dusk', settings: { aspectRatio: '16:9' } }, 1, run)
    expect(out).toMatch(/^Image generated: LU_00002_\.png \(prompt: "a lighthouse at dusk"\)\n/)
    expect(shown(out)).toEqual({ delivered: true, url: expect.stringContaining('/view?filename=LU_00002_.png') })
    expect(io.built[0].model).toBe('flux1-schnell-fp8.safetensors')
    expect(Number(io.built[0].width)).toBeGreaterThan(Number(io.built[0].height))
  })

  it('an edit of "attachment 1": uploaded to the input folder, LoadImage gets that name', async () => {
    io.conversations[0].messages.push({ role: 'user', content: 'make the sky red', images: [{ name: 'beach.png', mimeType: 'image/png', data: B64 }] })
    const out = await registry.execute('image_generate', { prompt: 'red sky', inputImage: 'attachment 1' }, 1, run)
    expect(shown(out).delivered).toBe(true)
    expect(io.uploads).toHaveLength(1)
    expect(io.built[0].inputImage).toBe(io.uploads[0])
    expect(io.built[0].denoise).toBe(0.75)
  })

  it('an edit of "attachment 1" while ComfyUI is not running yet: started first, then uploaded (box run 22.10.)', async () => {
    io.status = { running: false, found: true }
    io.conversations[0].messages.push({ role: 'user', content: 'snow', images: [{ name: 'me.png', mimeType: 'image/png', data: B64 }] })
    const out = await registry.execute('image_generate', { prompt: 'snow', inputImage: 'attachment 1' }, 1, run)
    expect(io.started).toBe(1)
    expect(io.uploads).toHaveLength(1)
    expect(shown(out).delivered).toBe(true)
  }, 15_000)

  it('an edit of an earlier result in a subfolder: found by its file name, subfolder kept', async () => {
    io.folders.output.set('chat/LU_00001_.png', PIXELS)
    io.conversations[0].messages.push(earlier('image_generate', 'LU_00001_.png', 'chat'))
    const out = await registry.execute('image_generate', { prompt: 'same, at night', inputImage: 'LU_00001_.png' }, 1, run)
    expect(shown(out).delivered).toBe(true)
    expect(io.uploads).toEqual(['LU_00001_.png'])
  })

  it('a guessed name: refused with the pictures this chat has, nothing renders', async () => {
    io.conversations[0].messages.push({ role: 'user', content: 'x', images: [{ name: 'beach.png', mimeType: 'image/png', data: B64 }] })
    io.conversations[0].messages.push(earlier('image_generate', 'LU_00001_.png'))
    const out = await registry.execute('image_generate', { prompt: 'x', inputImage: 'my_photo.png' }, 1, run)
    expect(out).toContain('could not find input image')
    expect(out).toContain('attachment 1 ("beach.png")')
    expect(out).toContain('"LU_00001_.png" (made in this chat)')
    expect(shown(out).delivered).toBe(false)
    expect(io.submitted).toBe(0)
  })

  it('a clip as the input picture is refused by name, before anything runs', async () => {
    io.conversations[0].messages.push(earlier('video_generate', 'LU_00007_.webp'))
    const out = await registry.execute('image_generate', { prompt: 'x', inputImage: 'LU_00007_.webp' }, 1, run)
    expect(out).toMatch(/is a video clip/)
    expect(io.submitted).toBe(0)
    const mp4 = await registry.execute('image_generate', { prompt: 'x', inputImage: 'holiday.mp4' }, 1, run)
    expect(mp4).toMatch(/is a video clip/)
  })

  it('denoise 1.0 would drop the input on a plain model: refused with the range that works', async () => {
    io.conversations[0].messages.push(earlier('image_generate', 'LU_00001_.png'))
    const out = await registry.execute('image_generate', { prompt: 'x', inputImage: 'LU_00001_.png', denoise: 1 }, 1, run)
    expect(out).toMatch(/denoise 1\.0 throws the input picture away/)
    expect(io.submitted).toBe(0)
  })

  it('a size beyond 4096, an aspect ratio that is none, a batch: refused, never clamped', async () => {
    expect(await registry.execute('image_generate', { prompt: 'x', width: 9000 }, 1, run)).toMatch(/width must be a number from 64 to 4096/)
    expect(await registry.execute('image_generate', { prompt: 'x', settings: { aspectRatio: 'wide' } }, 1, run)).toMatch(/is not a ratio/)
    expect(await registry.execute('image_generate', { prompt: 'x', batchSize: 4 }, 1, run)).toMatch(/one call makes one picture/)
    expect(io.submitted).toBe(0)
  })

  it('Stop while the model picker waits: nothing is submitted, and it is not counted as delivered', async () => {
    io.pick = () => new Promise(() => {}) // the user never answers
    const stop = new AbortController()
    const pending = registry.execute('image_generate', { prompt: 'x' }, 1, run, stop.signal)
    await new Promise((r) => setTimeout(r, 20))
    stop.abort()
    const out = await pending
    expect(out).toBe('Image generation cancelled.')
    expect(shown(out).delivered).toBe(false)
    await new Promise((r) => setTimeout(r, 20))
    expect(io.submitted).toBe(0)
  })

  it('Stop while it renders: our prompt is taken out of ComfyUI, the call ends as cancelled', async () => {
    io.history = () => null // still rendering
    const stop = new AbortController()
    const pending = registry.execute('image_generate', { prompt: 'x' }, 1, run, stop.signal)
    await vi.waitFor(() => expect(io.submitted).toBe(1))
    stop.abort()
    expect(await pending).toBe('Image generation cancelled.')
    expect(io.abandoned).toEqual(['prompt-1'])
  })

  it('no ComfyUI installed: said at once, without waiting for a start', async () => {
    io.status = { running: false, found: false }
    const started = Date.now()
    const out = await registry.execute('image_generate', { prompt: 'x' }, 1, run)
    expect(out).toMatch(/ComfyUI is not installed on this computer/)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(shown(out).delivered).toBe(false)
  })

  it('a render that failed in ComfyUI: its message, not delivered', async () => {
    io.history = () => ({ status: { completed: false, status_str: 'error', messages: [['execution_error', { node_type: 'KSampler', exception_type: 'RuntimeError', exception_message: 'CUDA out of memory' }]] } })
    const out = await registry.execute('image_generate', { prompt: 'x' }, 1, run)
    expect(out).toMatch(/^Image generation failed: CUDA out of memory/)
    expect(shown(out).delivered).toBe(false)
  })

  it('a prompt that quotes an address: the chat shows the result, not the quote', async () => {
    const out = await registry.execute('image_generate', { prompt: 'like http://localhost:8188/view?filename=old.png&type=output' }, 1, run)
    expect(comfyViewUrlFromResult(out)).toContain('filename=LU_00002_.png')
  })
})

describe('video_generate on ComfyUI, from the call to the clip in the chat', () => {
  it('a clip from text: length from seconds, an mp4 the chat plays', async () => {
    io.history = () => finished('LU_00003_.mp4', 'video')
    const out = await registry.execute('video_generate', { prompt: 'waves at night', seconds: 4 }, 1, run)
    expect(out).toMatch(/^Video generated: LU_00003_\.mp4/)
    expect(mediaCallSucceeded('video_generate', out)).toBe(true)
    const url = comfyViewUrlFromResult(out)!
    expect(isInlineVideoUrl(url)).toBe(true)
    expect(io.built[0].frames).toBe(96) // 4 s at Wan 2.2's 24 fps
  })

  it('a clip from an earlier picture of the chat: that picture is the start image', async () => {
    io.folders.output.set('LU_00001_.png', PIXELS)
    io.conversations[0].messages.push(earlier('image_generate', 'LU_00001_.png'))
    io.history = () => finished('LU_00004_.mp4')
    const out = await registry.execute('video_generate', { prompt: 'she smiles', inputImage: 'LU_00001_.png' }, 1, run)
    expect(mediaCallSucceeded('video_generate', out)).toBe(true)
    expect(io.built[0].inputImage).toBe('LU_00001_.png')
  })

  it('a name that is not there no longer takes the last picture of another chat', async () => {
    io.folders.output.set('LU_00001_.png', PIXELS)
    io.history = () => finished('LU_00001_.png')
    await registry.execute('image_generate', { prompt: 'cat' }, 1, { ...run, conversationId: 'other' } as AgentRunContext)
    io.built.length = 0
    const out = await registry.execute('video_generate', { prompt: 'animate it', inputImage: 'the_cat.png' }, 1, run)
    expect(out).toContain('could not find input image')
    expect(io.built).toHaveLength(0)
  })

  it('a length out of range is refused with the range', async () => {
    expect(await registry.execute('video_generate', { prompt: 'x', seconds: 400 }, 1, run)).toMatch(/seconds must be from 0\.5 to 60/)
    expect(io.submitted).toBe(0)
  })

  it('a render that hits its budget is not counted as a delivered clip', async () => {
    const budget = 'Video generation hit the 60 minute budget and was cancelled so the GPU is free again.'
    expect(mediaCallSucceeded('video_generate', budget)).toBe(false)
  })
})

describe('a ComfyUI that dies while rendering', () => {
  it('says it crashed, with its last error line, and that a retry will not help', async () => {
    const { comfyDiedNotice } = await import('../../vram-handoff')
    const out = comfyDiedNotice('Image', 26_000, { exited: true, line: 'Windows fatal exception: access violation' })
    expect(out).toMatch(/^Image generation failed: ComfyUI crashed after 26s/)
    expect(out).toContain('"Windows fatal exception: access violation"')
    expect(out).toMatch(/do not retry/)
    expect(mediaCallSucceeded('image_generate', out)).toBe(false)
    expect(comfyDiedNotice('Image', 26_000, null)).toMatch(/stopped responding/)
    // An ended process without a line of its own (box run 22.10.): no claim of a crash.
    const ended = comfyDiedNotice('Image', 24_000, { exited: true, line: null })
    expect(ended).toMatch(/ComfyUI ended after 24s/)
    expect(ended).not.toMatch(/crashed/)
  })
})
