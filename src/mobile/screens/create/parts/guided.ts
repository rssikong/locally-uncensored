/**
 * The guided presets of Create, for a phone. Pure.
 *
 * A preset of the 3.0.5 is a guided run of one to three steps ("Create the
 * image", "Bring it to life", "Add a soundtrack"). Each step is a job with
 * its own model, its own inputs and its own price, and the result of a step
 * is the input of the next. The desktop draws this as a workshop next to a
 * rail (components/create/experimental/PresetWorkshop.tsx).
 *
 * The phone uses the SAME data and rules: the presets themselves
 * (lib/render/create-presets.ts), which models a step may run on
 * (lib/render/preset-models.ts), the provider schemas
 * (lib/render/studio-contract.ts). This file turns them into what a page of
 * a phone asks: what does this step need, what is sent, what is missing.
 * The state of a run lives in guided-run.ts, the pages are PresetsPage.tsx
 * and PresetRunPage.tsx.
 */
import type { CloudJobParams } from '../../../../api/cloud/jobs'
import { CREATE_PRESETS, presetBaseCredits, type CreatePreset, type PresetStep } from '../../../../lib/render/create-presets'
import type { RenderKind, RenderOp } from '../../../../lib/render/cloud-jobs'
import {
  classicCredits, modelHint, modelLabel, presetModel, presetModels, requiredRoleInputs, roleInputs, rolePrompts,
  type PresetModel, type StepRole,
} from '../../../../lib/render/preset-models'
import { promptIdeas, type PromptIdea } from '../../../../lib/render/prompt-ideas'
import { STUDIO_MODELS, studioPreviewCredits, studioSchema, supportsProviderField } from '../../../../lib/render/studio-contract'
import { selectedVideoSeconds, videoDurations } from '../../../../lib/render/video-duration'
import { drawnFields } from './SchemaFields'

export type { CreatePreset, PresetStep, PresetModel, StepRole, PromptIdea }

// ---------- which presets ----------

/**
 * The presets this build shows. A preset marked `adult` runs on models that
 * do not refuse; a build whose store rules cap the content policy does not
 * offer those (the same rule that takes "Off" out of the content policy).
 */
export function guidedPresets(rules: { adult: boolean }): CreatePreset[] {
  return CREATE_PRESETS.filter((p) => rules.adult || !p.adult)
}

export function guidedPresetById(id: string | undefined, rules: { adult: boolean }): CreatePreset | undefined {
  return id ? guidedPresets(rules).find((p) => p.id === id) : undefined
}

/** The picture of a preset card. The files are the ones the desktop rail shows (public/create-presets). */
export function presetPicture(id: string): string {
  return `/create-presets/${id}.webp?v=2`
}

/** "From" price of a preset: all steps with their standard values. Null when a step has no price yet. */
export function presetFromCredits(preset: CreatePreset): number | null {
  try {
    return presetBaseCredits(preset)
  } catch {
    return null
  }
}

// ---------- one step ----------

export type InputKind = 'image' | 'video' | 'audio'

export interface StepInput {
  /** Name of the field in the provider schema ("image", "left_audio"). */
  field: string
  /** Key of the job parameter the uploaded path goes into ("source_path"). */
  key: string
  kind: InputKind
  required: boolean
  /** Several files in one field (reference images). */
  many: boolean
}

export interface StepView {
  index: number
  raw: PresetStep
  role: StepRole
  /** The model the step runs on right now: the user's choice, else the preset's own. */
  model: string
  label: string
  kind: RenderKind
  op: RenderOp
  /** The model brings its own schema and a price the server confirms. */
  studio: boolean
  /** Every model the user may pick for this step, the preset's own first. */
  alternatives: PresetModel[]
  inputs: StepInput[]
  /** A prompt field is shown. */
  promptShown: boolean
  promptRequired: boolean
  /** The prompt is one of a fixed list (a visual style), not free text. */
  promptChoices: string[] | null
  /** The source clip of a classic extend model comes from the gallery by its address. */
  needsGalleryClip: boolean
  hint: string | undefined
  ideas: PromptIdea[]
  last: boolean
}

export function inputKindOf(key: string): InputKind {
  if (key.includes('audio')) return 'audio'
  if (key === 'video_path') return 'video'
  return 'image'
}

/** The role the upload goes under at /api/jobs/upload. */
export function uploadRoleOf(key: string): 'source' | 'mask' | 'audio' | 'video' {
  if (key === 'mask_path') return 'mask'
  const kind = inputKindOf(key)
  return kind === 'audio' ? 'audio' : kind === 'video' ? 'video' : 'source'
}

