/**
 * Figur aus Fotos ohne Training und mehrere Bilder pro Lauf (02.10.2026, Web-
 * Paritaet; Vorlage: the web app).
 * Die Grenze je Modell ist die des Anbieter-Schemas, gedeckelt auf fuenf.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { STUDIO_MODELS, studioSchema } from '../studio-contract'
import { MAX_STUDIO_PHOTOS, referenceModel, startImageCount, studioExtraPhotoSlots, studioPhotoCap } from '../create-studio'
import { MAX_IMAGE_COUNT, bumpSeed, clampImageCount, imageCountApplies, runImageCount } from '../image-count'
import { MAX_EXTRA_REFERENCES, MAX_STORED_REFERENCES } from '../../edit-references'
import { useCloudCatalogStore } from '../../../stores/cloudCatalogStore'
import { neuerServer } from './fixtures/test-catalogs'

const CAPS: Record<string, number> = {
  'minimax-h3-ref': 5, 'wan-3.0-ref': 5,
  'qwen-image-2.1-edit': 5, 'qwen-image-3-edit': 3, 'minimax-h3-edit': 5, 'seedream-5-edit': 5,
}

beforeEach(() => { useCloudCatalogStore.setState({ models: neuerServer() }) })

describe('wie viele Fotos ein Modell liest', () => {
  it.each(Object.entries(CAPS))('%s nimmt %i Fotos', (id, cap) => {
    expect(studioPhotoCap(id)).toBe(cap)
    expect(studioExtraPhotoSlots(id)).toBe(cap - 1)
  })

  it('die Grenze kommt aus dem Schema und ist hoechstens fuenf', () => {
    for (const id of Object.keys(CAPS)) {
      const field = Object.entries(STUDIO_MODELS[id].inputs).find(([, k]) => k === 'image_paths')![0]
      expect(studioPhotoCap(id)).toBe(Math.min(studioSchema(id).properties![field].maxItems!, MAX_STUDIO_PHOTOS))
    }
    expect(MAX_STUDIO_PHOTOS).toBe(5)
  })

  it('der Speicher haelt so viele weitere Fotos, wie das groesste Modell neben dem Standbild liest, lokal oder in der Cloud', () => {
    expect(MAX_STORED_REFERENCES).toBe(Math.max(MAX_EXTRA_REFERENCES, MAX_STUDIO_PHOTOS - 1))
    expect(MAX_STORED_REFERENCES).toBe(9)
  })

  it('ein Modell mit einem einzelnen Bildfeld oder ohne Bild bietet keine Leiste', () => {
    expect(studioPhotoCap('ltx-2.5-i2v')).toBe(0)
    expect(studioPhotoCap('z-image')).toBe(0)
  })

  it('startImageCount zaehlt das Standbild und die Leistenfotos, nie ueber der Grenze', () => {
    expect(startImageCount('qwen-image-2.1-edit')).toBe(1)
    expect(startImageCount('qwen-image-2.1-edit', 2)).toBe(3)
    expect(startImageCount('qwen-image-2.1-edit', 40)).toBe(5)
    expect(startImageCount('qwen-image-3-edit', 4)).toBe(3)
    expect(startImageCount('ltx-2.5-i2v', 3)).toBe(1)
    expect(startImageCount('minimax-h3-ref', -2)).toBe(1)
  })
})

describe('welches Modell die Leiste meint', () => {
  const pick = (image: string, video: string) => ({ cloudImageModel: image, cloudVideoModel: video, cloudOpModel: '' })
  it('Bearbeiten und Animate loesen wie der Start auf', () => {
    expect(referenceModel('edit', pick('qwen-image-2.1-edit', ''))).toBe('qwen-image-2.1-edit')
    expect(referenceModel('animate', pick('', 'minimax-h3-ref'))).toBe('minimax-h3-ref')
    expect(referenceModel('animate', pick('', 'wan-3.0-ref'))).toBe('wan-3.0-ref')
  })
  it('ein Modell ohne Liste oder eine andere Unterkategorie zeigt keine Leiste', () => {
    expect(referenceModel('animate', pick('', 'ltx-2.5-i2v'))).toBeUndefined()
    expect(referenceModel('edit', pick('flux-dev', ''))).toBeUndefined()
    expect(referenceModel('image', pick('qwen-image-2.1-edit', 'minimax-h3-ref'))).toBeUndefined()
    expect(referenceModel('video', pick('qwen-image-2.1-edit', 'minimax-h3-ref'))).toBeUndefined()
  })
})

describe('Anzahl der Bilder', () => {
  it('die Grenze ist vier und die Klammer haelt sie', () => {
    expect(MAX_IMAGE_COUNT).toBe(4)
    expect([0, -3, NaN, undefined, '2', 2.9, 4, 40].map(clampImageCount)).toEqual([1, 1, 1, 1, 1, 2, 4, 4])
  })
  it('nur Bild und Bearbeiten kennen sie, nie die Figur mit Charakter', () => {
    expect(imageCountApplies('image')).toBe(true)
    expect(imageCountApplies('edit')).toBe(true)
    for (const i of ['video', 'animate', 'upscale', 'removebg', 'eraser', 'character', 'lipsync', 'music']) {
      expect(imageCountApplies(i)).toBe(false)
      expect(runImageCount(i, 4)).toBe(1)
    }
    expect(runImageCount('image', 3)).toBe(3)
    expect(runImageCount('image', 3, true)).toBe(1)
  })
  it('der Keim je Auftrag zaehlt hoch und laeuft nicht ueber den Anbieterwert', () => {
    expect(bumpSeed(5, 0)).toBe(5)
    expect(bumpSeed(5, 2)).toBe(7)
    expect(bumpSeed(2_147_483_646, 3)).toBeLessThan(2_147_483_647)
  })
})
