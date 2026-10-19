// "Use frames for a character" (Discord): the window takes a handful of
// frames spread evenly over the clip (8 by default, 4 to 20), the user unticks
// the ones that do not show the figure well and adds any frame by pausing on
// it. The ticked frames go straight into a training set in Character Studio,
// or are saved as a named character on this machine (lib/saved-characters),
// which can then go on to the reference strip as well.
import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Film, Loader2, UserRound, Images, X } from 'lucide-react'
import { useCreateStore, type GalleryItem } from '../../../stores/createStore'
import { isMlxImageHost } from '../../../api/mlx-image'
import { MAX_CHARACTER_NAME, MAX_CHARACTER_PHOTOS, saveCharacter, type SaveResult } from '../../../lib/saved-characters'
import { DEFAULT_EVEN_FRAMES, MAX_EVEN_FRAMES, MIN_EVEN_FRAMES, clampFrameCount, framesAcrossVideo, grabFrame } from '../../../lib/video-frames'
import { MIN_TRAIN_IMAGES } from '../../../lib/train-image-cap'
import { Modal } from '../../ui/Modal'
import { Button } from '../ui/Button'
import { fetchGalleryItemBlob, proxiedComfyBlobUrl } from './galleryUrl'
import { blobFromUrl } from '../../../lib/render/data-url'
import { isIntentAvailable } from './intents'
import { loadPhotosAsReferences, sendPhotosToStudio } from './characterPhotos'

interface Frame {
  url: string
  blob: Blob
  /** Ticked frames are the ones every action below uses. */
  picked: boolean
  /** Taken across the clip (replaced by the next "Take") or added by hand. */
  even: boolean
}

/** The clip as a blob: URL of the app's own origin, the only kind of video a
 *  canvas may read a frame back from. */
async function playableUrl(item: GalleryItem): Promise<string> {
  if (item.dataUrl?.startsWith('blob:')) {
    // A local MLX clip is one already. Copy it, so closing this window never
    // revokes the URL the gallery still plays.
    return URL.createObjectURL(await blobFromUrl(item.dataUrl))
  }
  try {
    return URL.createObjectURL(await fetchGalleryItemBlob(item))
  } catch (err) {
    // A ComfyUI that refuses the direct load still answers through the proxy.
    const proxied = await proxiedComfyBlobUrl(item)
    if (proxied) return proxied
    throw err
  }
}

export function SaveCharacterModal({ item, onClose }: { item: GalleryItem | null; onClose: () => void }) {
  return (
    <Modal open={!!item} onClose={onClose} title="Use frames for a character" maxWidth="max-w-2xl">
      {item && <SaveCharacterBody key={item.id} item={item} onClose={onClose} />}
    </Modal>
  )
}

/** The clip's file name without its extension, the name a training set gets
 *  when the user has not typed one. */
function clipName(item: GalleryItem): string {
  const base = item.filename.split(/[\\/]/).pop() ?? ''
  return base.replace(/\.[^.]+$/, '') || 'character'
}

