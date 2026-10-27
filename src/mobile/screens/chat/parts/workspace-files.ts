/**
 * The working folder of the agent of one chat (C7.6, audit L4).
 *
 * In Agent mode the model writes real files into a folder that belongs to
 * the chat. The agent then says "notes.md written", and until round 2 the
 * user found that file nowhere on the phone. This file lists the folder,
 * reads one file for the viewer and removes one after the user said yes.
 *
 * All of it goes through the file commands of the app (`fs_list`, `fs_read`,
 * `fs_read_bytes`), which keep every path inside the folder of the chat.
 * Nothing here names a path of the device.
 *
 * Deleting goes through `fs_delete`, which takes one regular file inside
 * the folder of the chat and nothing else. A build older than that command
 * answers "unavailable", and the viewer says so instead of pretending.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { backendCall } from '../../../../api/backend'
import { commandIsUnavailable } from '../../../../lib/engine-command-availability'
import { useAgentModeStore } from '../../../../stores/agentModeStore'
import type { FsEntry, FsListResult, FsReadResult } from '../../../../types/bridge'

export interface WorkspaceFile {
  /** Path inside the folder of the chat, with forward slashes. What the viewer is opened with. */
  path: string
  name: string
  size: number
  /** Unix seconds, 0 when unknown. */
  modified: number
}

/** More files than this are not listed; the list says that it was cut. */
export const WORKSPACE_LIST_MAX = 200
/** A text file up to this size is shown as text. */
export const WORKSPACE_TEXT_MAX = 512 * 1024
/** Bytes of a file up to this size are read for a preview or for sharing. The native cap is 16 MB. */
export const WORKSPACE_BYTES_MAX = 16 * 1024 * 1024

interface FolderContext {
  chatId: string
  workingDirectory?: string
}

/**
 * Which folder belongs to this chat, as the file commands want it. Null when
 * no agent run of this chat has named a folder yet: then there is nothing to
 * list, and looking must not create one.
 */
export function workspaceContext(chatId: string): FolderContext | null {
  const state = useAgentModeStore.getState()
  const slug = state.workspaceSlugs?.[chatId]
  if (!slug) return null
  const picked = state.workspaces?.[chatId]
  if (picked?.kind === 'folder' && picked.path) return { chatId: slug, workingDirectory: picked.path }
  return { chatId: slug }
}

const slashes = (path: string) => path.replace(/\\/g, '/')

/** Files nobody put there on purpose: dot files, dot folders, the temp files of an atomic write. */
function isHousekeeping(relative: string): boolean {
  return relative.split('/').some((part) => part.startsWith('.'))
}

/**
 * Pure: the entries of a recursive listing as files of the folder, newest
 * first. The listing names absolute paths and includes the folder itself;
 * the folder is the directory every other entry lies under.
 */
export function workspaceRows(entries: readonly FsEntry[]): WorkspaceFile[] {
  const all = entries.map((e) => ({ ...e, path: slashes(e.path) }))
  const dirs = all.filter((e) => e.isDir).sort((a, b) => a.path.length - b.path.length)
  const root = dirs.find((d) => all.every((e) => e.path === d.path || e.path.startsWith(`${d.path}/`)))?.path ?? null
  const out: WorkspaceFile[] = []
  for (const entry of all) {
    if (entry.isDir) continue
    const relative = root ? entry.path.slice(root.length + 1) : entry.name
    if (!relative || isHousekeeping(relative)) continue
    out.push({ path: relative, name: entry.name || relative.split('/').pop() || relative, size: entry.size || 0, modified: entry.modified || 0 })
  }
  return out.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path))
}

export interface WorkspaceListing {
  files: WorkspaceFile[]
  /** The folder holds more files than are shown. */
  cut: boolean
}

/** The files of the agent folder of this chat. Empty when the chat has no folder. Throws when the folder cannot be read. */
export async function listWorkspaceFiles(chatId: string): Promise<WorkspaceListing> {
  const ctx = workspaceContext(chatId)
  if (!ctx) return { files: [], cut: false }
  const data = await backendCall<FsListResult>('fs_list', { path: '.', recursive: true, pattern: null, ...ctx })
  const files = workspaceRows(Array.isArray(data?.entries) ? data.entries : [])
  return { files: files.slice(0, WORKSPACE_LIST_MAX), cut: files.length > WORKSPACE_LIST_MAX }
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  json: 'application/json',
  csv: 'text/csv',
  md: 'text/markdown',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/plain',
  py: 'text/x-python',
  zip: 'application/zip',
}

