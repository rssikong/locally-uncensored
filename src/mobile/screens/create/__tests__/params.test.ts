import { describe, expect, it } from 'vitest'
import { ASPECTS, aspectKey, aspectSize, creditsLabel, formatClock, formatSeconds, hasAnyParam, qualityKey, runParams, summaryParts, type ParamInput } from '../parts/params'
import { TOOL_IDS, availableTools, fallbackTool, toolAllowsMask, toolFacts, toolNeedsMask } from '../parts/tools'

const base: ParamInput = {
  tool: 'image', characterUse: false, studio: false, studioFieldCount: 0, negativePrompt: false, durations: [], musicLength: null, musicSecond: null, canImprove: false,
}

describe('which settings a run takes', () => {
  it('a classic image model takes aspect, quality and count', () => {
    const p = runParams({ ...base, negativePrompt: true, canImprove: true })
    expect(p).toMatchObject({ aspect: true, quality: true, count: true, negative: true, improve: true, strength: false, size: false, modelSettings: false })
  })

  it('a negative prompt only shows when the model reads one', () => {
    expect(runParams(base).negative).toBe(false)
    expect(runParams({ ...base, tool: 'video', durations: [5], negativePrompt: true }).negative).toBe(true)
  })

  it('a studio model brings its own controls and drops aspect and quality', () => {
    const p = runParams({ ...base, studio: true, studioFieldCount: 3 })
    expect(p).toMatchObject({ aspect: false, quality: false, count: true, modelSettings: true })
    expect(runParams({ ...base, studio: true, studioFieldCount: 0 }).modelSettings).toBe(false)
  })

  it('edit takes strength, enhance takes a target size', () => {
    expect(runParams({ ...base, tool: 'edit' })).toMatchObject({ strength: true, quality: true, aspect: false })
    expect(runParams({ ...base, tool: 'upscale' })).toMatchObject({ size: true, quality: false, count: false })
  })

  it('remove background and erase take nothing', () => {
    expect(hasAnyParam(runParams({ ...base, tool: 'removebg' }))).toBe(false)
    expect(hasAnyParam(runParams({ ...base, tool: 'eraser', negativePrompt: true, canImprove: true }))).toBe(false)
  })

  it('a video model offers exactly the lengths it renders', () => {
    expect(runParams({ ...base, tool: 'video', durations: [5, 10] }).length).toEqual([5, 10])
    expect(runParams({ ...base, tool: 'animate', durations: [] }).length).toEqual([])
    expect(runParams({ ...base, tool: 'video', studio: true, studioFieldCount: 2, durations: [5] }).length).toEqual([])
  })

  it('training takes nothing, using a character takes aspect and quality', () => {
    expect(hasAnyParam(runParams({ ...base, tool: 'character' }))).toBe(false)
    expect(runParams({ ...base, tool: 'character', characterUse: true })).toMatchObject({ aspect: true, quality: true, count: false })
  })

  it('music takes its length and its second text when the model has them', () => {
    const len = { min: 10, max: 180, step: 5 }
    expect(runParams({ ...base, tool: 'music', musicLength: len, musicSecond: 'lyrics' })).toMatchObject({ musicLength: len, musicSecond: 'lyrics' })
    expect(runParams({ ...base, tool: 'music' }).musicLength).toBeNull()
  })

  it('talking and motion take only their inputs', () => {
    expect(hasAnyParam(runParams({ ...base, tool: 'lipsync', canImprove: true }))).toBe(false)
    expect(hasAnyParam(runParams({ ...base, tool: 'motion' }))).toBe(false)
    expect(runParams({ ...base, tool: 'extend', canImprove: true }).improve).toBe(true)
  })

  it('every tool gives an answer', () => {
    for (const tool of TOOL_IDS) expect(runParams({ ...base, tool })).toBeTruthy()
  })
})

describe('aspect, quality and the summary', () => {
  it('sizes keep the long side and snap to 64', () => {
    expect(aspectSize('1:1', 1024)).toEqual({ w: 1024, h: 1024 })
    expect(aspectSize('16:9', 1024)).toEqual({ w: 1024, h: 576 })
    expect(aspectSize('3:4', 1024)).toEqual({ w: 768, h: 1024 })
    for (const a of ASPECTS) expect(aspectKey(aspectSize(a, 1024).w, aspectSize(a, 1024).h)).toBe(a)
  })

  it('picks the closest quality', () => {
    const ladder = { Draft: 8, Standard: 20, High: 40 }
    expect(qualityKey(ladder, 9)).toBe('Draft')
    expect(qualityKey(ladder, 22)).toBe('Standard')
    expect(qualityKey(ladder, 100)).toBe('High')
  })

  it('the summary names only what the run takes', () => {
    const params = runParams(base)
    expect(summaryParts({ params, tool: 'image', characterUse: false, count: 2, aspect: '1:1', quality: 'Standard', seconds: null, size: '4k', musicSeconds: 0 })).toEqual(['2 images', '1:1', 'Standard'])
    const up = runParams({ ...base, tool: 'upscale' })
    expect(summaryParts({ params: up, tool: 'upscale', characterUse: false, count: 1, aspect: '1:1', quality: 'Standard', seconds: null, size: '4k', musicSeconds: 0 })).toEqual(['4K'])
    const vid = runParams({ ...base, tool: 'video', durations: [5, 10] })
    expect(summaryParts({ params: vid, tool: 'video', characterUse: false, count: 1, aspect: '1:1', quality: 'Standard', seconds: 10, size: '', musicSeconds: 0 })).toEqual(['10 s'])
  })

  it('formats time and credits', () => {
    expect(formatClock(7)).toBe('0:07')
    expect(formatClock(90)).toBe('1:30')
    expect(formatSeconds(45)).toBe('45 s')
    expect(creditsLabel(1)).toMatch(/^1 credit$/)
    expect(creditsLabel(48)).toMatch(/^48 credits$/)
  })
})

describe('tools', () => {
  it('only what the catalog offers is shown, in the fixed order', () => {
    expect(availableTools({ video: true, image: true, music: false })).toEqual(['image', 'video'])
    expect(availableTools({})).toEqual([])
  })

  it('falls back to the first offered tool', () => {
    expect(fallbackTool('music', ['image', 'video'])).toBe('image')
    expect(fallbackTool('video', ['image', 'video'])).toBe('video')
    expect(fallbackTool('video', [])).toBeNull()
  })

  it('erase always needs a painted area, edit only when its model asks, the rest never', () => {
    expect(toolNeedsMask('eraser', true)).toBe(true)
    expect(toolNeedsMask('edit', false)).toBe(true)
    expect(toolNeedsMask('edit', true)).toBe(false)
    expect(toolNeedsMask('removebg', false)).toBe(false)
    expect(toolAllowsMask('edit')).toBe(true)
    expect(toolAllowsMask('image')).toBe(false)
  })

  it('a batch is only for tools that take one source and no mask', () => {
    expect(TOOL_IDS.filter((id) => toolFacts(id).batch)).toEqual(['edit', 'removebg', 'upscale'])
  })
})
