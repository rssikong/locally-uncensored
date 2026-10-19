// The Mac's local media catalogue as the Model Manager reads it: both engines,
// both model lists, and what is installing right now.
//
// What is installing is NOT held here. The install slots live in Rust and the
// titlebar tray already follows them through `mlxInstallStore`; this hook reads
// the same store, so a tile and the tray cannot tell two stories about one
// download, and an install started in Create or Settings shows up here too.

import { useCallback, useEffect, useRef, useState } from 'react'
import { mlxStatus, listMlxImageModels, deleteMlxImageModel, type MlxStatus, type MlxImageModel } from '../api/mlx-image'
import { getVideoStatus, listVideoModels, deleteVideoModel, type VideoStatus, type VideoModel } from '../api/mlx-video'
import { getMusicStatus, deleteMusicModel, musicCatalogModel, type MusicStatus } from '../api/mlx-music'
import { anyVideoEngineReady } from '../lib/video-engines'
import { anyImageEngineReady } from '../lib/image-engines'
import { installMlxEngine, installMlxModel, MlxInstallCancelled } from '../api/mlx-install'
import { useMlxInstallStore, mlxLaneGeneration, type MlxInstallEntry } from '../stores/mlxInstallStore'

export type MlxKind = 'image' | 'video' | 'music'

/** The fields both catalogues share, which is all a tile draws. */
export interface MlxCatalogModel {
  id: string
  name: string
  repo: string
  sizeBytes: number
  minRamGB: number
  /** Where the catalogue names it apart from `minRamGB` (video only). */
  recommendedRamGB?: number
  /** The text encoder a Get still fetches beside the model, in decimal GB
   *  (video only). 0 or absent: nothing comes on top of `sizeBytes`. */
  textEncoderGB?: number
  unfiltered: boolean
  description: string
  installed: boolean
  /** The engine family, which decides what a Get sets up first. */
  family?: string
}

export interface MlxLane {
  models: MlxCatalogModel[]
  engineReady: boolean
  /** A Mac that cannot run this lane at all, with the reason. Null: it can. */
  unsupported: string | null
  engineInstall: MlxInstallEntry | null
  modelInstall: MlxInstallEntry | null
  /** The model a Get click is waiting on while the engine installs first. */
  queuedId: string | null
  error: string | null
}

export interface MlxMedia {
  /** False until the first read of both catalogues has come back. */
  loaded: boolean
  image: MlxLane
  video: MlxLane
  /** The music engine (ACE-Step 1.5): one model, which brings its engine. */
  music: MlxLane
  /** What the two engines last reported about themselves: whether the image
   *  engine is running and which model it holds in memory, the video engine's
   *  version and where its files are. Null until read, or when a read failed. */
  engines: { image: MlxStatus | null; video: VideoStatus | null; music: MusicStatus | null }
  /** Install a model. Its tile says so at once, before the backend answers. */
  get: (kind: MlxKind, model: MlxCatalogModel) => void
  setUpEngine: (kind: MlxKind) => void
  /** Stop the model download of this lane. What it fetched is kept. The tile
   *  is back at once; a Stop the backend refused brings it back with a line. */
  cancel: (kind: MlxKind) => void
  /** Remove a model. Its tile is gone from Installed at once, and comes back
   *  with a line when the backend refused. */
  remove: (kind: MlxKind, id: string) => Promise<void>
  clearError: (kind: MlxKind) => void
  refresh: () => Promise<void>
}

const running = (e: MlxInstallEntry | undefined): MlxInstallEntry | null =>
  e && e.status === 'installing' ? e : null

interface Seen {
  engine: MlxStatus | null
  images: MlxImageModel[]
  video: VideoStatus | null
  videos: VideoModel[]
  music: MusicStatus | null
}

/** What the last read of the catalogues said. The Model Manager is mounted
 *  anew every time it is opened, and without this every opening drew a
 *  skeleton until four commands had answered. It is drawn from here at once
 *  and read again behind that. */
