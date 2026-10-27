/**
 * Settings → Storage: one folder for everything LU downloads and makes
 * (Discord "Storage Management", 12.–17.10.2026). The rules live in Rust
 * (`commands/storage.rs`, `storage_move.rs`); this is the call surface.
 * Desktop only: the browser build has no files of its own to place.
 */

import { backendCall } from './backend'
import type { MoveOutcome } from './runtime-folder'

export interface Drive {
  mount: string
  free: number
  total: number
  /** The drive the system runs from (C: on Windows). */
  system: boolean
}

export type PlaceId = 'models' | 'comfyModels' | 'gallery' | 'runtime'

export interface Place {
  id: PlaceId
  path: string
  drive: Drive | null
}

export interface StorageStatus {
  root: string | null
  /** This machine runs ComfyUI (not the Mac). */
  comfyHere: boolean
  comfyPath: string | null
  comfyDownloadsInModelFolder: boolean
  places: Place[]
  moving: boolean
  example: string
}

export interface TreePlan {
  files: number
  bytes: number
  /** Bytes that have to be copied because the folder is on another drive. */
  crossBytes: number
  sameVolume: boolean
  /** Files already at the new place. They stay in both places. */
  conflicts: number
}

export type ItemGroup = 'models' | 'comfyModels' | 'gallery' | 'runtime'

export interface ItemPlan {
  /** `luEngine`, `modelFolder`, `comfy:<key>`, `gallery`, `runtime:<kind>`. */
  id: string
  group: ItemGroup
  from: string
  to: string
  plan: TreePlan
}

export interface StoragePlan {
  root: string
  modelsDir: string
  galleryDir: string | null
  runtimeDir: string
  items: ItemPlan[]
  crossBytes: number
  drive: Drive | null
  enoughSpace: boolean
  /** Why the move cannot start now. Choosing the folder for new files works anyway. */
  blocker: string | null
  /** What LU stops for the move. */
  stops: string[]
}

export interface TreeReport {
  movedFiles: number
  movedBytes: number
  kept: number
  failed: string[]
  failedCount: number
  cancelled: boolean
}

export interface ItemReport {
  id: string
  group: ItemGroup
  from: string
  to: string
  report: TreeReport
}

export interface StorageApplied {
  root: string
  modelsDir: string
  galleryDir: string | null
  runtimeDir: string
  moved: ItemReport[]
  runtime: MoveOutcome[]
  stopped: string[]
  cancelled: boolean
}

export interface StorageProgress {
  id: string
  done: number
  total: number
  allDone: number
  allTotal: number
  file: string
}

export function storageStatus(): Promise<StorageStatus> {
  return backendCall<StorageStatus>('storage_status')
}

/** Creates the folder, changes nothing else. Rejects with a sentence. */
export function storagePlan(root: string): Promise<StoragePlan> {
  return backendCall<StoragePlan>('storage_plan', { root })
}

export function storageApply(root: string, moveFiles: boolean, skip: string[]): Promise<StorageApplied> {
  return backendCall<StorageApplied>('storage_apply', { root, moveFiles, skip })
}

export function storageCancel(): Promise<boolean> {
  return backendCall<boolean>('storage_cancel')
}

/** Live progress of a move. Resolves to the function that stops listening. */
export async function onStorageProgress(handler: (p: StorageProgress) => void): Promise<() => void> {
  try {
    const { listen } = await import('@tauri-apps/api/event')
    return await listen<StorageProgress>('storage-move-progress', (event) => handler(event.payload))
  } catch {
    return () => {}
  }
}
