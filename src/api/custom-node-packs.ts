/**
 * ComfyUI node packs from inside LU (GitHub wish #14, Discussion #72): the
 * list of what sits in ComfyUI/custom_nodes, installing a pack from its Git
 * link, updating and removing one, and the answer to "which pack brings this
 * node type" for a workflow import.
 *
 * Every install and update runs through the backend command LU already uses
 * for its own packs (`install_custom_node`: git, then requirements.txt into
 * ComfyUI's Python). The link check here only gives early feedback; the
 * backend checks the same rule again (custom_node_packs.rs) and is the one
 * that counts.
 */
import { backendCall } from './backend'
import { clearNodeCache } from './comfyui-nodes'
import { assertNodeInstallOk } from './discover'
import { CUSTOM_NODE_REGISTRY, type CustomNodeEntry } from './model-bundles'

export interface NodePack {
  folder: string
  name: string
  enabled: boolean
  inDisabledDir: boolean
  kind: 'git' | 'folder' | 'file'
  origin: string | null
  branch: string | null
  commit: string | null
  committedAt: string | null
  hasRequirements: boolean
}

export type NodePackList =
  | { available: true; path: string; packs: NodePack[] }
  | { available: false; reason: string; packs: NodePack[] }

/** The one sentence shown before anything is installed. */
export const FOREIGN_CODE_NOTICE =
  'A node pack is code written by its author. Once installed it runs inside ComfyUI with the same access to this computer as ComfyUI itself, so install only packs you trust.'

export const RESTART_NOTICE = 'Restart ComfyUI to load the change.'

/** The hosts a pack may come from, the same three the backend accepts. */
export const NODE_REPO_HOSTS = ['github.com', 'gitlab.com', 'codeberg.org'] as const

const ASK = 'Paste the https link of the repository, for example https://github.com/owner/repo.'

const plainSegment = (s: string) =>
  s.length > 0 && s.length <= 100 && !s.startsWith('.') && !s.startsWith('-') && !s.includes('..')
  && /^[A-Za-z0-9._-]+$/.test(s)

export type ParsedNodeRepo = { ok: true; url: string; folder: string } | { ok: false; reason: string }

