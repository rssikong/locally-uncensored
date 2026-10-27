/**
 * The draft of Create on a phone: prompt and inputs come back after the app
 * was ended (lib/create-draft.ts holds the record and the file store).
 *
 * Kept: the tool, the prompt, what should be left out, lyrics, the picked
 * character, the picked voice or clip from the gallery, and the files (source
 * photo, mask, further photos, training photos, voice, clip).
 * Not kept, on purpose: how many pictures one run makes (a number from
 * yesterday would book several without anyone noticing) and prices.
 */
import {
  DRAFT_KEY,
  browserDraftFiles,
  draftFileKeeper,
  readDraftWords,
  sortDraftFiles,
  writeDraftWords,
  type DraftFile,
  type DraftFileStore,
  type DraftSlot,
  type DraftWords,
} from '../../../../lib/create-draft'
import { blobFromUrl } from '../../../../lib/render/data-url'
import { pendingCloudJobs } from '../../../../lib/pending-cloud-jobs'
import { useCreateStore, type CreateIntent, type ImageRef, type MediaRef } from '../../../../stores/createStore'

type State = ReturnType<typeof useCreateStore.getState>

const WRITE_AFTER_MS = 400

function wordsOf(s: State): Omit<DraftWords, 'v' | 'at'> {
  return {
    intent: s.intent(),
    prompt: s.prompt,
    negativePrompt: s.negativePrompt,
    musicLyrics: s.musicLyrics,
    characterTab: s.characterTab,
    selectedCharacter: s.selectedCharacter,
    voiceFromJob: s.voiceFromJob,
    extendSource: s.extendSource,
    models: { image: s.cloudImageModel, video: s.cloudVideoModel, op: s.cloudOpModel },
  }
}

function trainingIsBooked(): boolean {
  return pendingCloudJobs().some((job) => job.landing === 'character')
}

function slotsOf(s: State): DraftSlot[] {
  const image = (slot: string, ref: ImageRef): DraftSlot => ({ slot, key: ref, name: ref.filename, width: ref.width, height: ref.height, blob: () => blobFromUrl(ref.url) })
  const media = (slot: string, ref: MediaRef): DraftSlot => ({ slot, key: ref, name: ref.name, blob: () => ref.blob })
  const out: DraftSlot[] = []
  if (s.source) out.push(image('source', s.source))
  if (s.mask) out.push(image('mask', s.mask))
  s.references.forEach((ref, i) => out.push(image(`ref:${i}`, ref)))
  // Photos of a training that is booked are not kept: after a restart they would stand next to
  // a Train button as if nothing had been sent, and a second tap would pay a second time.
  if (!trainingIsBooked()) s.trainImages.forEach((ref, i) => out.push(media(`train:${i}`, ref)))
  if (s.audioInput) out.push(media('audio', s.audioInput))
  if (s.videoInput) out.push(media('video', s.videoInput))
  return out
}

