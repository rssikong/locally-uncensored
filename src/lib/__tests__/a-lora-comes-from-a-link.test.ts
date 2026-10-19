/**
 * GitHub wish G2 (3 people): a LoRA from a pasted CivitAI or Hugging Face
 * link. These are the rules: which links pass, what the host's answer turns
 * into, and what is refused or warned about instead of guessed.
 *
 * Run: npx vitest run src/lib/__tests__/a-lora-comes-from-a-link.test.ts
 */
import { describe, it, expect } from 'vitest'
import {
  civitaiBaseFamily,
  civitaiLoraFromModel,
  civitaiLoraFromVersionAnswer,
  familyLabel,
  hfBaseFamily,
  hfLoraFromAnswers,
  macFamilyWarning,
  parseLoraLink,
  safeLoraFilename,
} from '../lora-link'
import {
  CIVITAI_VERSION_ZIMAGE, HF_INFO_PLAIN, HF_INFO_SDXL_LORA, HF_TREE_ROOT, HF_TREE_SUB, SHA,
  VERSION_NEW, VERSION_OLD, VERSION_PICKLE, VERSION_UNKNOWN_BASE, civitaiModel,
} from './fixtures/lora-link-answers'

describe('which links pass', () => {
  it('reads a CivitAI model page with and without a version', () => {
    expect(parseLoraLink('https://civitai.com/models/2175220/z-image-street?modelVersionId=2449544'))
      .toEqual({ ok: true, ref: { kind: 'civitai', modelId: 2175220, versionId: 2449544 } })
    expect(parseLoraLink('  https://www.civitai.com/models/2175220  '))
      .toEqual({ ok: true, ref: { kind: 'civitai', modelId: 2175220, versionId: undefined } })
    expect(parseLoraLink('https://civitai.com/api/download/models/2449544'))
      .toEqual({ ok: true, ref: { kind: 'civitai', versionId: 2449544 } })
  })

  it('reads a Hugging Face file link, blob or resolve, with folders', () => {
    expect(parseLoraLink('https://huggingface.co/ostris/ikea-instructions-lora-sdxl/blob/main/ikea_instructions_xl_v1_5.safetensors'))
      .toEqual({ ok: true, ref: { kind: 'hf', repo: 'ostris/ikea-instructions-lora-sdxl', rev: 'main', path: 'ikea_instructions_xl_v1_5.safetensors' } })
    expect(parseLoraLink('https://huggingface.co/a/b/resolve/main/loras/style.safetensors?download=true'))
      .toEqual({ ok: true, ref: { kind: 'hf', repo: 'a/b', rev: 'main', path: 'loras/style.safetensors' } })
  })

  it('takes https only, and only the two hosts', () => {
    for (const bad of [
      'http://civitai.com/models/1',
      'https://civitai.com.evil.test/models/1',
      'https://evil.test/?u=https://civitai.com/models/1',
      'https://civitai.red/models/1',
      'https://hf.co/a/b/resolve/main/x.safetensors',
      'https://user:pw@civitai.com/models/1',
      'https://civitai.com:8443/models/1',
      'file:///C:/loras/x.safetensors',
      'civitai.com/models/1',
      '',
    ]) {
      expect(parseLoraLink(bad).ok, bad).toBe(false)
    }
  })

  it('refuses links that name no LoRA file', () => {
    const msg = (u: string) => { const r = parseLoraLink(u); return r.ok ? '' : r.error }
    expect(msg('https://civitai.com/user/someone')).toMatch(/not a model page/)
    expect(msg('https://civitai.com/models/abc')).toMatch(/no model number/)
    expect(msg('https://civitai.com/models/1?modelVersionId=x')).toMatch(/not a number/)
    expect(msg('https://huggingface.co/a/b')).toMatch(/names no file/)
    expect(msg('https://huggingface.co/a/b/blob/main/model.ckpt')).toMatch(/\.safetensors files only/)
    expect(msg('https://huggingface.co/a/b/blob/main/..%2F..%2Fx.safetensors')).toMatch(/could not be read/)
  })
})

