/**
 * Desktops this phone has been paired with, so the next visit is one tap and
 * the code.
 *
 * The store of the logic layer keeps ONE connection. This list stands next
 * to it and keeps only what is needed to offer a desktop again: the address,
 * the computer name when the desktop sent one, and when it last worked.
 * Never a token, never a code.
 *
 * localStorage on purpose: a handful of short entries, read before the first
 * frame of R1.
 */
import { classifyHost, displayAddress, normalizeRemoteBase, type RemoteRoute } from '../../../remote/pairingLink'
import { cleanHostName } from '../../../remote/remoteClient'

export const KNOWN_DESKTOPS_KEY = 'lu-mobile-remote-desktops'
export const KNOWN_DESKTOPS_MAX = 5

export interface KnownDesktop {
  baseUrl: string
  /** Display form without the scheme. */
  address: string
  route: RemoteRoute
  /** When the pairing last worked, ms. */
  lastConnectedAt: number
  /** Computer name the desktop sent, if any. */
  name?: string
}

type Listener = () => void
const listeners = new Set<Listener>()
let cache: KnownDesktop[] | null = null

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Pure: what a saved list may contain. Anything else is dropped. */
export function sanitizeKnown(raw: unknown): KnownDesktop[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: KnownDesktop[] = []
  for (const entry of raw as Array<Partial<KnownDesktop> | null>) {
    if (!entry || typeof entry.baseUrl !== 'string') continue
    const baseUrl = normalizeRemoteBase(entry.baseUrl)
    if (!baseUrl || seen.has(baseUrl)) continue
    seen.add(baseUrl)
    let host = ''
    try {
      host = new URL(baseUrl).hostname
    } catch {
      continue
    }
    const name = cleanHostName(entry.name)
    out.push({
      baseUrl,
      address: displayAddress(baseUrl),
      route: classifyHost(host),
      lastConnectedAt: typeof entry.lastConnectedAt === 'number' && Number.isFinite(entry.lastConnectedAt) ? entry.lastConnectedAt : 0,
      ...(name ? { name } : {}),
    })
  }
  return out.sort((a, b) => b.lastConnectedAt - a.lastConnectedAt).slice(0, KNOWN_DESKTOPS_MAX)
}

/** Pure: the list after a pairing with `baseUrl` worked at `at`. A name that was known stays when none is passed. */
export function withRemembered(list: readonly KnownDesktop[], baseUrl: string, at: number, name = ''): KnownDesktop[] {
  const normal = normalizeRemoteBase(baseUrl)
  const before = list.find((d) => d.baseUrl === normal)
  return sanitizeKnown([{ baseUrl, lastConnectedAt: at, name: name || before?.name }, ...list.filter((d) => d.baseUrl !== normal)])
}

/** Pure: the list without `baseUrl`. */
export function withoutDesktop(list: readonly KnownDesktop[], baseUrl: string): KnownDesktop[] {
  return list.filter((d) => d.baseUrl !== baseUrl)
}

function read(): KnownDesktop[] {
  const ls = storage()
  if (!ls) return []
  try {
    const raw = ls.getItem(KNOWN_DESKTOPS_KEY)
    return raw ? sanitizeKnown(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

function write(list: KnownDesktop[]): void {
  cache = list
  const ls = storage()
  try {
    if (ls) {
      if (list.length === 0) ls.removeItem(KNOWN_DESKTOPS_KEY)
      else ls.setItem(KNOWN_DESKTOPS_KEY, JSON.stringify(list))
    }
  } catch {
    /* a full storage costs the shortcut, never the connection */
  }
  for (const fn of [...listeners]) fn()
}

/** The remembered desktops, newest first. The same array until something changes. */
export function knownDesktops(): KnownDesktop[] {
  if (!cache) cache = read()
  return cache
}

export function rememberDesktop(baseUrl: string, at: number = Date.now(), name = ''): void {
  write(withRemembered(knownDesktops(), baseUrl, at, name))
}

export function forgetKnownDesktop(baseUrl: string): void {
  write(withoutDesktop(knownDesktops(), baseUrl))
}

export function subscribeKnownDesktops(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Only for tests. */
export function __resetKnownDesktopsForTests(): void {
  cache = null
  listeners.clear()
}
