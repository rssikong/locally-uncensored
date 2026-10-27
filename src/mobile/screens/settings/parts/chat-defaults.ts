/**
 * Ranges and wording of the chat defaults (E5). Pure.
 */
import type { Settings } from '../../../../types/settings'

/** The keys "Reset chat defaults" puts back. */
export const CHAT_DEFAULT_KEYS: ReadonlyArray<keyof Settings> = ['temperature', 'topP', 'topK', 'maxTokens', 'autoCompactThreshold']

export const RANGES = {
  temperature: { min: 0, max: 2, step: 0.1 },
  topP: { min: 0, max: 1, step: 0.05 },
  topK: { min: 1, max: 100, step: 1 },
  maxTokens: { min: 0, max: 8192, step: 256 },
  compactPercent: { min: 0, max: 95, step: 5 },
} as const

/** The stored share (0 to 1) as the percent the field shows. */
export function thresholdToPercent(threshold: number | undefined): number {
  const value = Number(threshold)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(RANGES.compactPercent.max, Math.round(value * 100))
}

/** The percent of the field as the stored share; 0 turns compacting off. */
export function percentToThreshold(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return 0
  return Math.min(RANGES.compactPercent.max, Math.round(percent)) / 100
}
