/**
 * LU Cloud, offered at the one place where a local model does not fit.
 *
 * The owner's wish of 15.10.2026: a model in the Model Manager that is too big
 * for the card, or a local video run that would take very long, says there
 * that LU Cloud runs it. A quiet line with one button, never a banner.
 *
 * Three decisions, each reversible:
 *
 * 1. The offer follows the TASK, not the single model. A chat model that does
 *    not fit leads to the cloud chat models, an image or video model to Create
 *    in cloud mode with the same tab (Image, Video, Animate, ...). The line
 *    promises the task, which the cloud always has, never the single model.
 * 2. A number of credits is named only where the app knows the price (the
 *    number Create shows for a cloud run). Unknown or 0 gives no number. No
 *    money amount stands in the app.
 * 3. "Very long" is not guessed. The app has no runtime estimate for a local
 *    video run on a PC, so there the line rides on the card verdict of
 *    lib/vram-fit: too big, or only partly on the card (tight) for a video
 *    lane. A Mac has a measured estimate (lib/mlx-video-progress.ts) and a
 *    memory verdict (MacVideoMemoryNotice), and the line rides on those.
 *
 * Pure: no store, no component. The components read the stores and hand the
 * facts in here, so every sentence is tested without a render.
 */
import type { VramFit } from './vram-fit'

/** What the user wanted to do with the model that does not fit. */
export type CloudOfferTask =
  | 'chat'
  | 'image' | 'edit'
  | 'video' | 'animate' | 'extend'
  | 'lipsync' | 'motion' | 'music'

/** The Create tabs a cloud offer can lead to. */
export type CloudOfferIntent = Exclude<CloudOfferTask, 'chat'>

const CREATE_TASKS: ReadonlySet<string> = new Set<CloudOfferIntent>([
  'image', 'edit', 'video', 'animate', 'extend', 'lipsync', 'motion', 'music',
])

/** The tabs whose run is a video. Only these get the line for a model that
 *  merely sits tight on the card: a tight image model loads slowly once, a
 *  tight video model pays for it on every frame. */
const VIDEO_TASKS: ReadonlySet<string> = new Set<CloudOfferIntent>([
  'video', 'animate', 'extend', 'lipsync', 'motion',
])

export function isCloudOfferIntent(intent: string): intent is CloudOfferIntent {
  return CREATE_TASKS.has(intent)
}

export function isVideoTask(task: string): boolean {
  return VIDEO_TASKS.has(task)
}

/** The lane names the Model Manager prints on a non-video bundle. */
const LANE_TASK: Record<string, CloudOfferIntent> = {
  Music: 'music',
  'Lip sync': 'lipsync',
  Motion: 'motion',
}

/** Which Create tab a Model Manager bundle belongs to. */
export function bundleCloudTask(
  category: 'image' | 'video',
  bundle: { i2v?: boolean },
  lane?: string,
): CloudOfferIntent {
  if (lane && LANE_TASK[lane]) return LANE_TASK[lane]
  if (category === 'image') return 'image'
  return bundle.i2v ? 'animate' : 'video'
}

const NOUN: Record<CloudOfferTask, string> = {
  chat: 'Large chat models',
  image: 'Images',
  edit: 'Images',
  video: 'Videos',
  animate: 'Videos',
  extend: 'Videos',
  lipsync: 'Talking videos',
  motion: 'Motion videos',
  music: 'Songs',
}

/** The first half of the line: why this model is a case for the cloud. */
export function tooBigWords(sharedMemory: boolean): string {
  return sharedMemory ? "Too big for this Mac's memory." : 'Too big for this graphics card.'
}

/** The line on a Model Manager tile whose model does not fit. */
export function tileOfferLine(task: CloudOfferTask, sharedMemory: boolean): string {
  return `${tooBigWords(sharedMemory)} ${NOUN[task]} run on LU Cloud.`
}

/** Why Create offers the cloud for the run on screen, or null for no line. */
export type CreateOfferReason = 'too-big' | 'partly' | 'mac-memory' | 'mac-long'

export interface CreateOfferFacts {
  intent: string
  /** A Mac running media itself (MLX). */
  macHost: boolean
  /** The card verdict for the picked local model (PC). */
  fit: VramFit
  /** The Mac has less memory than the lane's video model is recommended for. */
  macMemoryShort: boolean
  /** The measured estimate says this Mac run takes long. */
  macLongRun: boolean
}

export function createOfferReason(f: CreateOfferFacts): CreateOfferReason | null {
  if (!isCloudOfferIntent(f.intent)) return null
  if (f.macHost) {
    if (!isVideoTask(f.intent)) return null
    if (f.macMemoryShort) return 'mac-memory'
    if (f.macLongRun) return 'mac-long'
    return null
  }
  if (f.fit === 'big') return 'too-big'
  if (f.fit === 'tight' && isVideoTask(f.intent)) return 'partly'
  return null
}

/** The line Create shows for that reason. */
export function createOfferLine(reason: CreateOfferReason, task: CloudOfferIntent): string {
  const noun = NOUN[task]
  switch (reason) {
    case 'too-big':
      return `${tooBigWords(false)} ${noun} run on LU Cloud.`
    case 'partly':
      return `This model only partly fits this graphics card, so a run can take long. ${noun} also run on LU Cloud.`
    case 'mac-memory':
      return `${tooBigWords(true)} ${noun} run on LU Cloud.`
    case 'mac-long':
      return `This run takes long on this Mac. ${noun} also run on LU Cloud.`
  }
}

/** The sentence with the price, or '' when the price is not known. */
export function offerCreditsLine(credits: number | undefined | null): string {
  if (typeof credits !== 'number' || !Number.isFinite(credits) || credits <= 0) return ''
  return `About ${Math.ceil(credits).toLocaleString('en-US')} credits per run.`
}

/** The button and its title, the same path the model picker's LU Cloud rows
 *  take (ModelSelector). */
export const CLOUD_OFFER_BUTTON = 'Try LU Cloud'
export const CLOUD_OFFER_TITLE = 'Runs on LU Cloud, tap to see plans'
