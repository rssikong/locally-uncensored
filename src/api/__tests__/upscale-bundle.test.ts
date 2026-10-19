// Local Enhance Image (3.0.7): the one file the Stage offers when no upscale
// model is there. Pinned, checked, and in a folder ComfyUI reads.
import { describe, it, expect } from 'vitest'
import { getUpscaleBundles } from '../model-bundles'
import { lookupFileMeta } from '../discover'
import { COMFY_MODEL_FOLDERS } from '../comfyui'
import { STARTER_UPSCALE_MODEL } from '../../lib/local-upscale'
import { catalogModelName } from '../../lib/local-model-name'

describe('the upscale starter', () => {
  const [bundle] = getUpscaleBundles()
  const [file] = bundle.files

  it('is one small safetensors file, not a pickle', () => {
    expect(getUpscaleBundles()).toHaveLength(1)
    expect(bundle.files).toHaveLength(1)
    expect(file.filename).toBe(STARTER_UPSCALE_MODEL)
    expect(file.filename).toMatch(/\.safetensors$/)
    expect(file.sizeBytes).toBe(66857836)
    expect(bundle.totalSizeGB).toBeLessThan(0.1)
    expect(bundle.customNodes ?? []).toEqual([])
  })

  it('downloads from a pinned commit and carries its SHA-256', () => {
    expect(file.downloadUrl).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\/RealESRGAN_x4plus\.safetensors$/)
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(file.sha256).toBe('37f9a931c215f040aa6d50f711f2cb115f713c46df1d0d6469a8bd7bfe9a60bb')
  })

  it('lands in upscale_models, which UpscaleModelLoader reads back', () => {
    expect(file.subfolder).toBe('upscale_models')
    expect(COMFY_MODEL_FOLDERS.map((f) => f.subfolder)).toContain('upscale_models')
  })

  it('the tray and the retry find its URL and digest by name', () => {
    expect(lookupFileMeta(STARTER_UPSCALE_MODEL)).toEqual({
      url: file.downloadUrl, subfolder: 'upscale_models',
      expectedBytes: Math.round(file.sizeGB! * 1_073_741_824), sha256: file.sha256,
    })
    expect(catalogModelName(STARTER_UPSCALE_MODEL)).toBe('Real-ESRGAN x4plus')
  })

  it('names its licence', () => {
    expect(bundle.tags).toContain('BSD-3')
  })
})
