import { useState } from 'react'
import { Download, Puzzle, RotateCcw, Settings } from 'lucide-react'
import { installCustomNodes } from '../../api/discover'
import { restartComfyForNewNodes } from '../../api/comfy-restart'
import { FOREIGN_CODE_NOTICE, packsForMissingTypes } from '../../api/custom-node-packs'
import { isMlxImageHost } from '../../api/mlx-image'
import { useNodePackLog } from '../../hooks/useNodePackLog'
import { useUIStore } from '../../stores/uiStore'
import { Button } from './ui/Button'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Under a workflow import that named node types ComfyUI does not know: the
 * packs LU knows for them, with an install button, and the rest by name with
 * the way to the Git link field. A pack is only offered when LU's own
 * registry names it for that type; nothing is looked up elsewhere.
 */
export function MissingNodePacks({ types }: { types: string[] }) {
  const [phase, setPhase] = useState<'offer' | 'installing' | 'installed' | 'restarting' | 'restarted'>('offer')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const log = useNodePackLog()
  const openSettingsAt = useUIStore((s) => s.openSettingsAt)

  if (types.length === 0 || isMlxImageHost()) return null
  const { installable, unknown } = packsForMissingTypes(types)

  const install = async () => {
    setPhase('installing')
    setError('')
    await log.start()
    try {
      await installCustomNodes(installable.map((p) => p.key), { onProgress: setProgress })
      setPhase('installed')
    } catch (e) {
      setError(errorText(e))
      setPhase('offer')
    } finally {
      await log.stop()
    }
  }

  const restart = async () => {
    setPhase('restarting')
    setError('')
    try {
      await restartComfyForNewNodes()
      setPhase('restarted')
    } catch (e) {
      setError(errorText(e))
      setPhase('installed')
    }
  }

  return (
    <div
      className="mt-2.5 rounded-[var(--radius-control)] bg-white/[0.03] border border-white/[0.08] px-2.5 py-2 space-y-2"
      data-testid="missing-node-packs"
    >
      <div className="flex items-center gap-1.5">
        <Puzzle size={13} className="text-gray-500" />
        <span className="t-label text-gray-400">Missing node packs</span>
      </div>

      {installable.length > 0 && (
        <div className="space-y-1.5">
          <ul className="space-y-0.5">
            {installable.map((pack) => (
              <li key={pack.key} className="t-body text-gray-300">
                <span className="font-medium">{pack.name}</span>
                <span className="text-gray-500"> for {pack.types.join(', ')}</span>
              </li>
            ))}
          </ul>
          {phase === 'offer' && (
            <>
              <p className="t-body text-gray-500">{FOREIGN_CODE_NOTICE}</p>
              <Button variant="secondary" size="sm" icon={Download} onClick={() => void install()}>
                {installable.length === 1 ? `Install ${installable[0].name}` : `Install these ${installable.length} packs`}
              </Button>
            </>
          )}
          {phase === 'installing' && (
            <p className="t-body text-gray-400">{progress || 'Installing…'}</p>
          )}
          {log.lines.length > 0 && phase === 'installing' && (
            <div className="bg-black/40 rounded p-1.5 max-h-24 overflow-y-auto t-mono text-gray-500">
              {log.lines.slice(-6).map((line, i) => <div key={i} className="break-all">{line}</div>)}
            </div>
          )}
          {(phase === 'installed' || phase === 'restarting') && (
            <div className="space-y-1.5">
              <p className="t-body text-emerald-300">Installed. Restart ComfyUI to load the new nodes, then import the workflow again.</p>
              <Button
                variant="secondary"
                size="sm"
                icon={RotateCcw}
                loading={phase === 'restarting'}
                disabled={phase === 'restarting'}
                onClick={() => void restart()}
              >
                Restart ComfyUI
              </Button>
            </div>
          )}
          {phase === 'restarted' && (
            <p className="t-body text-emerald-300">ComfyUI restarted. Import the workflow again.</p>
          )}
        </div>
      )}

      {unknown.length > 0 && (
        <div className="space-y-1.5">
          <p className="t-body text-gray-400">
            LU does not know which pack brings {unknown.length === 1 ? 'this node' : 'these nodes'}:{' '}
            <span className="t-mono text-gray-300">{unknown.join(', ')}</span>. Find the pack that provides
            {unknown.length === 1 ? ' it' : ' them'} (the workflow&apos;s source usually names it) and paste its Git
            link under Settings, ComfyUI node packs.
          </p>
          <Button
            variant="ghost"
            size="sm"
            icon={Settings}
            onClick={() => openSettingsAt({ tab: 'backends', section: 'comfyui-nodes' })}
          >
            Open node packs
          </Button>
        </div>
      )}

      {error && <p className="t-body text-red-300 whitespace-pre-line">{error}</p>}
    </div>
  )
}
