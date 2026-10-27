/**
 * A store build without the unfiltered catalogue does not keep working with
 * a model it does not list: not the active Cloud chat model, not the chosen
 * Create model. At the start and whenever a choice or a list changes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useCloudCatalogStore, defaultCloudModel } from '../../../stores/cloudCatalogStore'
import { useCreateStore } from '../../../stores/createStore'
import { useModelStore } from '../../../stores/modelStore'
import { setStorePresetForTests } from '../../policy/storePolicy'
import { enforceModelPolicy, listedCreatePick, unlistedChatModel } from '../models'

type Models = ReturnType<typeof useModelStore.getState>['models']
type Catalogue = ReturnType<typeof useCloudCatalogStore.getState>['models']

const CHAT = [
  { name: 'openai::local-3b', provider: 'openai', model: 'local-3b', providerName: 'LU Engine', size: 0, type: 'text' },
  { name: 'lu-cloud::plain', provider: 'lu-cloud', model: 'plain', providerName: 'LU Cloud', size: 0, type: 'text' },
  { name: 'lu-cloud::marked', provider: 'lu-cloud', model: 'marked', providerName: 'LU Cloud', size: 0, type: 'text', unfiltered: 'full' },
] as unknown as Models

const before = {
  model: useModelStore.getState(),
  create: useCreateStore.getState(),
  catalogue: useCloudCatalogStore.getState().models,
}

beforeEach(() => {
  useModelStore.setState({ models: CHAT, activeModel: null, lastCloudModel: null })
})

afterEach(() => {
  setStorePresetForTests(null)
  useModelStore.setState({ models: before.model.models, activeModel: before.model.activeModel, lastCloudModel: before.model.lastCloudModel })
  useCreateStore.setState({ cloudImageModel: before.create.cloudImageModel, cloudVideoModel: before.create.cloudVideoModel })
  useCloudCatalogStore.setState({ models: before.catalogue })
})

describe('the rules', () => {
  it('only a marked LU Cloud model is unlisted, and an unknown name is left alone', () => {
    expect(unlistedChatModel('lu-cloud::marked', CHAT)).toBe(true)
    expect(unlistedChatModel('lu-cloud::plain', CHAT)).toBe(false)
    // The second mark of the catalogue (the makers' statement) counts like the measured one.
    expect(unlistedChatModel('s', [{ name: 's', provider: 'lu-cloud', unrestricted: true }])).toBe(true)
    expect(unlistedChatModel('s', [{ name: 's', provider: 'lu-cloud', unrestricted: false }])).toBe(false)
    expect(unlistedChatModel('openai::local-3b', CHAT)).toBe(false)
    expect(unlistedChatModel('lu-cloud::not-in-the-list-yet', CHAT)).toBe(false)
    expect(unlistedChatModel(null, CHAT)).toBe(false)
    // A model on the phone is the user's own file; its mark is not judged here.
    expect(unlistedChatModel('x', [{ name: 'x', provider: 'openai', unfiltered: 'full' }])).toBe(false)
  })

  it('a Create pick marked adult falls back to the standard model, or to the first listed one when the standard is adult too', () => {
    const plain = { id: 'plain' }
    const other = { id: 'other' }
    const spicy = { id: 'spicy', adult: true }
    const byId = (id: string) => [plain, other, spicy].find((m) => m.id === id)
    expect(listedCreatePick('spicy', plain, [spicy, plain, other], byId)).toBe('')
    expect(listedCreatePick('other', plain, [spicy, plain, other], byId)).toBe('other')
    expect(listedCreatePick('', plain, [spicy, plain, other], byId)).toBe('')
    expect(listedCreatePick('spicy', spicy, [spicy, other, plain], byId)).toBe('other')
    expect(listedCreatePick('', spicy, [spicy, other, plain], byId)).toBe('other')
    expect(listedCreatePick('', spicy, [spicy], byId)).toBe('')
    // An id the catalogue does not know is not judged.
    expect(listedCreatePick('gone', plain, [plain], byId)).toBe('gone')
  })
})

describe('at the start and on every change', () => {
  const adultImage = () => useCloudCatalogStore.getState().models.find((m) => m.kind === 'image' && !m.ops && m.adult === true)

  it('the open build leaves every choice alone', () => {
    const spicy = adultImage()
    expect(spicy).toBeDefined()
    for (const preset of [null, 'open'] as const) {
      setStorePresetForTests(preset)
      useModelStore.setState({ activeModel: 'lu-cloud::marked', lastCloudModel: 'lu-cloud::marked' })
      useCreateStore.setState({ cloudImageModel: spicy!.id })
      enforceModelPolicy()
      expect(useModelStore.getState().activeModel).toBe('lu-cloud::marked')
      expect(useModelStore.getState().lastCloudModel).toBe('lu-cloud::marked')
      expect(useCreateStore.getState().cloudImageModel).toBe(spicy!.id)
    }
  })

  // Play since r56 (18.10.2026): the catalogue without refusals is off there too, so the same holds in both store builds.
  for (const store of ['play', 'appstore'] as const) {
    it(`${store}: what an earlier build left active is put down at the start`, () => {
      const spicy = adultImage()!
      expect(defaultCloudModel('image')?.adult).not.toBe(true)
      useModelStore.setState({ activeModel: 'lu-cloud::marked', lastCloudModel: 'lu-cloud::marked' })
      useCreateStore.setState({ cloudImageModel: spicy.id })
      setStorePresetForTests(store)
      enforceModelPolicy()
      expect(useModelStore.getState().activeModel).toBeNull()
      expect(useModelStore.getState().lastCloudModel).toBeNull()
      expect(useCreateStore.getState().cloudImageModel).toBe('')
    })

    it(`${store}: a later change is caught too (a backup, a draft, a list that arrives late), and listed models stay`, () => {
      setStorePresetForTests(store)
      enforceModelPolicy()

      useModelStore.getState().setActiveModel('lu-cloud::plain')
      expect(useModelStore.getState().activeModel).toBe('lu-cloud::plain')
      useModelStore.getState().setActiveModel('lu-cloud::marked')
      expect(useModelStore.getState().activeModel).toBeNull()
      expect(useModelStore.getState().lastCloudModel).not.toBe('lu-cloud::marked')
      useModelStore.getState().setActiveModel('openai::local-3b')
      expect(useModelStore.getState().activeModel).toBe('openai::local-3b')

      // The name is active before the list knows it: judged as soon as the list arrives.
      useModelStore.setState({ models: CHAT.slice(0, 2), activeModel: 'lu-cloud::marked' })
      expect(useModelStore.getState().activeModel).toBe('lu-cloud::marked')
      useModelStore.setState({ models: CHAT })
      expect(useModelStore.getState().activeModel).toBeNull()

      const spicy = adultImage()!
      useCreateStore.getState().setCloudImageModel(spicy.id)
      expect(useCreateStore.getState().cloudImageModel).toBe('')
      const plainVideo = useCloudCatalogStore.getState().models.find((m) => m.kind === 'video' && !m.ops && m.adult !== true)!
      useCreateStore.getState().setCloudVideoModel(plainVideo.id)
      expect(useCreateStore.getState().cloudVideoModel).toBe(plainVideo.id)

      // A catalogue that marks the chosen model as adult later on.
      const marked = useCloudCatalogStore.getState().models.map((m) => (m.id === plainVideo.id ? { ...m, adult: true } : m)) as Catalogue
      useCloudCatalogStore.setState({ models: marked })
      expect(useCreateStore.getState().cloudVideoModel).not.toBe(plainVideo.id)
    })
  }
})