let lastSeen: Seen | null = null

/** For tests: start from a page that has read nothing yet. */
export function forgetMlxMediaForTest() {
  lastSeen = null
}

const withoutRemoved = <T extends { id: string; installed: boolean }>(models: T[], removed: string[]): T[] =>
  removed.length === 0 ? models : models.map((m) => (removed.includes(m.id) ? { ...m, installed: false } : m))

export function useMlxMedia(enabled: boolean): MlxMedia {
  const [engine, setEngine] = useState<MlxStatus | null>(lastSeen?.engine ?? null)
  const [images, setImages] = useState<MlxImageModel[]>(lastSeen?.images ?? [])
  const [video, setVideo] = useState<VideoStatus | null>(lastSeen?.video ?? null)
  const [videos, setVideos] = useState<VideoModel[]>(lastSeen?.videos ?? [])
  const [music, setMusic] = useState<MusicStatus | null>(lastSeen?.music ?? null)
  const [loaded, setLoaded] = useState(lastSeen !== null)
  // The model a Get waits on, with the count of Stops its lane had then. A
  // Stop since, on the tile or in the download tray, makes it void in the
  // same render, and not a poll later when the run behind it notices.
  const [queued, setQueued] = useState<Record<MlxKind, { id: string; stops: number } | null>>({ image: null, video: null, music: null })
  const [errors, setErrors] = useState<Record<MlxKind, string | null>>({ image: null, video: null, music: null })
  // Models whose Remove was clicked and is not through yet.
  const [removed, setRemoved] = useState<Record<MlxKind, string[]>>({ image: [], video: [], music: [] })
  // Which Get of a lane is the current one. A Stop, and the next Get, make
  // the one before it old, and an old one must not clear what a new one set.
  const run = useRef<Record<MlxKind, number>>({ image: 0, video: 0, music: 0 })
  const entries = useMlxInstallStore((s) => s.entries)
  const stopCount = useMlxInstallStore((s) => s.stopCount)
  const queuedId = (kind: MlxKind) => (queued[kind] && queued[kind].stops === stopCount[kind] ? queued[kind].id : null)

  const refresh = useCallback(async () => {
    const [e, i, v, vm, mu] = await Promise.all([
      mlxStatus().catch(() => null),
      listMlxImageModels().catch(() => [] as MlxImageModel[]),
      getVideoStatus().catch(() => null),
      listVideoModels().catch(() => [] as VideoModel[]),
      getMusicStatus().catch(() => null),
    ])
    lastSeen = { engine: e, images: i, video: v, videos: vm, music: mu }
    setEngine(e)
    setImages(i)
    setVideo(v)
    setVideos(vm)
    setMusic(mu)
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!enabled) return
    // The writes sit behind four awaits inside `refresh`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    // An install somebody else started (Create, Settings, the last session).
    void useMlxInstallStore.getState().adopt()
  }, [enabled, refresh])

  // A slot that reaches its end changes what is installed: read again. Keyed
  // on the statuses, so progress ticks do not re-read the catalogue.
  const statusKey = (['image-engine', 'image-model', 'video-engine', 'video-model', 'music-model'] as const)
    .map((k) => entries[k]?.status ?? '-')
    .join('|')
  const lastKey = useRef(statusKey)
  useEffect(() => {
    if (!enabled || lastKey.current === statusKey) return
    lastKey.current = statusKey
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [enabled, statusKey, refresh])

  const fail = (kind: MlxKind, e: unknown) => {
    if (e instanceof MlxInstallCancelled) return
    setErrors((s) => ({ ...s, [kind]: e instanceof Error ? e.message : String(e) }))
  }

  const get = useCallback((kind: MlxKind, model: MlxCatalogModel, engineReady: boolean) => {
    const mine = ++run.current[kind]
    setErrors((s) => ({ ...s, [kind]: null }))
    setQueued((s) => ({ ...s, [kind]: { id: model.id, stops: mlxLaneGeneration(kind) } }))
    installMlxModel(kind, model, undefined, { engineReady })
      .catch((e) => fail(kind, e))
      .finally(() => {
        if (run.current[kind] === mine) setQueued((s) => ({ ...s, [kind]: null }))
        void refresh()
      })
  }, [refresh])

  const setUpEngine = useCallback((kind: MlxKind) => {
    // The music engine installs with its model's Get and has no setup alone.
    if (kind === 'music') return
    setErrors((s) => ({ ...s, [kind]: null }))
    installMlxEngine(kind)
      .catch((e) => fail(kind, e))
      .finally(() => { void refresh() })
  }, [refresh])

  const cancel = useCallback((kind: MlxKind) => {
    // The tile is back before the backend has heard of it: the store takes
    // the rows of the lane away in this call and counts the Stop, which is
    // what voids the queue above.
    useMlxInstallStore.getState().stop(kind)
      .catch((e) => fail(kind, e))
      .finally(() => { void refresh() })
  }, [refresh])

  const remove = useCallback(async (kind: MlxKind, id: string) => {
    setErrors((s) => ({ ...s, [kind]: null }))
    setRemoved((s) => ({ ...s, [kind]: [...s[kind], id] }))
    try {
      if (kind === 'image') await deleteMlxImageModel(id)
      else if (kind === 'music') await deleteMusicModel()
      else await deleteVideoModel(id)
    } catch (e) {
      fail(kind, e)
    }
    // What the disk says now, and only then is the guess dropped: refused,
    // the tile is installed again; removed, the list no longer has it.
    await refresh()
    setRemoved((s) => ({ ...s, [kind]: s[kind].filter((x) => x !== id) }))
  }, [refresh])

  const clearError = useCallback((kind: MlxKind) => setErrors((s) => ({ ...s, [kind]: null })), [])

  return {
    loaded,
    image: {
      models: withoutRemoved(images, removed.image),
      // `installed` is the finished engine. A venv whose pip run never ended
      // reads false here, so the setup button comes back and repairs it.
      // Either engine counts: the second one comes with the first mflux
      // pack, and a Mac that has only that is not waiting for a setup.
      engineReady: anyImageEngineReady(engine),
      unsupported: engine?.unsupported ?? null,
      engineInstall: running(entries['image-engine']),
      modelInstall: running(entries['image-model']),
      queuedId: queuedId('image'),
      error: errors.image,
    },
    video: {
      models: withoutRemoved(videos, removed.video),
      // Either engine counts. The second one comes with the first quantized
      // LTX pack, and a Mac that has only that is not waiting for a setup.
      engineReady: anyVideoEngineReady(video),
      unsupported: video && !video.appleSilicon
        ? 'Local video needs Apple Silicon. On this Mac, video generation is available in LU Cloud.'
        : null,
      engineInstall: running(entries['video-engine']),
      modelInstall: running(entries['video-model']),
      queuedId: queuedId('video'),
      error: errors.video,
    },
    music: {
      models: withoutRemoved(music ? [musicCatalogModel(music.model)] : [], removed.music),
      // The engine comes with the model's Get, so there is no setup to offer.
      engineReady: true,
      unsupported: music && !music.appleSilicon
        ? 'Local music needs a Mac with Apple Silicon.'
        : null,
      engineInstall: null,
      modelInstall: running(entries['music-model']),
      queuedId: queuedId('music'),
      error: errors.music,
    },
    engines: { image: engine, video, music },
    // What the lane last knew about its engine decides which row a Get shows
    // first, the engine's or the model's. The backend is asked right after.
    get: (kind, model) => get(kind, model, kind === 'image' ? !!engine?.installed : kind === 'music' || !!video?.mlxInstalled),
    setUpEngine,
    cancel,
    remove,
    clearError,
    refresh,
  }
}
