/**
 * The buttons under the LU Engine's fit sentence (3.0.8, A25).
 *
 * Discord, 22.10.2026 (RTX 5070 Ti 16 GB): gemma-4-31B at a
 * 64K context put 22 of its 60 layers on the card, and nothing on screen said
 * that the context was what cost them, or what a smaller one would buy. The
 * engine now works the numbers out from the model's own head (Rust,
 * vram_plan.rs) and says them in one sentence: "With 64K context, 24 of 60
 * layers fit on the graphics card; the rest run on the processor, which is
 * slower. With 16K, 30 fit. With KV q8_0, 30 fit." Under it, one button per
 * change it names.
 *
 * The plan never makes these changes by itself. A context the person chose
 * and the precision of the KV cache are the person's settings; a button is
 * the person making the change, with the numbers in front of them.
 */

import type { BuiltinEngineTuning } from '../types/settings'

/** One button, as Rust writes it (`FitAction`). */
export interface FitAction {
  /** What the button says: "Context 16K", "KV q8_0". */
  label: string
  /** The context it sets. */
  ctx?: number
  /** The KV cache type it sets for K and V. */
  kv?: 'q8_0' | 'q4_0'
}

/** Only what Rust may send: a context in tokens or a KV type LU offers. */
export function isFitAction(v: unknown): v is FitAction {
  if (!v || typeof v !== 'object') return false
  const a = v as Record<string, unknown>
  if (typeof a.label !== 'string' || !a.label) return false
  const ctxOk = a.ctx === undefined || (typeof a.ctx === 'number' && Number.isInteger(a.ctx) && a.ctx >= 1024 && a.ctx <= 1_048_576)
  const kvOk = a.kv === undefined || a.kv === 'q8_0' || a.kv === 'q4_0'
  return ctxOk && kvOk && (a.ctx !== undefined || a.kv !== undefined)
}

/** The buttons of a status answer, without anything that is not one. */
export function fitActionsOf(raw: unknown): FitAction[] {
  return Array.isArray(raw) ? raw.filter(isFitAction) : []
}

/**
 * The settings after a button. A context is marked as chosen (GH #129), so
 * neither the agent mode nor the plan moves it afterwards. A quantized V
 * cache needs Flash Attention, so a button that quantizes it never leaves
 * Flash Attention off: the engine would refuse to start.
 */
export function tuningAfter(tuning: BuiltinEngineTuning, action: FitAction): BuiltinEngineTuning {
  let next = { ...tuning }
  if (action.ctx !== undefined) next = { ...next, ctx: action.ctx, ctxChosen: true }
  if (action.kv !== undefined) {
    next = { ...next, cacheTypeK: action.kv, cacheTypeV: action.kv }
    if (next.flashAttn === 'off') next = { ...next, flashAttn: 'auto' }
  }
  return next
}
