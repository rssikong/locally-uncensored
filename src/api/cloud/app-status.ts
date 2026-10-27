// GET /api/app/status: whether LU Cloud has an outage right now
// (lib/cloud-outage.ts). No session, no header beyond the app's own: the route
// answers every origin. Anything but a well formed answer is null, and null
// changes nothing.
import { CLOUD_BASE } from './config'
import { parseAppStatus, type CloudOutage } from '../../lib/cloud-outage'

export async function getAppStatus(timeoutMs = 6_000): Promise<CloudOutage | null> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`${CLOUD_BASE}/api/app/status`, {
      signal: ac.signal,
      headers: { 'x-lu-client': 'desktop' },
    })
    if (!res.ok) return null
    return parseAppStatus(await res.json())
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}
