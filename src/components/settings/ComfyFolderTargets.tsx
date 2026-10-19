import { useEffect, useState } from 'react'
import { loadComfyFolderTargets, sourceLabel, type ComfyFolderTargets as Targets } from '../../lib/comfy-folder-targets'
import { HINWEIS_TEXT } from '../../lib/hinweis'

/**
 * GH #183: where LU puts ComfyUI models, input and output, one short line per
 * kind, with the file the folder came from. Read again when the ComfyUI path
 * or its running state changes, because both change the answer.
 */
export function ComfyFolderTargets({ path, running }: { path?: string | null; running?: boolean }) {
  const [targets, setTargets] = useState<Targets | null>(null)

  useEffect(() => {
    let cancelled = false
    loadComfyFolderTargets().then((t) => { if (!cancelled) setTargets(t) })
    return () => { cancelled = true }
  }, [path, running])

  if (!targets?.shown) return null
  return (
    <div className="space-y-0.5" data-testid="comfy-folder-targets">
      <span className="t-micro text-gray-700 dark:text-gray-400">Folders LU uses</span>
      {targets.models.map((row) => (
        <p key={row.key} className={`t-micro break-all ${HINWEIS_TEXT.ruhig}`}>
          <span className="text-gray-700 dark:text-gray-300">{row.key}</span>: <span className="font-mono">{row.dir}</span> ({sourceLabel(row.source)})
        </p>
      ))}
      <p className={`t-micro break-all ${HINWEIS_TEXT.ruhig}`}>
        <span className="text-gray-700 dark:text-gray-300">input</span>: <span className="font-mono">{targets.input}</span>
      </p>
      <p className={`t-micro break-all ${HINWEIS_TEXT.ruhig}`}>
        <span className="text-gray-700 dark:text-gray-300">output</span>: <span className="font-mono">{targets.output}</span>
      </p>
      {targets.problems.map((p) => (
        <p key={p} role="note" className={`t-micro break-all ${HINWEIS_TEXT.ruhig}`}>
          Not used: {p}
        </p>
      ))}
    </div>
  )
}