/** The bytes as a data URL, which is the shape the cloud path of the create store takes. */
async function dataUrlOf(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step))
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`
}

async function imageRefOf(file: DraftFile): Promise<ImageRef> {
  return { filename: file.name, url: await dataUrlOf(file.blob), width: file.width ?? 0, height: file.height ?? 0 }
}

function mediaRefOf(file: DraftFile): MediaRef {
  return { name: file.name, url: URL.createObjectURL(file.blob), blob: file.blob }
}

/** Nothing typed and nothing picked since the app started. */
function untouched(s: State): boolean {
  return !s.isGenerating && !s.prompt && !s.negativePrompt && !s.source && !s.mask && s.references.length === 0 && s.trainImages.length === 0 && !s.audioInput && !s.videoInput
}

export interface RestoredDraft {
  words: boolean
  files: number
}

/**
 * Put the draft back into the create store. Only into a store nobody has
 * touched yet: what the user does now always wins over what was kept.
 */
export async function restoreCreateDraft(storage: Pick<Storage, 'getItem'>, files: DraftFileStore, now = Date.now()): Promise<RestoredDraft> {
  const none: RestoredDraft = { words: false, files: 0 }
  const words = readDraftWords({ getItem: (k) => storage.getItem(k), setItem: () => {}, removeItem: () => {} }, now)
  if (!words) return none
  if (!untouched(useCreateStore.getState())) return none
  const stored = await files.all().catch(() => [] as DraftFile[])
  const { single, lists } = sortDraftFiles(stored)
  // Decode before anything is set, so the store changes in one go.
  const [source, mask, refs] = await Promise.all([
    single.source ? imageRefOf(single.source).catch(() => null) : null,
    single.mask ? imageRefOf(single.mask).catch(() => null) : null,
    Promise.all((lists.ref ?? []).map((f) => imageRefOf(f).catch(() => null))),
  ])
  const st = useCreateStore.getState()
  if (!untouched(st)) return none

  // A page that opened meanwhile may have chosen its own tool (the page for a
  // new character does). Then the tool stays, and only what fits any tool comes back.
  const before = st.intent()
  const sameTool = before === words.intent
  if (!sameTool && before === 'image') st.setIntent(words.intent as CreateIntent)
  const toolRestored = useCreateStore.getState().intent() === words.intent

  let count = 0
  const set = useCreateStore.getState()
  if (words.prompt) set.setPrompt(words.prompt)
  if (words.negativePrompt) set.setNegativePrompt(words.negativePrompt)
  if (toolRestored) {
    // The picked model first: what the tool asks for (a mask or none, a length) depends on it.
    if (words.models.image && words.models.image !== set.cloudImageModel) set.setCloudImageModel(words.models.image)
    if (words.models.video && words.models.video !== set.cloudVideoModel) set.setCloudVideoModel(words.models.video)
    if (words.models.op && words.models.op !== set.cloudOpModel) set.setCloudOpModel(words.models.op)
    if (words.musicLyrics) set.setMusicLyrics(words.musicLyrics)
    if (!sameTool) set.setCharacterTab(words.characterTab)
    if (words.selectedCharacter && !set.selectedCharacter) set.setSelectedCharacter(words.selectedCharacter)
    if (words.extendSource) set.setExtendSource(words.extendSource)
    if (source) {
      set.setSource(source)
      count++
      if (mask) {
        set.setMask(mask)
        count++
      }
      const good = refs.filter((r): r is ImageRef => r !== null)
      if (good.length) {
        set.setReferences(good)
        count += good.length
      }
    }
    if (single.audio) {
      set.setAudioInput(mediaRefOf(single.audio))
      count++
    } else if (words.voiceFromJob) set.setVoiceFromJob(words.voiceFromJob)
    if (single.video) {
      set.setVideoInput(mediaRefOf(single.video))
      count++
    }
  }
  const train = (lists.train ?? []).map(mediaRefOf)
  if (train.length) {
    set.addTrainImages(train)
    count += useCreateStore.getState().trainImages.length
  }
  return { words: true, files: count }
}

let started: Promise<RestoredDraft> | null = null
let forget: (() => Promise<void>) | null = null
let flush: (() => Promise<void>) | null = null

/**
 * Bring the draft back once, then keep writing it. Safe to call again; the
 * answer of the first call is handed out.
 */
export function installCreateDraft(opts: { storage?: Storage; files?: DraftFileStore } = {}): Promise<RestoredDraft> {
  if (started) return started
  const storage = opts.storage ?? window.localStorage
  const files = opts.files ?? browserDraftFiles()
  const keeper = draftFileKeeper(files)
  let timer: ReturnType<typeof setTimeout> | null = null

  const writeNow = () => {
    timer = null
    const s = useCreateStore.getState()
    const slots = slotsOf(s)
    writeDraftWords(storage, wordsOf(s), slots.length > 0)
    void keeper.sync(slots)
  }
  const writeSoon = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(writeNow, WRITE_AFTER_MS)
  }

  started = restoreCreateDraft(storage, files)
    .catch(() => ({ words: false, files: 0 }))
    .then((restored) => {
      // What came back is already in the file store as it is.
      keeper.adopt(slotsOf(useCreateStore.getState()))
      useCreateStore.subscribe((s, prev) => {
        const same =
          s.prompt === prev.prompt && s.negativePrompt === prev.negativePrompt && s.musicLyrics === prev.musicLyrics &&
          s.source === prev.source && s.mask === prev.mask && s.references === prev.references && s.trainImages === prev.trainImages &&
          s.audioInput === prev.audioInput && s.videoInput === prev.videoInput && s.voiceFromJob === prev.voiceFromJob &&
          s.extendSource === prev.extendSource && s.selectedCharacter === prev.selectedCharacter && s.characterTab === prev.characterTab &&
          s.mode === prev.mode && s.imageSubMode === prev.imageSubMode && s.videoSubMode === prev.videoSubMode &&
          s.removebg === prev.removebg && s.utilityOp === prev.utilityOp && s.cloudOp === prev.cloudOp &&
          s.cloudImageModel === prev.cloudImageModel && s.cloudVideoModel === prev.cloudVideoModel && s.cloudOpModel === prev.cloudOpModel &&
          // A run that books a training changes what is kept (see slotsOf), and the store moves while it runs.
          s.isGenerating === prev.isGenerating && s.progress === prev.progress
        if (!same) writeSoon()
      })
      // The app is about to be put away: do not wait for the timer.
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden' && timer) {
            clearTimeout(timer)
            writeNow()
          }
        })
      }
      writeNow()
      return restored
    })

  flush = async () => {
    if (timer) {
      clearTimeout(timer)
      writeNow()
    }
    await keeper.settled()
  }
  forget = async () => {
    if (timer) clearTimeout(timer)
    timer = null
    try {
      storage.removeItem(DRAFT_KEY)
    } catch {
      /* nothing to remove */
    }
    await keeper.forgetAll()
  }
  return started
}

/** Throw the kept draft away (the account was signed out: its photos do not stay behind). */
export async function forgetCreateDraft(): Promise<void> {
  await forget?.()
}

/** Write what is waiting to be written now, and wait until the files are on disk. */
export async function flushCreateDraft(): Promise<void> {
  await started
  await flush?.()
}

/** Test seam. The subscription of an earlier start stays, so only tests use it. */
export function __resetCreateDraftForTests(): void {
  started = null
  forget = null
  flush = null
}
