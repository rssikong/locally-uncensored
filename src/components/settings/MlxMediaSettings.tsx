// Local media on a Mac, as far as it belongs in Settings.
//
// Until 3.0.6 this panel was also the model list: one flat row per image and
// video model with its own install and remove buttons, its own polling of the
// Rust install slots and its own copy of the progress line. The Model Manager
// has the catalogue now (models/MacMediaLane), with tiles, the two catalogues
// and a verdict against this Mac's memory, and two lists of the same models
// told two stories about one download. What stays here is what a settings
// page is for: the state of the two engines, the memory an idle model holds,
// where the files are, the Hugging Face token, and the way to the models.
//
// Nothing is polled here. Engine state, the install slots and their errors
// come from `useMlxMedia`, the same hook the Model Manager reads, so an engine
// set up here shows up there and the other way round.

import { useEffect, useState } from 'react'
import { Check, Cpu, Download, FolderOpen, HardDrive, KeyRound, Layers, Loader2, Boxes, MemoryStick } from 'lucide-react'
import { mlxUnload, hfTokenPresent } from '../../api/mlx-image'
import { useMlxMedia, type MlxLane } from '../../hooks/useMlxMedia'
import { useMlxLoras } from '../../hooks/useMlxLoras'
import { openMlxLoraFolder, MAC_LORA_MODELS } from '../../api/mlx-loras'
import { useUIStore } from '../../stores/uiStore'
import { useModelStore } from '../../stores/modelStore'
import { mlxProgressText } from '../../lib/mlx-progress'
import { formatBytes, countLabel } from '../../lib/formatters'
import { MAC_IMAGE_SETUP_SIZE, MAC_VIDEO_ENGINE_SIZE } from '../../lib/mac-setup-sizes'
import { Hinweis } from '../ui/Hinweis'
import { ICON_SM } from '../ui/icon-size'

const ROW = 'flex items-center gap-3 p-2.5 rounded-[var(--radius-control)] border border-gray-200 dark:border-white/[0.06]'
const ROW_TITLE = 't-control text-gray-800 dark:text-gray-200'
const ROW_TEXT = 't-micro leading-relaxed text-gray-500 dark:text-gray-400 mt-1'

/** What a first setup fetches. The image setup pulls the starter model along
 *  (commands/mlx.rs), the same sentence the Model Manager uses. */
const ENGINE_SETUP: Record<'image' | 'video', string> = {
  image: `Not set up. A one-time setup of ${MAC_IMAGE_SETUP_SIZE}, the starter model SD Turbo included.`,
  video: `Not set up. A one-time setup of ${MAC_VIDEO_ENGINE_SIZE}.`,
}

