import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * D3 (Discord feature-requests, 09.10.2026): the Create gallery sorted into
 * folders. A folder is a label in the app, never a place on disk: making,
 * renaming, removing and filing never touch a file, and removing a folder
 * hands its items back to "All". An older saved gallery without folders loads
 * as it always did.
 *
 * Run: npx vitest run src/stores/__tests__/createStore-gallery-folders.test.ts
 */

// zustand/persist reads window.localStorage when the module loads.
vi.hoisted(() => {
  const map = new Map<string, string>()
  const ls = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  }
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = ls
  const g = globalThis as unknown as { window?: Record<string, unknown> }
  g.window = Object.assign(g.window ?? {}, { localStorage: ls })
})

vi.mock('../../api/mlx-image', () => ({ isMlxImageHost: () => false, MLX_MODEL_PREFIX: 'MLX ' }))
const trash = vi.hoisted(() => vi.fn(async () => null))
vi.mock('../../lib/gallery-trash', () => ({ trashGalleryFile: trash }))

import { useCreateStore, type GalleryItem } from '../createStore'
import { folderCounts, itemsInFolder, sanitizeFolders, FOLDER_CAP, FOLDER_NAME_MAX } from '../../lib/gallery-folders'

const KEY = 'create-store'

function item(id: string, extra: Partial<GalleryItem> = {}): GalleryItem {
  return {
    id, type: 'image', filename: `${id}.png`, subfolder: '', prompt: id, negativePrompt: '',
    model: 'm.safetensors', modelType: 'sdxl', seed: 1, steps: 20, cfgScale: 5, sampler: 'euler',
    scheduler: 'normal', width: 512, height: 512, batchSize: 1, createdAt: 1, ...extra,
  }
}

const st = () => useCreateStore.getState()

beforeEach(() => {
  localStorage.clear()
  trash.mockClear()
  useCreateStore.setState({ backend: 'local', gallery: [], galleryFolders: [], galleryFolderOpen: null })
})

