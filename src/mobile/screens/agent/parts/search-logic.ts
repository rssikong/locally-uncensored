/** Pure helpers of E9 Web search. */
import { searchFailedOffline } from '../../../../lib/search-offline'

export interface SearchAnswer {
  results?: Array<{ title?: string; url?: string; snippet?: string }>
  provider?: string
  providerError?: string
  error?: string
  /** The free searches that were asked and did not deliver, each with its reason. */
  tiers?: Array<{ tier?: string; error?: string }>
}

export type SearchOutcome =
  | { kind: 'ok'; count: number; provider: string; first: { title: string; url: string } | null; fallbackReason: string | null; skipped: string | null }
  | { kind: 'empty' }
  /** The phone has no network: nothing was searched, and no key would have changed that (F7). */
  | { kind: 'offline' }
  | { kind: 'failed'; reason: string }

/** Pure: what a search that threw is read as. An error that says "no network" is the same outcome as above. */
export function readSearchError(err: unknown, device: { offline?: boolean } = {}): SearchOutcome {
  const reason = err instanceof Error ? err.message : String(err)
  return device.offline || searchFailedOffline({ error: reason }) ? { kind: 'offline' } : { kind: 'failed', reason }
}

/** "DuckDuckGo: answered with a bot check instead of results (HTTP 202)." for every free search that did not deliver. */
export function skippedTiers(data: SearchAnswer): string | null {
  const lines = (Array.isArray(data.tiers) ? data.tiers : [])
    .filter((t) => t && typeof t.tier === 'string' && t.tier && typeof t.error === 'string' && t.error)
    .map((t) => `${t.tier}: ${String(t.error).replace(/\.+$/, '')}.`)
  return lines.length > 0 ? lines.join(' ') : null
}

/** Read what the search command answered into the three things the page can say. */
export function readSearchAnswer(data: SearchAnswer | null | undefined, device: { offline?: boolean } = {}): SearchOutcome {
  if (!data || typeof data !== 'object') return device.offline ? { kind: 'offline' } : { kind: 'failed', reason: '' }
  const results = Array.isArray(data.results) ? data.results : []
  if (results.length > 0) {
    const top = results[0]
    return {
      kind: 'ok',
      count: results.length,
      provider: typeof data.provider === 'string' ? data.provider : 'auto',
      first: top && typeof top.title === 'string' && typeof top.url === 'string' ? { title: top.title, url: top.url } : null,
      fallbackReason: typeof data.providerError === 'string' && data.providerError ? data.providerError : null,
      skipped: skippedTiers(data),
    }
  }
  // No network: the reasons of the command are the text of the system ("failed to lookup address information"),
  // and its advice to add a key does not fit. One sentence of the app instead.
  if (searchFailedOffline(data)) return { kind: 'offline' }
  if (typeof data.error === 'string' && data.error) {
    const extra = typeof data.providerError === 'string' && data.providerError ? ` ${data.providerError}` : ''
    return { kind: 'failed', reason: `${data.error}${extra}` }
  }
  return { kind: 'empty' }
}

/**
 * The search command ends "nothing answered" with advice for a build that
 * takes keys: "The free search is not dependable. Add a Brave or Tavily key
 * under Settings, Web search for dependable search." A build without search
 * keys of one's own (store switch webSearchKeys) has no place to add one, so
 * there the page leaves the two sentences out and keeps the reasons.
 */
const KEY_ADVICE = /\s*The free search is not dependable\.\s*Add a Brave or Tavily key\b[^.]*\./gi

/** Pure: the reason of a failed search without the advice to add a key. */
export function withoutKeyAdvice(reason: string): string {
  return reason.replace(KEY_ADVICE, '').trim()
}