export function MlxMediaSettings() {
  const media = useMlxMedia(true)
  const loras = useMlxLoras(true)
  const setView = useUIStore((s) => s.setView)
  const setCategoryFilter = useModelStore((s) => s.setCategoryFilter)
  const [freeing, setFreeing] = useState(false)
  const [freeError, setFreeError] = useState<string | null>(null)
  const [tokenSet, setTokenSet] = useState<boolean | null>(null)

  useEffect(() => {
    hfTokenPresent().then(setTokenSet).catch(() => setTokenSet(null))
  }, [])

  const imageEngine = media.engines.image
  const videoEngine = media.engines.video
  const loadedRepo = imageEngine?.modelLoaded ? (imageEngine.modelRepo ?? 'An image model') : null

  const installed = [...media.image.models, ...media.video.models].filter((m) => m.installed)
  const installedBytes = installed.reduce((sum, m) => sum + m.sizeBytes, 0)

  const freeMemory = async () => {
    setFreeing(true)
    setFreeError(null)
    try {
      await mlxUnload()
    } catch (e) {
      setFreeError(e instanceof Error ? e.message : String(e))
    } finally {
      await media.refresh()
      setFreeing(false)
    }
  }

  const engineState = (kind: 'image' | 'video'): string => {
    if (kind === 'image') {
      if (imageEngine?.broken) return 'The engine on this Mac is incomplete. Setting it up again repairs it.'
      if (!imageEngine?.installed) {
        // Only the second engine is here. It came with a quantized pack, and
        // the first one comes with the first model that needs it.
        return imageEngine?.mfluxInstalled
          ? `Set up for the quantized MLX packs, mflux ${imageEngine.mfluxVersion ?? ''}`.trim() + '. The other models bring their engine with the first Get.'
          : ENGINE_SETUP.image
      }
      // The engine's own account of why it stopped, until the next start.
      if (imageEngine.startError) return `Set up, but it stopped: ${imageEngine.startError}`
      return imageEngine.running ? 'Set up and running.' : 'Set up. It starts with the first image.'
    }
    if (!videoEngine?.mlxInstalled) return ENGINE_SETUP.video
    return videoEngine.mlxVersion ? `Set up, MLX ${videoEngine.mlxVersion}.` : 'Set up.'
  }

  const engineRow = (kind: 'image' | 'video', lane: MlxLane) => (
    <div className={ROW} data-mlx-engine={kind} data-engine-state={lane.engineInstall ? 'installing' : lane.engineReady ? 'ready' : 'missing'}>
      <Cpu size={ICON_SM} className="shrink-0 text-gray-400 dark:text-gray-500" />
      <div className="flex-1 min-w-0">
        <p className={ROW_TITLE}>{kind === 'image' ? 'Image engine' : 'Video engine'}</p>
        <p className={ROW_TEXT}>
          {lane.unsupported
            ?? (lane.engineInstall
              ? (mlxProgressText(lane.engineInstall) || 'Setting up. This keeps running if you close Settings.')
              : engineState(kind))}
        </p>
      </div>
      {lane.unsupported ? null : lane.engineReady ? (
        <Check size={ICON_SM} className="shrink-0 text-emerald-500/80" aria-hidden="true" />
      ) : lane.engineInstall ? (
        <span className="flex items-center gap-1.5 h-[var(--control-h-sm)] px-2 t-micro text-gray-500 dark:text-gray-400 shrink-0" role="status">
          <Loader2 size={ICON_SM} className="animate-spin" /> Setting up…
        </span>
      ) : (
        <button onClick={() => media.setUpEngine(kind)} className="lu-control shrink-0" disabled={!!lane.queuedId} aria-label={`Set up the ${kind} engine`}>
          <Download size={ICON_SM} /> Set up
        </button>
      )}
    </div>
  )

  return (
    <div className="space-y-2.5" data-testid="mlx-media-settings">
      <p className="t-micro leading-relaxed text-gray-500 dark:text-gray-400">
        Images and video are made on this Mac with Apple MLX, with no server involved. Each engine is a one-time setup.
      </p>

      {media.image.error && <Hinweis ton="fehler" onDismiss={() => media.clearError('image')}>{media.image.error}</Hinweis>}
      {media.video.error && <Hinweis ton="fehler" onDismiss={() => media.clearError('video')}>{media.video.error}</Hinweis>}
      {freeError && <Hinweis ton="fehler" onDismiss={() => setFreeError(null)}>{freeError}</Hinweis>}

      {engineRow('image', media.image)}
      {engineRow('video', media.video)}

      {/* The models themselves live in the Model Manager. */}
      <div className={ROW} data-mlx-row="models">
        <Boxes size={ICON_SM} className="shrink-0 text-gray-400 dark:text-gray-500" />
        <div className="flex-1 min-w-0">
          <p className={ROW_TITLE}>Models</p>
          <p className={ROW_TEXT}>
            {!media.loaded
              ? 'Reading your installed models…'
              : installed.length === 0
                ? 'None installed yet. Image and video models are installed and removed in the Model Manager.'
                : `${countLabel(installed.length, 'model')} installed, ${formatBytes(installedBytes)}. Install and remove them in the Model Manager.`}
          </p>
        </div>
        <button
          onClick={() => { setCategoryFilter('image'); setView('models') }}
          className="lu-control shrink-0"
        >
          Manage models
        </button>
      </div>

      {/* The image engine keeps its last model in memory for a while, so the
          next picture starts at once. On a Mac that is memory every other app
          shares; this hands it back without stopping the engine. */}
      <div className={ROW} data-mlx-row="memory">
        <MemoryStick size={ICON_SM} className="shrink-0 text-gray-400 dark:text-gray-500" />
        <div className="flex-1 min-w-0">
          <p className={ROW_TITLE}>Memory</p>
          <p className={ROW_TEXT}>
            {loadedRepo
              ? `${loadedRepo} is loaded and holds memory. The engine lets go of it on its own after a while.`
              : 'No image model is held in memory right now.'}
          </p>
        </div>
        <button onClick={() => { void freeMemory() }} className="lu-control shrink-0" disabled={!loadedRepo || freeing}>
          {freeing && <Loader2 size={ICON_SM} className="animate-spin" />} Free memory
        </button>
      </div>

      {videoEngine?.modelsRoot && (
        <div className={ROW} data-mlx-row="storage">
          <HardDrive size={ICON_SM} className="shrink-0 text-gray-400 dark:text-gray-500" />
          <div className="flex-1 min-w-0">
            <p className={ROW_TITLE}>Storage</p>
            <p className={ROW_TEXT}>Video models</p>
            <p className="t-micro font-mono text-gray-600 dark:text-gray-300 break-all">{videoEngine.modelsRoot}</p>
            {videoEngine.outputsRoot && (
              <>
                <p className={ROW_TEXT}>Videos you make</p>
                <p className="t-micro font-mono text-gray-600 dark:text-gray-300 break-all">{videoEngine.outputsRoot}</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* The LoRAs of the image engine are files in a folder of the app. This
          is where it is, and the way into it. */}
      <div className={ROW} data-mlx-row="loras">
        <Layers size={ICON_SM} className="shrink-0 text-gray-400 dark:text-gray-500" />
        <div className="flex-1 min-w-0">
          <p className={ROW_TITLE}>LoRAs</p>
          <p className={ROW_TEXT}>
            {!loras.loaded
              ? 'Reading your LoRA folder…'
              : loras.loras.length === 0
                ? `None yet. Put .safetensors files into this folder. The LoRA stack in Create lists them for ${MAC_LORA_MODELS}.`
                : `${countLabel(loras.loras.length, 'LoRA')} in this folder. The LoRA stack in Create lists them for ${MAC_LORA_MODELS}.`}
          </p>
          {loras.dir && <p className="t-micro font-mono text-gray-600 dark:text-gray-300 break-all">{loras.dir}</p>}
        </div>
        <button
          onClick={() => { setFreeError(null); openMlxLoraFolder().catch((e) => setFreeError(e instanceof Error ? e.message : String(e))) }}
          className="lu-control shrink-0"
        >
          <FolderOpen size={ICON_SM} /> Open folder
        </button>
      </div>

      {/* F4 (301-Liste): the models download from huggingface.co. The hint
          carries no number: the comparison with and without a token was never
          measured, and it is not invented here. */}
      <Hinweis icon={<KeyRound size={ICON_SM} className="mt-px shrink-0" />}>
        {tokenSet === true ? 'A Hugging Face token is set. ' : tokenSet === false ? 'No Hugging Face token is set. ' : ''}
        These models download from Hugging Face. Anonymous downloads can be slower or rate limited;
        a free Hugging Face token avoids that. It goes under Hugging Face token, one section up.
      </Hinweis>
    </div>
  )
}