describe('gallery folders in the store', () => {
  it('makes a folder with a clean name and refuses an empty one', () => {
    const id = st().addGalleryFolder('  Portraits   of  May ')
    expect(id).toBeTruthy()
    expect(st().galleryFolders).toEqual([{ id, name: 'Portraits of May' }])
    expect(st().addGalleryFolder('   ')).toBeNull()
    expect(st().galleryFolders).toHaveLength(1)
  })

  it('cuts a long name and stops at the cap', () => {
    const id = st().addGalleryFolder('x'.repeat(200))!
    expect(st().galleryFolders.find((f) => f.id === id)!.name).toHaveLength(FOLDER_NAME_MAX)
    for (let i = 1; i < FOLDER_CAP; i++) st().addGalleryFolder(`f${i}`)
    expect(st().galleryFolders).toHaveLength(FOLDER_CAP)
    expect(st().addGalleryFolder('one more')).toBeNull()
  })

  it('renames a folder and keeps the old name for an empty one', () => {
    const id = st().addGalleryFolder('Old')!
    st().renameGalleryFolder(id, 'New')
    expect(st().galleryFolders[0].name).toBe('New')
    st().renameGalleryFolder(id, '  ')
    expect(st().galleryFolders[0].name).toBe('New')
  })

  it('files one or more items under a folder and back under none', () => {
    useCreateStore.setState({ gallery: [item('a'), item('b'), item('c')] })
    const id = st().addGalleryFolder('Set')!
    st().moveToGalleryFolder(['a', 'c'], id)
    expect(st().gallery.map((g) => g.folderId)).toEqual([id, undefined, id])
    st().moveToGalleryFolder(['a'], null)
    expect(st().gallery.map((g) => g.folderId)).toEqual([undefined, undefined, id])
  })

  it('does not file under a folder that does not exist', () => {
    useCreateStore.setState({ gallery: [item('a')] })
    st().moveToGalleryFolder(['a'], 'f-nope')
    expect(st().gallery[0].folderId).toBeUndefined()
  })

  it('removing a folder keeps every item and every file, they go back to All', () => {
    useCreateStore.setState({ gallery: [item('a'), item('b')] })
    const id = st().addGalleryFolder('Gone soon')!
    st().moveToGalleryFolder(['a', 'b'], id)
    st().setGalleryFolderOpen(id)
    st().removeGalleryFolder(id)
    expect(st().galleryFolders).toEqual([])
    expect(st().gallery.map((g) => g.id)).toEqual(['a', 'b'])
    expect(st().gallery.every((g) => g.folderId === undefined)).toBe(true)
    expect(st().galleryFolderOpen).toBeNull()
    expect(trash).not.toHaveBeenCalled()
  })

  it('the filter shows All or one folder, with counts', () => {
    useCreateStore.setState({ gallery: [item('a'), item('b'), item('c')] })
    const one = st().addGalleryFolder('One')!
    const two = st().addGalleryFolder('Two')!
    st().moveToGalleryFolder(['a', 'b'], one)
    st().moveToGalleryFolder(['c'], two)
    const g = st().gallery
    expect(itemsInFolder(g, null).map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(itemsInFolder(g, one).map((x) => x.id)).toEqual(['a', 'b'])
    expect(folderCounts(g).get(one)).toBe(2)
    expect(folderCounts(g).get(two)).toBe(1)
  })

  it('a new result lands in the open folder, and only there', () => {
    const id = st().addGalleryFolder('Project')!
    st().addToGallery(item('first'))
    st().setGalleryFolderOpen(id)
    st().addToGallery(item('second'))
    expect(st().gallery.find((g) => g.id === 'first')!.folderId).toBeUndefined()
    expect(st().gallery.find((g) => g.id === 'second')!.folderId).toBe(id)
    st().setGalleryFolderOpen('f-unknown')
    expect(st().galleryFolderOpen).toBeNull()
  })

  it('folders and the label on an item are saved, the open folder is not', () => {
    useCreateStore.setState({ gallery: [item('a')] })
    const id = st().addGalleryFolder('Kept')!
    st().moveToGalleryFolder(['a'], id)
    st().setGalleryFolderOpen(id)
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    expect(raw.state.galleryFolders).toEqual([{ id, name: 'Kept' }])
    expect(raw.state.gallery[0].folderId).toBe(id)
    expect(raw.state.galleryFolderOpen).toBeUndefined()
  })
})

describe('a saved gallery loads', () => {
  async function freshStoreFrom(state: Record<string, unknown>, version = 2) {
    localStorage.setItem(KEY, JSON.stringify({ state, version }))
    vi.resetModules()
    const mod = await import('../createStore')
    return mod.useCreateStore
  }

  it('an older gallery without folders loads unchanged, with no folders', async () => {
    const store = await freshStoreFrom({ mode: 'image', gallery: [item('old1'), item('old2')] })
    const s = store.getState()
    expect(s.gallery.map((g) => g.id)).toEqual(['old1', 'old2'])
    expect(s.galleryFolders).toEqual([])
    expect(s.galleryFolderOpen).toBeNull()
  })

  it('a saved folder list comes back, a damaged one is cleaned', async () => {
    const store = await freshStoreFrom({
      gallery: [item('a', { folderId: 'f-1' })],
      galleryFolders: [{ id: 'f-1', name: 'Good' }, { id: 7 }, 'junk', { id: 'f-1', name: 'Twice' }, { id: 'f-2', name: '   ' }],
      galleryFolderOpen: 'f-1',
    })
    const s = store.getState()
    expect(s.galleryFolders).toEqual([{ id: 'f-1', name: 'Good' }])
    expect(s.gallery[0].folderId).toBe('f-1')
    expect(s.galleryFolderOpen).toBeNull()
  })

  it('a folder list that is not a list reads as none', () => {
    expect(sanitizeFolders({ id: 'x' })).toEqual([])
    expect(sanitizeFolders(null)).toEqual([])
  })
})
