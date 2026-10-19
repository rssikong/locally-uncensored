/**
 * How-it-works session, 3.0.7: with a workflow of the user's own in Motion
 * Control, the "Workflow parameters" list said "Set by LU: Steps, CFG,
 * Sampler, Scheduler" on the KSampler and offered no field for them, and a
 * value changed there never reached the run. The Motion Control run
 * (injectLaneParameters) sets only the model, the seed, the picture and the
 * clip (the tab has no prompt field, so the prompts are the workflow's too);
 * what LU sets has to follow the way the run goes.
 *
 * Run: npx vitest run src/api/__tests__/motion-own-workflow-params-follow-the-lane.test.ts
 */
import { describe, it, expect } from 'vitest'
import example from './fixtures/wan-animate/quantstack-example.api.json'
import { parseImportedWorkflow, injectLaneParameters } from '../workflows'
import { listWorkflowParams, luSetInputs, paramKey, LANE_SET_FIELDS } from '../workflow-params'
import type { ComfyApiGraph } from '../../types/comfy-graph'

const t = parseImportedWorkflow('Wan animate native', example as unknown as ComfyApiGraph)
const ksampler = (path: 'workflow' | 'lane') =>
  listWorkflowParams(t.workflow, t.parameterMap, null, path).find((n) => n.nodeId === '3')!

describe('the KSampler of an own Motion Control workflow', () => {
  it('in the list: steps, CFG, sampler and scheduler are editable, only the seed is LU\'s', () => {
    const node = ksampler('lane')
    expect(node.setByLu).toEqual(['Seed'])
    const keys = node.fields.map((f) => f.inputKey)
    for (const k of ['steps', 'cfg', 'sampler_name', 'scheduler']) expect(keys).toContain(k)
  })

  it('a normal run still sets them itself, so there they stay "Set by LU"', () => {
    expect(ksampler('workflow').setByLu).toEqual(expect.arrayContaining(['Seed', 'Steps', 'CFG']))
  })

  it('a changed step count and CFG reach the run; the seed and model stay LU\'s', () => {
    const run = injectLaneParameters(t.workflow, t.parameterMap, {
      model: 'Wan2.2-Animate-14B-Q4_K_M.gguf', seed: 7,
      refImage: 'me.png', drivingVideo: 'flip.mp4',
    }, {
      '3': { steps: 10, cfg: 2.5, sampler_name: 'uni_pc', seed: 99 },
      '85': { unet_name: 'other.gguf' },
      '39': { vae_name: 'my_vae.safetensors' },
      '6': { text: 'a woman doing a cartwheel' },
      '7': { text: 'blurry' },
    })
    expect(run['3'].inputs?.steps).toBe(10)
    expect(run['3'].inputs?.cfg).toBe(2.5)
    expect(run['3'].inputs?.sampler_name).toBe('uni_pc')
    expect(run['3'].inputs?.seed).toBe(7)
    expect(run['85'].inputs?.unet_name).toBe('Wan2.2-Animate-14B-Q4_K_M.gguf')
    // The lane picks no VAE of its own: the file value, or the user's.
    expect(run['39'].inputs?.vae_name).toBe('my_vae.safetensors')
    // Motion Control has no prompt field: the prompts are the workflow's,
    // edited in its list.
    expect(run['6'].inputs?.text).toBe('a woman doing a cartwheel')
    expect(run['7'].inputs?.text).toBe('blurry')
  })

  it('a video saver left on save_output false still saves to output, not to temp', () => {
    // A normal run of an own workflow turns it on (injectParameters); the
    // Motion Control run did not, so the clip landed in ComfyUI's temp folder.
    const off = JSON.parse(JSON.stringify(t.workflow)) as ComfyApiGraph
    off['114'].inputs!.save_output = false
    const run = injectLaneParameters(off, t.parameterMap, {
      model: 'm.gguf', seed: 1, refImage: 'me.png', drivingVideo: 'flip.mp4',
    }, { '114': { save_output: false } })
    expect(run['114'].inputs?.save_output).toBe(true)
    // And the list says so instead of offering a switch that does nothing.
    const saver = listWorkflowParams(off, t.parameterMap, null, 'lane').find((n) => n.nodeId === '114')!
    expect(saver.setByLu).toContain('Save output')
    expect(saver.fields.map((f) => f.inputKey)).not.toContain('save_output')
  })

  it('the prompts are editable in the list, not "Set by LU"', () => {
    const nodes = listWorkflowParams(t.workflow, t.parameterMap, null, 'lane')
    for (const id of ['6', '7']) {
      const n = nodes.find((x) => x.nodeId === id)!
      expect(n.setByLu).toEqual([])
      expect(n.fields.map((f) => f.inputKey)).toContain('text')
    }
  })

  it('what the list calls LU\'s on the lane is exactly what injectLaneParameters overwrites', () => {
    const lane = luSetInputs(t.workflow, t.parameterMap, 'lane')
    const marker = 'zz-marker'
    const before = JSON.parse(JSON.stringify(t.workflow)) as ComfyApiGraph
    for (const [, n] of Object.entries(before)) {
      for (const [k, v] of Object.entries(n.inputs ?? {})) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') (n.inputs as Record<string, unknown>)[k] = marker
      }
    }
    const run = injectLaneParameters(before, t.parameterMap, {
      model: 'm', seed: 7, refImage: 'r', drivingVideo: 'v',
    })
    const written = new Set<string>()
    for (const [id, n] of Object.entries(run)) {
      for (const [k, v] of Object.entries(n.inputs ?? {})) if (!Array.isArray(v) && v !== marker) written.add(paramKey(id, k))
    }
    expect([...lane.keys()].sort()).toEqual([...written].sort())
    // The mapped fields, plus the video saver of the workflow.
    expect(lane.size).toBeLessThanOrEqual(LANE_SET_FIELDS.length + 1)
  })
})
