/**
 * "Add a LoRA from a link" (GitHub wish G2): paste a CivitAI or Hugging Face
 * link, LU reads what is behind it, shows name, base model and size, and
 * downloads it into the LoRA folder of this host on the download path every
 * other model file takes. Rules in lib/lora-link.ts, fetching in
 * api/lora-link.ts.
 */
import { useState } from 'react'
import { AlertTriangle, CheckCircle, Download, ExternalLink, Link2, Loader2, X } from 'lucide-react'
import { resolveLoraLink, startLoraLinkDownload } from '../../api/lora-link'
import { openExternal } from '../../api/backend'
import { familyLabel, macFamilyWarning, type LoraLinkInfo } from '../../lib/lora-link'
import { formatBytes } from '../../lib/formatters'
import { useDownloadStore } from '../../stores/downloadStore'
import { useWorkflowStore } from '../../stores/workflowStore'
import { GlassCard } from '../ui/GlassCard'
import { Hinweis } from '../ui/Hinweis'
import { ProgressBar } from '../ui/ProgressBar'
import { ICON_SM } from '../ui/icon-size'

interface Props {
  /** The Mac's LoRA folder. Absent on Windows and Linux, where the file goes
   *  to ComfyUI's models/loras. */
  destDir?: string
  /** True on the Mac: a LoRA for a family the Mac does not run is said so. */
  mac?: boolean
  /** File names already in the LoRA folder. A link to a file of the same
   *  name never overwrites it. */
  installed: readonly string[]
}

export function LoraLinkPanel({ destDir, mac = false, installed }: Props) {
  const [link, setLink] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<LoraLinkInfo | null>(null)
  const [started, setStarted] = useState(false)
  const row = useDownloadStore((s) => (info && started ? s.downloads[info.filename] : undefined))
  const cancelled = useDownloadStore((s) => !!info && s.cancelled.includes(info.filename))

  const check = async () => {
    if (!link.trim() || checking) return
    setChecking(true)
    setError(null)
    setInfo(null)
    setStarted(false)
    const wf = useWorkflowStore.getState()
    const result = await resolveLoraLink(link, { civitaiKey: wf.civitaiApiKey, civitaiHost: wf.civitaiHost })
    setChecking(false)
    if (result.ok) setInfo(result.info)
    else setError(result.error)
  }

  // Once this panel started the file, the folder holding it is the success,
  // not a clash.
  const nameTaken = !!info && !started && installed.some((n) => (n.split(/[/\\]/).pop() ?? n).toLowerCase() === info.filename.toLowerCase())
  const macNote = info && mac ? macFamilyWarning(info.family) : null
  const warnings = info ? [...info.warnings, ...(macNote ? [macNote] : [])] : []
  const noFolder = mac && !destDir

  const download = async () => {
    if (!info || nameTaken || noFolder) return
    setError(null)
    setStarted(true)
    try {
      await startLoraLinkDownload(info, mac ? destDir : undefined)
    } catch (e) {
      setStarted(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const busy = row?.status === 'connecting' || row?.status === 'downloading' || row?.status === 'pausing' || row?.status === 'paused'
  const done = row?.status === 'complete'
  const failed = row?.status === 'error'
  // Between the start and the first progress reading there is no row yet;
  // after a cancel there is none any more.
  const waiting = started && !row && !cancelled

  return (
    <GlassCard className="p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
        <Link2 size={ICON_SM} /> Add a LoRA from a link
      </h3>
      <p className="t-micro text-gray-500 dark:text-gray-400">
        Paste the link of a LoRA on civitai.com or of a .safetensors file on huggingface.co.
        LU reads what it is before anything is downloaded.
      </p>
      <div className="flex gap-2">
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void check() }}
          placeholder="https://civitai.com/models/... or https://huggingface.co/.../file.safetensors"
          aria-label="LoRA link"
          spellCheck={false}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-gray-400 dark:focus:border-white/20"
        />
        <button
          onClick={() => { void check() }}
          disabled={checking || !link.trim()}
          className="lu-tonal shrink-0"
        >
          {checking ? <Loader2 size={ICON_SM} className="animate-spin" /> : <Link2 size={ICON_SM} />} Check link
        </button>
      </div>

      {error && <Hinweis ton="fehler" onDismiss={() => setError(null)}>{error}</Hinweis>}

      {info && (
        <div className="p-3 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 space-y-2" data-testid="lora-link-info">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 dark:text-white break-words">{info.name}</p>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 t-micro text-gray-500 dark:text-gray-400">
                <dt>Base model</dt>
                <dd className="text-gray-700 dark:text-gray-200">{familyLabel(info)}</dd>
                <dt>Size</dt>
                <dd className="tabular-nums text-gray-700 dark:text-gray-200">{info.sizeBytes ? formatBytes(info.sizeBytes) : 'Not stated'}</dd>
                <dt>File</dt>
                <dd className="font-mono break-all text-gray-700 dark:text-gray-200">{info.filename}</dd>
                <dt>Check</dt>
                <dd className="text-gray-700 dark:text-gray-200">{info.sha256 ? 'SHA256 from the host, checked after the download' : 'The host states no SHA256, the file is not checked'}</dd>
              </dl>
            </div>
            <button
              onClick={() => openExternal(info.pageUrl)}
              title="View page"
              aria-label="View page"
              className="lu-control lu-control--icon shrink-0"
            >
              <ExternalLink size={ICON_SM} />
            </button>
          </div>

          {warnings.map((w) => (
            <Hinweis key={w} icon={<AlertTriangle size={ICON_SM} />}>{w}</Hinweis>
          ))}
          {nameTaken && (
            <Hinweis ton="fehler">A file called {info.filename} is already in the LoRA folder. Nothing was downloaded.</Hinweis>
          )}
          {noFolder && <Hinweis ton="fehler">The LoRA folder could not be read, so there is nowhere to put the file.</Hinweis>}

          {busy && row && (
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <ProgressBar progress={row.total > 0 ? (row.progress / row.total) * 100 : 0} />
                <span className="t-micro text-gray-400 tabular-nums">
                  {row.total > 0 ? `${formatBytes(row.progress)} / ${formatBytes(row.total)}` : 'Connecting...'}
                </span>
              </div>
              <button
                onClick={() => { void useDownloadStore.getState().cancel(info.filename) }}
                className="lu-control lu-control--outline shrink-0"
              >
                <X size={ICON_SM} /> Cancel
              </button>
            </div>
          )}
          {done && (
            <p className="flex items-center gap-1.5 t-micro text-gray-700 dark:text-gray-200" role="status">
              <CheckCircle size={ICON_SM} className="text-green-500" /> In the LoRA folder. It shows up in the LoRA stack in Create.
            </p>
          )}
          {failed && row?.error && <Hinweis ton="fehler">{row.error}</Hinweis>}

          {!busy && !done && !nameTaken && !noFolder && (
            <button onClick={() => { void download() }} disabled={waiting} className="lu-primary lu-control">
              {waiting ? <Loader2 size={ICON_SM} className="animate-spin" /> : <Download size={ICON_SM} />} {warnings.length > 0 ? 'Download anyway' : 'Download'}
              {info.sizeBytes ? ` (${formatBytes(info.sizeBytes)})` : ''}
            </button>
          )}
        </div>
      )}
    </GlassCard>
  )
}
