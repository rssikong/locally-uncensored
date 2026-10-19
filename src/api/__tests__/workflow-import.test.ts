/**
 * Reading a picked workflow file (GitHub Discussion #124): API format as it
 * is, the regular format through the running ComfyUI's node definitions, and
 * an honest "ComfyUI has to run" when it does not answer.
 *
 * Run: npx vitest run src/api/__tests__/workflow-import.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const localFetch = vi.fn<(url: string, opts?: unknown) => Promise<Response>>()

vi.mock('../backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../backend')>()),
  localFetch: (...a: unknown[]) => localFetch(...(a as [string, unknown])),
  comfyuiUrl: (p: string) => `http://localhost:8188${p}`,
}))

import { COMFY_NOT_RUNNING, loadNodeDefs, readWorkflowText } from '../workflow-import'
import type { ComfyNodeDefs } from '../comfy-ui-format'

const DIR = join(process.cwd(), 'src/api/__tests__/fixtures/comfy-ui')
const text = (name: string) => readFileSync(join(DIR, name), 'utf8')
const defs = JSON.parse(text('object-info.json')) as ComfyNodeDefs

const fromFixture = vi.fn(async (types: string[]) => {
  const out: ComfyNodeDefs = {}
  for (const t of types) if (defs[t]) out[t] = defs[t]
  return out
})

beforeEach(() => {
  fromFixture.mockClear()
  localFetch.mockReset()
})

describe('readWorkflowText', () => {
  it('takes an API export as it is and never asks ComfyUI', async () => {
    const api = { '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'x' } } }
    const r = await readWorkflowText(JSON.stringify(api), fromFixture)
    expect(r).toEqual({ ok: true, graph: api, format: 'api', notes: [] })
    expect(fromFixture).not.toHaveBeenCalled()
  })

  it('converts a regular save, asking only for the node types it needs', async () => {
    const r = await readWorkflowText(text('z-image-turbo.ui.json'), fromFixture)
    expect(r.ok && r.format).toBe('ui')
    expect(fromFixture).toHaveBeenCalledWith([
      'CLIPLoader', 'CLIPTextEncode', 'ConditioningZeroOut', 'EmptySD3LatentImage', 'KSampler',
      'ModelSamplingAuraFlow', 'PreviewImage', 'SaveImage', 'UNETLoader', 'VAEDecode', 'VAELoader',
    ])
  })

  it('says ComfyUI has to run when it does not answer, and guesses nothing', async () => {
    const r = await readWorkflowText(text('sdxl-txt2img.ui.json'), async () => null)
    expect(r).toEqual({ ok: false, reason: COMFY_NOT_RUNNING })
  })

  it('rejects broken JSON and foreign JSON with a reason', async () => {
    expect(await readWorkflowText('{"nodes": [', fromFixture)).toEqual({ ok: false, reason: 'That file does not contain valid JSON.' })
    const r = await readWorkflowText('{"name":"not a workflow"}', fromFixture)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/not a ComfyUI workflow/)
  })

  it('rejects an unreadable subgraph before contacting ComfyUI', async () => {
    const g = JSON.parse(text('z-image-turbo.ui.json'))
    g.definitions = { subgraphs: [{ id: 'sg-1', nodes: 'broken', links: [] }] }
    g.nodes.push({ id: 50, type: 'sg-1', mode: 0 })
    const r = await readWorkflowText(JSON.stringify(g), fromFixture)
    expect(r.ok).toBe(false)
    expect(fromFixture).not.toHaveBeenCalled()
  })

  it('imports the stock Z-Image Turbo template with its subgraph unpacked', async () => {
    const r = await readWorkflowText(text('templates/image_z_image_turbo.json'), fromFixture)
    if (!r.ok) throw new Error(r.reason)
    expect(r.format).toBe('ui')
    expect(r.notes).toEqual(['1 subgraph unpacked', '1 note left out'])
    expect(r.graph['57:3'].inputs?.positive).toEqual(['57:27', 0])
    expect(r.graph['9'].inputs?.images).toEqual(['57:8', 0])
    // Asked for the inner node types only, never for the subgraph id.
    const asked = fromFixture.mock.calls[0][0]
    expect(asked).toContain('KSampler')
    expect(asked.some((t) => t.includes('-'))).toBe(false)
  })
})

describe('loadNodeDefs', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  it('collects the known definitions, an unknown type answers {}', async () => {
    localFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/object_info/KSampler')) return json({ KSampler: defs.KSampler })
      return json({})
    })
    const out = await loadNodeDefs(['KSampler', 'Fancy Node (pack)'])
    expect(out).toEqual({ KSampler: defs.KSampler })
    expect(localFetch).toHaveBeenCalledWith('http://localhost:8188/object_info/Fancy%20Node%20(pack)', expect.anything())
  })

  it('returns null when ComfyUI is not reachable or answers with an error', async () => {
    localFetch.mockRejectedValue(new Error('connection refused'))
    expect(await loadNodeDefs(['KSampler'])).toBeNull()
    localFetch.mockReset().mockResolvedValue(json({ error: 'x' }, 500))
    expect(await loadNodeDefs(['KSampler'])).toBeNull()
  })
})
