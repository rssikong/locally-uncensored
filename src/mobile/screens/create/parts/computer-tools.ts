/**
 * The tools of Create on "My computer" (A17, LU 3.0.8): the same tools as
 * the cloud tool row (tools.ts), turned into the kinds the computer knows
 * (mobile-docs/remote/CREATE-V2.md). Pure: no store, no network.
 *
 *   Image      image, or image-to-image with a start image (as in 3.0.7)
 *   Edit       edit: 1 to limits.max_edit_inputs photos, optional mask
 *   Cutout     removebg: one photo
 *   Enhance    upscale: one photo, factor 2 or 4
 *   Video      video, or image-to-video with a start image (as in 3.0.7)
 *   Character  image with `character` from capabilities.characters
 *   Music      music: style (the prompt), lyrics, duration
 *
 * A tool is shown when the computer names its feature word; a tool whose
 * kind the computer names as not available stays in the row and says the
 * computer's reason. A computer with LU 3.0.7 names only create-image and
 * create-video, so it gets the two tools it always had.
 */
import {
  FEATURE_CREATE_CHARACTER,
  FEATURE_CREATE_EDIT,
  FEATURE_CREATE_IMAGE,
  FEATURE_CREATE_MUSIC,
  FEATURE_CREATE_REMOVEBG,
  FEATURE_CREATE_UPSCALE,
  FEATURE_CREATE_VIDEO,
  kindInfo,
  mediaOf,
  type ComputerCapabilities,
  type ComputerKind,
  type ComputerMedia,
} from '../../../remote/desktopCreate'
import { TOOL_IDS, type ToolId } from './tools'

export type ComputerTool = Extract<ToolId, 'image' | 'edit' | 'removebg' | 'upscale' | 'video' | 'character' | 'music'>

const FEATURE: Record<ComputerTool, string> = {
  image: FEATURE_CREATE_IMAGE,
  edit: FEATURE_CREATE_EDIT,
  removebg: FEATURE_CREATE_REMOVEBG,
  upscale: FEATURE_CREATE_UPSCALE,
  video: FEATURE_CREATE_VIDEO,
  character: FEATURE_CREATE_CHARACTER,
  music: FEATURE_CREATE_MUSIC,
}

/** In the order of the cloud tool row. */
export const COMPUTER_TOOLS: readonly ComputerTool[] = TOOL_IDS.filter((id): id is ComputerTool => id in FEATURE)

export function isComputerTool(id: unknown): id is ComputerTool {
  return typeof id === 'string' && (COMPUTER_TOOLS as readonly string[]).includes(id)
}

/** The kind a tool asks for when it has no start image. */
const BASE_KIND: Record<ComputerTool, ComputerKind> = {
  image: 'image',
  character: 'image',
  edit: 'edit',
  removebg: 'removebg',
  upscale: 'upscale',
  video: 'video',
  music: 'music',
}

/** Pure: the kind of a run. A start image turns image and video into their image kinds, if the computer has them. */
export function kindOfTool(tool: ComputerTool, withImage: boolean, caps: ComputerCapabilities | null): ComputerKind {
  if (withImage && tool === 'image' && kindInfo(caps, 'image-to-image')) return 'image-to-image'
  if (withImage && tool === 'video' && kindInfo(caps, 'image-to-video')) return 'image-to-video'
  return BASE_KIND[tool]
}

export function mediaOfTool(tool: ComputerTool): ComputerMedia {
  return mediaOf(BASE_KIND[tool])
}

export interface ComputerToolState {
  id: ComputerTool
  available: boolean
  /** Why not, in the computer's words or ours. '' when available. */
  reason: string
}

export const TOOL_REASON = {
  noModel: (what: string) => `Your computer has no model for ${what}. Add one in LU on your computer.`,
  noCharacter: 'Your computer has no trained character. Train one in Create on your computer.',
} as const

const WHAT: Record<ComputerTool, string> = {
  image: 'images',
  character: 'images',
  edit: 'editing photos',
  removebg: 'cutting out photos',
  upscale: 'enhancing photos',
  video: 'videos',
  music: 'music',
}

/**
 * Pure: the tools of the row, with whether each can run now. Before the
 * capabilities are in, every named tool counts as available (the stage says
 * "Asking your computer" meanwhile).
 */
export function computerTools(features: readonly string[], caps: ComputerCapabilities | null): ComputerToolState[] {
  const out: ComputerToolState[] = []
  for (const id of COMPUTER_TOOLS) {
    if (!features.includes(FEATURE[id])) continue
    // A character is an image with a name: without image there is nothing to put it in.
    if (id === 'character' && !features.includes(FEATURE_CREATE_IMAGE)) continue
    if (!caps) {
      out.push({ id, available: true, reason: '' })
      continue
    }
    const info = kindInfo(caps, BASE_KIND[id])
    if (!info) {
      // The feature is named, the kind is not: an answer of a computer in between. Nothing to run.
      out.push({ id, available: false, reason: TOOL_REASON.noModel(WHAT[id]) })
      continue
    }
    if (!info.available) {
      out.push({ id, available: false, reason: info.reason || TOOL_REASON.noModel(WHAT[id]) })
      continue
    }
    if (id === 'character' && caps.characters.length === 0) {
      out.push({ id, available: false, reason: TOOL_REASON.noCharacter })
      continue
    }
    out.push({ id, available: true, reason: '' })
  }
  return out
}

/** Pure: the tool in force: the chosen one if the row has it, else the first of the row. */
export function computerToolInForce(chosen: ComputerTool, row: readonly ComputerToolState[]): ComputerTool | null {
  if (row.some((t) => t.id === chosen)) return chosen
  return row[0]?.id ?? null
}

export interface ToolInputs {
  /** Photos the run needs at least. */
  min: number
  /** Photos the run takes at most. 0: none. */
  max: number
}

/** Pure: how many photos from the phone a tool takes. */
export function toolInputs(tool: ComputerTool, caps: ComputerCapabilities | null): ToolInputs {
  switch (tool) {
    case 'edit':
      return { min: 1, max: Math.max(1, caps?.limits.maxEditInputs ?? 1) }
    case 'upscale':
    case 'removebg':
      return { min: 1, max: 1 }
    case 'image':
      return { min: 0, max: kindInfo(caps, 'image-to-image') ? 1 : 0 }
    case 'video':
      return { min: 0, max: kindInfo(caps, 'image-to-video') ? 1 : 0 }
    default:
      return { min: 0, max: 0 }
  }
}

/** Pure: yes: a prompt is required. optional: it may stay empty. no: there is no prompt field. */
export function toolPrompt(tool: ComputerTool): 'yes' | 'optional' | 'no' {
  if (tool === 'upscale' || tool === 'removebg') return 'no'
  if (tool === 'video') return 'optional'
  return 'yes'
}

/** Pure: the kinds that run without a model to pick (the computer has its own). */
export function modelOptional(kind: ComputerKind): boolean {
  return kind === 'upscale' || kind === 'removebg'
}

/** Pure: only Edit takes a painted area. */
export function toolTakesMask(tool: ComputerTool): boolean {
  return tool === 'edit'
}
