/**
 * Seen twice in the real Windows build (05.10.2026): Create, Image, sd_turbo,
 * Quality on "Draft", over to Music and back, and Quality read "High" with 50
 * steps. Music keeps mode 'image' and writes ACE's sampling values into the
 * fields every tab shares; the way back only restored the image values when
 * the mode had been 'video', so ACE's 50 steps stayed on Image.
 *
 * The same shared fields are written by every tab that runs another model, and
 * they are stored across a restart while the tab itself is not.
 *
 * Run: npx vitest run src/stores/__tests__/a-tab-visit-leaves-the-image-values-alone.test.ts
 */
import { beforeEach, describe, it, expect } from 'vitest'
import { useCreateStore, MODEL_TYPE_DEFAULTS } from '../createStore'
import type { CreateIntent } from '../createStore'

const IMAGE_TABS: CreateIntent[] = ['image', 'edit', 'removebg', 'upscale', 'eraser', 'character']
const OTHER_TABS: CreateIntent[] = ['music', 'video', 'animate', 'extend', 'lipsync', 'motion']

// What the Quality control wrote for "Draft" on an SD 1.5 checkpoint at the
// time (0.6 of the family's 25 steps), plus values tuned by hand.
const TUNED = { steps: 15, cfgScale: 2.5, sampler: 'dpmpp_2m', scheduler: 'karras', width: 640, height: 768 }

const stored = () =>
  useCreateStore.persist.getOptions().partialize!(useCreateStore.getState()) as Record<string, unknown>

beforeEach(() => {
  useCreateStore.setState(useCreateStore.getInitialState(), true)
  useCreateStore.setState({ videoModel: 'wan2.2_ti2v_5B_fp16.safetensors' })
  useCreateStore.getState().setImageModel('sd_turbo.safetensors', 'sd15')
  useCreateStore.setState(TUNED)
})

describe('Image after a visit to another tab', () => {
  it('Draft stays Draft across Music, the reported case', () => {
    const st = useCreateStore.getState()
    st.setIntent('music')
    expect(useCreateStore.getState().steps).toBe(MODEL_TYPE_DEFAULTS.ace.steps)
    st.setIntent('image')
    expect(useCreateStore.getState()).toMatchObject(TUNED)
  })

  it('every image tab gets the tuned values back from every other tab', () => {
    for (const away of OTHER_TABS) {
      for (const home of IMAGE_TABS) {
        useCreateStore.getState().setIntent('image')
        useCreateStore.setState(TUNED)
        useCreateStore.getState().setIntent(away)
        useCreateStore.getState().setIntent(home)
        expect(useCreateStore.getState(), `${away} -> ${home}`).toMatchObject(TUNED)
      }
    }
  })

  it('a second tab on the way does not lose them', () => {
    const st = useCreateStore.getState()
    st.setIntent('music')
    st.setIntent('video')
    st.setIntent('lipsync')
    st.setIntent('edit')
    expect(useCreateStore.getState()).toMatchObject(TUNED)
  })

  it('a model picked in the meantime gets its own values, not the old tuning', () => {
    const st = useCreateStore.getState()
    st.setIntent('music')
    st.setImageModel('juggernautXL_v9.safetensors', 'sdxl')
    st.setIntent('image')
    const d = MODEL_TYPE_DEFAULTS.sdxl
    expect(useCreateStore.getState()).toMatchObject({
      steps: d.steps, cfgScale: d.cfgScale, sampler: d.sampler, scheduler: d.scheduler, width: d.width, height: d.height,
    })
  })

  it('holds without a local image model too (Cloud only)', () => {
    useCreateStore.setState({ imageModel: '', imageModelType: 'unknown', ...TUNED })
    for (const away of OTHER_TABS) {
      useCreateStore.getState().setIntent(away)
      useCreateStore.getState().setIntent('image')
      expect(useCreateStore.getState(), away).toMatchObject(TUNED)
    }
  })

  it('inside the image lane nothing is put aside or restored', () => {
    const st = useCreateStore.getState()
    st.setIntent('edit')
    useCreateStore.setState({ steps: 9 })
    st.setIntent('image')
    expect(useCreateStore.getState()).toMatchObject({ steps: 9, imageLaneKept: null })
  })
})

describe('a restart on a tab that is not stored', () => {
  it('closed on Music, the stored values are the image ones', () => {
    useCreateStore.getState().setIntent('music')
    expect(stored()).toMatchObject({ mode: 'image', ...TUNED })
    expect(stored()).not.toHaveProperty('imageLaneKept')
  })

  it('closed on Lip sync or Motion, the stored values are the video model\'s', () => {
    const d = MODEL_TYPE_DEFAULTS.wan22
    for (const tab of ['lipsync', 'motion'] as const) {
      useCreateStore.getState().setIntent(tab)
      expect(stored(), tab).toMatchObject({
        mode: 'video', steps: d.steps, cfgScale: d.cfgScale, sampler: d.sampler, width: d.width, height: d.height,
        frames: d.frames, fps: d.fps,
      })
    }
  })

  it('on Image and on Video the stored values are what is on screen', () => {
    expect(stored()).toMatchObject(TUNED)
    useCreateStore.getState().setIntent('video')
    useCreateStore.setState({ steps: 11 })
    expect(stored()).toMatchObject({ mode: 'video', steps: 11 })
  })
})

describe('a distilled video model after a visit to another tab', () => {
  it('comes back at its own 6 steps and CFG 1, not at the family defaults', () => {
    const st = useCreateStore.getState()
    st.setVideoModel('wan2.2_t2v_lightx2v_4steps.safetensors')
    expect(useCreateStore.getState()).toMatchObject({ steps: 6, cfgScale: 1 })
    for (const tab of ['video', 'animate', 'extend'] as const) {
      useCreateStore.getState().setIntent('image')
      useCreateStore.getState().setIntent(tab)
      expect(useCreateStore.getState(), tab).toMatchObject({ mode: 'video', steps: 6, cfgScale: 1 })
    }
  })
})
