/**
 * Discord help chat, thread "I can't launch Wan2.2" (15.10.2026, Windows 10,
 * RTX 4060 Ti 16 GB, LU 3.0.6, ComfyUI Desktop).
 *
 * He installed "Wan 2.2 Animate Q4 (Motion Control, GGUF)" from Models, Get
 * new. The card said Installed, the file lay in models\diffusion_models under
 * the name the catalogue gives it, and the Installed tab did not list it. He
 * renamed the file to Wan2.1.gguf and then it was listed, which proves
 * ComfyUI enumerates that folder: the Installed tab reads ComfyUI's own
 * loader lists, so the folder was never the problem.
 *
 * The problem was the predicate. The video inventory kept a file only when
 * isVideoModelType said yes, and the three specialised Wan lanes (S2V for
 * Talking Character, Animate and VACE for Motion Control) are left out of
 * isVideoModelType on purpose, so the plain Video picker never offers them.
 * The inventory borrowed that picker rule and so dropped every model of those
 * lanes, while their own Create tabs (getLipsyncModels, getMotionModels) did
 * list them. The rename moved the file into the plain Wan class, which is
 * why it then showed up, and why Create then failed: a Wan Animate file run
 * through the plain Wan graph.
 *
 * Run: npx vitest run src/api/__tests__/lane-models-are-in-the-installed-tab.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const localFetch = vi.fn()
vi.mock('../backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../backend')>()),
  localFetch: (...a: unknown[]) => localFetch(...a),
  isTauri: () => false,
  comfyuiUrl: (path: string) => `http://127.0.0.1:8188${path}`,
}))

import {
  getInstalledVideoModels, getVideoModels, getMotionModels, getLipsyncModels,
  classifyModel, isInstalledVideoType,
} from '../comfyui'
import { getVideoBundles, getLipsyncBundles, getMotionBundles } from '../discover'

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

/** The catalogue file name, exactly as it lay on his disk. */
const ANIMATE_Q4 = 'Wan2.2-Animate-14B-Q4_K_M.gguf'
const VACE = 'wan2.1_vace_1.3B_fp16.safetensors'
const S2V_Q4 = 'Wan2.2-S2V-14B-Q4_K_M.gguf'

function routeObjectInfo(opts: { unets?: string[]; gguf?: string[] }) {
  const { unets = [], gguf = [] } = opts
  localFetch.mockImplementation(async (url: string) => {
    if (url.includes('UnetLoaderGGUF')) {
      return okJson({ UnetLoaderGGUF: { input: { required: { unet_name: [gguf] } } } })
    }
    if (url.includes('UNETLoader')) {
      return okJson({ UNETLoader: { input: { required: { unet_name: [unets] } } } })
    }
    if (url.includes('CheckpointLoaderSimple')) {
      return okJson({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [[]] } } } })
    }
    return okJson({})
  })
}

beforeEach(() => {
  localFetch.mockReset()
})

describe('a Motion Control or Talking Character model is in the Installed tab', () => {
  it('THE REPORT: the Wan 2.2 Animate Q4 GGUF under its catalogue name is listed', async () => {
    routeObjectInfo({ gguf: [ANIMATE_Q4] })
    expect(classifyModel(ANIMATE_Q4)).toBe('wananimate')
    const names = (await getInstalledVideoModels()).map((m) => m.name)
    expect(names).toContain(ANIMATE_Q4)
  })

  it('VACE and S2V, the other two lane architectures, are listed too', async () => {
    routeObjectInfo({ unets: [VACE], gguf: [S2V_Q4] })
    const names = (await getInstalledVideoModels()).map((m) => m.name)
    expect(names).toContain(VACE)
    expect(names).toContain(S2V_Q4)
  })

  it('the same file is on the Motion Control list of Create, where it runs', async () => {
    routeObjectInfo({ gguf: [ANIMATE_Q4] })
    expect((await getMotionModels()).map((m) => m.name)).toEqual([ANIMATE_Q4])
  })

  it('the plain Video picker still does not offer it: that graph cannot run it', async () => {
    routeObjectInfo({ unets: [VACE], gguf: [ANIMATE_Q4, S2V_Q4] })
    expect(await getVideoModels()).toEqual([])
    expect((await getLipsyncModels()).map((m) => m.name)).toEqual([S2V_Q4])
  })

  it('every main file the catalogue ships for a video lane counts as installed video', () => {
    // A bundle whose card can say Installed must have a row to show for it.
    // The shared support files (text encoder, VAE, audio encoder) are listed
    // by the addon lanes and are not judged here.
    const support = /umt5|vae|wav2vec|clip_vision|encoder|realistic_vision|animatediff|v3_sd15_mm/i
    for (const b of [...getVideoBundles(), ...getLipsyncBundles(), ...getMotionBundles()]) {
      for (const f of b.files) {
        if (!f.filename || support.test(f.filename)) continue
        if (f.subfolder !== 'diffusion_models' && f.subfolder !== 'unet' && f.subfolder !== 'checkpoints') continue
        expect(isInstalledVideoType(classifyModel(f.filename)), `${b.name}: ${f.filename}`).toBe(true)
      }
    }
  })
})
