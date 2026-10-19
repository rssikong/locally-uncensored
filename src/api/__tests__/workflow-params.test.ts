/**
 * GitHub wish #8: every value of an imported workflow is editable in Create.
 * The list comes from a fixture workflow (SDXL with a LoRA, CLIP skip and its
 * own VAE loader), the node definitions from the recorded /object_info.
 *
 * Run: npx vitest run src/api/__tests__/workflow-params.test.ts
 */
import { describe, it, expect, vi } from 'vitest'
import wfJson from './fixtures/workflow-params/sdxl-lora-vae.api.json'
import objectInfo from './fixtures/comfy-ui/object-info.json'
import type { ComfyApiGraph } from '../../types/comfy-graph'
import type { ComfyNodeDefs } from '../comfy-ui-format'
import type { GenerateParams } from '../comfyui'

vi.mock('../comfyui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../comfyui')>()),
  findMatchingVAE: vi.fn(async () => 'lu_pick_vae.safetensors'),
  findMatchingCLIP: vi.fn(async () => 'lu_pick_clip.safetensors'),
}))

const { autoDetectParameterMap, injectParameters } = await import('../workflows')
const { listWorkflowParams, applyParamOverrides, luSetInputs, paramKey } = await import('../workflow-params')

const graph = (): ComfyApiGraph => JSON.parse(JSON.stringify(wfJson)) as ComfyApiGraph
const defs: ComfyNodeDefs = {
  ...(objectInfo as unknown as ComfyNodeDefs),
  // A custom node with a switch, a list in the newer COMBO shape and a long text.
  LU_TestToggle: {
    input: {
      required: {
        enabled: ['BOOLEAN', { default: true }],
        mode: ['COMBO', { options: ['fast', 'slow'] }],
      },
      optional: { note: ['STRING', { multiline: true }] },
    },
  },
}

const params: GenerateParams = {
  prompt: 'a castle', negativePrompt: 'ugly', model: 'mine.safetensors',
  sampler: 'dpmpp_2m', scheduler: 'normal', steps: 30, cfgScale: 5,
  width: 832, height: 1216, seed: 7, batchSize: 1,
}

function field(nodes: ReturnType<typeof listWorkflowParams>, nodeId: string, key: string) {
  return nodes.find((n) => n.nodeId === nodeId)?.fields.find((f) => f.inputKey === key)
}

describe('the list of workflow parameters', () => {
  const wf = graph()
  const map = autoDetectParameterMap(wf)
  const nodes = listWorkflowParams(wf, map, defs)

  it('lists every node with a value, by title, in node order, without connected inputs', () => {
    expect(nodes.map((n) => n.nodeId)).toEqual(['3', '4', '5', '6', '7', '9', '10', '11', '12', '13'])
    expect(nodes.find((n) => n.nodeId === '10')?.title).toBe('Detail LoRA')
    expect(nodes.find((n) => n.nodeId === '4')?.title).toBe('Load Checkpoint')
    expect(listWorkflowParams(wf, map, null).find((n) => n.nodeId === '4')?.title).toBe('CheckpointLoaderSimple')
    // VAEDecode has only connections and is not listed at all.
    expect(nodes.some((n) => n.classType === 'VAEDecode')).toBe(false)
    const keys = nodes.flatMap((n) => n.fields.map((f) => `${f.nodeId}.${f.inputKey}`))
    for (const linked of ['3.model', '3.positive', '3.latent_image', '10.model', '10.clip', '11.clip']) {
      expect(keys).not.toContain(linked)
    }
  })

  it('does not offer what LU sets itself a second time, and names it', () => {
    const sampler = nodes.find((n) => n.nodeId === '3')!
    expect(sampler.fields.map((f) => f.inputKey)).toEqual(['denoise'])
    expect(sampler.setByLu).toEqual(['Seed', 'Steps', 'CFG', 'Sampler', 'Scheduler'])
    expect(nodes.find((n) => n.nodeId === '4')!.fields).toEqual([])
    expect(nodes.find((n) => n.nodeId === '4')!.setByLu).toEqual(['Model'])
    expect(nodes.find((n) => n.nodeId === '5')!.setByLu).toEqual(['Width', 'Height', 'Batch size'])
    expect(nodes.find((n) => n.nodeId === '6')!.setByLu).toEqual(['Prompt'])
  })

  it('picks the control from the node definition', () => {
    expect(field(nodes, '3', 'denoise')?.control).toEqual({ kind: 'number', integer: false, min: 0, max: 1, step: 0.01 })
    expect(field(nodes, '10', 'lora_name')?.control).toEqual({ kind: 'select', options: ['detail_tweaker_xl.safetensors'] })
    expect(field(nodes, '10', 'strength_model')?.control).toMatchObject({ kind: 'number', min: -100, max: 100 })
    expect(field(nodes, '9', 'filename_prefix')?.control).toEqual({ kind: 'text', multiline: false })
    expect(field(nodes, '13', 'enabled')?.control).toEqual({ kind: 'toggle' })
    expect(field(nodes, '13', 'mode')?.control).toEqual({ kind: 'select', options: ['fast', 'slow'] })
    expect(field(nodes, '13', 'note')?.control).toEqual({ kind: 'text', multiline: true })
  })

  it('keeps a file this ComfyUI does not have choosable, and marks the VAE as picked by LU', () => {
    const vae = field(nodes, '12', 'vae_name')!
    expect(vae.autoByLu).toBe(true)
    expect(vae.control).toEqual({ kind: 'select', options: ['sdxl_vae.safetensors', 'ae.safetensors', 'wan_2.1_vae.safetensors', 'pixel_space'] })
  })

  it('falls back to the value when there is no definition (CLIP skip node, ComfyUI down)', () => {
    expect(field(nodes, '11', 'stop_at_clip_layer')?.control).toEqual({ kind: 'number', integer: true })
    const offline = listWorkflowParams(wf, map, null)
    expect(field(offline, '3', 'denoise')?.control).toEqual({ kind: 'number', integer: false })
    expect(field(offline, '10', 'lora_name')?.control).toEqual({ kind: 'text', multiline: false })
    expect(field(offline, '13', 'enabled')?.control).toEqual({ kind: 'toggle' })
    expect(field(offline, '13', 'note')?.control).toEqual({ kind: 'text', multiline: true })
  })
})

