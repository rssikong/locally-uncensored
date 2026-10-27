/**
 * Is there a network. navigator.onLine is the cheap signal; it says "a link
 * exists", not "the internet answers". Screens that need certainty still have
 * to handle a failed request. resilience/useOnline.ts builds the hook on this.
 */
import { tryBridge } from './bridge'

type Listener = (online: boolean) => void

export type ConnectionKind = 'wifi' | 'cellular' | 'ethernet' | 'other' | 'none' | 'unknown'
const KINDS: readonly string[] = ['wifi', 'cellular', 'ethernet', 'other', 'none', 'unknown']

/**
 * Which kind of network the phone is on. The system is asked through the
 * native layer; without it the browser (navigator.connection, which most
 * browsers do not have). Unknown is unknown: it never counts as mobile data.
 */
export async function connectionKind(): Promise<ConnectionKind> {
  try {
    const answer = await tryBridge((bridge) => bridge.connectionInfo?.())
    if (answer.ok && answer.value && KINDS.includes(String(answer.value.kind)) && answer.value.kind !== 'unknown') return answer.value.kind as ConnectionKind
  } catch {
    /* the command failed: the browser is asked */
  }
  const type = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: { type?: string } }).connection?.type
  return type === 'cellular' || type === 'wifi' || type === 'ethernet' || type === 'none' ? type : 'unknown'
}

/**
 * Hand the switch "Download on Wi-Fi only" to native code, which holds every
 * download to it, with or without the page. False where nobody can be told.
 */
export async function setDownloadWifiOnly(wifiOnly: boolean): Promise<boolean> {
  try {
    const answer = await tryBridge((bridge) => bridge.bgDownloadNetworkRule?.(wifiOnly))
    return answer.ok && answer.value === true
  } catch {
    return false
  }
}

/** "Download anyway": this one download may use mobile data although the switch is on. */
export async function allowDownloadOnMobileData(id: string, allow = true): Promise<boolean> {
  try {
    const answer = await tryBridge((bridge) => bridge.bgDownloadAllowMetered?.(id, allow))
    return answer.ok && answer.value === true
  } catch {
    return false
  }
}

/**
 * Megabytes per second as the settings hold the limit, to the bytes per
 * second native code counts in. 1 MB is 1 000 000 bytes, as on the desktop.
 */
export function limitToBytesPerSecond(mbPerSecond: number): number {
  return Number.isFinite(mbPerSecond) && mbPerSecond > 0 ? Math.round(mbPerSecond * 1_000_000) : 0
}

/**
 * Can this phone limit the speed of a model download. True on Android,
 * where the plugin carries the transfer itself. False on iOS: the system
 * carries the download in a background URLSession, which has no limit to
 * set. False in a browser and in a build without the plugin. A page shows
 * the control only when this is true.
 */
export async function downloadLimitSupported(): Promise<boolean> {
  try {
    const answer = await tryBridge((bridge) => bridge.bgDownloadLimit?.())
    return answer.ok && answer.value?.supported === true
  } catch {
    return false
  }
}

/**
 * Hand the speed limit (MB/s, 0 for none) to native code, which holds every
 * download to it, with or without the page. True when the limit holds now.
 */
export async function setDownloadLimit(mbPerSecond: number): Promise<boolean> {
  const wanted = limitToBytesPerSecond(mbPerSecond)
  try {
    const answer = await tryBridge((bridge) => bridge.bgDownloadLimit?.(wanted))
    return answer.ok && answer.value?.supported === true && Number(answer.value.bytesPerSecond) === wanted
  } catch {
    return false
  }
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}

export function onNetworkChange(fn: Listener): () => void {
  if (typeof window === 'undefined') return () => {}
  const up = () => fn(true)
  const down = () => fn(false)
  window.addEventListener('online', up)
  window.addEventListener('offline', down)
  return () => {
    window.removeEventListener('online', up)
    window.removeEventListener('offline', down)
  }
}
