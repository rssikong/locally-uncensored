// GET /api/public/cloud-catalog: the public model lists and what each plan and
// pack buys, for the gate pop-up. No session, no header: the route answers
// every origin, so a signed out app reads it like the pricing page. The
// header says it is the app, which gets the whole catalogue under the app's
// own names; a browser gets the list of the pricing page.
import { CLOUD_BASE } from './config'
import { parseGateCatalog, type GateCatalog } from '../../lib/cloud-gate'

export async function getPublicCatalog(timeoutMs = 6_000): Promise<GateCatalog | null> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`${CLOUD_BASE}/api/public/cloud-catalog`, {
      signal: ac.signal,
      headers: { 'x-lu-client': 'desktop' },
    })
    if (!res.ok) return null
    return parseGateCatalog(await res.json())
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}
