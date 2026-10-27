/**
 * The price of a model the provider bills by the length of what goes in
 * (`credits.length` of the catalogue: per_block, min, max, quote). Pure.
 *
 * The rule itself is the server's and lives once, in stores/cloudCatalogStore
 * (lengthPrice, lengthCredits). This file only says which input of the phone
 * is the length, and what the button shows for it: the same decisions the
 * Create tab of the desktop takes in its composer.
 */
import { lengthCredits, lengthPrice } from '../../../../stores/cloudCatalogStore'
import type { ToolId } from './tools'

export interface LengthInputs {
  /** Object URLs of what is attached, undefined where nothing is. */
  audioUrl?: string
  videoUrl?: string
  extendUrl?: string
  /** A voice made earlier stands in for the sound: the id of its job. */
  voiceJobId?: string
}

export interface LengthSource {
  /** A file of this phone whose seconds are the length. */
  media?: { url: string; kind: 'audio' | 'video' }
  /** A voice of an earlier job whose seconds are the length. */
  voiceJobId?: string
}

/** The basis of the price of this run, or undefined when the model is not billed by length. */
export function lengthBasis(model: string | undefined, op: string | undefined): 'audio' | 'video' | 'chars' | undefined {
  const basis = lengthPrice(model, op)?.basis
  // 'extension' is a fixed length the model adds: priced per run, nothing to measure.
  return basis === 'extension' ? undefined : basis
}

/**
 * Which input is measured. A lip sync model can bill the clip instead of the
 * sound; then the clip is the length.
 */
export function lengthSource(tool: ToolId, basis: 'audio' | 'video' | 'chars' | undefined, inputs: LengthInputs): LengthSource {
  if (!basis || basis === 'chars') return {}
  if (tool === 'lipsync') {
    if (basis === 'video') return inputs.videoUrl ? { media: { url: inputs.videoUrl, kind: 'video' } } : {}
    if (inputs.audioUrl) return { media: { url: inputs.audioUrl, kind: 'audio' } }
    return inputs.voiceJobId ? { voiceJobId: inputs.voiceJobId } : {}
  }
  if (tool === 'motion') return inputs.videoUrl ? { media: { url: inputs.videoUrl, kind: 'video' } } : {}
  if (tool === 'extend') return inputs.extendUrl ? { media: { url: inputs.extendUrl, kind: 'video' } } : {}
  return {}
}

/**
 * The credits of one run on a model billed by length: the characters of the
 * text for a voice, else the measured seconds. Without a known length it is
 * the price of the length the catalogue quotes. Null when the model is not
 * billed by length.
 */
export function lengthUnit(model: string | undefined, op: string | undefined, prompt: string, seconds: number | undefined): number | null {
  const rate = lengthPrice(model, op)
  if (!rate || !model) return null
  return lengthCredits(model, rate.basis === 'chars' ? Array.from(prompt).length || undefined : seconds)
}
