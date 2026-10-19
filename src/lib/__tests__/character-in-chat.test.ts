/**
 * Characters everywhere (3.0.7): image_generate and video_generate in the
 * local chat take `character`. The app finds the LoRA, the model and the
 * trigger word; a video starts from an image of the character, made by the
 * same chain Create uses.
 *
 * Run: npx vitest run src/lib/__tests__/character-in-chat.test.ts
 */
import { describe, it, expect, vi } from 'vitest'
import {
  characterImageArgs, characterVideoArgs, generatedFile, withCharacterLoraArgs, type CharacterChatDeps, type MediaArgs,
} from '../character-chat'
import { toolRegistry, DEFAULT_PERMISSIONS } from '../../api/mcp/index'
import { classifyModel, isI2VModel } from '../../api/comfyui'

const CHAR = 'char_mira_zimage.safetensors'
const MIRA = { id: `local:${CHAR}`, name: 'mira', triggerWord: 'mira', family: 'zimage' }
const ZOE = { id: 'local:char_zoe_zimage.safetensors', name: 'zoe', triggerWord: 'zoe', family: 'zimage' }
const model = (name: string) => ({ name, type: classifyModel(name) })

function deps(over: Partial<CharacterChatDeps> = {}): CharacterChatDeps & { renders: MediaArgs[] } {
  const renders: MediaArgs[] = []
  return {
    renders,
    characters: async () => [MIRA, ZOE],
    imageModels: async () => [model('qwen_image_2512_fp8_e4m3fn.safetensors'), model('z_image_bf16.safetensors')],
    renderImage: async (a) => { renders.push(a); return 'Image generated: LU_00012_.png (prompt: "x")\nhttp://127.0.0.1:8188/view?filename=LU_00012_.png' },
    failed: (r) => r.startsWith('Error'),
    takesStartImage: isI2VModel,
    ...over,
  }
}

describe('both media tools offer the argument', () => {
  it('image_generate and video_generate list `character`, optional', () => {
    for (const name of ['image_generate', 'video_generate']) {
      const tool = toolRegistry.getAvailableTools(DEFAULT_PERMISSIONS).find((t) => t.name === name)!
      expect(tool.inputSchema.properties?.character?.type).toBe('string')
      expect(tool.inputSchema.required ?? []).not.toContain('character')
    }
  })
})

describe('image_generate with a character', () => {
  it('runs on Z Image with the LoRA and the trigger word in front', async () => {
    const out = await characterImageArgs('Mira', { prompt: 'on a boat', model: 'qwen_image_2512_fp8_e4m3fn.safetensors' }, deps())
    expect(out).toEqual({ prompt: 'mira, on a boat', model: 'z_image_bf16.safetensors', lora: [CHAR], loraStrength: [0.8] })
  })

  it('keeps a LoRA the model asked for and does not add the character twice', () => {
    expect(withCharacterLoraArgs({ lora: 'grain.safetensors', loraStrength: 0.4 }, CHAR, 1))
      .toEqual({ lora: ['grain.safetensors', CHAR], loraStrength: [0.4, 1] })
    expect(withCharacterLoraArgs({ lora: [CHAR] }, CHAR, 1)).toEqual({ lora: [CHAR] })
  })

  it('an unknown name answers with the characters there are', async () => {
    expect(await characterImageArgs('bob', { prompt: 'x' }, deps())).toBe('Error: No character called "bob". Available characters: mira, zoe.')
  })

  it('without a Z Image model it says so', async () => {
    const out = await characterImageArgs('mira', { prompt: 'x' }, deps({ imageModels: async () => [model('juggernautXL_v9.safetensors')] }))
    expect(out).toMatch(/^Error: "mira" was trained for Z Image, and no Z Image model is installed/)
  })
})

describe('video_generate with a character', () => {
  it('makes the character image first and starts the clip from it', async () => {
    const d = deps()
    const out = await characterVideoArgs('zoe', { prompt: 'dancing in the rain', seconds: 4 }, d)
    expect(d.renders).toEqual([{ prompt: 'zoe, dancing in the rain', model: 'z_image_bf16.safetensors', lora: ['char_zoe_zimage.safetensors'], loraStrength: [0.8] }])
    expect(out).toEqual({ prompt: 'dancing in the rain', seconds: 4, inputImage: 'LU_00012_.png' })
  })

  it('a text only model is refused before anything renders', async () => {
    const d = deps()
    expect(await characterVideoArgs('zoe', { prompt: 'x', model: 'wan2.1_t2v_1.3B_fp16.safetensors' }, d)).toMatch(/makes video from text only/)
    expect(d.renders).toEqual([])
  })

  it('a failed image stops the video with the reason', async () => {
    const out = await characterVideoArgs('zoe', { prompt: 'x' }, deps({ renderImage: vi.fn(async () => 'Error: ComfyUI is not running') }))
    expect(out).toMatch(/^Error: The image of zoe did not come out, so the video did not start. Error: ComfyUI is not running/)
  })

  it('reads the file out of the result line', () => {
    expect(generatedFile('Image generated: a b.png (prompt: "x")\nurl')).toBe('a b.png')
    expect(generatedFile('Error: nope')).toBeNull()
  })
})
