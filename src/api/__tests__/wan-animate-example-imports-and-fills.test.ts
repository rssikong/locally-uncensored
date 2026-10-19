/**
 * Discord, thread "I can't launch Wan2.2" (15.10.2026): the reporter ran the
 * Wan 2.2 Animate example workflow of QuantStack in ComfyUI. This takes that
 * very file (regular save format, fixtures/wan-animate/SOURCE.md) through the
 * import of the Workflows window and on into a Motion Control run.
 *
 * The import reads each node's settings through the node definitions of the
 * running ComfyUI. There is no ComfyUI with KJNodes, Video Helper Suite,
 * segment-anything-2 and WanVideoWrapper here, so the definitions are built
 * from the sockets the file itself lists (a current ComfyUI frontend writes
 * every widget input there, in the definition's order). What this proves is
 * LU's side: the format conversion, the canvas helpers, the family, the
 * fields LU fills. That a ComfyUI with those packs serves the same
 * definitions is not proven here.
 *
 * Run: npx vitest run src/api/__tests__/wan-animate-example-imports-and-fills.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readWorkflowText } from '../workflow-import'
import { parseImportedWorkflow, injectLaneParameters } from '../workflows'
import type { ComfyNodeDefs } from '../comfy-ui-format'

const TEXT = readFileSync(join(__dirname, 'fixtures/wan-animate/wan-animate-native.ui.json'), 'utf8')
const FILE = JSON.parse(TEXT) as { nodes: Array<{ type: string; inputs?: Array<{ name: string; type: string; widget?: unknown; shape?: number }> }> }

const OUTPUT_NODES = new Set(['VHS_VideoCombine', 'PreviewAnimation', 'PreviewImage', 'SaveImage'])
const CANVAS = new Set(['Reroute', 'SetNode', 'GetNode', 'Note', 'MarkdownNote', 'PrimitiveNode'])

/** Node definitions as the file's own sockets describe them. */
function defsFromFile(): ComfyNodeDefs {
  const defs: ComfyNodeDefs = {}
  for (const node of FILE.nodes) {
    if (CANVAS.has(node.type) || defs[node.type]) continue
    const required: Record<string, unknown> = {}
    const optional: Record<string, unknown> = {}
    const inputs = node.inputs ?? []
    // The upload button is a widget of the canvas, not an input: ComfyUI
    // serves it as an option of the file list (image_upload).
    const upload = inputs.some((i) => /UPLOAD$/.test(i.type))
    let firstCombo = true
    for (const input of inputs) {
      if (/UPLOAD$/.test(input.type)) continue
      const opts: Record<string, unknown> = {}
      if (upload && input.widget && input.type === 'COMBO' && firstCombo) { opts.image_upload = true; firstCombo = false }
      const spec = input.widget ? [input.type, opts] : [input.type]
      if (!input.widget && input.shape === 7) optional[input.name] = spec
      else required[input.name] = spec
    }
    defs[node.type] = { input: { required, optional }, output_node: OUTPUT_NODES.has(node.type) }
  }
  return defs
}

const loadDefs = async (types: string[]) => {
  const all = defsFromFile()
  return Object.fromEntries(types.filter((t) => all[t]).map((t) => [t, all[t]]))
}

describe('the QuantStack Wan 2.2 Animate example in the Workflows window', () => {
  it('imports in its regular save format, the canvas helpers resolved', async () => {
    const read = await readWorkflowText(TEXT, loadDefs)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.format).toBe('ui')
    const types = Object.values(read.graph).map((n) => n.class_type)
    for (const t of ['UnetLoaderGGUF', 'WanAnimateToVideo', 'VHS_LoadVideo', 'LoadImage', 'DWPreprocessor', 'KSampler', 'VHS_VideoCombine']) {
      expect(types, t).toContain(t)
    }
    for (const t of ['SetNode', 'GetNode', 'Reroute']) expect(types).not.toContain(t)
    // The width the canvas carried through a SetNode/GetNode pair arrives as
    // a real link at the conditioner.
    const animate = Object.values(read.graph).find((n) => n.class_type === 'WanAnimateToVideo')!
    expect(Array.isArray(animate.inputs?.width)).toBe(true)
    expect(Array.isArray(animate.inputs?.pose_video)).toBe(true)
  })

  it('is filed as a Wan Animate video workflow, with its model, picture and clip known', async () => {
    const read = await readWorkflowText(TEXT, loadDefs)
    if (!read.ok) throw new Error(read.reason)
    const t = parseImportedWorkflow('wan animate native', read.graph)
    expect(t.mode).toBe('video')
    expect(t.modelTypes).toEqual(['wananimate'])
    expect(read.graph[t.parameterMap.model!.nodeId].class_type).toBe('UnetLoaderGGUF')
    expect(read.graph[t.parameterMap.inputImage!.nodeId].class_type).toBe('LoadImage')
    expect(read.graph[t.parameterMap.inputVideo!.nodeId].class_type).toBe('VHS_LoadVideo')
  })

  it('a Motion Control run fills the picked model, picture and clip and keeps its 6 steps', async () => {
    const read = await readWorkflowText(TEXT, loadDefs)
    if (!read.ok) throw new Error(read.reason)
    const t = parseImportedWorkflow('wan animate native', read.graph)
    const run = injectLaneParameters(t.workflow, t.parameterMap, {
      model: 'Wan2.2-Animate-14B-Q4_K_M.gguf', seed: 3, refImage: 'me.png', drivingVideo: 'flip.mp4',
    })
    const m = t.parameterMap
    expect(run[m.model!.nodeId].inputs?.unet_name).toBe('Wan2.2-Animate-14B-Q4_K_M.gguf')
    expect(run[m.inputImage!.nodeId].inputs?.image).toBe('me.png')
    expect(run[m.inputVideo!.nodeId].inputs?.video).toBe('flip.mp4')
    const sampler = Object.values(run).find((n) => n.class_type === 'KSampler')!
    expect(sampler.inputs?.steps).toBe(6)
    expect(sampler.inputs?.cfg).toBe(1)
    expect(sampler.inputs?.seed).toBe(3)
  })

  it('a ComfyUI without the custom node packs is told which nodes it lacks', async () => {
    const core = new Set(['CLIPTextEncode', 'ModelSamplingSD3', 'LoadImage', 'GrowMask', 'CLIPLoader', 'VAELoader',
      'WanAnimateToVideo', 'VAEDecode', 'TrimVideoLatent', 'LoraLoaderModelOnly', 'KSampler'])
    const read = await readWorkflowText(TEXT, async (types) => {
      const all = defsFromFile()
      return Object.fromEntries(types.filter((t) => core.has(t)).map((t) => [t, all[t]]))
    })
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.reason).toMatch(/UnetLoaderGGUF|VHS_LoadVideo|DWPreprocessor/)
  })
})