/** Mirror of `node_repo_from_url` in custom_node_packs.rs. */
export function parseNodeRepoLink(raw: string): ParsedNodeRepo {
  const url = raw.trim()
  if (!url) return { ok: false, reason: ASK }
  if (url.length > 512 || /[\s\p{Cc}]/u.test(url)) {
    return { ok: false, reason: `That link is not a plain repository link. ${ASK}` }
  }
  if (!url.startsWith('https://')) return { ok: false, reason: `Only https links are accepted. ${ASK}` }
  let rest = url.slice('https://'.length)
  if (/[?#@\\%]/.test(rest)) return { ok: false, reason: `That link carries extra parts LU does not accept. ${ASK}` }
  rest = rest.replace(/\/+$/, '')
  const [rawHost, ...path] = rest.split('/')
  const host = rawHost.toLowerCase().replace(/^www\./, '')
  if (!(NODE_REPO_HOSTS as readonly string[]).includes(host)) {
    return { ok: false, reason: `LU installs node packs from github.com, gitlab.com and codeberg.org only. ${ASK}` }
  }
  if (path.length > 0) path[path.length - 1] = path[path.length - 1].replace(/\.git$/, '')
  const maxDepth = host === 'gitlab.com' ? 4 : 2
  if (path.length < 2 || path.length > maxDepth || !path.every(plainSegment)) {
    return { ok: false, reason: `That is not a link to a repository. ${ASK}` }
  }
  if (path.some((s) => s === '-' || /^(tree|blob)$/i.test(s))) {
    return { ok: false, reason: `That link points into a repository, not at it. ${ASK}` }
  }
  return { ok: true, url: `https://${host}/${path.join('/')}`, folder: path[path.length - 1] }
}

/** The registry entry a pack came from, by its repository, so a pinned pack
 *  (ComfyUI-RMBG) is updated onto its tested commit and not past it. */
export function registryEntryForOrigin(origin: string | null): CustomNodeEntry | undefined {
  if (!origin) return undefined
  const parsed = parseNodeRepoLink(origin)
  if (!parsed.ok) return undefined
  const want = parsed.url.toLowerCase()
  return Object.values(CUSTOM_NODE_REGISTRY).find((entry) => {
    const own = parseNodeRepoLink(entry.repo)
    return own.ok && own.url.toLowerCase() === want
  })
}

/** Why a listed pack has no Update button, or null when it has one. */
export function whyNoUpdate(pack: NodePack): string | null {
  if (pack.kind === 'file') return 'A single file has no source LU can update it from.'
  if (pack.kind === 'folder') return 'This folder is not a git checkout, so LU cannot update it.'
  if (!pack.enabled) return 'This pack is disabled.'
  if (!pack.origin) return 'This checkout has no origin to update from.'
  if (!parseNodeRepoLink(pack.origin).ok) {
    return 'LU updates packs from https links on github.com, gitlab.com and codeberg.org only. Update this one with git yourself.'
  }
  return null
}

export async function listNodePacks(): Promise<NodePackList> {
  return backendCall<NodePackList>('list_custom_nodes')
}

/** Log lines of node pack work after `since`; without `since`, only the
 *  number to start from. */
export async function readNodeLog(since?: number): Promise<{ lines: string[]; next: number }> {
  return backendCall('custom_node_log', since === undefined ? {} : { since })
}

export async function installNodePackFromLink(link: string): Promise<string> {
  const parsed = parseNodeRepoLink(link)
  if (!parsed.ok) throw new Error(parsed.reason)
  try {
    const result = await backendCall('install_custom_node', {
      repoUrl: parsed.url, nodeName: parsed.folder, freshOnly: true,
    })
    assertNodeInstallOk(result, parsed.folder)
  } finally {
    clearNodeCache()
  }
  return parsed.folder
}

export async function updateNodePack(pack: NodePack): Promise<void> {
  const why = whyNoUpdate(pack)
  if (why) throw new Error(why)
  const entry = registryEntryForOrigin(pack.origin)
  try {
    const result = await backendCall('install_custom_node', {
      repoUrl: pack.origin, nodeName: pack.folder, ...(entry?.commit ? { commit: entry.commit } : {}),
    })
    assertNodeInstallOk(result, pack.name)
  } finally {
    clearNodeCache()
  }
}

/** Moves the pack to the system trash. True when ComfyUI was restarted on
 *  the way (it had files of the pack open), so no second restart is due. */
export async function removeNodePack(pack: NodePack): Promise<boolean> {
  try {
    const result = await backendCall<{ restarted?: boolean }>('remove_custom_node', {
      folder: pack.folder, inDisabledDir: pack.inDisabledDir,
    })
    return result?.restarted === true
  } finally {
    clearNodeCache()
  }
}

// ── Missing node types of a workflow ──────────────────────────────

export interface PackForTypes {
  key: string
  name: string
  repo: string
  types: string[]
}

/**
 * Which known pack brings each of `types`. Only LU's own registry counts
 * (model-bundles.ts, CUSTOM_NODE_REGISTRY): a type is matched by the exact
 * names an entry lists or by a prefix that pack owns. Nothing is fetched from
 * the network, so no list from elsewhere decides what gets installed.
 */
export function packsForMissingTypes(types: string[]): { installable: PackForTypes[]; unknown: string[] } {
  const byKey = new Map<string, PackForTypes>()
  const unknown: string[] = []
  for (const type of [...new Set(types)].sort()) {
    const hit = Object.entries(CUSTOM_NODE_REGISTRY).find(([, entry]) =>
      entry.requiredNodes.includes(type)
      || (entry.alsoProvides ?? []).includes(type)
      || (entry.providesPrefixes ?? []).some((p) => type.startsWith(p)))
    if (!hit) {
      unknown.push(type)
      continue
    }
    const [key, entry] = hit
    const pack = byKey.get(key) ?? { key, name: entry.name, repo: entry.repo, types: [] }
    pack.types.push(type)
    byKey.set(key, pack)
  }
  return { installable: [...byKey.values()], unknown }
}
