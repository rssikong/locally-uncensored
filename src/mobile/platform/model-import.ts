/**
 * Bring a model file of the user's own into the app.
 *
 * The system's document picker opens, and the native layer copies the chosen
 * file into the model folder (plugin lu-native, `import_model_document`).
 * The bytes never pass through the WebView: a model has gigabytes, and a
 * file picked through `<input type="file">` would sit in the WebView's
 * memory as a whole.
 *
 * There is no web fallback on purpose. Where the native layer is missing
 * the answer is `unavailable`, and the screen does not offer the row.
 */
import { nativeBridge, tryBridge } from './bridge'

export type ModelImportStatus = 'imported' | 'cancelled' | 'not-gguf' | 'no-space' | 'exists' | 'failed' | 'unavailable'

export interface ModelImport {
  status: ModelImportStatus
  /** The name in the model folder, with `.gguf`. */
  fileName: string | null
  bytes: number
  /** A sentence of the native layer for the user, for a refused or failed import. */
  message: string | null
}

const STATES: readonly string[] = ['imported', 'cancelled', 'not-gguf', 'no-space', 'exists', 'failed']

/** Does this build have the native import. */
export async function modelImportSupported(): Promise<boolean> {
  const bridge = await nativeBridge().catch(() => null)
  return !!bridge && typeof bridge.importModelFile === 'function'
}

/**
 * Open the picker and copy the chosen file. Never throws: a failure of the
 * call itself is `failed` with the sentence of the native layer.
 * `onProgress` hears the copy a few times a second (`total` is 0 when the
 * provider of the file does not say its size).
 */
export async function importModelFile(onProgress?: (received: number, total: number, fileName: string) => void): Promise<ModelImport> {
  try {
    const answer = await tryBridge((bridge) =>
      bridge.importModelFile?.({
        onProgress: onProgress ? (p) => onProgress(Number(p.receivedBytes) || 0, Number(p.totalBytes) || 0, String(p.fileName ?? '')) : undefined,
      }),
    )
    if (!answer.ok || !answer.value) return { status: 'unavailable', fileName: null, bytes: 0, message: null }
    const value = answer.value
    return {
      status: STATES.includes(String(value.status)) ? (value.status as ModelImportStatus) : 'failed',
      fileName: value.fileName ?? null,
      bytes: Number(value.bytes) || 0,
      message: value.message ?? null,
    }
  } catch (err) {
    return { status: 'failed', fileName: null, bytes: 0, message: err instanceof Error ? err.message : typeof err === 'string' ? err : null }
  }
}

/** Stop the copy that is running. importModelFile then answers `cancelled`. */
export async function cancelModelImport(): Promise<void> {
  try {
    await tryBridge((bridge) => bridge.cancelModelImport?.())
  } catch {
    /* nothing was running */
  }
}