function inputsOf(role: StepRole, model: string): Record<string, string> {
  const studio = !!STUDIO_MODELS[model]
  const base = roleInputs(role, model)
  // A classic image to video model that takes a sound track gets the slot too, as on the desktop.
  if (!studio && role === 'animate' && supportsProviderField(model, 'audio', 'animate')) return { ...base, audio: 'audio_path' }
  return base
}

/** Everything a page needs to know about step `index` of `preset`, run on `picked` (or the preset's own model). */
export function stepView(preset: CreatePreset, index: number, picked?: string): StepView {
  const raw = preset.steps[Math.min(Math.max(index, 0), preset.steps.length - 1)]
  const role = raw.role
  // An adult preset keeps its step on the open endpoints. A filtered one would refuse the run and still cost the credits.
  const alternatives = presetModels(role, preset.adult).filter((m) => !raw.models || raw.models.includes(m.id))
  const choice = presetModel(role, picked ?? raw.model) ?? presetModel(role, raw.model) ?? { id: raw.model, label: modelLabel(raw.model), kind: raw.kind, op: raw.op, adult: preset.adult }
  const model = choice.id
  const studio = !!STUDIO_MODELS[model]
  const required = requiredRoleInputs(role, model)
  const inputs: StepInput[] = Object.entries(inputsOf(role, model))
    // The painted area of a talking model is an expert input the phone does not offer here.
    .filter(([, key]) => key !== 'mask_path')
    .map(([field, key]) => ({ field, key, kind: inputKindOf(key), required: required.includes(key), many: key === 'image_paths' }))
    .sort((a, b) => Number(b.required) - Number(a.required))
  let promptShown: boolean
  let promptRequired: boolean
  let promptChoices: string[] | null = null
  if (studio) {
    const schema = studioSchema(model)
    const field = STUDIO_MODELS[model].promptField ?? 'prompt'
    const prop = schema.properties?.[field]
    promptShown = !!prop
    promptRequired = !!prop && (schema.required ?? []).includes(field)
    if (prop?.enum) promptChoices = prop.enum.map(String)
  } else {
    promptRequired = rolePrompts(role)
    promptShown = promptRequired
  }
  return {
    index, raw, role, model, label: choice.label, kind: choice.kind, op: choice.op, studio, alternatives, inputs,
    promptShown, promptRequired, promptChoices,
    needsGalleryClip: !studio && role === 'extend',
    hint: modelHint(model),
    ideas: promptIdeas(role, preset.category),
    last: index >= preset.steps.length - 1,
  }
}

/** A step has a choice of models only when its role has more than one that runs. */
export function stepHasChoice(view: StepView): boolean {
  return view.alternatives.length > 1 && view.alternatives.some((m) => m.id !== view.model)
}

// ---------- the settings of a step ----------

/** The fields that stand on the page itself. Everything else is under "More settings". */
const PRIMARY = ['duration', 'resolution', 'target_resolution', 'target_megapixels', 'upscale_factor', 'music_length_ms', 'voice', 'voice_id', 'avatar', 'language', 'emotion', 'preset', 'horizontal_angle', 'vertical_angle', 'distance', 'order', 'loras']

export function stepFields(view: StepView): { primary: string[]; other: string[] } {
  if (!view.studio) return { primary: [], other: [] }
  const keys = drawnFields(view.model).map(([key]) => key)
  return { primary: keys.filter((k) => PRIMARY.includes(k)), other: keys.filter((k) => !PRIMARY.includes(k)) }
}

export const CLASSIC_VOICES = ['Serena', 'Vivian', 'Ryan', 'Aiden', 'Dylan', 'Eric', 'Sohee', 'Ono_Anna', 'Uncle_Fu'] as const

export interface ClassicControls {
  /** Clip lengths in seconds an image to video model renders. */
  durations: number[]
  shotType: boolean
  negative: boolean
  voice: boolean
  voiceDescription: boolean
}

/** The few controls of a model without a provider schema, by the rules of the desktop workshop. */
export function classicControls(view: StepView): ClassicControls {
  const none: ClassicControls = { durations: [], shotType: false, negative: false, voice: false, voiceDescription: false }
  if (view.studio) return none
  const { role, model, op } = view
  return {
    durations: role === 'animate' ? [...videoDurations(model)] : [],
    shotType: role === 'animate' && supportsProviderField(model, 'shot_type', 'animate'),
    negative: (role === 'image' || role === 'animate') && supportsProviderField(model, 'negative_prompt', op),
    voice: role === 'speech' && model === 'qwen3-tts',
    voiceDescription: role === 'speech' && model === 'qwen3-tts-design',
  }
}

// ---------- what is sent ----------

export type StepPaths = Record<string, string | string[]>

export interface StepDraft {
  prompt: string
  options: Record<string, unknown>
  paths: StepPaths
}

