/**
 * Check files and Repair (GH #113, wish G16): the four backend calls.
 *
 * The check runs as a job in Rust (src-tauri/src/commands/model_verify.rs):
 * `startFileCheck` answers with an id at once, `fileCheckStatus` reports the
 * progress of the digest and, at the end, one verdict per file, and
 * `cancelFileCheck` stops it between two pieces of a file. The rules about
 * what the verdicts mean live in lib/model-file-check.ts.
 */

import { backendCall } from './backend'

/** One file, the way the backend is asked about it. */
export interface FileCheckRequest {
  filename: string
  /** ComfyUI model folder (the bundle lane). */
  subfolder?: string
  /** A chat model's own folder. */
  destDir?: string
  url?: string
  /** The catalog's EXACT byte count. Never the rounded `sizeGB`. */
  expectedBytes?: number
  sha256?: string
}

export type FileState = 'ok' | 'missing' | 'wrong_size' | 'wrong_checksum' | 'incomplete' | 'unconfirmed'

export interface FileVerdict {
  filename: string
  state: FileState
  actualBytes: number
  expectedBytes: number | null
  partialBytes: number | null
  checked: 'sha256' | 'size' | 'none'
}

export interface FileCheckJob {
  id: string
  status: 'running' | 'done' | 'cancelled' | 'error'
  current: string | null
  hashedBytes: number
  hashTotalBytes: number
  files: FileVerdict[]
  error: string | null
}

export async function startFileCheck(files: FileCheckRequest[]): Promise<string> {
  const answer = await backendCall<{ id: string }>('verify_model_files', {
    files: files.map((f) => ({
      filename: f.filename,
      subfolder: f.subfolder ?? null,
      destDir: f.destDir ?? null,
      url: f.url ?? null,
      expectedBytes: f.expectedBytes ?? null,
      sha256: f.sha256 ?? null,
    })),
  })
  return answer.id
}

export function fileCheckStatus(id: string): Promise<FileCheckJob> {
  return backendCall<FileCheckJob>('verify_model_files_status', { id })
}

export async function cancelFileCheck(id: string): Promise<void> {
  await backendCall('verify_model_files_cancel', { id })
}

/** Move one model file to the Trash. Never a permanent delete. */
export function trashModelFile(target: { filename: string; subfolder?: string; destDir?: string }): Promise<{ trashed: boolean; missing: boolean }> {
  return backendCall('trash_model_file', {
    filename: target.filename,
    subfolder: target.subfolder ?? null,
    destDir: target.destDir ?? null,
  })
}
