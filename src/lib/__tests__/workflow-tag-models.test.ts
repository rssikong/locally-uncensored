/**
 * The model list of Workflows & Tags offers only what Create can pick as its
 * model (Discord 2026-10-23: LoRAs were in it, and picking one did nothing,
 * because a workflow is found by the tags of the model picked in Create).
 *
 * Run: npx vitest run src/lib/__tests__/workflow-tag-models.test.ts
 */
import { describe, it, expect } from 'vitest'
import { takesWorkflowTags } from '../workflow-tag-models'
import type { AIModel, ComfyModelSource } from '../../types/models'

const row = (name: string, source?: ComfyModelSource, type: 'image' | 'video' = 'image') =>
  ({ name, model: name, size: 0, format: 'safetensors', architecture: 'sdxl', type, providerName: 'ComfyUI', ...(source ? { source } : {}) }) as AIModel

describe('takesWorkflowTags', () => {
  it('main models stay: checkpoints, diffusion models, motion modules', () => {
    expect(takesWorkflowTags(row('juggernaut.safetensors', 'checkpoint'))).toBe(true)
    expect(takesWorkflowTags(row('flux1-dev.safetensors', 'diffusion_model'))).toBe(true)
    expect(takesWorkflowTags(row('mm_sd15_v3.safetensors', 'motion_module', 'video'))).toBe(true)
  })

  it('a LoRA is left out, the reported case', () => {
    expect(takesWorkflowTags(row('film_grain_xl.safetensors', 'lora'))).toBe(false)
  })

  it('every other addon is left out the same way', () => {
    for (const source of ['vae', 'text_encoder', 'clip_vision', 'controlnet', 'upscale_model', 'embedding', 'style_model'] as const) {
      expect(takesWorkflowTags(row(`x_${source}.safetensors`, source)), source).toBe(false)
    }
  })

  it('a row without a source stays', () => {
    expect(takesWorkflowTags(row('legacy.safetensors'))).toBe(true)
  })
})