describe('the values reach the workflow that is sent', () => {
  it('writes the user values into the injected graph and leaves the template alone', async () => {
    const wf = graph()
    const map = autoDetectParameterMap(wf)
    const sent = await injectParameters(wf, map, params, 'sdxl', {
      '3': { denoise: 0.5 },
      '10': { strength_model: 0.3, lora_name: 'other.safetensors' },
      '11': { stop_at_clip_layer: -1 },
      '13': { enabled: false, note: 'changed' },
    })
    expect(sent['3'].inputs?.denoise).toBe(0.5)
    expect(sent['10'].inputs?.strength_model).toBe(0.3)
    expect(sent['10'].inputs?.lora_name).toBe('other.safetensors')
    expect(sent['11'].inputs?.stop_at_clip_layer).toBe(-1)
    expect(sent['13'].inputs?.enabled).toBe(false)
    expect(sent['13'].inputs?.note).toBe('changed')
    // LU's own values are still in place.
    expect(sent['3'].inputs?.steps).toBe(30)
    expect(sent['6'].inputs?.text).toBe('a castle')
    expect(wf['3'].inputs?.denoise).toBe(0.85)
  })

  it('without changes, the file values are sent (the state after Reset)', async () => {
    const wf = graph()
    const sent = await injectParameters(wf, autoDetectParameterMap(wf), params, 'sdxl', undefined)
    expect(sent['3'].inputs?.denoise).toBe(0.85)
    expect(sent['10'].inputs?.strength_model).toBe(0.8)
    expect(sent['11'].inputs?.stop_at_clip_layer).toBe(-2)
  })

  it('LU picks the VAE unless the user chose one', async () => {
    const wf = graph()
    const map = autoDetectParameterMap(wf)
    expect((await injectParameters(wf, map, params, 'sdxl'))['12'].inputs?.vae_name).toBe('lu_pick_vae.safetensors')
    const chosen = await injectParameters(wf, map, params, 'sdxl', { '12': { vae_name: 'sdxl_vae.safetensors' } })
    expect(chosen['12'].inputs?.vae_name).toBe('sdxl_vae.safetensors')
  })

  it('never lets a stored value beat what LU sets, cut a connection or add an input', () => {
    const wf = graph()
    const map = autoDetectParameterMap(wf)
    applyParamOverrides(wf, map, {
      '3': { steps: 99, model: 'x', made_up: 1 },
      '99': { anything: 1 },
    })
    expect(wf['3'].inputs?.steps).toBe(25)
    expect(wf['3'].inputs?.model).toEqual(['10', 0])
    expect('made_up' in (wf['3'].inputs ?? {})).toBe(false)
    expect(wf['99']).toBeUndefined()
  })

  it('knows the resize node and the first image loader as LU inputs, like injectParameters', () => {
    const wf: ComfyApiGraph = {
      '1': { class_type: 'ImageResizeKJv2', inputs: { width: 512, height: 512, image: ['2', 0] } },
      '2': { class_type: 'LoadImage', inputs: { image: 'in.png' } },
    }
    const set = luSetInputs(wf, {})
    expect(set.get(paramKey('1', 'width'))?.label).toBe('Width')
    expect(set.get(paramKey('2', 'image'))?.label).toBe('Source image')
  })
})
