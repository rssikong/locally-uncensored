import { create } from 'zustand'

export interface FlashPolicy {
  dailyTokens: number
  defaultMaxOutput: number
  requestSeconds: number
  billingKey: string
}

export function parseFlashPolicy(value: unknown, usageClass: unknown, billingKey: string): FlashPolicy | undefined {
  if (usageClass !== 'flash' || !value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const positive = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= 10_000_000
  if (v.sessions_only !== true || v.concurrent_requests !== 1 || !positive(v.daily_tokens)
    || !positive(v.default_max_output) || !positive(v.request_seconds)) return undefined
  return { dailyTokens: v.daily_tokens, defaultMaxOutput: v.default_max_output, requestSeconds: v.request_seconds, billingKey }
}

interface BillingNotice {
  billing: 'flash' | 'credits'
  remaining: number
  ok: boolean
}
export const useFlashBillingStore = create<{ entries: Record<string, BillingNotice> }>(() => ({ entries: {} }))
let billingGeneration = 0
export const captureFlashGeneration = (): number => billingGeneration
export function clearFlashNotices(): void {
  billingGeneration += 1
  useFlashBillingStore.setState({ entries: {} })
}

/** How LU Cloud billed one response, from its own header, or nothing. */
export function chatBilling(response: Response): 'flash' | 'credits' | undefined {
  const billing = response.headers.get('x-lu-chat-billing')
  return billing === 'flash' || billing === 'credits' ? billing : undefined
}

export function recordFlashResponse(billingKey: string, response: Response, generation = billingGeneration): void {
  if (generation !== billingGeneration) return
  const billing = response.headers.get('x-lu-chat-billing')
  const raw = response.headers.get('x-lu-flash-remaining')
  const remaining = raw === null ? NaN : Number(raw)
  if ((billing !== 'flash' && billing !== 'credits') || !Number.isSafeInteger(remaining) || remaining < 0) return
  useFlashBillingStore.setState((s) => {
    const entries = { ...s.entries }
    delete entries[billingKey]
    const keys = Object.keys(entries)
    if (keys.length >= 32) delete entries[keys[0]]
    entries[billingKey] = { billing, remaining, ok: response.ok }
    return { entries }
  })
}
