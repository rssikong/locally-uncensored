// The Image and Video lanes of the Model Manager on a Mac.
//
// Local media on macOS runs on Apple's own stack (MLX for video, diffusers on
// the Metal backend for images), never on ComfyUI, so the bundle grid the other
// platforms show has nothing to install into here. Until 3.0.6 these two lanes
// showed the engine panel out of Settings instead: one flat list, a purple
// button per row, and no way to tell an unfiltered model from a mainstream one
// except a chip. This is the same surface Chat has: the two catalogues behind
// one switch, tiles, a verdict against this Mac's memory, and Installed as its
// own view.

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ShieldCheck, Unlock, Sparkles, Cpu, Loader2, Image as ImageIcon, Video as VideoIcon, Music as MusicIcon, KeyRound, Download, X } from 'lucide-react'
import { HardwareChip, TILE_BAR, TILE_BAR_FILL, TILE_BUSY, TILE_CONTROL } from './ModelTiles'
import { MacMediaTile, memoryFit, type MacMediaTileState } from './MacMediaTile'
import { ModelEmptyState } from './ModelPageParts'
import { ModelGridSkeleton } from '../layout/ViewSkeletons'
import { Hinweis } from '../ui/Hinweis'
import { Modal } from '../ui/Modal'
import { ModalActions, ModalButton } from '../ui/ModalActions'
import { ICON_MD, ICON_SM } from '../ui/icon-size'
import { openExternal } from '../../api/backend'
import { getTotalRamGb } from '../../lib/hardware'
import { formatBytes } from '../../lib/formatters'
import { MAC_IMAGE_SETUP_SIZE, MAC_MUSIC_ENGINE_SIZE, MAC_VIDEO_ENGINE_SIZE } from '../../lib/mac-setup-sizes'
import { installedRowMatchesSearch } from '../../lib/model-search'
import { memoryNeedGb } from '../../lib/mac-memory-fit'
import type { MlxCatalogModel, MlxKind, MlxLane, MlxMedia } from '../../hooks/useMlxMedia'
import { mlxPercent, mlxProgressDetail, mlxProgressText } from '../../lib/mlx-progress'

const SEGMENT_TRACK =
  'inline-flex items-center gap-0.5 p-0.5 rounded-[calc(var(--radius-control)+2px)] '
  + 'bg-gray-100 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.06] '
  + 'flex-wrap'

type Catalogue = 'mainstream' | 'unfiltered'
/** Buckets by the memory a model needs, which is what decides it on a Mac. */
type MemoryTier = 'all' | 'fit' | 'light' | 'mid' | 'heavy'

const TIERS: { key: MemoryTier; label: string; desc: string; has: (minRamGB: number) => boolean }[] = [
  { key: 'all', label: 'All', desc: '', has: () => true },
  { key: 'light', label: 'Light', desc: 'up to 16 GB', has: (g) => g <= 16 },
  { key: 'mid', label: 'Medium', desc: '24 to 32 GB', has: (g) => g > 16 && g <= 32 },
  { key: 'heavy', label: 'Heavy', desc: '48 GB and up', has: (g) => g > 32 },
]

const NOUN: Record<MlxKind, string> = { image: 'image', video: 'video', music: 'music' }

/** What a lane makes, for the empty Installed view. */
const MADE: Record<MlxKind, string> = { image: 'Images', video: 'Videos', music: 'Tracks' }

function tileState(m: MlxCatalogModel, lane: MlxLane): MacMediaTileState {
  if (m.installed) return { kind: 'installed' }
  const running = lane.modelInstall
  if (running) {
    // A slot adopted from another page names no model. With one download
    // unaccounted for, every other tile waits; none of them claims it.
    if (running.modelId === m.id) return { kind: 'installing', percent: mlxPercent(running), detail: mlxProgressDetail(running) }
    return { kind: 'blocked', by: running.label }
  }
  if (lane.queuedId === m.id) return { kind: 'queued' }
  if (lane.queuedId) return { kind: 'blocked', by: lane.models.find((x) => x.id === lane.queuedId)?.name ?? 'Another model' }
  return { kind: 'idle' }
}

interface Props {
  kind: MlxKind
  media: MlxMedia
  tab: 'discover' | 'installed'
  search: string
  onGetNew: () => void
}

