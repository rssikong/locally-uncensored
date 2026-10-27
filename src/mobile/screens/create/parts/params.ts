/**
 * Which run settings a tool and its model really take. Pure.
 *
 * The cloud endpoints ignore values they do not know, and a control whose
 * value is dropped is a lie on the screen. So every control of the run
 * settings sheet asks this table first.
 */
import type { ToolId } from './tools'

export interface ParamInput {
  tool: ToolId
  /** Character tool with a trained character picked: it renders an image. */
  characterUse: boolean
  /** The run model brings its own controls from the provider schema. */
  studio: boolean
  /** How many controls that schema has. */
  studioFieldCount: number
  /** The catalog says the model reads a negative prompt. */
  negativePrompt: boolean
  /** Clip lengths in seconds the model renders, empty when it has none. */
  durations: readonly number[]
  /** Track length of a music model, null when the model decides itself. */
  musicLength: { min: number; max: number; step: number } | null
  /** The second text of a music model. */
  musicSecond: 'lyrics' | 'style' | null
  /** The helper model can rewrite the prompt for this run. */
  canImprove: boolean
}

export interface RunParams {
  aspect: boolean
  quality: boolean
  /** 1 to 4 images in one run. */
  count: boolean
  /** Target of Enhance: 2K, 4K, 8K. */
  size: boolean
  /** Clip lengths to choose from. */
  length: readonly number[]
  /** How far an edit may move away from the source. */
  strength: boolean
  negative: boolean
  improve: boolean
  musicLength: { min: number; max: number; step: number } | null
  musicSecond: 'lyrics' | 'style' | null
  /** The sub page with the controls of the provider schema. */
  modelSettings: boolean
}

const NONE: RunParams = {
  aspect: false, quality: false, count: false, size: false, length: [], strength: false,
  negative: false, improve: false, musicLength: null, musicSecond: null, modelSettings: false,
}

export function runParams(input: ParamInput): RunParams {
  const { tool, studio } = input
  const modelSettings = studio && input.studioFieldCount > 0
  if (tool === 'character') {
    if (!input.characterUse) return NONE
    return { ...NONE, aspect: true, quality: true, negative: input.negativePrompt }
  }
  if (tool === 'image') {
    if (studio) return { ...NONE, count: true, improve: input.canImprove, modelSettings }
    return { ...NONE, aspect: true, quality: true, count: true, negative: input.negativePrompt, improve: input.canImprove }
  }
  if (tool === 'edit') {
    if (studio) return { ...NONE, count: true, improve: input.canImprove, modelSettings }
    return { ...NONE, quality: true, count: true, strength: true, negative: input.negativePrompt, improve: input.canImprove }
  }
  if (tool === 'upscale') return { ...NONE, size: true }
  if (tool === 'removebg' || tool === 'eraser') return NONE
  if (tool === 'video' || tool === 'animate') {
    if (studio) return { ...NONE, improve: input.canImprove, modelSettings }
    return { ...NONE, length: input.durations, negative: input.negativePrompt, improve: input.canImprove }
  }
  if (tool === 'music') {
    return { ...NONE, musicLength: input.musicLength, musicSecond: input.musicSecond, improve: input.canImprove, modelSettings }
  }
  // Talking, Extend, Motion: a classic model takes its inputs and nothing else.
  return { ...NONE, improve: tool === 'extend' && input.canImprove, modelSettings }
}

/** True when the sheet would have nothing but the footer. */
export function hasAnyParam(p: RunParams): boolean {
  return p.aspect || p.quality || p.count || p.size || p.length.length > 0 || p.strength || p.negative ||
    p.improve || p.musicLength !== null || p.musicSecond !== null || p.modelSettings
}

// ---------- aspect and quality ----------

export type AspectKey = '1:1' | '3:4' | '4:3' | '16:9'
export const ASPECTS: readonly AspectKey[] = ['1:1', '3:4', '4:3', '16:9']
const RATIO: Record<AspectKey, number> = { '1:1': 1, '3:4': 3 / 4, '4:3': 4 / 3, '16:9': 16 / 9 }

function snap64(n: number): number {
  return Math.max(64, Math.round(n / 64) * 64)
}

/** Width and height for an aspect, with the long side of the model family. */
export function aspectSize(key: AspectKey, baseLong: number): { w: number; h: number } {
  const r = RATIO[key]
  return r >= 1 ? { w: baseLong, h: snap64(baseLong / r) } : { w: snap64(baseLong * r), h: baseLong }
}

/** The aspect a size is closest to. */
export function aspectKey(w: number, h: number): AspectKey {
  const r = h > 0 ? w / h : 1
  let best: AspectKey = '1:1'
  let bestD = Infinity
  for (const k of ASPECTS) {
    const d = Math.abs(RATIO[k] - r)
    if (d < bestD) {
      bestD = d
      best = k
    }
  }
  return best
}

export type QualityKey = 'Draft' | 'Standard' | 'High'
export const QUALITIES: readonly QualityKey[] = ['Draft', 'Standard', 'High']

/** The quality whose step count is closest to the current one. */
export function qualityKey(ladder: Record<QualityKey, number>, steps: number): QualityKey {
  let best: QualityKey = 'Standard'
  let bestD = Infinity
  for (const k of QUALITIES) {
    const d = Math.abs(ladder[k] - steps)
    if (d < bestD) {
      bestD = d
      best = k
    }
  }
  return best
}

// ---------- the summary line ----------

export interface SummaryInput {
  params: RunParams
  tool: ToolId
  characterUse: boolean
  count: number
  aspect: AspectKey
  quality: QualityKey
  seconds: number | null
  size: string
  musicSeconds: number
}

/** The parts of the line under the prompt: "1 image", "1:1", "Standard". */
export function summaryParts(input: SummaryInput): string[] {
  const { params, tool } = input
  const parts: string[] = []
  if (params.count) parts.push(input.count === 1 ? '1 image' : `${input.count} images`)
  else if (tool === 'character' && input.characterUse) parts.push('1 image')
  if (params.aspect) parts.push(input.aspect)
  if (params.quality) parts.push(input.quality)
  if (params.size) parts.push(input.size.toUpperCase())
  if (params.length.length > 0 && input.seconds !== null) parts.push(`${input.seconds} s`)
  if (params.musicLength) parts.push(formatSeconds(input.musicSeconds))
  if (params.modelSettings) parts.push('Model settings')
  return parts
}

/** "0:07", "1:30". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "45 s", "1 min 30 s", "2 min". */
export function formatSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  if (s < 60) return `${s} s`
  const rest = s % 60
  return rest ? `${Math.floor(s / 60)} min ${rest} s` : `${Math.floor(s / 60)} min`
}

/** "1,240". */
export function formatCredits(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString('en-US')
}

/** "4 credits", "1 credit". */
export function creditsLabel(n: number): string {
  const v = Math.max(0, Math.round(n))
  return v === 1 ? '1 credit' : `${formatCredits(v)} credits`
}
