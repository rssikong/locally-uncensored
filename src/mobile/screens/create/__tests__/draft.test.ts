/**
 * Prompt and inputs survive a restart: what the create store held is written,
 * and a fresh store gets it back. What the user does now always wins.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pending = vi.hoisted(() => ({ jobs: [] as Array<{ id: string; landing: string }> }))
vi.mock('../../../../lib/pending-cloud-jobs', () => ({ pendingCloudJobs: () => pending.jobs }))

import { DRAFT_KEY, memoryDraftFiles, type DraftFileStore } from '../../../../lib/create-draft'
import { useCreateStore, type ImageRef, type MediaRef } from '../../../../stores/createStore'
import { __resetCreateDraftForTests, flushCreateDraft, forgetCreateDraft, installCreateDraft, restoreCreateDraft } from '../parts/draft'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const image = (name: string): ImageRef => ({ filename: name, url: PNG, width: 64, height: 48 })
const media = (name: string): MediaRef => ({ name, url: `blob:${name}`, blob: new Blob([name], { type: 'image/jpeg' }) })

function storage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() { return map.size },
  } as Storage
}

/** The store as a fresh start of the app finds it. */
function freshStart(): void {
  __resetCreateDraftForTests()
  useCreateStore.setState({
    backend: 'cloud', isGenerating: false, error: null, prompt: '', negativePrompt: '', musicLyrics: '', source: null, mask: null, references: [],
    trainImages: [], audioInput: null, videoInput: null, voiceFromJob: null, extendSource: null, selectedCharacter: null, cloudImageCount: 1,
    cloudImageModel: '', cloudVideoModel: '', cloudOpModel: '',
  })
  useCreateStore.getState().setIntent('image')
}

let store: Storage
let files: DraftFileStore

beforeEach(() => {
  vi.useRealTimers()
  store = storage()
  files = memoryDraftFiles()
  freshStart()
  if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:restored'
})

/** Write now instead of waiting for the timer, and wait for the files. No sleeping: a loaded machine must not fail this. */
const written = () => flushCreateDraft()

