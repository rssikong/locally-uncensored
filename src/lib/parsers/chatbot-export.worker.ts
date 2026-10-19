// Runs parseExportFile off the main thread. A ChatGPT export of a few
// thousand conversations is a single JSON file of 100 MB and more, and
// JSON.parse on that blocks whatever thread it runs on for seconds. In here
// it blocks nothing the user can see; the page keeps painting the progress.
//
// Protocol: in { file }, out any number of { type: 'progress', progress },
// then exactly one { type: 'done', result } or { type: 'error', message }.

import { parseExportFile } from './chatbot-export'
import type { ExportWorkerRequest, ExportWorkerResponse } from './chatbot-export-offthread'

const post = (msg: ExportWorkerResponse) => { (self as unknown as Worker).postMessage(msg) }

self.onmessage = async (e: MessageEvent<ExportWorkerRequest>) => {
  try {
    const result = await parseExportFile(e.data.file, progress => post({ type: 'progress', progress }))
    post({ type: 'done', result })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
