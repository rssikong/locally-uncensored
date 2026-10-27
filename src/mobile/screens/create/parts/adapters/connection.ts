/**
 * ADAPTER: is this phone on Wi-Fi or on mobile data.
 *
 * The answer comes from the platform seam (platform/network.ts), which asks
 * the native layer (iOS and Android) and falls back to the Network
 * Information API of the WebView. `connectionKind()` is the answer for the
 * first paint, from the WebView alone; `readConnectionKind()` is the real one.
 */
import { connectionKind as systemConnectionKind, onNetworkChange } from '../../../../platform'

export type ConnectionKind = 'wifi' | 'cellular' | 'unknown'

interface NetworkInformationLike {
  type?: string
  addEventListener?: (name: 'change', fn: () => void) => void
  removeEventListener?: (name: 'change', fn: () => void) => void
}

function info(): NetworkInformationLike | null {
  if (typeof navigator === 'undefined') return null
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection ?? null
}

export function connectionKind(): ConnectionKind {
  const type = info()?.type
  if (type === 'wifi' || type === 'ethernet') return 'wifi'
  if (type === 'cellular') return 'cellular'
  return 'unknown'
}

/** What the system says. Unknown stays unknown, it never counts as mobile data. Never throws. */
export async function readConnectionKind(): Promise<ConnectionKind> {
  try {
    const kind = await systemConnectionKind()
    if (kind === 'wifi' || kind === 'ethernet') return 'wifi'
    if (kind === 'cellular') return 'cellular'
    return 'unknown'
  } catch {
    return connectionKind()
  }
}

/** Told when the network may have changed: the WebView says so, or the phone went on or off the net. */
export function onConnectionChange(fn: () => void): () => void {
  const c = info()
  c?.addEventListener?.('change', fn)
  const off = onNetworkChange(() => fn())
  return () => {
    c?.removeEventListener?.('change', fn)
    off()
  }
}
