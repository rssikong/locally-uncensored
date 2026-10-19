/**
 * What a clip of a Mac video model is comes from its catalogue entry
 * (persona walk of the Mac app, 09.10.2026, Fund 19).
 *
 * Animate with "LTX-2.3 Distilled 8-bit" stood on 25 steps, guidance 5.0,
 * 16 fps and 49 frames, the values of Wan, and went out as `seconds: 3.0625`
 * (49 by 16). The LTX engine runs at 24 fps whatever it is asked, so it made
 * 73 frames. Steps and guidance set nothing at all: `video_generate` takes
 * a prompt, a seed, a start image and a length.
 *
 * Run: npx vitest run src/api/__tests__/mlx-video-clip-values.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MLX_VIDEO_MIN_FRAMES, buildMlxVideoModels, mlxFramesOnGrid, mlxVideoFrameStep,
  mlxVideoLaneEntry, mlxVideoMaxFrames, mlxVideoRunRate, mlxVideoRunSize, mlxVideoRunSteps, mlxVideoSeconds,
  type VideoModel,
} from '../mlx-video'

const rust = (file: string) => readFileSync(resolve(__dirname, '../../../src-tauri/src/commands', file), 'utf-8')

const entry = (over: Partial<VideoModel>): VideoModel => ({
  id: 'x', name: 'X', family: 'wan_2', repo: 'a/b', sizeGB: 1, sizeBytes: 1e9, minRamGB: 16, defaultFrames: 81,
  fps: 16, defaultWidth: 1280, defaultHeight: 704, negativePrompt: true, userSampling: false,
  needsConvert: false, unfiltered: false, description: '', installed: true, ...over,
})

/** `(s * fps as f32).max(1.0) as u32` in video_generate, with the length as
 *  the f32 serde reads it. */
const rustFrames = (seconds: number, fps: number) => Math.trunc(Math.max(1, Math.fround(Math.fround(seconds) * fps)))
/** `clamp_frames` of video.rs and video_ltx2mlx.rs. */
const rustClamp = (frames: number, step: number) => {
  const f = Math.max(step === 8 ? 9 : 5, frames)
  return f - ((f - 1) % step)
}

describe('the rate and the grid of a family', () => {
  it('the rate is the one the catalogue names, and the interface has no rule of its own', () => {
    // Until the real run of 09.10.2026 this file knew "LTX 24, Wan 2.2 TI2V
    // 24, every other Wan 16" by family and id. Rust says it per entry now
    // (`fps`), so a Wan the table would have put at 16 plays at what its
    // entry says.
    const [wan] = buildMlxVideoModels([entry({ id: 'wan21-t2v-1.3b', fps: 30 })])
    expect(wan.mlxVideo?.fps).toBe(30)
    const source = readFileSync(resolve(__dirname, '../mlx-video.ts'), 'utf-8')
    expect(source).not.toContain('mlxVideoFps')
    expect(source).not.toMatch(/startsWith\('wan22-ti2v'\)/)
    expect(source).not.toMatch(/\? 24 : 16/)
  })

  it('the second engine really is fixed at 24, in its own source', () => {
    expect(rust('video_ltx2mlx.rs')).toContain('pub(super) const FRAME_RATE: u32 = 24;')
    // Since 82ff5890 the rate is one rule per catalogue entry (`frame_rate`):
    // 16 for the Wan models that run at 16, the second engine's constant for
    // everything else, and `video_generate` takes it from there.
    const video = rust('video.rs')
    const rule = video.slice(video.indexOf('fn frame_rate(c: &CatalogEntry) -> u32 {'))
    expect(rule.slice(0, rule.indexOf('\n}'))).toContain('ltx2mlx::FRAME_RATE')
    expect(video).toContain('let fps = frame_rate(entry);')
  })

  it('a frame count sits on the grid the engine floors it to', () => {
    expect(mlxVideoFrameStep('ltx_2q')).toBe(8)
    expect(mlxVideoFrameStep('ltx_2')).toBe(8)
    expect(mlxVideoFrameStep('wan_2')).toBe(4)
    expect(mlxVideoMaxFrames(8)).toBe(113)
    expect(mlxVideoMaxFrames(4)).toBe(117)
    for (const [asked, step, given] of [[49, 8, 49], [50, 8, 49], [48, 8, 41], [0, 8, 9], [500, 8, 113], [81, 4, 81], [83, 4, 81], [120, 4, 117], [1, 4, 9]]) {
      expect(mlxFramesOnGrid(asked, step), `${asked} on ${step}`).toBe(given)
    }
    expect(mlxFramesOnGrid(Number.NaN, 8)).toBe(MLX_VIDEO_MIN_FRAMES)
  })
})

