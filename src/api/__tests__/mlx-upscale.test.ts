// @vitest-environment jsdom
/**
 * Enhance Image on a Mac, on the side of the interface (14.10.2026).
 *
 *   `upscaleOnMac` sends `mlx_upscale` the staged path, the factor, the seed
 *   and a run name, and Cancel carries that name. The catalogue's upscaler is
 *   never a model of the image picker and never one the chat's image tool
 *   would run, and `mlxUpscalerInstalled` says whether Enhance has a lane.
 *
 * Run: npx vitest run src/api/__tests__/mlx-upscale.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface Call { cmd: string; args: Record<string, unknown> }
const calls: Call[] = []
let finish: ((reply: unknown) => void) | null = null

vi.mock('../backend', () => ({
  backendCall: async (cmd: string, payload?: { args?: Record<string, unknown> }) => {
    calls.push({ cmd, args: payload?.args ?? {} })
    if (cmd === 'mlx_generate_progress') return { running: true, step: 1, steps: 1 }
    if (cmd === 'mlx_generate_cancel') return { ok: true, stopped: true }
    if (cmd === 'mlx_upscale') return new Promise((r) => { finish = r })
    throw new Error(`unexpected command: ${cmd}`)
  },
  isTauri: () => true,
  isMacOS: () => true,
}))

import { MAC_UPSCALE_FACTORS, buildMlxImageModels, mlxUpscalerInstalled, upscaleOnMac, type MlxImageModel } from '../mlx-image'

const sent = (cmd: string) => calls.filter((c) => c.cmd === cmd)
const until = async (what: () => boolean) => {
  for (let i = 0; i < 200 && !what(); i++) await Promise.resolve()
  expect(what()).toBe(true)
}

const model = (over: Partial<MlxImageModel>): MlxImageModel => ({
  id: 'x', name: 'X', repo: 'a/b', sizeGB: 1, sizeBytes: 1e9, minRamGB: 8, steps: 4, guidance: 1, defaultSize: 1024,
  unfiltered: false, description: '', installed: true, family: 'mflux', ...over,
})

beforeEach(() => {
  calls.length = 0
  finish = null
})

describe('upscaleOnMac', () => {
  it('sends the staged path, the factor, the seed and a name of its own', async () => {
    const run = upscaleOnMac('/data/videos/start-images/a.png', { scale: 4, seed: 9 })
    await until(() => sent('mlx_upscale').length === 1)
    const [call] = sent('mlx_upscale')
    expect(call.args).toMatchObject({ image: '/data/videos/start-images/a.png', scale: 4, seed: 9 })
    expect(String(call.args.run)).toMatch(/^run-/)
    finish?.({ image_base64: 'QQ==', width: 2048, height: 2048, steps: 1, output: '/data/images/enhance-1.png' })
    await expect(run).resolves.toEqual({
      dataUrl: 'data:image/png;base64,QQ==', width: 2048, height: 2048, localPath: '/data/images/enhance-1.png', steps: 1,
    })
  })

  it('leaves a random seed to the engine', async () => {
    const run = upscaleOnMac('/s/a.png', { scale: 2, seed: -1 })
    await until(() => sent('mlx_upscale').length === 1)
    expect(sent('mlx_upscale')[0].args).not.toHaveProperty('seed')
    finish?.({ image_base64: '', width: 1, height: 1 })
    await run
  })

  it('Cancel ends this run by its name', async () => {
    const stop = new AbortController()
    const run = upscaleOnMac('/s/a.png', { scale: 2 }, { signal: stop.signal })
    await until(() => sent('mlx_upscale').length === 1)
    stop.abort()
    await until(() => sent('mlx_generate_cancel').length > 0)
    expect(sent('mlx_generate_cancel')[0].args).toEqual({ run: sent('mlx_upscale')[0].args.run })
    finish?.({ image_base64: '', width: 1, height: 1 })
    await run
  })

  it('takes the factors Rust takes', () => {
    expect([...MAC_UPSCALE_FACTORS]).toEqual([2, 4])
    const rust = readFileSync(resolve(__dirname, '../../../src-tauri/src/commands/image_mflux.rs'), 'utf8')
    expect(rust).toContain('pub(super) const UPSCALE_FACTORS: [u32; 2] = [2, 4];')
  })
})

describe('the upscaler in the catalogue', () => {
  const catalogue = [
    model({ id: 'qwen-image-2.1-8bit', name: 'Qwen-Image 2.1 8-bit', editImages: 10 }),
    model({ id: 'seedvr2-3b', name: 'SeedVR2 3B', upscaler: true }),
  ]

  it('is no model of the image picker', () => {
    expect(buildMlxImageModels(catalogue).map((m) => m.name)).toEqual(['MLX Qwen-Image 2.1 8-bit'])
  })

  it('gives Enhance its lane while it is installed', () => {
    expect(mlxUpscalerInstalled(catalogue)).toBe(true)
    expect(mlxUpscalerInstalled([catalogue[0], { ...catalogue[1], installed: false }])).toBe(false)
    expect(mlxUpscalerInstalled([catalogue[0]])).toBe(false)
  })

  it('is never what the chat makes a picture with', () => {
    const tool = readFileSync(resolve(__dirname, '../mcp/builtin-tools.ts'), 'utf8')
    // The prompt enhancers are filtered in the same line (lib/render/qwen-enhancer).
    expect(tool).toContain('installed = (await listMlxImageModels()).filter((m) => m.installed && !isMlxEnhancer(m) && m.upscaler !== true)')
  })
})
