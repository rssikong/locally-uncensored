/**
 * K6 Gallery, the tab "On my computer" (A17, `create-gallery`,
 * mobile-docs/remote/CREATE-V2.md): the gallery of the user's computer,
 * newest first, also what was made at the computer itself. Previews come
 * through the sealed channel (JPEG, at most 320 px); a tap brings the file
 * to this phone (pieces, SHA-256), puts it into the phone gallery and opens
 * it in the result view, where it plays, saves and shares like any result.
 * Nothing on the computer is deleted from here.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { AudioLines, Play } from 'lucide-react'
import { useCreateStore, type GalleryItem } from '../../../../stores/createStore'
import { nav } from '../../../nav'
import { COMPUTER_STRINGS as C, CREATE_STRINGS as T } from '../../../strings/create'
import { Button, EmptyState, Icon, Notice, Spinner, SkeletonCards, toast } from '../../../ui'
import {
  ComputerCreateError,
  fetchGalleryFile,
  fetchGalleryThumb,
  getGalleryEntry,
  listGallery,
  type ComputerGalleryItem,
} from '../../../remote/desktopCreate'
import { COMPUTER_ITEM_PREFIX, putComputerMedia } from './computer-media'
import { computerChannel } from './computer-source'
import { useNearViewport } from './ui'

/** The phone gallery id of an entry of the computer gallery. */
export function computerGalleryItemId(id: string): string {
  return `${COMPUTER_ITEM_PREFIX}g_${id}`
}

/** Previews of this run of the app, by entry id. */
const thumbs = new Map<string, string>()

function nameOf(item: ComputerGalleryItem): string {
  return item.prompt.slice(0, 48) || (item.media === 'audio' ? C.galleryAudio : T.gal.kind[item.media])
}

/** Pure: the phone gallery item for an entry whose bytes just came. */
export function phoneItemOf(item: ComputerGalleryItem, url: string): GalleryItem {
  return {
    id: computerGalleryItemId(item.id),
    type: item.media,
    filename: '',
    subfolder: '',
    prompt: item.prompt,
    negativePrompt: '',
    model: item.model,
    modelType: 'unknown',
    seed: 0,
    steps: 0,
    cfgScale: 0,
    sampler: '',
    scheduler: '',
    width: item.width ?? 0,
    height: item.height ?? 0,
    batchSize: 1,
    createdAt: item.createdAt > 0 ? item.createdAt * 1000 : Date.now(),
    intent: item.media === 'audio' ? 'music' : item.media,
    dataUrl: url,
  }
}

function errorText(err: unknown): string {
  return err instanceof ComputerCreateError ? err.message : err instanceof Error ? err.message : String(err)
}

interface TileProps {
  item: ComputerGalleryItem
  busy: boolean
  onOpen: (item: ComputerGalleryItem) => void
}

const Tile = memo(function Tile({ item, busy, onOpen }: TileProps) {
  const ref = useRef<HTMLDivElement>(null)
  const near = useNearViewport(ref)
  const [url, setUrl] = useState<string | null>(() => thumbs.get(item.id) ?? null)
  useEffect(() => {
    if (!near || url || item.media === 'audio') return
    const ch = computerChannel()
    if (!ch) return
    let alive = true
    void fetchGalleryThumb(ch, item.id)
      .then((bytes) => {
        if (!bytes) return
        const made = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
        thumbs.set(item.id, made)
        if (alive) setUrl(made)
      })
      .catch(() => {
        /* the tile stays without a preview; a tap still loads the file */
      })
    return () => {
      alive = false
    }
  }, [near, url, item.id, item.media])
  const name = nameOf(item)
  return (
    <div ref={ref} className="m-k-tile" data-testid="m-create-computer-gallery-tile" data-m-id={item.id} data-m-kind={item.media} data-state={busy ? 'loading' : url ? 'ok' : 'plain'}>
      <button type="button" className="m-k-tile-main" aria-label={C.galleryOpen(name)} aria-busy={busy || undefined} data-testid="m-create-computer-gallery-item" data-m-id={item.id} onClick={() => onOpen(item)}>
        {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : null}
        {item.media === 'audio' ? <Icon icon={AudioLines} /> : null}
        {busy ? <Spinner label={C.galleryFetching} /> : null}
      </button>
      {item.media !== 'image' ? (
        <span className="m-k-tile-badge">
          {item.media === 'video' ? <Play /> : <AudioLines />}
          {item.media === 'video' ? T.gal.kind.video : C.galleryAudio}
        </span>
      ) : null}
    </div>
  )
})

