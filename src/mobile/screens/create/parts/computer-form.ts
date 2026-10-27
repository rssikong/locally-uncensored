/**
 * The settings of a job on the user's computer: model, size, steps, seed,
 * count, what to leave out, the photos from the phone, a painted area, a
 * character, lyrics. The fields and their limits come from the computer
 * (`capabilities`, one simple JSON schema per kind); this file keeps what
 * the user picked and turns it into the body of a job.
 *
 * The prompt is the one of Create (create store), so switching between LU
 * Cloud and "My computer" keeps what was typed. The count is never kept
 * across a restart, like in the cloud form (draft.ts).
 */
import { create } from 'zustand'
import type { ImageRef } from '../../../../stores/createStore'
import type { ComputerField, ComputerJobBody, ComputerKind, ComputerKindInfo, ComputerModel } from '../../../remote/desktopCreate'

export interface StartImage {
  bytes: Uint8Array
  /** A data URL for the preview tile. */
  preview: string
  width: number
  height: number
  /** The same picture as the mask editor takes it (kept, so a mask stays with its photo). */
  ref?: ImageRef
}

/** Lyrics the computer takes at most (CREATE-V2.md). */
export const MAX_LYRICS = 3000

interface FormStore {
  /** Picked model per kind. */
  models: Partial<Record<ComputerKind, string>>
  /** Numbers the user set (width, height, steps, seed, count, duration, factor). Unset: the computer's default. */
  values: Record<string, number | undefined>
  negative: string
  /** Photos from the phone, in order: the start image, or the references of an edit (1, 2, ...). */
  inputs: StartImage[]
  /** The painted area of reference 1 (Edit), a PNG of its size. */
  mask: StartImage | null
  /** A character of the computer (its id), for the tool Character. */
  character: string | null
  lyrics: string
  /** The first photo, the start image of image and video (3.0.7). */
  image: StartImage | null
  setModel: (kind: ComputerKind, id: string) => void
  setValue: (key: string, v: number | undefined) => void
  setNegative: (text: string) => void
  /** One start image or none (3.0.7). */
  setImage: (img: StartImage | null) => void
  addInputs: (imgs: StartImage[], max: number) => void
  removeInput: (index: number) => void
  setMask: (mask: StartImage | null) => void
  setCharacter: (id: string | null) => void
  setLyrics: (text: string) => void
}

const MODELS_KEY = 'lu-computer-create-models'

function readModels(): Partial<Record<ComputerKind, string>> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(MODELS_KEY) ?? '{}')
    return v && typeof v === 'object' ? (v as Partial<Record<ComputerKind, string>>) : {}
  } catch {
    return {}
  }
}

export const useComputerForm = create<FormStore>()((set, get) => ({
  models: readModels(),
  values: {},
  negative: '',
  inputs: [],
  mask: null,
  character: null,
  lyrics: '',
  image: null,
  setModel: (kind, id) => {
    const models = { ...get().models, [kind]: id }
    try {
      localStorage.setItem(MODELS_KEY, JSON.stringify(models))
    } catch {
      /* the choice holds for this run */
    }
    set({ models })
  },
  setValue: (key, v) => set((s) => ({ values: { ...s.values, [key]: v } })),
  setNegative: (negative) => set({ negative: negative.slice(0, 2000) }),
  setImage: (image) => set({ image, inputs: image ? [image] : [], mask: null }),
  addInputs: (imgs, max) => {
    const inputs = [...get().inputs, ...imgs].slice(0, Math.max(1, max))
    // A new first photo makes the painted area of the old one meaningless.
    const keepMask = inputs[0] === get().inputs[0]
    set({ inputs, image: inputs[0] ?? null, ...(keepMask ? {} : { mask: null }) })
  },
  removeInput: (index) => {
    const inputs = get().inputs.filter((_, i) => i !== index)
    set({ inputs, image: inputs[0] ?? null, ...(index === 0 ? { mask: null } : {}) })
  },
  setMask: (mask) => set({ mask }),
  setCharacter: (character) => set({ character }),
  setLyrics: (lyrics) => set({ lyrics: lyrics.slice(0, MAX_LYRICS) }),
}))

/** Keys the sheet never draws as a field: they have their own place (prompt, photos, model, mask, character, lyrics). */
const OWN_PLACE = new Set(['prompt', 'input_id', 'input_ids', 'mask_id', 'model', 'character', 'lyrics'])

/** The fields the settings sheet draws. */
export function settingFields(info: ComputerKindInfo | null): ComputerField[] {
  return (info?.fields ?? []).filter((f) => !OWN_PLACE.has(f.key))
}

/** Pure: the model in force for a kind: the picked one if the computer still has it, else its first. */
export function modelFor(info: ComputerKindInfo | null, picked: string | undefined): ComputerModel | null {
  if (!info || info.models.length === 0) return null
  return info.models.find((m) => m.id === picked) ?? info.models[0]
}