describe('base models', () => {
  it('maps the CivitAI words measured on 15.10.2026', () => {
    const cases: Array<[string, string | null]> = [
      ['SD 1.5', 'SD 1.5'], ['SDXL 1.0', 'SDXL'], ['Pony', 'SDXL'], ['Illustrious', 'SDXL'], ['NoobAI', 'SDXL'],
      ['Flux.1 D', 'FLUX.1'], ['Flux.2 D', 'FLUX.2 dev'], ['Flux.2 Klein 4B', 'FLUX.2 klein 4B'],
      ['Flux.2 Klein 9B-base', 'FLUX.2 klein 9B'], ['ZImageTurbo', 'Z-Image'], ['ZImageBase', 'Z-Image'],
      ['Qwen', 'Qwen-Image'], ['Qwen 2.1', 'Qwen-Image 2.1'], ['Wan Video 14B t2v', 'Wan 2.1'],
      ['Wan Video 2.2 I2V-A14B', 'Wan 2.2'], ['Hunyuan Video', 'Hunyuan Video'], ['LTXV', 'LTX Video'],
      ['LTXV2', 'LTX-2'], ['Chroma', 'Chroma'],
      // Not guessed:
      ['Krea 2', null], ['Other', null], ['MiniMax H3', null], ['Hunyuan 1', null], ['', null],
    ]
    for (const [raw, fam] of cases) expect(civitaiBaseFamily(raw), raw).toBe(fam)
  })

  it('maps Hugging Face base_model repo ids by their name only', () => {
    expect(hfBaseFamily('stabilityai/stable-diffusion-xl-base-1.0')).toBe('SDXL')
    expect(hfBaseFamily('black-forest-labs/FLUX.1-dev')).toBe('FLUX.1')
    expect(hfBaseFamily('black-forest-labs/FLUX.2-klein-4B')).toBe('FLUX.2 klein 4B')
    expect(hfBaseFamily('Tongyi-MAI/Z-Image-Turbo')).toBe('Z-Image')
    expect(hfBaseFamily('Qwen/Qwen-Image')).toBe('Qwen-Image')
    expect(hfBaseFamily('Wan-AI/Wan2.2-T2V-A14B')).toBe('Wan 2.2')
    expect(hfBaseFamily('someone/my-merge')).toBeNull()
  })

  it('says on a Mac which families run there', () => {
    expect(macFamilyWarning('Z-Image')).toBeNull()
    expect(macFamilyWarning('Qwen-Image 2.1')).toBeNull()
    expect(macFamilyWarning('SDXL')).toMatch(/On this Mac, LoRAs run with .*Z-Image.* This one is for SDXL\./)
    expect(macFamilyWarning(null)).toMatch(/On this Mac/)
  })

  it('labels a fork with its own word, a family with its name', () => {
    expect(familyLabel({ source: 'civitai', family: 'SDXL', baseModelRaw: 'Illustrious' })).toBe('SDXL (Illustrious)')
    expect(familyLabel({ source: 'civitai', family: 'SDXL', baseModelRaw: 'SDXL 1.0' })).toBe('SDXL')
    expect(familyLabel({ source: 'civitai', family: 'Z-Image', baseModelRaw: 'ZImageTurbo' })).toBe('Z-Image')
    expect(familyLabel({ source: 'civitai', family: null, baseModelRaw: 'Krea 2' })).toBe('Krea 2 (unknown to LU)')
    expect(familyLabel({ source: 'hf', family: 'SDXL', baseModelRaw: 'stabilityai/stable-diffusion-xl-base-1.0' })).toBe('SDXL')
  })
})