function SaveCharacterBody({ item, onClose }: { item: GalleryItem; onClose: () => void }) {
  const backend = useCreateStore((s) => s.backend)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [frames, setFrames] = useState<Frame[]>([])
  const [count, setCount] = useState(DEFAULT_EVEN_FRAMES)
  const [taking, setTaking] = useState(false)
  const [name, setName] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<SaveResult | null>(null)
  // Every preview URL this window minted, given back when it closes.
  const minted = useRef<string[]>([])
  // The running "Take", stopped when the window closes or a new one starts.
  const takeRun = useRef<AbortController | null>(null)

  useEffect(() => {
    let alive = true
    const urls = minted.current
    void playableUrl(item).then((url) => {
      if (!alive) { URL.revokeObjectURL(url); return }
      urls.push(url)
      setSrc(url)
    }).catch((err: unknown) => {
      if (alive) setLoadError(`Could not load this video: ${err instanceof Error ? err.message : String(err)}`)
    })
    return () => {
      alive = false
      takeRun.current?.abort()
      for (const u of urls) URL.revokeObjectURL(u)
      urls.length = 0
    }
  }, [item])

  const keep = (blob: Blob, even: boolean): Frame => {
    const url = URL.createObjectURL(blob)
    minted.current.push(url)
    return { url, blob, picked: true, even }
  }

  /** Take `n` frames spread over the clip, in place of the last such set.
   *  Frames added by hand stay. */
  const takeFrames = async (url: string, n: number) => {
    takeRun.current?.abort()
    const run = new AbortController()
    takeRun.current = run
    setTaking(true)
    setNote(null)
    setSaved(null)
    setFrames((list) => list.filter((f) => !f.even))
    try {
      await framesAcrossVideo(url, n, {
        signal: run.signal,
        onFrame: (blob) => {
          if (run.signal.aborted) return
          setFrames((list) => (list.length >= MAX_CHARACTER_PHOTOS ? list : [...list, keep(blob, true)]))
        },
      })
    } catch (err) {
      if (!run.signal.aborted) setNote(err instanceof Error ? err.message : String(err))
    } finally {
      if (takeRun.current === run) {
        takeRun.current = null
        setTaking(false)
      }
    }
  }

  // The first set comes on its own once the clip is there.
  const firstTake = useRef(false)
  useEffect(() => {
    if (!src || firstTake.current) return
    firstTake.current = true
    void takeFrames(src, DEFAULT_EVEN_FRAMES)
    // takeFrames is recreated each render; the first set is taken once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  const picked = frames.filter((f) => f.picked)
  const full = frames.length >= MAX_CHARACTER_PHOTOS
  const addFrame = async () => {
    const video = videoRef.current
    if (!video || full) return
    video.pause()
    setNote(null)
    try {
      const blob = await grabFrame(video)
      setFrames((f) => [...f, keep(blob, false)])
      setSaved(null)
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    }
  }
  const toggle = (url: string) => {
    setFrames((list) => list.map((f) => (f.url === url ? { ...f, picked: !f.picked } : f)))
    setSaved(null)
  }

  const save = async () => {
    setBusy(true)
    setNote(null)
    try {
      setSaved(await saveCharacter(name, picked.map((f) => f.blob)))
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const mlx = isMlxImageHost()
  const canReference = isIntentAvailable('edit', backend, mlx)
  const canTrain = isIntentAvailable('character', backend, mlx)
  const asReferences = async () => {
    if (!saved) return
    setBusy(true)
    try {
      await loadPhotosAsReferences(saved.character.name, saved.character.photos)
      onClose()
    } catch (err) {
      setNote(`Could not load the photos: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }
  /** The ticked frames start a training set, no saving needed first. */
  const pickedToStudio = () => {
    if (picked.length === 0) return
    sendPhotosToStudio(name.trim() || clipName(item), picked.map((f) => f.blob))
    onClose()
  }
  const savedToStudio = () => {
    if (!saved) return
    sendPhotosToStudio(saved.character.name, saved.character.photos)
    onClose()
  }

  return (
    <div className="flex flex-col gap-3" data-testid="save-character">
      {loadError ? (
        <p className="t-body text-red-300">{loadError}</p>
      ) : !src ? (
        <div className="h-48 flex items-center justify-center t-control text-gray-400 gap-2"><Loader2 size={14} className="animate-spin" /> Loading the video…</div>
      ) : (
        <video ref={videoRef} src={src} controls loop muted playsInline className="w-full max-h-[calc(40vh/var(--ui-scale))] rounded-lg bg-black object-contain" />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 t-control text-gray-300">
          <span className="whitespace-nowrap">Frames across the clip</span>
          <input
            type="range"
            min={MIN_EVEN_FRAMES}
            max={MAX_EVEN_FRAMES}
            step={1}
            value={count}
            onChange={(e) => setCount(clampFrameCount(Number(e.target.value)))}
            aria-label="Frames across the clip"
            className="w-28 accent-gray-300"
          />
          <span className="w-5 text-right tabular-nums" data-testid="frame-count">{count}</span>
        </label>
        <div className="shrink-0 whitespace-nowrap">
          <Button variant="secondary" icon={Film} loading={taking} disabled={!src || busy} onClick={() => { if (src) void takeFrames(src, count) }}>
            {taking ? 'Taking frames…' : `Take ${count} frames`}
          </Button>
        </div>
        <div className="shrink-0 whitespace-nowrap">
          <Button variant="ghost" icon={Camera} disabled={!src || full || busy} onClick={() => { void addFrame() }}>Add this frame</Button>
        </div>
      </div>

      {frames.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2" data-testid="character-frames">
            {frames.map((f, i) => (
              <div key={f.url} className="relative w-20 h-20">
                <button
                  onClick={() => toggle(f.url)}
                  aria-pressed={f.picked}
                  aria-label={`${f.picked ? 'Untick' : 'Tick'} frame ${i + 1}`}
                  title={f.picked ? 'Used. Click to leave this frame out.' : 'Left out. Click to use this frame.'}
                  className="block w-20 h-20 rounded-lg overflow-hidden"
                >
                  <img
                    src={f.url}
                    alt={`frame ${i + 1}`}
                    className={`w-20 h-20 object-cover border rounded-lg transition-opacity ${f.picked ? 'border-white/40' : 'border-white/[0.06] opacity-35'}`}
                  />
                  {f.picked && (
                    <span className="absolute bottom-1 left-1 w-4 h-4 flex items-center justify-center rounded bg-black/70 text-gray-100"><Check size={10} /></span>
                  )}
                </button>
                <button
                  onClick={() => setFrames((list) => list.filter((x) => x.url !== f.url))}
                  className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-md bg-black/60 text-gray-300 hover:text-white"
                  title={`Remove frame ${i + 1}`}
                  aria-label={`Remove frame ${i + 1}`}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
          <p className="t-body text-gray-500" data-testid="frames-picked">
            {picked.length} of {frames.length} {frames.length === 1 ? 'frame' : 'frames'} ticked. Untick the ones that do not show the figure clearly.
            {full ? ` That is the most a character keeps (${MAX_CHARACTER_PHOTOS}).` : ''}
          </p>
        </>
      )}

      {canTrain && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={UserRound} disabled={picked.length === 0 || busy || taking} onClick={pickedToStudio}>
            Train with {picked.length} {picked.length === 1 ? 'frame' : 'frames'}
          </Button>
          <span className="t-body text-gray-500">
            {picked.length > 0 && picked.length < MIN_TRAIN_IMAGES && !saved
              ? `Training needs at least ${MIN_TRAIN_IMAGES} photos. You can add more in Character Studio.`
              : 'Opens Character Studio with these frames as the training set.'}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, MAX_CHARACTER_NAME))}
          placeholder="Character name"
          aria-label="Character name"
          className="flex-1 min-w-0 h-[var(--control-h-md)] px-2.5 rounded-[var(--radius-control)] bg-white/[0.04] border border-white/[0.08] focus:border-white/20 outline-none t-control text-gray-100"
        />
        <Button variant="secondary" loading={busy} disabled={picked.length === 0 || name.trim().length === 0 || taking || !!saved} onClick={() => { void save() }}>
          Save character
        </Button>
      </div>

      {note && <p className="t-body text-red-300" data-testid="save-character-note">{note}</p>}

      {saved && (
        <div className="flex flex-col gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] p-3" data-testid="character-saved">
          <p className="t-body text-gray-200">
            {saved.merged
              ? `Added ${saved.added} ${saved.added === 1 ? 'photo' : 'photos'} to ${saved.character.name}, ${saved.character.photos.length} in all.`
              : `Saved ${saved.character.name} with ${saved.added} ${saved.added === 1 ? 'photo' : 'photos'}.`}
            {saved.dropped > 0 ? ` ${saved.dropped} did not fit, a character keeps up to ${MAX_CHARACTER_PHOTOS}.` : ''}
            {' '}It is kept on this computer.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {canReference && (
              <Button variant="secondary" icon={Images} disabled={busy} onClick={() => { void asReferences() }}>Use as reference photos</Button>
            )}
            {canTrain && (
              <Button variant="secondary" icon={UserRound} disabled={busy} onClick={savedToStudio}>Train in Character Studio</Button>
            )}
          </div>
          {canTrain && saved.character.photos.length < MIN_TRAIN_IMAGES && (
            <p className="t-body text-gray-500">Training needs at least {MIN_TRAIN_IMAGES} photos. Add more frames or more photos there.</p>
          )}
        </div>
      )}
    </div>
  )
}