export function ComputerGallery() {
  const [items, setItems] = useState<ComputerGalleryItem[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'more' | 'error'>('loading')
  const [error, setError] = useState('')
  const [opening, setOpening] = useState<string | null>(null)

  const load = useCallback(async (before: string | null) => {
    const ch = computerChannel()
    if (!ch) {
      setState('error')
      setError('Your computer cannot be reached right now.')
      return
    }
    setState(before ? 'more' : 'loading')
    try {
      const page = await listGallery(ch, { before, limit: 30 })
      setItems((list) => (before ? [...list, ...page.items.filter((i) => !list.some((x) => x.id === i.id))] : page.items))
      setNext(page.next)
      setState('ok')
    } catch (err) {
      setError(errorText(err))
      setState('error')
    }
  }, [])

  useEffect(() => {
    void load(null)
  }, [load])

  const open = async (item: ComputerGalleryItem) => {
    if (opening) return
    const id = computerGalleryItemId(item.id)
    // Brought before: the phone has it (after a restart its bytes come from IndexedDB).
    if (useCreateStore.getState().gallery.some((g) => g.id === id)) {
      nav.push('/create/item/:id', { id })
      return
    }
    const ch = computerChannel()
    if (!ch) {
      toast('Your computer cannot be reached right now.', { tone: 'error', testid: 'create-computer-gallery-failed' })
      return
    }
    setOpening(item.id)
    try {
      const entry = item.sha256 ? item : await getGalleryEntry(ch, item.id)
      const bytes = await fetchGalleryFile(ch, entry)
      const blob = new Blob([bytes as BlobPart], { type: entry.mime })
      await putComputerMedia(id, blob)
      useCreateStore.getState().addToGallery(phoneItemOf(entry, URL.createObjectURL(blob)))
      nav.push('/create/item/:id', { id })
    } catch (err) {
      toast(errorText(err), { tone: 'error', testid: 'create-computer-gallery-failed' })
    } finally {
      setOpening(null)
    }
  }

  if (state === 'loading') return <SkeletonCards cards={2} label={C.galleryLoading} testid="m-create-computer-gallery-loading" />
  return (
    <div data-testid="m-create-computer-gallery" data-m-count={items.length}>
      {state === 'error' ? (
        <Notice
          variant="error"
          testid="m-create-computer-gallery-error"
          actions={
            <Button compact onPress={() => void load(items.length > 0 ? next : null)} testid="m-create-computer-gallery-retry">
              {C.retry}
            </Button>
          }
        >
          {error}
        </Notice>
      ) : null}
      {items.length === 0 && state !== 'error' ? (
        <EmptyState title={C.galleryComputer} testid="m-create-computer-gallery-empty">
          {C.galleryEmpty}
        </EmptyState>
      ) : (
        <div className="m-k-gal" style={{ paddingTop: 8 }} data-testid="m-create-computer-gallery-grid">
          {items.map((item) => (
            <Tile key={item.id} item={item} busy={opening === item.id} onOpen={(i) => void open(i)} />
          ))}
        </div>
      )}
      {next && state !== 'error' ? (
        <div className="m-k-sec">
          <Button block busy={state === 'more'} onPress={() => void load(next)} testid="m-create-computer-gallery-more">
            {C.galleryMore}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