describe('CivitAI answers', () => {
  it('a version answer gives name, base model, file, size and the sha256 in lower case', () => {
    const r = civitaiLoraFromVersionAnswer(CIVITAI_VERSION_ZIMAGE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.info).toMatchObject({
      source: 'civitai',
      name: 'Z-Image Street Photo (v1.0)',
      family: 'Z-Image',
      baseModelRaw: 'ZImageTurbo',
      filename: 'Z-xhs888.safetensors',
      sha256: SHA.toLowerCase(),
      downloadUrl: 'https://civitai.com/api/download/models/2449544',
      pageUrl: 'https://civitai.com/models/2175220?modelVersionId=2449544',
      warnings: [],
    })
    expect(r.info.sizeBytes).toBe(Math.round(166140.8515625 * 1024))
  })

  it('without a version the newest one, with one exactly that one, and the safetensors file not the zip', () => {
    const model = civitaiModel('LORA', [VERSION_NEW, VERSION_OLD])
    const newest = civitaiLoraFromModel(model)
    expect(newest.ok && newest.info.filename).toBe('street-v2.safetensors')
    expect(newest.ok && newest.info.family).toBe('SDXL')
    const old = civitaiLoraFromModel(model, 900001)
    expect(old.ok && old.info.filename).toBe('street-v1.safetensors')
    expect(old.ok && old.info.sha256).toBe('b'.repeat(64))
    const none = civitaiLoraFromModel(model, 123)
    expect(none.ok ? '' : none.error).toMatch(/no version with the number/)
  })

  it('LoCon and DoRA pass, everything that is not a LoRA is refused by name', () => {
    expect(civitaiLoraFromModel(civitaiModel('LoCon', [VERSION_OLD])).ok).toBe(true)
    expect(civitaiLoraFromModel(civitaiModel('DoRA', [VERSION_OLD])).ok).toBe(true)
    const err = (type: string) => { const r = civitaiLoraFromModel(civitaiModel(type, [VERSION_OLD])); return r.ok ? '' : r.error }
    expect(err('Checkpoint')).toBe('This CivitAI model is a checkpoint, not a LoRA. Nothing was downloaded.')
    expect(err('TextualInversion')).toMatch(/is an embedding, not a LoRA/)
    expect(err('VAE')).toMatch(/is a VAE, not a LoRA/)
    expect(err('Workflows')).toMatch(/is a workflow, not a LoRA/)
    expect(err('SomethingNew')).toMatch(/of the type "SomethingNew", not a LoRA/)
    expect(err('')).toMatch(/of no stated type/)
  })

  it('a version with only a pickle file is refused', () => {
    const r = civitaiLoraFromModel(civitaiModel('LORA', [VERSION_PICKLE]))
    expect(r.ok ? '' : r.error).toMatch(/no \.safetensors file/)
  })

  it('an unknown base model is said, not guessed', () => {
    const r = civitaiLoraFromModel(civitaiModel('LORA', [VERSION_UNKNOWN_BASE]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.info.family).toBeNull()
    expect(r.info.warnings).toEqual(['LU does not know the base model "Krea 2". Check on the CivitAI page which image model this LoRA is for.'])
  })

  it('a download address off civitai.com is refused, the mirror host is swapped in', () => {
    const off = { ...VERSION_OLD, files: [{ ...VERSION_OLD.files[0], downloadUrl: 'https://evil.test/x' }] }
    expect(civitaiLoraFromModel(civitaiModel('LORA', [off])).ok).toBe(false)
    const mirror = civitaiLoraFromModel(civitaiModel('LORA', [VERSION_OLD]), undefined, 'civitai.red')
    expect(mirror.ok && mirror.info.downloadUrl).toBe('https://civitai.red/api/download/models/900001')
  })

  it('a file name cannot climb out of the folder', () => {
    expect(safeLoraFilename('../../evil.safetensors')).toBe('evil.safetensors')
    expect(safeLoraFilename('a\\b:c?.safetensors')).toBe('b_c_.safetensors')
    expect(safeLoraFilename('.hidden.safetensors')).toBe('hidden.safetensors')
    expect(safeLoraFilename('')).toBe('lora.safetensors')
  })
})

describe('Hugging Face answers', () => {
  const ref = { kind: 'hf' as const, repo: 'ostris/ikea-instructions-lora-sdxl', rev: 'main', path: 'ikea_instructions_xl_v1_5.safetensors' }

  it('a LoRA repo gives family, size and the LFS sha256, and a resolve address', () => {
    const r = hfLoraFromAnswers(ref, HF_INFO_SDXL_LORA, HF_TREE_ROOT)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.info).toMatchObject({
      source: 'hf',
      family: 'SDXL',
      filename: 'ikea_instructions_xl_v1_5.safetensors',
      sizeBytes: 228_456_164,
      sha256: 'c'.repeat(64),
      downloadUrl: 'https://huggingface.co/ostris/ikea-instructions-lora-sdxl/resolve/main/ikea_instructions_xl_v1_5.safetensors',
      warnings: [],
    })
  })

  it('a file in a folder is found by its full path', () => {
    const sub = { kind: 'hf' as const, repo: 'a/b', rev: 'main', path: 'loras/style.safetensors' }
    const r = hfLoraFromAnswers(sub, HF_INFO_SDXL_LORA, HF_TREE_SUB)
    expect(r.ok && r.info.filename).toBe('style.safetensors')
    expect(r.ok && r.info.downloadUrl).toBe('https://huggingface.co/a/b/resolve/main/loras/style.safetensors')
  })

  it('a file not in the tree is refused', () => {
    const r = hfLoraFromAnswers({ ...ref, path: 'nope.safetensors' }, HF_INFO_SDXL_LORA, HF_TREE_ROOT)
    expect(r.ok ? '' : r.error).toMatch(/not in the Hugging Face repository/)
  })

  it('a page that does not say LoRA and names no base model warns twice', () => {
    const r = hfLoraFromAnswers(ref, HF_INFO_PLAIN, HF_TREE_ROOT)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.info.family).toBeNull()
    expect(r.info.warnings).toEqual([
      'The Hugging Face page does not say this file is a LoRA. Download it only if you know it is one.',
      'The Hugging Face page names no base model. Check on the page which image model this LoRA is for.',
    ])
  })

  it('a full model on a page that does not say LoRA is refused, not offered as Download anyway (d308-a)', () => {
    // The answers of stabilityai/stable-diffusion-xl-base-1.0 and
    // Comfy-Org/z_image_turbo on 15.10.2026, cut to what counts.
    const sdxl = { id: 'stabilityai/stable-diffusion-xl-base-1.0', tags: ['diffusers', 'safetensors', 'text-to-image', 'diffusers:StableDiffusionXLPipeline'] }
    const big = [{ type: 'file', path: 'sd_xl_base_1.0.safetensors', size: 6_938_078_334, lfs: { oid: 'e'.repeat(64), size: 6_938_078_334 } }]
    const r1 = hfLoraFromAnswers({ ...ref, repo: sdxl.id, path: 'sd_xl_base_1.0.safetensors' }, sdxl, big)
    expect(r1.ok ? '' : r1.error).toBe('This Hugging Face file is a full diffusers model, not a LoRA. Nothing was downloaded.')
    const zimage = { id: 'Comfy-Org/z_image_turbo', tags: ['diffusion-single-file', 'comfyui', 'base_model:Tongyi-MAI/Z-Image-Turbo', 'base_model:finetune:Tongyi-MAI/Z-Image-Turbo'] }
    const r2 = hfLoraFromAnswers({ ...ref, repo: zimage.id, path: 'sd_xl_base_1.0.safetensors' }, zimage, big)
    expect(r2.ok ? '' : r2.error).toMatch(/full model built on a base model, not a LoRA/)
    // No telling tag, only the size of a checkpoint.
    const r3 = hfLoraFromAnswers({ ...ref, path: 'sd_xl_base_1.0.safetensors' }, HF_INFO_PLAIN, big)
    expect(r3.ok ? '' : r3.error).toMatch(/6\.5 GB, the size of a full model, not a LoRA/)
    // A page that says LoRA is never refused by these rules.
    expect(hfLoraFromAnswers({ ...ref, path: 'sd_xl_base_1.0.safetensors' }, HF_INFO_SDXL_LORA, big).ok).toBe(true)
  })

  it('without a folder listing the file still goes, only without size and digest', () => {
    const r = hfLoraFromAnswers(ref, HF_INFO_SDXL_LORA, null)
    expect(r.ok && r.info.sizeBytes).toBeUndefined()
    expect(r.ok && r.info.sha256).toBeUndefined()
  })
})
