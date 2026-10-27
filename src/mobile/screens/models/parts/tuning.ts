/**
 * The engine settings of the phone (E13), read from and written to
 * settings.builtinEngine, the same record the desktop uses. The engine reads
 * it at every start (api/engine.ts `tuningFromSettings`).
 *
 * The phone engine honours the context size, the layers on the graphics
 * chip (iOS), the threads, flash attention and the cache types f16 and q8_0
 * (mobile-docs/ENGINE-NACHZUG.md section 5). It never applies `mlock`,
 * `noMmap` and the cache type q4_0, so the phone pages do not offer them; a
 * stored q4_0 is opened as q8_0 and shown as that.
 */
import { DEFAULT_SETTINGS } from '../../../../lib/constants'
import { useSettingsStore } from '../../../../stores/settingsStore'
import type { BuiltinEngineTuning } from '../../../../types/settings'

export function useTuning(): BuiltinEngineTuning {
  return useSettingsStore((s) => s.settings.builtinEngine) ?? DEFAULT_SETTINGS.builtinEngine
}

export function getTuning(): BuiltinEngineTuning {
  return useSettingsStore.getState().settings.builtinEngine ?? (DEFAULT_SETTINGS.builtinEngine as BuiltinEngineTuning)
}

export function setTuning(partial: Partial<BuiltinEngineTuning>): void {
  useSettingsStore.getState().updateSettings({ builtinEngine: { ...getTuning(), ...partial } })
}

export function resetTuning(): void {
  useSettingsStore.getState().updateSettings({ builtinEngine: { ...(DEFAULT_SETTINGS.builtinEngine as BuiltinEngineTuning) } })
}

/**
 * What the context segment marks: "auto" until the user picked a size, and
 * then exactly that size, whether the engine page offers it or not. A size
 * picked in the chat options (3K) is a choice like any other; reading it as
 * "auto" made the page mark one thing while the engine ran another. Pure.
 */
export function contextChoiceOf(tuning: Pick<BuiltinEngineTuning, 'ctx' | 'ctxChosen'>): string {
  return tuning.ctxChosen && Number.isFinite(tuning.ctx) && tuning.ctx > 0 ? String(tuning.ctx) : 'auto'
}

/**
 * The sizes the segment offers: the ones this phone carries, plus the size
 * the user already picked elsewhere when it is not among them, in order.
 * So the marked choice is always one of the options. Pure.
 */
export function contextOptions(choices: readonly number[], tuning: Pick<BuiltinEngineTuning, 'ctx' | 'ctxChosen'>): number[] {
  const picked = contextChoiceOf(tuning)
  const all = picked === 'auto' || choices.includes(Number(picked)) ? [...choices] : [...choices, Number(picked)]
  return all.sort((a, b) => a - b)
}

/** The tuning a context choice stands for. Pure. */
export function tuningOfContextChoice(choice: string): Pick<BuiltinEngineTuning, 'ctx' | 'ctxChosen'> {
  const ctx = Number(choice)
  if (choice === 'auto' || !Number.isFinite(ctx) || ctx <= 0) return { ctx: DEFAULT_SETTINGS.builtinEngine.ctx, ctxChosen: false }
  return { ctx, ctxChosen: true }
}

/** Graphics acceleration is on unless the layers were set to 0. */
export function usesGraphics(tuning: Pick<BuiltinEngineTuning, 'gpuLayers'>): boolean {
  return tuning.gpuLayers !== 0
}

export type PhoneCacheType = 'f16' | 'q8_0'

/** The cache type as the phone engine opens it: q4_0 runs as q8_0, anything unknown as the default. Pure. */
export function phoneCacheType(stored: string | undefined | null): PhoneCacheType {
  return stored === 'q8_0' || stored === 'q4_0' ? 'q8_0' : 'f16'
}

/** Threads the page offers at most: the cores of this phone, capped like the engine caps them. Pure. */
export function maxThreads(cores: number | undefined | null): number {
  const n = typeof cores === 'number' && Number.isFinite(cores) && cores > 0 ? Math.floor(cores) : 8
  return Math.max(1, Math.min(16, n))
}
