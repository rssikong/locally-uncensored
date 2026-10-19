// Parse a chatbot export without freezing the window. The parse itself lives
// in chatbot-export.ts; this file only decides WHERE it runs: in a module
// worker when the platform gives us one, on the main thread otherwise (the
// test runner, or a worker that fails to load). The fallback is the same
// code the app ran before 3.0.8, so the worst case is the old behaviour.

import { parseExportFile, type ParseProgressFn, type ParseResult, type ParseProgress } from './chatbot-export'

export interface ExportWorkerRequest { file: File }
export type ExportWorkerResponse =
  | { type: 'progress'; progress: ParseProgress }
  | { type: 'done'; result: ParseResult }
  | { type: 'error'; message: string }

export function parseExportFileOffThread(file: File, onProgress?: ParseProgressFn): Promise<ParseResult> {
  let worker: Worker
  try {
    if (typeof Worker === 'undefined') return parseExportFile(file, onProgress)
    worker = new Worker(new URL('./chatbot-export.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return parseExportFile(file, onProgress)
  }
  return new Promise<ParseResult>((resolve, reject) => {
    let settled = false
    const finish = () => { settled = true; worker.terminate() }
    worker.onmessage = (e: MessageEvent<ExportWorkerResponse>) => {
      const msg = e.data
      if (msg.type === 'progress') { onProgress?.(msg.progress); return }
      finish()
      if (msg.type === 'done') resolve(msg.result)
      else reject(new Error(msg.message))
    }
    // A worker script that cannot load (blocked, missing chunk) fires
    // `error` before any message. Parse on the main thread instead of failing.
    worker.onerror = (ev) => {
      if (settled) return
      ev.preventDefault()
      finish()
      parseExportFile(file, onProgress).then(resolve, reject)
    }
    const request: ExportWorkerRequest = { file }
    worker.postMessage(request)
  })
}