/** The parameters of the job of this step. The price is asked with the very same ones. */
export function stepParams(view: StepView, draft: Pick<StepDraft, 'options' | 'paths'>): CloudJobParams {
  const { options, paths } = draft
  if (view.studio) return { op: 'studio', ...paths, studio_options: options } as CloudJobParams
  const p = { op: view.op, ...paths } as CloudJobParams & Record<string, unknown>
  if (view.role === 'animate') {
    // The server prices a clip from frames and fps and ignores `duration`.
    const seconds = selectedVideoSeconds(view.model, Number(options.duration ?? 5) * 16, 16)
    p.frames = seconds * 16
    p.fps = 16
    if (supportsProviderField(view.model, 'shot_type', 'animate') && (options.shot_type === 'single' || options.shot_type === 'multi')) p.shot_type = options.shot_type
  }
  if (view.role === 'image') {
    p.width = 1024
    p.height = 1024
  }
  if ((view.role === 'image' || view.role === 'animate') && supportsProviderField(view.model, 'negative_prompt', view.op) && options.negative_prompt) p.negative_prompt = String(options.negative_prompt)
  if (view.role === 'speech') {
    if (view.model === 'qwen3-tts-design') p.voice_description = String(options.voice_description ?? '')
    else if (view.model !== 'qwen3-tts-clone') p.voice = String(options.voice ?? 'Serena')
  }
  if (view.role === 'extend') p.source_url = String(paths.source_url ?? '')
  return p
}

export type Missing =
  /** A required file is not there yet. `field` names it. */
  | { what: 'input'; field: string; kind: InputKind }
  | { what: 'clip' }
  | { what: 'prompt' }

/** What the step still needs before a price can be asked, first things first. Null when it is complete. */
export function stepMissing(view: StepView, draft: StepDraft): Missing | null {
  for (const input of view.inputs) {
    if (!input.required) continue
    const value = draft.paths[input.key]
    if (!value || (Array.isArray(value) && value.length === 0)) return { what: 'input', field: input.field, kind: input.kind }
  }
  if (view.needsGalleryClip && !draft.paths.source_url) return { what: 'clip' }
  if (view.promptRequired && !draft.prompt.trim()) return { what: 'prompt' }
  return null
}

/** Everything the price depends on, as one key. The quote belongs to exactly this key. */
export function priceKeyOf(view: StepView, draft: StepDraft): string {
  return JSON.stringify([view.model, draft.prompt, draft.options, draft.paths, view.index])
}

/** The estimate shown while the server has not confirmed a price yet. Null when it cannot be told. */
export function stepEstimate(view: StepView, draft: StepDraft, measuredSeconds?: number): number | null {
  if (view.studio) {
    const images = Array.isArray(draft.paths.image_paths) ? draft.paths.image_paths.length : 1
    return studioPreviewCredits(view.model, draft.options, measuredSeconds, images, Array.from(draft.prompt).length)
  }
  return classicCredits(view.kind, view.model, view.op, stepParams(view, draft) as { frames?: number; fps?: number; duration?: number; target_resolution?: string })
}

/** The uploads that survive a change of the model: only what the next model reads. */
export function keptPaths(preset: CreatePreset, index: number, nextModel: string, paths: StepPaths): StepPaths {
  const next = stepView(preset, index, nextModel)
  const keep = new Set<string>([...next.inputs.map((i) => i.key), 'source_url'])
  return Object.fromEntries(Object.entries(paths).filter(([key]) => keep.has(key)))
}

/** Which input of this step a result of `kind` fills: the result of step 1 is the input of step 2. */
export function slotFor(view: StepView, kind: string): StepInput | undefined {
  return view.inputs.find((i) => i.kind === kind && (i.key === 'source_path' || i.key === 'image_paths' || i.key === 'audio_path' || i.key === 'video_path'))
}

// ---------- words ----------

/** The last step carries the name of the preset alone: it IS the result. The steps before say which one they were. */
export function runLabel(preset: CreatePreset, index: number): string {
  const step = preset.steps[index]
  return index === preset.steps.length - 1 || !step ? preset.title : `${preset.title} · ${step.title}`
}

export type PromptWord = 'speech' | 'sound' | 'movement' | 'setting' | 'scene'

export function promptWord(role: StepRole): PromptWord {
  if (role === 'speech') return 'speech'
  if (role === 'soundtrack') return 'sound'
  if (role === 'animate' || role === 'extend') return 'movement'
  if (role === 'edit') return 'setting'
  return 'scene'
}

/** A prompt idea joins what is there, it never replaces it. */
export function withIdea(prompt: string, idea: string): string {
  const current = prompt.trim()
  return current ? `${current}, ${idea}` : idea
}