describe('the length a run asks for', () => {
  it('comes back from Rust as exactly the frames on the slider, for every grid point and rate', () => {
    for (const [step, rates] of [[8, [24]], [4, [16, 24]]] as const) {
      for (const fps of rates) {
        for (let frames = MLX_VIDEO_MIN_FRAMES; frames <= mlxVideoMaxFrames(step); frames += step) {
          const made = rustClamp(rustFrames(mlxVideoSeconds(frames, fps), fps), step)
          expect(made, `${frames} frames at ${fps}`).toBe(frames)
        }
      }
    }
  })

  it('COUNTER-CHECK: the old length made another clip than the one on screen', () => {
    // 49 frames by Wan's 16 fps, read by the LTX engine at its 24.
    expect(rustClamp(rustFrames(49 / 16, 24), 8)).toBe(73)
  })
})

describe('the Create list entry of a Mac video model', () => {
  const catalogue = [
    entry({ id: 'wan21-t2v-1.3b', name: 'Wan 2.1 T2V 1.3B', family: 'wan_2', defaultFrames: 81, fps: 16, defaultWidth: 832, defaultHeight: 480, negativePrompt: true, recommendedRamGB: 32, loras: true }),
    entry({ id: 'ltx-2.3-q8', name: 'LTX-2.3 Distilled 8-bit', family: 'ltx_2q', defaultFrames: 49, acceptsImage: true, fps: 24, defaultWidth: 768, defaultHeight: 512, negativePrompt: false, loras: true }),
    entry({ id: 'ltx-2.3-dev', name: 'LTX-2.3 Dev', family: 'ltx_2', defaultFrames: 49, installed: false, fps: 24, defaultWidth: 768, defaultHeight: 512 }),
  ]
  const list = buildMlxVideoModels(catalogue)

  it('carries the frames of its catalogue entry, its rate, its grid, its size, whether it reads a negative prompt and takes the LoRA stack, and the memory it is recommended for', () => {
    expect(list.map((m) => [m.name, m.mlxVideo])).toEqual([
      ['MLX Wan 2.1 T2V 1.3B', { frames: 81, fps: 16, frameStep: 4, width: 832, height: 480, negativePrompt: true, loras: true, recommendedRamGB: 32 }],
      // An entry that names one number is recommended for that one.
      ['MLX LTX-2.3 Distilled 8-bit', { frames: 49, fps: 24, frameStep: 8, width: 768, height: 512, negativePrompt: false, loras: true, recommendedRamGB: 16 }],
    ])
    // A list from before the stack (no `loras`) takes none.
    expect(buildMlxVideoModels([entry({ id: 'old' })])[0].mlxVideo?.loras).toBe(false)
  })

  it('the lane runs the stored pick where it can, else the first model that can', () => {
    // Animate with a stored Wan that takes no image: the lane runs the LTX.
    expect(mlxVideoLaneEntry(list, 'MLX Wan 2.1 T2V 1.3B', 'animate')?.name).toBe('MLX LTX-2.3 Distilled 8-bit')
    expect(mlxVideoLaneEntry(list, 'MLX Wan 2.1 T2V 1.3B', 'video')?.name).toBe('MLX Wan 2.1 T2V 1.3B')
    expect(mlxVideoLaneEntry(list, 'MLX LTX-2.3 Distilled 8-bit', 'video')?.name).toBe('MLX LTX-2.3 Distilled 8-bit')
    expect(mlxVideoLaneEntry(list, '', 'video')?.name).toBe('MLX Wan 2.1 T2V 1.3B')
    expect(mlxVideoLaneEntry([], 'MLX Wan 2.1 T2V 1.3B', 'video')).toBeUndefined()
  })
})

