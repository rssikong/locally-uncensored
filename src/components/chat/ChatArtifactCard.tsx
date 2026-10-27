import { useState } from 'react'
import { FileText, Download, Check, Copy } from 'lucide-react'
import type { ChatArtifact } from '../../types/chat'
import { saveOrShare, saveSucceeded, type SaveOutcome } from '../../lib/save-or-share'
import { formatBytes } from '../../lib/formatters'

/**
 * In-chat file artifact (2026-06-12). In PLAIN chat a "file write" never
 * touches disk — the model's file lands here and shows like a ChatGPT artifact:
 * filename + a scrollable preview + a Download button (native Save-As in Tauri,
 * blob-download in the browser).
 */

function extOf(name: string): string {
  const e = name.split('.').pop()
  return e && e !== name ? e : 'txt'
}

const PREVIEW_LINES = 200

export type ArtifactSaveState = 'idle' | 'saving' | 'done' | 'failed'

/** What the Download button shows after an attempt: "Saved" for a file that
 *  went somewhere, "Not saved" for a failure, nothing for a cancel. */
export function saveStateAfter(outcome: SaveOutcome): ArtifactSaveState {
  if (saveSucceeded(outcome)) return 'done'
  return outcome.status === 'error' ? 'failed' : 'idle'
}

export function ChatArtifactCard({ artifact }: { artifact: ChatArtifact }) {
  const [copied, setCopied] = useState(false)
  const [saveState, setSaveState] = useState<ArtifactSaveState>('idle')

  const lines = artifact.content.split('\n')
  const preview = lines.slice(0, PREVIEW_LINES).join('\n')
  const hiddenLines = lines.length - Math.min(lines.length, PREVIEW_LINES)
  // Die dritte handgeschriebene Byte-Rechnung der Oberflaeche, mit eigenen
  // Schwellen und eigenem Einheitennamen. Es gibt eine Regel dafuer, und sie
  // steht in lib/formatters.ts (Fund 5).
  const sizeLabel = formatBytes(artifact.content.length)

  const handleDownload = async () => {
    if (saveState === 'saving') return
    setSaveState('saving')
    // Desktop → native Save-As, a blob download if the command itself throws.
    // Browser → blob. Phone → share sheet. One door: lib/save-or-share.ts.
    const outcome = await saveOrShare(
      { filename: artifact.name, mime: artifact.mime, text: artifact.content },
      { extension: extOf(artifact.name), extLabel: extOf(artifact.name).toUpperCase(), anchorOnDialogFailure: true },
    )
    // "Saved" only when the file really went somewhere. It used to appear
    // after a cancelled dialog too, and on a phone after the dialog command
    // had failed outright.
    setSaveState(saveStateAfter(outcome))
    setTimeout(() => setSaveState('idle'), 2000)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(artifact.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-1 rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.02] overflow-hidden">
      {/* Header: filename + meta + actions */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-gray-200 dark:border-white/[0.06]">
        <FileText size={13} className="text-blue-500 shrink-0" />
        <span className="text-[0.72rem] font-medium text-gray-800 dark:text-gray-100 truncate flex-1" title={artifact.name}>
          {artifact.name}
        </span>
        <span className="text-[0.55rem] text-gray-400 dark:text-gray-500 shrink-0 whitespace-nowrap">
          {lines.length} {lines.length === 1 ? 'line' : 'lines'} · {sizeLabel}
        </span>
        <button
          onClick={handleCopy}
          title={copied ? 'Copied' : 'Copy contents'}
          className="p-1 rounded text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors shrink-0"
        >
          {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
        </button>
        <button
          onClick={handleDownload}
          disabled={saveState === 'saving'}
          title="Download / Save as…"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded t-micro font-medium bg-blue-500/15 text-blue-500 hover:bg-blue-500/25 border border-blue-500/30 transition-colors disabled:opacity-50 shrink-0"
        >
          {saveState === 'done' ? <Check size={11} /> : <Download size={11} />}
          <span>{saveState === 'done' ? 'Saved' : saveState === 'failed' ? 'Not saved' : saveState === 'saving' ? '…' : 'Download'}</span>
        </button>
      </div>
      {/* Scrollable preview */}
      <pre className="px-2.5 py-1.5 t-micro leading-snug text-gray-700 dark:text-gray-300 font-mono overflow-auto max-h-64 scrollbar-thin whitespace-pre">
        {preview}
        {hiddenLines > 0 ? `\n\n… ${hiddenLines} more line${hiddenLines === 1 ? '' : 's'}. Download for the full file` : ''}
      </pre>
    </div>
  )
}
