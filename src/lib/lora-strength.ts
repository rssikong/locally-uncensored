// The strength of one LoRA in the stack: the range, the typed number and the
// starting value. Pure, no imports, so the store, the control and the tests
// read the same rules.

/** What the stack lets through. ComfyUI's LoraLoader and LoraLoaderModelOnly
 *  take strength_model and strength_clip from -100 to 100 in steps of 0.01
 *  (nodes.py), and say themselves that the value can be negative. Slider LoRAs
 *  are made for a wide range around zero (Discord 2026-10-02:
 *  Krea 2 LoRAs meant for -10 to 10; Discord 2026-10-23: some are
 *  used from -10 to 15), so the number field takes -20 to 20.
 *  The slider keeps the usual 0 to 2. */
export const LORA_STRENGTH_MIN = -20
export const LORA_STRENGTH_MAX = 20
export const LORA_STRENGTH_STEP = 0.05
export const LORA_SLIDER_MIN = 0
export const LORA_SLIDER_MAX = 2

/** Into the allowed range, on ComfyUI's own grid of 0.01. */
export function clampLoraStrength(value: number): number {
  const v = Math.max(LORA_STRENGTH_MIN, Math.min(LORA_STRENGTH_MAX, value))
  // "+ 0" turns a negative zero into a plain one.
  return Math.round(v * 100) / 100 + 0
}

/**
 * What a typed strength means, or null when it is not a number yet ("", "-",
 * "abc", "1.2.3"). A decimal comma counts as a point. A number outside
 * the range is pulled to its nearest end, never thrown away.
 */
export function parseLoraStrength(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? clampLoraStrength(n) : null
}

/** One step up or down from a value, for the arrow keys of the number field. */
export function stepLoraStrength(value: number, direction: 1 | -1): number {
  return clampLoraStrength(value + direction * LORA_STRENGTH_STEP)
}

/**
 * The strength a LoRA starts with when it is ticked for the first time. A
 * step distillation only does its job at full strength: the official MiniMax
 * H3 templates (video_minimax_h3_t2v and _i2v) load the turbo LoRA at 1. The
 * name test is the one the H3 builder reads the step count with
 * (minimax_h3_fl2v_turbo_8step_...). Everything else starts at the usual 0.8.
 */
export function defaultLoraStrength(name: string): number {
  return /turbo\D*?\d+\s*_?steps?/i.test(name) ? 1 : 0.8
}
