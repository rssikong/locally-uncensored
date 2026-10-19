/**
 * The chat's image_generate on a Mac with `lora` (14.10.2026): Windows hands
 * the LoRA to its ComfyUI graph, the Mac dropped it without a word. It now
 * goes to the second image engine by the names of the Mac's LoRA folder, and
 * a character brings the Z-Image model it was trained for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const io = vi.hoisted(() => ({
  runs: [] as Array<Record<string, unknown>>,
  files: [] as string[],
  installed: [] as Array<Record<string, unknown>>,
  videos: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../backend', () => ({ backendCall: vi.fn(async () => ({})), isTauri: () => true }))
vi.mock('../../agents/sub-agent', () => ({
  DELEGATE_TASK_TOOL_DEF: { name: 'delegate_task', description: '', category: 'system', inputSchema: {} },
  buildDelegateExecutor: () => async () => 'stub',
}))
vi.mock('../../../lib/workflow-engine', () => ({ WorkflowEngine: class {} }))
vi.mock('../../../stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: {} }) } }))
vi.mock('../../mlx-image', async (orig) => ({
  ...(await orig<typeof import('../../mlx-image')>()),
  isMlxImageHost: () => true,
  listMlxImageModels: vi.fn(async () => io.installed),
  generateMlxImageDataUrl: vi.fn(async (args: Record<string, unknown>) => {
    io.runs.push(args)
    return { dataUrl: 'data:image/png;base64,AAAA', localPath: '/i/mlx-1.png', width: 1024, height: 1024 }
  }),
}))
vi.mock('../../mlx-video', async (orig) => ({
  ...(await orig<typeof import('../../mlx-video')>()),
  getVideoStatus: vi.fn(async () => ({ available: true, mlxInstalled: true, ltx2MlxInstalled: true, installedModels: [] })),
  listVideoModels: vi.fn(async () => [
    { id: 'wan21-t2v-1.3b', name: 'Wan 2.1 T2V 1.3B', installed: true, requiresImage: false, acceptsImage: false },
    { id: 'ltx-2.3-q4', name: 'LTX-2.3 Distilled 4-bit', installed: true, requiresImage: false, acceptsImage: true },
  ]),
  generateVideo: vi.fn(async (o: Record<string, unknown>) => { io.videos.push(o); throw new Error('stop here') }),
}))
vi.mock('../../mlx-loras', async (orig) => ({
  ...(await orig<typeof import('../../mlx-loras')>()),
  listMlxLoras: vi.fn(async () => ({ loras: io.files.map((name) => ({ name, bytes: 1 })), folder: '/loras' })),
}))

import { registerBuiltinTools } from '../builtin-tools'
import { ToolRegistry } from '../tool-registry'

const registry = new ToolRegistry()
registerBuiltinTools(registry)

const entry = (id: string, name: string, loras: boolean) => ({
  id, name, repo: '', sizeGB: 1, sizeBytes: 1, minRamGB: 16, steps: 8, guidance: 1, defaultSize: 1024,
  unfiltered: false, description: '', installed: true, loras,
})
const SDTURBO = entry('sd-turbo', 'SD Turbo', false)
const QWEN = entry('qwen-image-2.1-4bit', 'Qwen-Image 2.1 4-bit', true)
const ZIMAGE = entry('z-image-turbo-4bit', 'Z-Image Turbo 4-bit', true)
const CHAR = 'char_davechar_zimage.safetensors'

beforeEach(() => {
  io.runs.length = 0
  io.videos.length = 0
  io.files = [CHAR, 'ink.safetensors']
  io.installed = [SDTURBO, QWEN, ZIMAGE]
})

describe('image_generate on a Mac with a LoRA', () => {
  it('hands a character to the engine on the Z-Image model it was trained for', async () => {
    const out = await registry.execute('image_generate', { prompt: 'davechar on a beach', lora: 'char_davechar_zimage', loraStrength: 0.9 }) as string
    expect(out).not.toMatch(/^Error/)
    expect(io.runs).toHaveLength(1)
    expect(io.runs[0]).toMatchObject({ model: 'z-image-turbo-4bit', loras: [{ name: CHAR, strength: 0.9 }] })
  })

  it('refuses a LoRA that is not in the folder, with what is there', async () => {
    const out = await registry.execute('image_generate', { prompt: 'a cat', lora: 'nobody' }) as string
    expect(out).toContain('No LoRA named "nobody"')
    expect(out).toContain(CHAR)
    expect(io.runs).toHaveLength(0)
  })

  it('says so when the character has no model of its family on this Mac', async () => {
    io.installed = [SDTURBO, QWEN]
    const out = await registry.execute('image_generate', { prompt: 'davechar', lora: CHAR }) as string
    expect(out).toMatch(/trained for Z-Image/)
    expect(io.runs).toHaveLength(0)
  })

  it('a run without a LoRA sends none, as before', async () => {
    await registry.execute('image_generate', { prompt: 'a cat', model: 'Qwen-Image 2.1 4-bit' })
    expect(io.runs).toHaveLength(1)
    expect(io.runs[0].loras).toBeUndefined()
  })
})

describe('image_generate and video_generate on a Mac with a character', () => {
  it('a character by its trigger word brings its Z-Image model, its LoRA and the word in the prompt', async () => {
    const out = await registry.execute('image_generate', { prompt: 'on a beach at sunset', character: 'davechar' }) as string
    expect(out).not.toMatch(/^Error/)
    expect(io.runs).toHaveLength(1)
    expect(io.runs[0]).toMatchObject({ model: 'z-image-turbo-4bit' })
    expect(io.runs[0].loras).toEqual([expect.objectContaining({ name: CHAR })])
    expect(String(io.runs[0].prompt)).toContain('davechar')
  })

  it('a character in a video makes its picture first and the clip starts from that file on a model that takes it', async () => {
    await registry.execute('video_generate', { prompt: 'walks along the beach', character: 'davechar' })
    expect(io.runs).toHaveLength(1)
    expect(io.runs[0].loras).toEqual([expect.objectContaining({ name: CHAR })])
    expect(io.videos).toHaveLength(1)
    expect(io.videos[0]).toMatchObject({ id: 'ltx-2.3-q4', initImage: '/i/mlx-1.png' })
  })

  it('an unknown character is said with the names there are', async () => {
    const out = await registry.execute('image_generate', { prompt: 'x', character: 'nobody' }) as string
    expect(out).toMatch(/^Error/)
    expect(out).toContain('davechar')
    expect(io.runs).toHaveLength(0)
  })
})