describe('what video_generate takes', () => {
  // Create on the Mac shows the length and no slider for guidance, because
  // Rust takes none. The day it does, this turns red: the catalogue then has
  // to name the value, and Create has to show it.
  //
  // The negative prompt came with 82ff5890. It is text, not a slider, and it
  // reaches only the models that read one: the catalogue says which
  // (`negativePrompt`, from `takes_negative_prompt`).
  //
  // The LoRA stack came with M12 (14.10.2026). It is a list of files, not a
  // slider, and reaches only the models whose engine takes `--lora`
  // (`loras`, from `takes_loras`).
  //
  // Size and steps came with M2 (14.10.2026), changed on purpose: the second
  // engine and Wan read `-W`/`-H` and `--width`/`--height`, Wan reads
  // `--steps`. The catalogue says per entry which (`sizeGrid`, `steps`).
  //
  // The voice came with Talking Character on the Mac (3.0.8). It is a file,
  // not a slider, and turns the run into the engine's a2v on a model whose
  // entry talks (`talking`, from `talks`).
  it('is a prompt, a seed, a start image, a length, a negative prompt, the LoRA stack, a size and steps, a motion video, and no guidance', () => {
    const source = rust('video.rs')
    const args = source.slice(source.indexOf('struct GenerateArgs {'))
    const fields = [...args.slice(0, args.indexOf('\n}')).matchAll(/^\s+(\w+): /gm)].map((m) => m[1])
    expect(fields).toEqual(['id', 'prompt', 'seconds', 'fps', 'init_image', 'seed', 'negative_prompt', 'loras', 'width', 'height', 'steps', 'motion_video', 'audio'])
    expect(source).toContain('"talking": talks(c),')
    expect(source).toContain('"loras": takes_loras(c),')
    expect(source).toContain('"negativePrompt": takes_negative_prompt(c),')
    expect(source).toContain('"sizeGrid": size_grid(c),')
    expect(source).toContain('"steps": default_steps(c),')
  })

  it('and the catalogue names frames and a size per entry, no steps, no guidance and no rate', () => {
    const source = rust('video.rs')
    const struct = source.slice(source.indexOf('struct CatalogEntry {'))
    const fields = [...struct.slice(0, struct.indexOf('\n}')).matchAll(/^\s+(\w+): /gm)].map((m) => m[1])
    expect(fields).toContain('default_frames')
    for (const absent of ['steps', 'default_steps', 'guidance', 'cfg', 'fps', 'frame_rate']) expect(fields).not.toContain(absent)
  })
})

