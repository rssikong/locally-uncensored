/**
 * The folder of the voice engine, the read-aloud voices and LU's own Python
 * (Settings, Model Storage). The rules live in Rust (`runtime_root.rs`); this
 * is the call surface. Desktop only: the browser build has none of the three.
 */

import { backendCall } from './backend'

export type RuntimeKind = 'voice' | 'python' | 'piperVoices'

export interface RuntimeEntry {
  kind: RuntimeKind
  /** Where it is, or where a new install would go. */
  path: string
  installed: boolean
  /** Already in the chosen folder (or, with none chosen, the default place). */
  atTarget: boolean
  bytes: number
}

export interface RuntimeFolderStatus {
  /** The chosen folder, null for the app data folder. */
  chosen: string | null
  defaultFolder: string
  entries: RuntimeEntry[]
  moving: boolean
}

export type MoveStatus = 'moved' | 'movedOldKept' | 'failed'

export interface MoveOutcome {
  kind: RuntimeKind
  from: string
  to: string
  status: MoveStatus
  detail: string
}

export function runtimeFolderStatus(): Promise<RuntimeFolderStatus> {
  return backendCall<RuntimeFolderStatus>('runtime_folder_status')
}

/** An empty path goes back to the app data folder. Rejects with a sentence. */
export function setRuntimeFolder(path: string): Promise<RuntimeFolderStatus> {
  return backendCall<RuntimeFolderStatus>('set_runtime_folder', { path })
}

export function moveRuntimeFolder(): Promise<MoveOutcome[]> {
  return backendCall<MoveOutcome[]>('move_runtime_folder')
}
