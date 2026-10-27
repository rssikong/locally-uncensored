/**
 * Pure rules of the model sheet C3: which rows are local, which belong to a
 * provider with the user's own key, which cloud row is the cheapest, how a
 * price reads.
 */
import type { AIModel } from '../../../../../types/models'
import { isLuEngineName } from '../../../../../lib/engine-name'
import type { PickerRow } from '../../../../../lib/model-picker'

interface RowLike {
  name: string
  type: string
  provider?: string
  providerName?: string
}

export interface SplitModels<T> {
  /** Models that run on this phone. */
  device: T[]
  /** Models of a provider the user added with an own key. */
  providers: T[]
  /** Models of LU Cloud. */
  cloud: T[]
}

export function splitModels<T extends RowLike>(models: readonly T[]): SplitModels<T> {
  const out: SplitModels<T> = { device: [], providers: [], cloud: [] }
  for (const m of models) {
    if (m.type !== 'text') continue
    if (m.provider === 'lu-cloud') out.cloud.push(m)
    else if (m.provider === 'openai' && isLuEngineName(m.providerName)) out.device.push(m)
    else out.providers.push(m)
  }
  return out
}

/** Words per token, the usual rule of thumb: 750 words are 1,000 tokens. */
const WORDS_PER_TOKEN = 0.75

/** Credits for 1,000 words from a rate per million tokens. */
export function creditsPer1000Words(perMillionTokens: number): number {
  if (!(perMillionTokens > 0)) return 0
  return (perMillionTokens * (1000 / WORDS_PER_TOKEN)) / 1_000_000
}

/** A price a person can read: whole from 10, one decimal from 1, two below. */
export function priceText(credits: number): string {
  if (!(credits > 0)) return '0'
  if (credits >= 10) return Math.round(credits).toLocaleString('en-US')
  if (credits >= 1) return credits.toFixed(1)
  return credits < 0.01 ? '0.01' : credits.toFixed(2)
}

/** The cloud row that costs the least for a short exchange: free today first, then the lowest sum of both rates. */
export function cheapestRow(rows: readonly PickerRow[]): string | null {
  let best: { name: string; cost: number } | null = null
  for (const row of rows) {
    const cost = row.free ? 0 : row.rates ? row.rates.inputPerMillion + row.rates.outputPerMillion : Number.POSITIVE_INFINITY
    if (!best || cost < best.cost) best = { name: row.name, cost }
  }
  return best && Number.isFinite(best.cost) ? best.name : (rows[0]?.name ?? null)
}

/** Share of a download in whole percent. */
export function downloadPercent(progress: number, total: number): number {
  if (!(total > 0)) return 0
  return Math.max(0, Math.min(100, Math.round((progress / total) * 100)))
}

export type { AIModel }
