/**
 * Fund F2 (05.10.2026, Vorlage: the web app):
 * Studio-Optionen gehoeren zu
 * dem Modell, fuer das sie gewaehlt wurden. Eine laengere Dauer oder eine
 * hoehere Aufloesung wandert bei keinem Wechsel still zum naechsten Modell mit.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const host = vi.hoisted(() => ({ mlx: false }))
vi.mock('../../api/mlx-image', () => ({ isMlxImageHost: () => host.mlx }))

import { useCreateStore, type GalleryItem } from '../createStore'
import { useCloudCatalogStore } from '../cloudCatalogStore'
import { createRunModel } from '../../lib/render/create-studio'
import { neuerServer } from '../../lib/render/__tests__/fixtures/test-catalogs'

const st = () => useCreateStore.getState()
const options = () => st().cloudStudioOptions

function item(model: string, type: 'image' | 'video'): GalleryItem {
  return {
    id: `job-${model}`, type, filename: '', subfolder: '', prompt: 'x', negativePrompt: '', model,
    modelType: 'unknown', seed: 0, steps: 1, cfgScale: 1, sampler: '', scheduler: '',
    width: 64, height: 64, batchSize: 1, createdAt: 1,
  } as GalleryItem
}

beforeEach(() => {
  host.mlx = false
  useCloudCatalogStore.setState({ models: neuerServer() })
  useCreateStore.setState({
    backend: 'cloud', cloudStudioOptions: {}, cloudImageModel: '', cloudVideoModel: '', cloudOpModel: '',
    cloudOpPicks: {}, characterTab: 'train', selectedCharacter: null, gallery: [],
  })
  st().setIntent('image')
})

describe('Studio-Optionen beim Modellwechsel', () => {
  it('Animate: 15 Sekunden auf MiniMax H3 gelten nach dem Wechsel auf Seedance 2.5 nicht weiter', () => {
    st().setIntent('animate')
    st().setCloudVideoModel('minimax-h3')
    st().setCloudStudioOptions({ duration: 15, resolution: '768p' })
    st().setCloudVideoModel('seedance-2.5')
    expect(options()).toEqual({})
  })

  it('Bild: 2K auf Qwen Image 2.1 gilt nach dem Wechsel des Bildmodells nicht weiter', () => {
    st().setCloudImageModel('qwen-image-2.1')
    st().setCloudStudioOptions({ resolution: '2k' })
    st().setCloudImageModel('z-image')
    expect(options()).toEqual({})
  })

  it('dasselbe Modell noch einmal gewaehlt behaelt die Einstellungen', () => {
    st().setCloudImageModel('qwen-image-2.1')
    st().setCloudStudioOptions({ resolution: '2k' })
    st().setCloudImageModel('qwen-image-2.1')
    expect(options()).toEqual({ resolution: '2k' })
  })

  it('der Wechsel der Unterkategorie faehrt ein anderes Modell und nimmt nichts mit', () => {
    st().setCloudImageModel('qwen-image-2.1')
    st().setCloudStudioOptions({ resolution: '2k' })
    const vorher = createRunModel('image', { image: 'qwen-image-2.1', video: '', op: '' })
    const nachher = createRunModel('edit', { image: 'qwen-image-2.1', video: '', op: '' })
    expect(nachher).not.toBe(vorher)
    st().setIntent('edit')
    expect(options()).toEqual({})
  })

  it('dieselbe Unterkategorie erneut gesetzt behaelt die Einstellungen', () => {
    st().setCloudImageModel('qwen-image-2.1')
    st().setCloudStudioOptions({ resolution: '2k' })
    st().setIntent('image')
    expect(options()).toEqual({ resolution: '2k' })
  })

  it('der Waehler der Spezialkategorien haelt dieselbe Regel', () => {
    st().setIntent('extend')
    st().setCloudOpModel('seedance-2.5-extend')
    st().setCloudStudioOptions({ duration: 10 })
    st().setCloudOpModel('seedance-2.5-extend')
    expect(options()).toEqual({ duration: 10 })
    st().setCloudOpModel('wan-3.0-extend')
    expect(options()).toEqual({})
  })

  it('ein Ergebnis des laufenden Modells stellt den Waehler und laesst die Einstellungen stehen', () => {
    st().setIntent('video')
    st().setCloudVideoModel('minimax-h3-t2v')
    st().setCloudStudioOptions({ duration: 10 })
    // Ein Studio-Eintrag ohne Katalogzwilling laesst den Waehler, wie er ist.
    st().addToGallery(item('minimax-h3-t2v', 'video'))
    expect(st().cloudVideoModel).toBe('minimax-h3-t2v')
    expect(options()).toEqual({ duration: 10 })
    // Bearbeiten: der Waehler haelt noch ein Text-zu-Bild-Modell, gefahren wird
    // der Editor. Das erste Ergebnis stellt den Waehler auf den Editor, das
    // Modell des Laufs bleibt dasselbe.
    st().setIntent('edit')
    st().setCloudImageModel('flux-schnell')
    const editor = createRunModel('edit', { image: 'flux-schnell', video: '', op: '' })
    st().setCloudStudioOptions({ resolution: '2k' })
    st().addToGallery(item(editor, 'image'))
    expect(createRunModel('edit', { image: st().cloudImageModel, video: '', op: '' })).toBe(editor)
    expect(options()).toEqual({ resolution: '2k' })
  })

  it('ein spaetes Ergebnis eines anderen Modells stellt den Waehler um und nimmt die Einstellungen nicht mit', () => {
    st().setIntent('video')
    st().setCloudVideoModel('ltx-2.5-t2v')
    st().setCloudStudioOptions({ duration: 10 })
    st().addToGallery(item('ltx-2', 'video'))
    expect(st().cloudVideoModel).toBe('ltx-2')
    expect(options()).toEqual({})
  })

  it('ein lokales Ergebnis ruehrt weder den Waehler noch die Einstellungen an', () => {
    st().setIntent('video')
    st().setCloudVideoModel('ltx-2.5-t2v')
    st().setCloudStudioOptions({ duration: 10 })
    useCreateStore.setState({ backend: 'local' })
    st().addToGallery(item('ltx-2', 'video'))
    expect(st().cloudVideoModel).toBe('ltx-2.5-t2v')
    expect(options()).toEqual({ duration: 10 })
  })

  // Nur im Desktop: jede Unterkategorie merkt sich ihre eigene Wahl
  // (cloudOpPicks), und der Speicher stellt cloudOpModel beim Wechsel selbst um.
  it('die gemerkte Wahl einer Unterkategorie kommt ohne fremde Einstellungen zurueck', () => {
    st().setIntent('extend')
    st().setCloudOpModel('wan-3.0-extend')
    st().setIntent('motion')
    st().setCloudStudioOptions({ duration: 10 })
    st().setIntent('extend')
    expect(st().cloudOpModel).toBe('wan-3.0-extend')
    expect(options()).toEqual({})
  })

  // Nur im Desktop: der Wechsel auf lokal schliesst die Unterkategorien, die es
  // nur in der Cloud gibt. Zurueck in der Cloud steht eine andere da.
  // Bis 3.0.7 stand hier Enhance Image. Das laeuft jetzt auch lokal und
  // bleibt beim Wechsel stehen; Erase Object ist das Werkzeug, das schliesst.
  it('der Wechsel auf lokal und zurueck traegt Einstellungen aus Erase Object nicht nach Edit', () => {
    st().setIntent('eraser')
    st().setCloudStudioOptions({ target_resolution: '2k' })
    st().setBackend('local')
    st().setBackend('cloud')
    expect(st().intent()).toBe('edit')
    expect(options()).toEqual({})
  })

  it('der Wechsel auf lokal und zurueck behaelt sie, wo die Unterkategorie bleibt', () => {
    st().setCloudImageModel('qwen-image-2.1')
    st().setCloudStudioOptions({ resolution: '2k' })
    st().setBackend('local')
    st().setBackend('cloud')
    expect(st().intent()).toBe('image')
    expect(options()).toEqual({ resolution: '2k' })
  })
})
