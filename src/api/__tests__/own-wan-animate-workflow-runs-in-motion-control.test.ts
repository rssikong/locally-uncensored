/**
 * Discord, thread "I can't launch Wan2.2" (15.10.2026): the QuantStack example
 * workflow for Wan 2.2 Animate GGUF ran in ComfyUI itself, and LU could not
 * run it. Three things stood in the way on 3.0.7:
 *   - the import read no model input from UnetLoaderGGUF and had no field for
 *     the driving clip (VHS_LoadVideo, LoadVideo), so neither could be filled;
 *   - it filed the workflow under no model family ('unknown'), so no Wan
 *     Animate model could ever be paired with it;
 *   - the tags of a Wan Animate model were looked up under Image, while the
 *     Workflows window files that model under Video.
 * (The fourth, that Motion Control never ran a workflow of the user's own at
 * all, is driven through the real generate path in
 * hooks/__tests__/useCreate-motion-runs-the-own-workflow.test.ts.)
 *
 * The fixture is the example workflow in API format, its canvas helpers
 * (SetNode, GetNode, previews, notes) resolved, the way Save (API Format)
 * writes it.
 *
 * Run: npx vitest run src/api/__tests__/own-wan-animate-workflow-runs-in-motion-control.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import example from './fixtures/wan-animate/quantstack-example.api.json'
import { parseImportedWorkflow, injectLaneParameters } from '../workflows'
import { useWorkflowStore } from '../../stores/workflowStore'
import type { ComfyApiGraph } from '../../types/comfy-graph'

const graph = example as unknown as ComfyApiGraph
const MODEL = 'Wan2.2-Animate-14B-Q4_K_M.gguf'

describe('the Wan 2.2 Animate example workflow on import', () => {
  it('is a video workflow for the Wan Animate family', () => {
    const t = parseImportedWorkflow('Wan animate native', graph)
    expect(t.mode).toBe('video')
    expect(t.modelTypes).toEqual(['wananimate'])
  })

  it('knows its GGUF model loader, its character picture and its driving clip', () => {
    const { parameterMap: m } = parseImportedWorkflow('Wan animate native', graph)
    expect(m.model).toEqual({ nodeId: '85', inputKey: 'unet_name', loaderType: 'unet' })
    expect(m.inputImage).toEqual({ nodeId: '78', inputKey: 'image' })
    expect(m.inputVideo).toEqual({ nodeId: '79', inputKey: 'video' })
  })
})

describe('the example workflow filled by Motion Control', () => {
  const t = parseImportedWorkflow('Wan animate native', graph)
  const filled = () => injectLaneParameters(t.workflow, t.parameterMap, {
    model: MODEL, seed: 7,
    refImage: 'me.png', drivingVideo: 'flip.mp4',
  })

  it('takes the picked model, seed, picture and clip', () => {
    const run = filled()
    expect(run['85'].inputs?.unet_name).toBe(MODEL)
    // The tab has no prompt field: the workflow keeps its own prompt.
    expect(run['6'].inputs?.text).toBe('a girl is dancing')
    expect(run['3'].inputs?.seed).toBe(7)
    expect(run['78'].inputs?.image).toBe('me.png')
    expect(run['79'].inputs?.video).toBe('flip.mp4')
  })

  it('leaves what the workflow was tuned for: 6 steps at CFG 1, the 512 face crop, its negative prompt', () => {
    const run = filled()
    expect(run['3'].inputs?.steps).toBe(6)
    expect(run['3'].inputs?.cfg).toBe(1)
    expect(run['95'].inputs?.width).toBe(512)
    expect(run['95'].inputs?.height).toBe(512)
    expect(run['7'].inputs?.text).toBe('static, blurry, worst quality')
  })

  it('does not change the saved template', () => {
    filled()
    expect(t.workflow['85'].inputs?.unet_name).toBe('Wan2_2_Animate_14B_Q8_0.gguf')
  })
})

describe('pairing the workflow with a Wan Animate model', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      installedWorkflows: [], modelTypeAssignments: {}, modelNameAssignments: {},
      tags: [], workflowTags: {}, modelTags: {},
    } as never)
  })

  it('a shared tag set on the Video row of the Workflows window offers it for that model', () => {
    const s = useWorkflowStore.getState()
    s.installWorkflow({ ...parseImportedWorkflow('Wan animate native', graph), id: 'wf1', installedAt: 1 })
    const tag = s.createTag('Wan Animate')!
    s.setWorkflowTags('wf1', [tag])
    // The Models view of the window lists the file under Video, as the
    // Installed tab now does.
    s.setModelTags(MODEL, 'video', [tag])
    s.assignToModelName(MODEL, 'wf1')
    expect(useWorkflowStore.getState().getWorkflowForModel(MODEL, 'wananimate')?.id).toBe('wf1')
    expect(useWorkflowStore.getState().getMatchingWorkflows(MODEL, 'video').map((w) => w.id)).toEqual(['wf1'])
  })
})