export function MacMediaLane({ kind, media, tab, search, onGetNew }: Props) {
  const lane = media[kind]
  const [catalogue, setCatalogue] = useState<Catalogue>('mainstream')
  const [tier, setTier] = useState<MemoryTier>('all')
  const [memoryGb, setMemoryGb] = useState<number | null>(null)
  const [removing, setRemoving] = useState<MlxCatalogModel | null>(null)

  useEffect(() => {
    getTotalRamGb().then((r) => { if (r > 0) setMemoryGb(r) }).catch(() => {})
  }, [])

  const matches = (m: MlxCatalogModel) => !search || installedRowMatchesSearch(`${m.name} ${m.repo}`, search)
  const LaneIcon = kind === 'image' ? ImageIcon : kind === 'music' ? MusicIcon : VideoIcon

  const grid = (models: MlxCatalogModel[]) => (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2.5">
      {models.map((m, i) => (
        <motion.div key={m.id} className="h-full" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.025 }}>
          <MacMediaTile
            model={m}
            memoryGb={memoryGb}
            state={tileState(m, lane)}
            onGet={() => media.get(kind, m)}
            onCancel={() => media.cancel(kind)}
            onRemove={() => setRemoving(m)}
            onOpenUrl={(u) => { void openExternal(u) }}
            cloudTask={kind}
          />
        </motion.div>
      ))}
    </div>
  )

  const removeModal = (
    <Modal open={!!removing} onClose={() => setRemoving(null)} title="Remove model">
      {removing && (
        <>
          <p className="text-[0.7rem] text-gray-600 dark:text-gray-300 mb-3">
            Remove <span className="text-gray-900 dark:text-white font-medium">{removing.name}</span>? This deletes its files
            from this Mac and frees {formatBytes(removing.sizeBytes)}. You can install it again at any time.
          </p>
          <ModalActions>
            <ModalButton variant="quiet" onClick={() => setRemoving(null)}>Cancel</ModalButton>
            <ModalButton
              variant="danger"
              onClick={() => {
                // The question is answered, so it closes, and the tile is
                // gone with it. Deleting many gigabytes is not something to
                // watch a disabled button for. A refusal brings the tile
                // back, with its reason on the lane.
                setRemoving(null)
                void media.remove(kind, removing.id)
              }}
            >
              Remove
            </ModalButton>
          </ModalActions>
        </>
      )}
    </Modal>
  )

  const errorLine = lane.error && (
    <Hinweis ton="fehler" onDismiss={() => media.clearError(kind)}>{lane.error}</Hinweis>
  )

  if (!media.loaded) return <ModelGridSkeleton />

  // ── Installed ─────────────────────────────────────────────────────
  if (tab === 'installed') {
    const installed = lane.models.filter((m) => m.installed)
    const shown = installed.filter(matches)
    return (
      <div className="space-y-4" data-testid={`mac-media-${kind}`} data-view="installed">
        {errorLine}
        {installed.length === 0 ? (
          <ModelEmptyState
            icon={<LaneIcon size={28} />}
            title={`No ${NOUN[kind]} models installed yet`}
            action={(
              <button onClick={onGetNew} className="lu-primary lu-control">
                <Sparkles size={ICON_SM} /> Get new {NOUN[kind]} models
              </button>
            )}
          >
            {MADE[kind]} are made on this Mac, with no server involved. Pick a model and it installs with one click.
          </ModelEmptyState>
        ) : (
          <>
            {grid(shown)}
            {shown.length === 0 && (
              <p className="text-center text-xs text-gray-500 dark:text-gray-400 py-6">No installed {NOUN[kind]} models match "{search}"</p>
            )}
          </>
        )}
        {removeModal}
      </div>
    )
  }

  // ── Get new ───────────────────────────────────────────────────────
  const inCatalogue = lane.models.filter((m) => (catalogue === 'unfiltered') === m.unfiltered)
  const tierDef = TIERS.find((t) => t.key === tier)
  const shown = inCatalogue
    .filter(matches)
    .filter((m) => (tier === 'fit' ? memoryFit(memoryNeedGb(m), memoryGb) !== 'big' : tierDef ? tierDef.has(memoryNeedGb(m)) : true))
  const counts = {
    mainstream: lane.models.filter((m) => !m.unfiltered).length,
    unfiltered: lane.models.filter((m) => m.unfiltered).length,
  }
  // The image setup pulls the starter model along (commands/mlx.rs).
  const engineSetup = kind === 'image'
    ? `A one-time setup of ${MAC_IMAGE_SETUP_SIZE}, the starter model SD Turbo included.`
    : `A one-time setup of ${MAC_VIDEO_ENGINE_SIZE}.`
  const Engine = kind === 'image' ? 'Image' : 'Video'
  const enginePercent = lane.engineInstall ? mlxPercent(lane.engineInstall) : null

  return (
    <div className="space-y-4" data-testid={`mac-media-${kind}`} data-view="discover">
      {/* One row for everything that narrows the list: which catalogue, how
          much memory. On the right what the list is measured against, the
          engine that runs it and, where the rail has no room for it, this
          Mac's memory. Narrow windows break the row between its groups. */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* One model on the music lane: nothing to narrow. */}
        {kind !== 'music' && (<>
        <div className={SEGMENT_TRACK} role="group" aria-label="Catalogue">
          <button onClick={() => setCatalogue('mainstream')} aria-pressed={catalogue === 'mainstream'} title="Well-known models from the big labs" className="lu-control">
            <ShieldCheck size={ICON_SM} /> Mainstream
            <span className="opacity-60 ml-1 tabular-nums">{counts.mainstream}</span>
          </button>
          <button onClick={() => setCatalogue('unfiltered')} aria-pressed={catalogue === 'unfiltered'} title="No filters, no limits" className="lu-control">
            <Unlock size={ICON_SM} /> Unfiltered
            <span className="opacity-60 ml-1 tabular-nums">{counts.unfiltered}</span>
          </button>
        </div>

        <div className={SEGMENT_TRACK} role="group" aria-label="Memory">
          {[
            TIERS[0],
            ...(memoryGb ? [{ key: 'fit' as MemoryTier, label: 'Fits my Mac', desc: `${Math.round(memoryGb)} GB` }] : []),
            ...TIERS.slice(1),
          ].map((t) => (
            <button key={t.key} onClick={() => setTier(t.key)} aria-pressed={tier === t.key} className="lu-control">
              {t.label}
              {t.desc && <span className="opacity-60 ml-1">{t.desc}</span>}
            </button>
          ))}
        </div>
        </>)}

        <div className="ml-auto flex items-center gap-3">
          {/* The engine when it is there: one quiet line. When it is not, the
              card below with its one button. */}
          {/* The music engine has no state of its own to show: it comes
              with the model, and the tile says whether that is installed. */}
          {!lane.unsupported && lane.engineReady && kind !== 'music' && (
            <p
              className="flex items-center gap-1.5 t-micro whitespace-nowrap text-gray-500 dark:text-gray-400"
              data-engine-state="ready"
              title={`${Engine} engine is set up. Models install with one click.`}
            >
              <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-emerald-500/80" />
              {Engine} engine ready
            </p>
          )}
          {/* From lg up this stands at the foot of the rail. */}
          <div className="lg:hidden">
            <HardwareChip vramGb={null} ramGb={memoryGb} sharedMemory />
          </div>
        </div>
      </div>

      {lane.unsupported && <Hinweis>{lane.unsupported}</Hinweis>}
      {errorLine}

      {/* A Get on any tile sets the engine up on the way, so this card is an
          offer and never a gate. It is the one filled accent of the lane. */}
      {!lane.unsupported && !lane.engineReady && (
        <div
          className="lu-tile lu-tile--lead flex items-center gap-3.5 p-3.5"
          data-engine-state={lane.engineInstall ? 'installing' : 'missing'}
        >
          <div className="shrink-0 rounded-lg p-2.5 bg-lu-accent-soft text-lu-accent-ink dark:text-lu-accent">
            <Cpu size={ICON_MD} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="t-title text-gray-900 dark:text-white">
              {lane.engineInstall ? `Setting up the ${NOUN[kind]} engine` : `Set up the ${NOUN[kind]} engine`}
            </p>
            <p className="mt-0.5 text-xs leading-snug text-gray-500 dark:text-gray-400">
              {lane.engineInstall
                ? (mlxProgressText(lane.engineInstall) || 'Setting up. This keeps running if you leave this page.')
                : `${engineSetup} It runs ${NOUN[kind]} models on this Mac's own chip. Get on any model sets it up first.`}
            </p>
            {enginePercent !== null && (
              <div className={`mt-2 max-w-sm ${TILE_BAR}`} aria-hidden="true">
                <div className={TILE_BAR_FILL} style={{ width: `${enginePercent}%` }} />
              </div>
            )}
          </div>
          {lane.engineInstall ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className={TILE_BUSY} role="status">
                <Loader2 size={ICON_SM} className="animate-spin" /> Setting up…
              </span>
              <button
                onClick={() => media.cancel(kind)}
                className={TILE_CONTROL}
                title="Stop the setup. What is already here is kept, so Set up picks up where it stopped."
                aria-label={`Stop setting up the ${NOUN[kind]} engine`}
              >
                <X size={ICON_SM} /> Stop
              </button>
            </div>
          ) : (
            <button onClick={() => media.setUpEngine(kind)} className="lu-primary lu-control shrink-0" disabled={!!lane.queuedId}>
              <Download size={ICON_SM} /> Set up
            </button>
          )}
        </div>
      )}

      {grid(shown)}

      {inCatalogue.length > 0 && shown.length === 0 && (
        <p className="text-center text-xs text-gray-500 dark:text-gray-400 py-4">
          {search ? `No ${catalogue} ${NOUN[kind]} models match "${search}"` : 'No models in this memory range. Try a different one.'}
        </p>
      )}

      <p className="flex items-start gap-1.5 pt-1 t-micro leading-relaxed text-gray-500 dark:text-gray-400">
        <KeyRound size={ICON_SM} className="mt-px shrink-0" />
        <span>
          Models download from Hugging Face. Without a token the downloads can be slower or rate limited.
          A free token goes under Hugging Face token in Settings, AI Backends.
          {kind === 'video' && ' Video models are large and a clip takes minutes, so start with a light one.'}
          {kind === 'music' && ` Get also sets up the music engine on the way, a one-time Python environment of ${MAC_MUSIC_ENGINE_SIZE} on disk.`}
        </span>
      </p>

      {removeModal}
    </div>
  )
}