/** Pure: a number held to the field's limits and step, or undefined when it cannot be one. */
export function fitNumber(f: ComputerField, v: number | undefined): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined
  let n = Math.round(v)
  if (f.enumNumbers && f.enumNumbers.length > 0) return f.enumNumbers.includes(n) ? n : undefined
  if (f.multipleOf && f.multipleOf > 1) n = Math.round(n / f.multipleOf) * f.multipleOf
  if (f.minimum !== undefined) n = Math.max(f.minimum, n)
  if (f.maximum !== undefined) n = Math.min(f.maximum, n)
  return n
}

/**
 * Pure: the value a field shows: the user's, else for width and height the
 * size the model starts at on the computer (a change of model changes it,
 * as long as the user did not set a size), else the computer's default.
 * Only what the user set goes out with a job (jobBodyOf): without it the
 * computer takes the size of the model's family.
 */
export function shownValue(f: ComputerField, values: Record<string, number | undefined>, model?: ComputerModel | null): number | undefined {
  const own = fitNumber(f, values[f.key])
  if (own !== undefined) return own
  const size = model?.size
  if (size && (f.key === 'width' || f.key === 'height')) {
    const v = fitNumber(f, size[f.key])
    if (v !== undefined) return v
  }
  return typeof f.default === 'number' ? f.default : undefined
}

/**
 * Pure: the sentence of the computer about the size of this model ("SD 1.5
 * models are made for 512 x 512. ..."), once the size in force is above
 * its `recommended_max`. null otherwise.
 */
export function sizeNote(info: ComputerKindInfo | null, form: { models: Partial<Record<ComputerKind, string>>; values: Record<string, number | undefined> }, kind: ComputerKind): string | null {
  const model = modelFor(info, form.models[kind])
  const size = model?.size
  if (!size?.note || size.recommendedMax === undefined) return null
  const fields = new Map((info?.fields ?? []).map((f) => [f.key, f]))
  const w = fields.get('width')
  const h = fields.get('height')
  const wv = w ? shownValue(w, form.values, model) : undefined
  const hv = h ? shownValue(h, form.values, model) : undefined
  return (wv ?? 0) > size.recommendedMax || (hv ?? 0) > size.recommendedMax ? size.note : null
}

/** The numbers a job may carry, when the computer names them. */
const NUMBER_KEYS = ['width', 'height', 'steps', 'seed', 'count', 'duration', 'factor']

export type JobBodyDraft = Omit<ComputerJobBody, 'client_request_id' | 'input_id' | 'input_ids' | 'mask_id'>

/**
 * Pure: the body of a job (without client_request_id and the ids of the
 * uploads, which the run adds). Only fields the computer named are sent,
 * each inside its limits.
 */
export function jobBodyOf(
  kind: ComputerKind,
  info: ComputerKindInfo | null,
  form: {
    models: Partial<Record<ComputerKind, string>>
    values: Record<string, number | undefined>
    negative: string
    character?: string | null
    lyrics?: string
  },
  prompt: string,
): JobBodyDraft {
  const body: JobBodyDraft = { kind, prompt: prompt.trim().slice(0, 4000) }
  const named = new Set((info?.fields ?? []).map((f) => f.key))
  const model = modelFor(info, form.models[kind])
  if (model) body.model = model.id
  if (named.has('negative') && form.negative.trim()) body.negative = form.negative.trim().slice(0, 2000)
  if (named.has('character') && form.character) {
    const field = info?.fields.find((f) => f.key === 'character')
    if (!field?.enum || field.enum.includes(form.character)) body.character = form.character
  }
  if (kind === 'music' && form.lyrics?.trim()) body.lyrics = form.lyrics.trim().slice(0, MAX_LYRICS)
  for (const f of info?.fields ?? []) {
    if (f.type !== 'integer' || !NUMBER_KEYS.includes(f.key)) continue
    const v = fitNumber(f, form.values[f.key])
    if (v !== undefined) (body as unknown as Record<string, number>)[f.key] = v
  }
  return body
}

/** Pure: the short line under the prompt: model, size, count, length. No price, no time. */
export function summaryOf(info: ComputerKindInfo | null, form: { models: Partial<Record<ComputerKind, string>>; values: Record<string, number | undefined> }, kind: ComputerKind): string[] {
  const parts: string[] = []
  const model = modelFor(info, form.models[kind])
  if (model) parts.push(model.name)
  const fields = new Map((info?.fields ?? []).map((f) => [f.key, f]))
  const w = fields.get('width')
  const h = fields.get('height')
  const wv = w ? shownValue(w, form.values, model) : undefined
  const hv = h ? shownValue(h, form.values, model) : undefined
  if (wv && hv) parts.push(`${wv}x${hv}`)
  const c = fields.get('count')
  const cv = c ? shownValue(c, form.values) : undefined
  if (cv && cv > 1) parts.push(`${cv} images`)
  const d = fields.get('duration')
  const dv = d ? shownValue(d, form.values) : undefined
  if (dv) parts.push(`${dv} s`)
  const x = fields.get('factor')
  const xv = x ? shownValue(x, form.values) : undefined
  if (xv) parts.push(`${xv}x`)
  return parts
}

/** Test seam. */
export function __resetComputerFormForTests(): void {
  useComputerForm.setState({ models: {}, values: {}, negative: '', image: null, inputs: [], mask: null, character: null, lyrics: '' })
}
