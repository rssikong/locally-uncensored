// Local Enhance Image (3.0.7): the graph. Core ComfyUI nodes only, and the
// factor the user picked is the factor that comes out, whatever scale the
// model was trained for.
import { describe, it, expect } from 'vitest'
import { buildUpscaleWorkflow, WorkflowUnavailableError, type UpscaleParams } from '../dynamic-workflow'
import type { ComfyApiGraph } from '../../types/comfy-graph'

const combo = (field: string, list: string[]) => ({ input: { required: { [field]: [list] } } })
const METHODS = ['nearest-exact', 'bilinear', 'area', 'bicubic', 'lanczos']

/** A ComfyUI that has the core nodes and lists these upscale models. */
function comfy(models: string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    LoadImage: {},
    UpscaleModelLoader: combo('model_name', models),
    ImageUpscaleWithModel: {},
    ImageScaleBy: { input: { required: { image: ['IMAGE'], upscale_method: [METHODS], scale_by: ['FLOAT', {}] } } },
    ImageScale: { input: { required: { image: ['IMAGE'], upscale_method: [METHODS], width: ['INT', {}], height: ['INT', {}], crop: [['disabled', 'center']] } } },
    SaveImage: {},
    ...extra,
  }
}

const params = (over: Partial<UpscaleParams> = {}): UpscaleParams => ({
  image: 'photo.png', model: 'RealESRGAN_x4plus.safetensors', factor: 2, sourceWidth: 640, sourceHeight: 480, ...over,
})

const classes = (g: ComfyApiGraph) => Object.values(g).map((n) => n.class_type)
const nodeOf = (g: ComfyApiGraph, cls: string) => Object.entries(g).find(([, n]) => n.class_type === cls)

describe('the Enhance graph', () => {
  it('a 4x model asked for 4x: load, upscale, save, nothing else', () => {
    const g = buildUpscaleWorkflow(params({ factor: 4 }), comfy(['RealESRGAN_x4plus.safetensors']))
    expect(classes(g)).toEqual(['LoadImage', 'UpscaleModelLoader', 'ImageUpscaleWithModel', 'SaveImage'])
    expect(g['1']!.inputs).toEqual({ image: 'photo.png' })
    expect(g['2']!.inputs).toEqual({ model_name: 'RealESRGAN_x4plus.safetensors' })
    expect(g['3']!.inputs).toEqual({ upscale_model: ['2', 0], image: ['1', 0] })
    expect(g['5']!.inputs?.images).toEqual(['3', 0])
  })

  it('a 4x model asked for 2x: the result is scaled by 0.5, with area', () => {
    const g = buildUpscaleWorkflow(params({ factor: 2 }), comfy(['RealESRGAN_x4plus.safetensors']))
    expect(classes(g)).toEqual(['LoadImage', 'UpscaleModelLoader', 'ImageUpscaleWithModel', 'ImageScaleBy', 'SaveImage'])
    const [id, scale] = nodeOf(g, 'ImageScaleBy')!
    expect(scale.inputs).toEqual({ image: ['3', 0], upscale_method: 'area', scale_by: 0.5 })
    expect(g['5']!.inputs?.images).toEqual([id, 0])
  })

  it('a 2x model asked for 4x: scaled by 2, with lanczos', () => {
    const g = buildUpscaleWorkflow(params({ model: 'RealESRGAN_x2plus.pth', factor: 4 }), comfy(['RealESRGAN_x2plus.pth']))
    expect(nodeOf(g, 'ImageScaleBy')![1].inputs).toEqual({ image: ['3', 0], upscale_method: 'lanczos', scale_by: 2 })
  })

  it('a model whose name says no scale: resized to the exact target size', () => {
    const g = buildUpscaleWorkflow(params({ model: 'SwinIR.pth', factor: 2 }), comfy(['SwinIR.pth']))
    expect(nodeOf(g, 'ImageScaleBy')).toBeUndefined()
    expect(nodeOf(g, 'ImageScale')![1].inputs).toEqual({
      image: ['3', 0], upscale_method: 'lanczos', width: 1280, height: 960, crop: 'disabled',
    })
  })

  it('takes a resize method the running ComfyUI lists', () => {
    const old = comfy(['RealESRGAN_x4plus.safetensors'], {
      ImageScaleBy: { input: { required: { upscale_method: [['nearest-exact', 'bilinear', 'bicubic']] } } },
    })
    expect(nodeOf(buildUpscaleWorkflow(params(), old), 'ImageScaleBy')![1].inputs?.upscale_method).toBe('bicubic')
  })

  it('never names a prompt, a checkpoint or a sampler', () => {
    const g = buildUpscaleWorkflow(params(), comfy(['RealESRGAN_x4plus.safetensors']))
    for (const c of classes(g)) expect(c).not.toMatch(/Checkpoint|KSampler|CLIPTextEncode|VAE/)
    expect(String(g['5']!.inputs?.filename_prefix)).toMatch(/enhanced$/)
  })

  it('a ComfyUI without the upscale nodes is told to update, not sent a broken graph', () => {
    const nodes = comfy(['RealESRGAN_x4plus.safetensors'])
    delete nodes.ImageUpscaleWithModel
    let err: unknown
    try { buildUpscaleWorkflow(params(), nodes) } catch (e) { err = e }
    expect(err).toBeInstanceOf(WorkflowUnavailableError)
    expect((err as WorkflowUnavailableError).needsComfyUpdate).toBe(true)
    expect((err as Error).message).toMatch(/ImageUpscaleWithModel/)
  })

  it('a model ComfyUI no longer lists is said, not sent', () => {
    expect(() => buildUpscaleWorkflow(params(), comfy(['4x-UltraSharp.pth']))).toThrow(/no longer in ComfyUI's upscale model list/)
  })
})