/** Pure: the type of a file by its ending. */
export function mimeOfName(name: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function readBytes(ctx: FolderContext, path: string, mime: string): Promise<Blob | null> {
  try {
    const data = await backendCall<{ base64?: string }>('fs_read_bytes', { path, maxBytes: WORKSPACE_BYTES_MAX, ...ctx })
    return typeof data?.base64 === 'string' ? base64ToBlob(data.base64, mime) : null
  } catch {
    return null
  }
}

export type WorkspaceContent =
  | { kind: 'image'; name: string; mime: string; blob: Blob }
  | { kind: 'text'; name: string; mime: string; text: string; blob: Blob }
  | { kind: 'other'; name: string; mime: string; size: number; blob?: Blob }

/** One file of the folder for the viewer. Null when it is gone or the chat has no folder. */
export async function readWorkspaceFile(chatId: string, path: string): Promise<WorkspaceContent | null> {
  const ctx = workspaceContext(chatId)
  if (!ctx) return null
  const name = path.split('/').pop() || path
  const mime = mimeOfName(name)
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') {
    const blob = await readBytes(ctx, path, mime)
    if (blob) return { kind: 'image', name, mime, blob }
  }
  let read: FsReadResult
  try {
    read = await backendCall<FsReadResult>('fs_read', { path, ...ctx })
  } catch {
    return null
  }
  if (read?.encoding === 'utf8' && typeof read.content === 'string') {
    const textMime = mime === 'application/octet-stream' ? 'text/plain' : mime
    const blob = new Blob([read.content], { type: textMime })
    if (read.content.length <= WORKSPACE_TEXT_MAX) return { kind: 'text', name, mime: textMime, text: read.content, blob }
    return { kind: 'other', name, mime: textMime, size: blob.size, blob }
  }
  const size = typeof read?.bytes === 'number' ? read.bytes : 0
  const blob = size > 0 && size <= WORKSPACE_BYTES_MAX ? await readBytes(ctx, path, mime) : null
  return { kind: 'other', name, mime, size, blob: blob ?? undefined }
}

export type WorkspaceDelete =
  | 'deleted'
  /** This build has no command to delete a file of the folder. */
  | 'unavailable'
  | 'failed'

let deleteMissing = false

/** True once this session learned that the build cannot delete. The viewer then stops offering it. */
export function workspaceDeleteMissing(): boolean {
  return deleteMissing
}

/** Remove one file of the folder. The caller has asked the user before. Never throws. */
export async function deleteWorkspaceFile(chatId: string, path: string): Promise<WorkspaceDelete> {
  const ctx = workspaceContext(chatId)
  if (!ctx) return 'failed'
  try {
    const result = await backendCall<{ deleted?: boolean } | null>('fs_delete', { path, ...ctx })
    // Only a plain yes counts: an answer of a build that does not know the command must not read as success.
    if (result && result.deleted === true) {
      folderChanged()
      return 'deleted'
    }
    deleteMissing = true
    return 'unavailable'
  } catch (err) {
    if (commandIsUnavailable(err)) {
      deleteMissing = true
      return 'unavailable'
    }
    return 'failed'
  }
}

/* ---------- the list for a screen ---------- */

let version = 0
const listeners = new Set<() => void>()
function folderChanged(): void {
  version += 1
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export type WorkspaceListState =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; files: WorkspaceFile[]; cut: boolean }

/** The agent folder of a chat for a list: reads at mount, after a delete and when `reload` is called. */
export function useWorkspaceFiles(chatId: string | null): { list: WorkspaceListState; reload: () => void } {
  const changed = useSyncExternalStore(subscribe, () => version)
  const [attempt, setAttempt] = useState(0)
  const key = `${chatId ?? ''}|${changed}|${attempt}`
  const [answer, setAnswer] = useState<{ key: string; list: WorkspaceListState } | null>(null)
  useEffect(() => {
    if (!chatId) return
    let alive = true
    listWorkspaceFiles(chatId)
      .then((listing) => {
        if (alive) setAnswer({ key, list: { state: 'ready', files: listing.files, cut: listing.cut } })
      })
      .catch(() => {
        if (alive) setAnswer({ key, list: { state: 'failed' } })
      })
    return () => {
      alive = false
    }
  }, [chatId, key])
  const list: WorkspaceListState = !chatId ? { state: 'ready', files: [], cut: false } : answer && answer.key === key ? answer.list : { state: 'loading' }
  return { list, reload: () => setAttempt((n) => n + 1) }
}

/** Only for tests. */
export function __resetWorkspaceFilesForTests(): void {
  deleteMissing = false
}