describe('the size and the steps of a Mac video run', () => {
  const [wan, ltx, first] = buildMlxVideoModels([
    entry({ id: 'wan21-t2v-1.3b', defaultWidth: 832, defaultHeight: 480, sizeGrid: 16, maxPixels: 832 * 480, minSide: 256, maxSide: 1280, steps: 50, maxSteps: 60, measuredRunSecondsPerClipSecond: 345 }),
    entry({ id: 'ltx-2.3-q4', family: 'ltx_2q', fps: 24, defaultWidth: 768, defaultHeight: 512, sizeGrid: 64, maxPixels: 768 * 512, minSide: 256, maxSide: 1280, steps: null, maxSteps: 60 }),
    entry({ id: 'ltx-2.3-distilled', family: 'ltx_2', fps: 24, defaultWidth: 768, defaultHeight: 512, sizeGrid: null, steps: null }),
  ]).map((m) => m.mlxVideo!)

  /** `run_size` of video.rs, for a size that was asked. */
  const rustTakes = (clip: typeof wan, w: number, h: number) =>
    w % clip.sizeGrid! === 0 && h % clip.sizeGrid! === 0
    && [w, h].every((v) => v >= clip.minSide! && v <= clip.maxSide!) && w * h <= clip.maxPixels!

  it('the list entry carries the grid and the steps where the catalogue names them, and nothing where it does not', () => {
    expect(wan).toMatchObject({ sizeGrid: 16, maxPixels: 399360, minSide: 256, maxSide: 1280, steps: 50, maxSteps: 60 })
    expect(ltx).toMatchObject({ sizeGrid: 64, maxPixels: 393216 })
    expect(ltx.steps).toBeUndefined()
    expect(first.sizeGrid).toBeUndefined()
    expect(first.steps).toBeUndefined()
  })

  it('a size goes out on the grid, inside the bounds and the own pixels, so Rust takes it', () => {
    expect(mlxVideoRunSize(832, 480, wan)).toEqual({ width: 832, height: 480 })
    expect(mlxVideoRunSize(480, 832, wan)).toEqual({ width: 480, height: 832 })
    expect(mlxVideoRunSize(512, 768, ltx)).toEqual({ width: 512, height: 768 })
    // The Image tab's 1024 square on an LTX: the same square, within its pixels.
    expect(mlxVideoRunSize(1024, 1024, ltx)).toEqual({ width: 576, height: 576 })
    // Off the grid: floored, as the engine would, before it reaches it.
    expect(mlxVideoRunSize(800, 480, ltx)).toEqual({ width: 768, height: 448 })
    for (const clip of [wan, ltx]) {
      for (const w of [64, 200, 256, 333, 512, 768, 832, 1024, 1280, 1920, 4096]) {
        for (const h of [64, 200, 256, 333, 512, 768, 832, 1024, 1280, 1920, 4096]) {
          const run = mlxVideoRunSize(w, h, clip)
          expect(rustTakes(clip, run.width, run.height), `${w} x ${h} gave ${run.width} x ${run.height}`).toBe(true)
        }
      }
    }
    // A model without a grid runs at its own size whatever the fields say.
    expect(mlxVideoRunSize(512, 512, first)).toEqual({ width: 768, height: 512 })
    expect(mlxVideoRunSize(Number.NaN, 512, wan)).toEqual({ width: 832, height: 480 })
  })

  it('steps go out for a model that takes them, between 1 and its most', () => {
    expect(mlxVideoRunSteps(8, wan)).toBe(8)
    expect(mlxVideoRunSteps(0, wan)).toBe(1)
    expect(mlxVideoRunSteps(500, wan)).toBe(60)
    expect(mlxVideoRunSteps(8, ltx)).toBeUndefined()
    expect(mlxVideoRunSteps(Number.NaN, wan)).toBeUndefined()
  })

  it('the time a run takes follows its steps and its pixels', () => {
    expect(mlxVideoRunRate(wan, { width: 832, height: 480 }, 50)).toBe(345)
    expect(mlxVideoRunRate(wan, { width: 832, height: 480 }, 10)).toBe(69)
    expect(mlxVideoRunRate(wan, { width: 416, height: 480 }, 50)).toBe(172.5)
    expect(mlxVideoRunRate(ltx, { width: 768, height: 512 }, undefined)).toBeUndefined()
  })

  it('the run sends what the settings show, and the gallery keeps it', () => {
    const hook = readFileSync(resolve(__dirname, '../../hooks/useCreate.ts'), 'utf-8')
    // A talking clip takes the shape of its portrait, every other the canvas.
    expect(hook).toContain('const shape = talking && source?.width && source?.height ? { width: source.width, height: source.height } : { width, height }')
    expect(hook).toContain('const clipSize = clip ? mlxVideoRunSize(shape.width, shape.height, clip) : null')
    expect(hook).toContain('...(clip?.sizeGrid && clipSize ? { width: clipSize.width, height: clipSize.height } : {}),')
    expect(hook).toContain('...(clipSteps ? { steps: clipSteps } : {}),')
    expect(hook).toContain('width: clipSize?.width ?? width, height: clipSize?.height ?? height')
  })
})