describe('the draft of Create', () => {
  it('prompt, tool, photo, mask and further photos come back after a restart', async () => {
    await installCreateDraft({ storage: store, files })
    const st = useCreateStore.getState()
    st.setIntent('edit')
    st.setPrompt('make the sky pink')
    st.setNegativePrompt('text')
    st.setSource(image('me.png'))
    st.setMask(image('mask.png'))
    st.setReferences([image('r0.png'), image('r1.png')])
    st.setCloudImageCount(4)
    st.setCloudImageModel('qwen-image-edit')
    await written()
    expect(store.getItem(DRAFT_KEY)).toContain('make the sky pink')
    expect((await files.all()).map((f) => f.slot).sort()).toEqual(['mask', 'ref:0', 'ref:1', 'source'])

    freshStart()
    const back = await installCreateDraft({ storage: store, files })
    expect(back).toEqual({ words: true, files: 4 })
    const now = useCreateStore.getState()
    expect(now.intent()).toBe('edit')
    expect(now.prompt).toBe('make the sky pink')
    expect(now.negativePrompt).toBe('text')
    expect(now.source).toMatchObject({ filename: 'me.png', width: 64, height: 48 })
    expect(now.source?.url.startsWith('data:image/png;base64,')).toBe(true)
    expect(now.mask?.filename).toBe('mask.png')
    expect(now.references.map((r) => r.filename)).toEqual(['r0.png', 'r1.png'])
    expect(now.cloudImageModel).toBe('qwen-image-edit')
    // How many pictures a run makes is never brought back.
    expect(now.cloudImageCount).toBe(1)
  })

  it('training photos, the name and the page for a new character', async () => {
    await installCreateDraft({ storage: store, files })
    const st = useCreateStore.getState()
    st.setIntent('character')
    st.setCharacterTab('train')
    st.addTrainImages([media('a.jpg'), media('b.jpg'), media('c.jpg')])
    await written()

    freshStart()
    // The page for a new character opened first and chose its tool itself.
    useCreateStore.getState().setIntent('character')
    useCreateStore.getState().setCharacterTab('train')
    const back = await installCreateDraft({ storage: store, files })
    expect(back.files).toBe(3)
    const now = useCreateStore.getState()
    expect(now.trainImages.map((p) => p.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(await now.trainImages[1].blob.text()).toBe('b.jpg')
    expect(now.characterTab).toBe('train')
  })

  it('a voice from a file, a clip, a voice from the gallery, lyrics and the picked character', async () => {
    await installCreateDraft({ storage: store, files })
    let st = useCreateStore.getState()
    st.setIntent('lipsync')
    st.setAudioInput(media('voice.mp3'))
    st.setVideoInput(media('clip.mp4'))
    await written()
    freshStart()
    await installCreateDraft({ storage: store, files })
    expect(useCreateStore.getState().intent()).toBe('lipsync')
    expect(useCreateStore.getState().audioInput?.name).toBe('voice.mp3')
    expect(useCreateStore.getState().videoInput?.name).toBe('clip.mp4')

    st = useCreateStore.getState()
    st.setVoiceFromJob({ jobId: 'job-9', label: 'My voice' })
    await written()
    expect((await files.all()).map((f) => f.slot)).toEqual(['video'])
    freshStart()
    await installCreateDraft({ storage: store, files })
    expect(useCreateStore.getState().voiceFromJob).toEqual({ jobId: 'job-9', label: 'My voice' })
    expect(useCreateStore.getState().audioInput).toBeNull()

    st = useCreateStore.getState()
    st.setIntent('music')
    st.setPrompt('slow piano')
    st.setMusicLyrics('la la')
    await written()
    freshStart()
    await installCreateDraft({ storage: store, files })
    expect(useCreateStore.getState().intent()).toBe('music')
    expect(useCreateStore.getState().musicLyrics).toBe('la la')

    st = useCreateStore.getState()
    st.setIntent('character')
    st.setCharacterTab('use')
    st.setSelectedCharacter({ id: 'c1', name: 'Mia', triggerWord: 'mia', family: 'flux' })
    await written()
    freshStart()
    await installCreateDraft({ storage: store, files })
    expect(useCreateStore.getState().selectedCharacter?.id).toBe('c1')
  })

  it('photos of a training that is booked are not kept: after a restart nothing invites a second, paid tap', async () => {
    await installCreateDraft({ storage: store, files })
    const st = useCreateStore.getState()
    st.setIntent('character')
    st.setCharacterTab('train')
    st.addTrainImages([media('a.jpg'), media('b.jpg')])
    await written()
    expect((await files.all()).map((f) => f.slot).sort()).toEqual(['train:0', 'train:1'])
    // The training is handed in and stands in the ledger of booked jobs.
    pending.jobs = [{ id: 'job-1', landing: 'character' }]
    useCreateStore.getState().setProgress(10, 'Training')
    await written()
    expect(await files.all()).toEqual([])
    pending.jobs = []
  })

  it('what the user typed since the start wins over the draft', async () => {
    await installCreateDraft({ storage: store, files })
    useCreateStore.getState().setPrompt('old words')
    useCreateStore.getState().setSource(image('old.png'))
    await written()

    freshStart()
    useCreateStore.getState().setPrompt('new words')
    expect(await restoreCreateDraft(store, files)).toEqual({ words: false, files: 0 })
    expect(useCreateStore.getState().prompt).toBe('new words')
    expect(useCreateStore.getState().source).toBeNull()
  })

  it('another tool is open: the words come back, the photo of the other tool does not', async () => {
    await installCreateDraft({ storage: store, files })
    useCreateStore.getState().setIntent('edit')
    useCreateStore.getState().setPrompt('pink sky')
    useCreateStore.getState().setSource(image('me.png'))
    await written()

    freshStart()
    useCreateStore.getState().setIntent('music')
    expect(await restoreCreateDraft(store, files)).toEqual({ words: true, files: 0 })
    expect(useCreateStore.getState().intent()).toBe('music')
    expect(useCreateStore.getState().prompt).toBe('pink sky')
    expect(useCreateStore.getState().source).toBeNull()
  })

  it('clearing everything leaves nothing behind', async () => {
    await installCreateDraft({ storage: store, files })
    useCreateStore.getState().setPrompt('x')
    useCreateStore.getState().setSource(image('me.png'))
    await written()
    useCreateStore.getState().setPrompt('')
    useCreateStore.getState().setSource(null)
    await written()
    expect(store.getItem(DRAFT_KEY)).toBeNull()
    expect(await files.all()).toEqual([])
  })

  it('signing out forgets the draft on the phone', async () => {
    await installCreateDraft({ storage: store, files })
    useCreateStore.getState().setPrompt('private words')
    useCreateStore.getState().addTrainImages([media('a.jpg')])
    await written()
    await forgetCreateDraft()
    expect(store.getItem(DRAFT_KEY)).toBeNull()
    expect(await files.all()).toEqual([])
  })

  it('a phone without room keeps working: nothing is thrown, nothing comes back', async () => {
    const full = { ...storage(), setItem: () => { throw new Error('QuotaExceededError') } } as Storage
    const broken: DraftFileStore = { all: async () => { throw new Error('no database') }, put: async () => { throw new Error('QuotaExceededError') }, remove: async () => {}, clear: async () => {} }
    await expect(installCreateDraft({ storage: full, files: broken })).resolves.toEqual({ words: false, files: 0 })
    useCreateStore.getState().setPrompt('still typing')
    useCreateStore.getState().setSource(image('me.png'))
    await expect(flushCreateDraft()).resolves.toBeUndefined()
    expect(useCreateStore.getState().prompt).toBe('still typing')
  })
})
