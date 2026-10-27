// The `lora` and `loraStrength` arguments of the chat's image_generate tool,
// read for the Mac. Windows hands them to its ComfyUI graph builder; the Mac
// sends them to its second image engine (mflux `--lora`) by the names of the
// Mac's LoRA folder (api/mlx-loras). The tool's own contract holds here too:
// a name is matched with or without its extension, and an unknown one is
// refused with the list of what is there.

import { knownLora } from './lora-stack'
import { clampLoraStrength } from './lora-strength'

/** Strength when the tool gives none, as the stack's default. */
const DEFAULT_STRENGTH = 1

export interface ToolLora {
  name: string
  strength: number
}

/** The LoRA names the tool was given: one name, a list, or names joined by commas. */
export function askedLoraNames(lora: unknown): string[] {
  const raw = typeof lora === 'string' ? lora.split(',') : Array.isArray(lora) ? lora : []
  return raw.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
}

/** One strength for every LoRA, or one per LoRA in the same order, inside
 *  the range the stack takes (lib/lora-strength). */
function strengthAt(strength: unknown, index: number): number {
  const value = Array.isArray(strength) ? strength[index] : strength
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_STRENGTH
  return clampLoraStrength(value)
}

const stem = (name: string) => name.replace(/^.*[\\/]/, '').replace(/\.safetensors$/i, '').toLowerCase()

/**
 * The LoRAs a run takes, by the names the Mac's folder lists, or the sentence
 * for the model when one is not there.
 */
export function macToolLoras(lora: unknown, strength: unknown, listed: readonly string[]): { use: ToolLora[] } | { error: string } {
  const asked = askedLoraNames(lora)
  const use: ToolLora[] = []
  for (const [index, name] of asked.entries()) {
    const found = listed.find((l) => l === name) ?? listed.find((l) => stem(l) === stem(name))
    if (!found) {
      const there = listed.length ? listed.join(', ') : 'none'
      return { error: `Error: No LoRA named "${name}" is in the Mac's LoRA folder. Installed: ${there}.` }
    }
    if (!use.some((u) => u.name === found)) use.push({ name: found, strength: strengthAt(strength, index) })
  }
  return { use }
}

/** The model family the LoRAs of a run need, when one of them names one. */
export function loraFamily(loras: readonly ToolLora[]): { family: string; label: string } | null {
  for (const l of loras) {
    const known = knownLora(l.name)
    if (known) return { family: known.family, label: known.familyLabel }
  }
  return null
}
