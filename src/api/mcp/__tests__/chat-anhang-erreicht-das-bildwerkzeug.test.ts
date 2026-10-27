/**
 * A12 (Discord "Can't generate images", 20.10.2026): a picture attached in the
 * chat never reached image_generate. The model guessed "image.png", the tool
 * looked in ComfyUI's output folder and every edit ended in
 * `could not read input image "image.png" (HTTP 404)`, also with the file
 * copied into ComfyUI's input folder by hand.
 *
 * The whole way here, against a ComfyUI that answers like the real one
 * (/upload/image into the input folder, /view by folder, 404 for the rest):
 * chat attachment → "attachment 1" in the tool call → upload → the name the
 * workflow's LoadImage gets, read back by the real resolveInputImage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const io = vi.hoisted(() => ({
  conversations: [] as Array<{ id: string; messages: Array<Record<string, unknown>> }>,
  folders: { input: new Map<string, Uint8Array>(), output: new Map<string, Uint8Array>() },
  uploads: [] as string[],
  generated: [] as Array<{ kind: string; args: Record<string, unknown>; resolved?: unknown; error?: string }>,
}))

vi.mock('../../backend', async (orig) => ({
  ...(await orig<typeof import('../../backend')>()),
  // ComfyUI is running: the attachment is uploaded only to a ComfyUI that is up (A13).
  backendCall: vi.fn(async (cmd: string) => (cmd === 'comfyui_status' ? { running: true, found: true } : {})),
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
  useChatStore: { getState: () => ({ conversations: io.conversations }) },
}))
// The picker gate asks the user for a model; the ComfyUI model is not the question here.
vi.mock('../../model-pick', () => ({ pickModelForGeneration: async () => null }))
// The generation itself stops at the input picture: what the real
// resolveInputImage makes of the name the tool hands over.
vi.mock('../../vram-handoff', async (orig) => {
  const real = await orig<typeof import('../../vram-handoff')>()
  return {
    ...real,
    vramHandoffGenerate: async (kind: string, args: Record<string, unknown>) => {
      const rec: (typeof io.generated)[number] = { kind, args: { ...args } }
      io.generated.push(rec)
      try {
        rec.resolved = await real.resolveInputImage(String(args.inputImage))
        return `Image generated: out.png (prompt: "${args.prompt}")\n/comfyui/view?filename=out.png`
      } catch (e) {
        rec.error = (e as Error).message
        return `Image generation failed: ${rec.error}`
      }
    },
  }
})

import { registerBuiltinTools } from '../builtin-tools'
import { ToolRegistry } from '../tool-registry'
import type { AgentRunContext } from '../../agent-context'

const registry = new ToolRegistry()
registerBuiltinTools(registry)
const run = { token: 't', chatId: null, conversationId: 'c1', workspace: null, artifactMode: false, readOnlyShellTurn: false, mode: null } as unknown as AgentRunContext

// Four bytes stand in for the PNG; ComfyUI is not asked to decode them here.
const PIXELS = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const B64 = Buffer.from(PIXELS).toString('base64')

function fakeComfy() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://comfy.test')
    if (url.pathname.endsWith('/upload/image') && init?.method === 'POST') {
      const file = (init.body as FormData).get('image') as File
      const name = file.name
      io.folders.input.set(name, new Uint8Array(await file.arrayBuffer()))
      io.uploads.push(name)
      return new Response(JSON.stringify({ name, subfolder: '', type: 'input' }))
    }
    if (url.pathname.endsWith('/view')) {
      const folder = url.searchParams.get('type') as 'input' | 'output'
      const bytes = io.folders[folder]?.get(url.searchParams.get('filename') ?? '')
      return bytes ? new Response(new Blob([bytes as BlobPart], { type: 'image/png' })) : new Response('Not Found', { status: 404 })
    }
    return new Response('Not Found', { status: 404 })
  })
}

beforeEach(() => {
  io.folders.input.clear()
  io.folders.output.clear()
  io.uploads.length = 0
  io.generated.length = 0
  io.conversations = [{
    id: 'c1',
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'make her hair red', images: [{ name: 'image.png', mimeType: 'image/png', data: B64 }] },
    ],
  }]
  vi.stubGlobal('fetch', fakeComfy())
})

describe('a picture attached in the chat reaches image_generate', () => {
  it('"attachment 1" is uploaded to ComfyUI and the workflow gets its name', async () => {
    const out = await registry.execute('image_generate', { prompt: 'red hair', inputImage: 'attachment 1' }, 1, run)
    expect(out).toMatch(/^Image generated:/)
    expect(io.uploads).toHaveLength(1)
    const staged = io.uploads[0]
    expect(staged).toMatch(/^lu-chat-.+-image\.png$/)
    expect(io.folders.input.get(staged)).toEqual(PIXELS)
    expect(io.generated[0].args.inputImage).toBe(staged)
    // The real resolver finds it in the input folder and does not upload it again.
    expect(io.generated[0].resolved).toMatchObject({ name: staged })
    expect(io.uploads).toHaveLength(1)
  })

  it('the filename the user sees ("image.png") means the same attachment', async () => {
    const out = await registry.execute('image_generate', { prompt: 'red hair', inputImage: 'image.png' }, 1, run)
    expect(out).toMatch(/^Image generated:/)
    expect(io.generated[0].args.inputImage).toBe(io.uploads[0])
  })

  it('works for video_generate and the input_image alias as well', async () => {
    await registry.execute('video_generate', { prompt: 'she turns', input_image: 'Attachment #1' }, 1, run)
    expect(io.generated[0].kind).toBe('video')
    expect(io.generated[0].args.inputImage).toBe(io.uploads[0])
    expect(io.generated[0].args.input_image).toBeUndefined()
  })

  it('a missing attachment is a plain line for model and user, nothing runs', async () => {
    const out = await registry.execute('image_generate', { prompt: 'x', inputImage: 'attachment 2' }, 1, run)
    expect(out).toContain('There is no attachment 2')
    expect(out).toContain('attachment 1 ("image.png")')
    expect(io.uploads).toHaveLength(0)
    expect(io.generated).toHaveLength(0)

    io.conversations[0].messages = [{ role: 'user', content: 'edit it' }]
    const none = await registry.execute('image_generate', { prompt: 'x', inputImage: 'attachment 1' }, 1, run)
    expect(none).toContain('No image is attached in this chat')
    expect(io.generated).toHaveLength(0)
  })

  it('a file the user put in ComfyUI\'s input folder is found there', async () => {
    io.conversations[0].messages = []
    io.folders.input.set('mine.png', PIXELS)
    const out = await registry.execute('image_generate', { prompt: 'x', inputImage: 'mine.png' }, 1, run)
    expect(out).toMatch(/^Image generated:/)
    expect(io.generated[0].resolved).toMatchObject({ name: 'mine.png' })
    expect(io.uploads).toHaveLength(0)
  })

  it('a guessed name that exists nowhere says how to pass an attachment', async () => {
    io.conversations[0].messages = []
    const out = await registry.execute('image_generate', { prompt: 'x', inputImage: 'photo.png' }, 1, run)
    expect(out).toContain('could not find input image "photo.png"')
    expect(out).toContain('"attachment 1"')
    expect(out).not.toContain('HTTP 404')
  })

  it('a generated image still comes from the output folder', async () => {
    io.folders.output.set('LU_00001_.png', PIXELS)
    const out = await registry.execute('image_generate', { prompt: 'x', inputImage: 'LU_00001_.png' }, 1, run)
    expect(out).toMatch(/^Image generated:/)
    // Re-uploaded into input, as before: LoadImage reads only from there.
    expect(io.uploads).toEqual(['LU_00001_.png'])
  })
})
