/**
 * What Create says on a Mac when a local run cannot start (persona walk of
 * the Mac app, 09.10.2026, Fund 12).
 *
 * `generate` in hooks/useCreate.ts ends in the ComfyUI path: "Add checkpoints
 * or FLUX models to ComfyUI.", "Checking ComfyUI...". A Mac has no ComfyUI.
 * The hook cannot be loaded here (it pulls the whole app), so the order of
 * its branches is read from its source.
 *
 * Run: npx vitest run src/lib/__tests__/mac-create-wording.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { macNoLocalLaneLine, macNoModelLine } from '../mac-create-wording'

const hook = readFileSync(resolve(__dirname, '../../hooks/useCreate.ts'), 'utf-8')

describe('the Mac sentences', () => {
  it('name the Model Manager and never ComfyUI, a checkpoint or a Windows model', () => {
    const all = [macNoModelLine('image'), macNoModelLine('video'), macNoLocalLaneLine('image', true), macNoLocalLaneLine('video', true), macNoLocalLaneLine('image', false), macNoLocalLaneLine('video', false)]
    for (const line of all) expect(line).not.toMatch(/ComfyUI|checkpoint|FLUX|AnimateDiff|Wan 2\.1|picker/)
    expect(macNoModelLine('image')).toBe('No image model is installed on this Mac yet. Get one in Models, under Image.')
    expect(macNoModelLine('video')).toBe('No video model is installed on this Mac yet. Get one in Models, under Video.')
  })

  it('an empty lane asks for a model, a lane with models says the tool is not local', () => {
    expect(macNoLocalLaneLine('image', false)).toBe(macNoModelLine('image'))
    expect(macNoLocalLaneLine('video', false)).toBe(macNoModelLine('video'))
    expect(macNoLocalLaneLine('image', true)).toBe('This tool does not run locally on a Mac. Turn on Cloud to use it.')
  })
})

describe('generate in useCreate', () => {
  const generate = hook.slice(hook.indexOf('const runOnce = useCallback('), hook.indexOf('const generate = useCallback('))
  const macEnd = generate.indexOf('setError(macNoLocalLaneLine(mode, laneList.length > 0))')

  it('ends a Mac run before the first sentence of the ComfyUI path', () => {
    expect(generate.length).toBeGreaterThan(1000)
    expect(macEnd).toBeGreaterThan(0)
    // The guard is the Mac check and nothing narrower.
    const guard = generate.slice(generate.lastIndexOf('if (', macEnd), macEnd)
    expect(guard).toMatch(/^if \(isMlxImageHost\(\)\) \{/)
    expect(generate.slice(macEnd, macEnd + 80)).toMatch(/\n\s+return\n/)
    for (const comfy of [
      "'No image model selected. Add checkpoints or FLUX models to ComfyUI.'",
      "'No video model selected. Install Wan 2.1 or AnimateDiff models.'",
      "setProgress(0, 'Checking ComfyUI...')",
      'ensureComfyForRender(',
      "'Video models are still loading. Give it a few seconds and hit Create again.'",
    ]) {
      const at = generate.indexOf(comfy)
      expect(at, comfy).toBeGreaterThan(0)
      expect(at, `${comfy} is reachable on a Mac`).toBeGreaterThan(macEnd)
    }
  })

  it('the two MLX branches come before it, so a working Mac run never meets it', () => {
    const image = generate.indexOf('if ((intent === \'image\' || mlxEdit || macCharacter) && isMlxImageHost() && isMlxImageModel(effImageModel)) {')
    // Extend Video joined the video branch on 14.10.2026 (M1), Motion Control
    // and Talking Character in 3.0.8.
    const video = generate.indexOf("if ((intent === 'video' || intent === 'animate' || intent === 'extend' || intent === 'motion' || talking) && isMlxImageHost()) {")
    expect(image).toBeGreaterThan(0)
    expect(video).toBeGreaterThan(image)
    expect(macEnd).toBeGreaterThan(video)
  })

  it('an empty video picker is not answered with "pick one from the model picker"', () => {
    expect(generate).toContain(": state.videoModelList.length === 0 ? macNoModelLine('video') : 'No local video model selected. Pick one from the model picker.')")
  })
})
