/**
 * Prompt styles of Create on a phone. Pure, plus one small store at the end
 * of the file that keeps the user's own styles.
 *
 * A prompt style is a prompt building block and a few values for one tool:
 * tap it, the words join the prompt and the values are set. Until round 3
 * these were called "presets". That name belongs to the guided presets of
 * the desktop (several steps, lib/render/create-presets.ts), which the phone
 * has too now (parts/guided.ts). So this one got a name that says what it is.
 *
 * The store keeps its old key and field name ('lu-mobile-create-presets',
 * `presets`), so styles saved before the rename and backups stay readable.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeJSONStorage } from '../../../../lib/storage-quota'
import type { AspectKey, QualityKey } from './params'

export type StyleTool = 'image' | 'video'

export interface PromptStyle {
  id: string
  name: string
  tool: StyleTool
  /** Added to what the user typed, or used alone when the field is empty. */
  text: string
  aspect?: AspectKey
  quality?: QualityKey
  /** Clip length in seconds, used when the model renders it. */
  seconds?: number
  /** Built in styles cannot be changed or deleted. */
  builtIn?: boolean
}

export const BUILT_IN_STYLES: readonly PromptStyle[] = [
  { id: 'b-cinematic', name: 'Cinematic', tool: 'image', text: 'cinematic lighting, shallow depth of field, film grain', aspect: '16:9', quality: 'High', builtIn: true },
  { id: 'b-portrait', name: 'Portrait', tool: 'image', text: 'studio portrait, soft key light, 85mm lens, detailed skin', aspect: '3:4', quality: 'Standard', builtIn: true },
  { id: 'b-product', name: 'Product', tool: 'image', text: 'product photo on a clean backdrop, soft shadows, sharp focus', aspect: '1:1', quality: 'High', builtIn: true },
  { id: 'b-anime', name: 'Anime', tool: 'image', text: 'anime illustration, clean line art, vivid colors', aspect: '3:4', quality: 'Standard', builtIn: true },
  { id: 'b-sketch', name: 'Quick sketch', tool: 'image', text: 'loose pencil sketch, paper texture', aspect: '1:1', quality: 'Draft', builtIn: true },
  { id: 'b-slowmo', name: 'Slow motion', tool: 'video', text: 'slow motion, smooth camera, cinematic', builtIn: true },
  { id: 'b-drone', name: 'Drone shot', tool: 'video', text: 'aerial drone shot, slow forward flight, wide view', builtIn: true },
  { id: 'b-timelapse', name: 'Timelapse', tool: 'video', text: 'timelapse, moving clouds, changing light', builtIn: true },
]

export const MAX_STYLE_NAME = 30
export const MAX_STYLE_TEXT = 400
export const MAX_USER_STYLES = 40

/** The prompt after a style was applied: its text joins what is there, once. */
export function applyStyleText(prompt: string, styleText: string): string {
  const current = prompt.trim()
  const add = styleText.trim()
  if (!add) return current
  if (!current) return add
  if (current.toLowerCase().includes(add.toLowerCase())) return current
  return `${current}, ${add}`
}

export type StyleProblem = 'no-name' | 'no-content' | 'name-taken' | 'full'

export function checkStyle(
  draft: { id?: string; name: string; text: string; aspect?: AspectKey; quality?: QualityKey; seconds?: number },
  existing: readonly PromptStyle[],
): StyleProblem | null {
  const name = draft.name.trim()
  if (!name) return 'no-name'
  if (!draft.text.trim() && !draft.aspect && !draft.quality && !draft.seconds) return 'no-content'
  if (existing.some((p) => p.id !== draft.id && p.name.trim().toLowerCase() === name.toLowerCase())) return 'name-taken'
  if (!draft.id && existing.filter((p) => !p.builtIn).length >= MAX_USER_STYLES) return 'full'
  return null
}

export function cleanStyle(draft: Omit<PromptStyle, 'id' | 'builtIn'> & { id?: string }, newId: () => string): PromptStyle {
  return {
    id: draft.id ?? newId(),
    name: draft.name.trim().replace(/\s+/g, ' ').slice(0, MAX_STYLE_NAME),
    tool: draft.tool,
    text: draft.text.trim().slice(0, MAX_STYLE_TEXT),
    ...(draft.aspect ? { aspect: draft.aspect } : {}),
    ...(draft.quality ? { quality: draft.quality } : {}),
    ...(draft.seconds ? { seconds: draft.seconds } : {}),
  }
}

/** Built in first, then the user's own, newest first. */
export function stylesFor(tool: StyleTool, own: readonly PromptStyle[]): PromptStyle[] {
  return [...own.filter((p) => p.tool === tool), ...BUILT_IN_STYLES.filter((p) => p.tool === tool)]
}

interface StyleStore {
  presets: PromptStyle[]
  save: (preset: PromptStyle) => void
  remove: (id: string) => void
}

/** The user's own styles, kept on this phone. The key is the one from before the rename. */
export const useStyleStore = create<StyleStore>()(
  persist(
    (set) => ({
      presets: [],
      save: (preset) =>
        set((s) => ({
          presets: s.presets.some((p) => p.id === preset.id)
            ? s.presets.map((p) => (p.id === preset.id ? preset : p))
            : [preset, ...s.presets].slice(0, MAX_USER_STYLES),
        })),
      remove: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
    }),
    { name: 'lu-mobile-create-presets', storage: safeJSONStorage() },
  ),
)
