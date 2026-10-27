/**
 * The cards a tool puts on the stage of K1 for its own inputs: source image,
 * reference photos, target size, character, presenter and voice, music text,
 * the clip to extend, the motion video.
 */
import { useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { AudioLines, Brush, Clapperboard, ImagePlus, Plus, UserRound, Video as VideoIcon } from 'lucide-react'
import { useCreateStore } from '../../../../stores/createStore'
import { cloudModelById } from '../../../../stores/cloudCatalogStore'
import { studioShownValue } from '../../../../lib/render/create-studio'
import { musicLength, musicText } from '../../../../lib/render/music-ui'
import { mediaRefFrom } from '../../../../components/create/experimental/mediaRef'
import { pickFiles, pickPhotos } from '../../../platform/files'
import { Button, ChipGroup, Chip, Field, Icon, Notice, Row, ListGroup, Segmented, Slider, TextArea, riskProps, toast } from '../../../ui'
import { nav } from '../../../nav'
import { openGalleryPicker } from './actions'
import { CREATE_STRINGS as T } from '../../../strings/create'
import { fileProblemText } from './actions'
import { loadPhoneImage } from './photos'
import type { CreateFacts } from './facts'
import { checkFile } from './files'
import { lengthUnit } from './length-price'
import { creditsLabel, formatSeconds } from './params'
import { toolAllowsMask } from './tools'
import { RemoveX } from './ui'

const st = () => useCreateStore.getState()

/**
 * An input that is still empty: one card that is one button (round 45). The
 * card used to carry a large tile and a button of its own in a second line;
 * that took two rows of the first screen for a single tap.
 */
function AddCard(props: { icon: typeof ImagePlus; title: string; sub: string; action: string; onPress: () => void; disabled: boolean; testid: string; cardTestid: string; el?: string; state?: string; children?: ReactNode }) {
  const { icon, title, sub, action, onPress, disabled, testid, cardTestid, el, state, children } = props
  return (
    <div className="m-k-card m-k-card--add" data-testid={cardTestid} data-el={el} data-state={state}>
      <button type="button" className="m-k-addcard" disabled={disabled} data-testid={testid} onClick={onPress}>
        <span className="m-k-thumb" aria-hidden="true">
          <Icon icon={icon} />
        </span>
        <span className="m-k-card-text">
          <span className="m-sr">{`${action}. `}</span>
          <span className="m-k-card-title">{title}</span>
          <span className="m-k-card-sub">{sub}</span>
        </span>
        <span className="m-k-addcard-go" aria-hidden="true">
          <Icon icon={Plus} small />
        </span>
      </button>
      {children}
    </div>
  )
}

/** K1.18: the source image with remove, and "Paint mask" for Edit and Erase. */
export function SourceCard({ f, title, sub, disabled }: { f: CreateFacts; title?: string; sub?: string; disabled: boolean }) {
  const source = f.source
  const allowsMask = toolAllowsMask(f.tool)
  if (!source) {
    return <AddCard icon={ImagePlus} title={title ?? T.sourceTitle} sub={sub ?? T.tool[f.tool].empty} action={T.sourceAdd} onPress={() => nav.openSheet('source')} disabled={disabled} testid="m-create-source-add" cardTestid="m-create-source-empty" el="K1.18" />
  }
  const maskLine = !allowsMask ? null : f.mask ? T.maskSet : f.tool === 'eraser' ? T.maskRequired : f.needsMask ? T.maskNeeded : T.maskOptional
  return (
    <div className="m-k-card" data-testid="m-create-source" data-el="K1.18" data-state={f.mask ? 'masked' : 'plain'}>
      <div className="m-k-card-head">
        <span className="m-k-ref" style={{ width: 72, height: 72 }}>
          <button type="button" className="m-k-thumb" style={{ width: 72, height: 72 }} aria-label={T.sourceOpen} data-testid="m-create-source-open" onClick={() => nav.push('/create/item/:id', { id: 'source' })}>
            <img src={source.url} alt="" />
          </button>
          {disabled ? null : <RemoveX label={T.sourceRemove} testid="m-create-source-remove" onPress={() => st().setSource(null)} />}
        </span>
        <span className="m-k-card-text">
          <span className="m-k-card-title">{title ?? T.sourceTitle}</span>
          <span className="m-k-card-sub m-mono">{T.sourceSize(source.width, source.height)}</span>
          {maskLine ? <span className="m-k-card-sub" data-testid="m-create-mask-state">{maskLine}</span> : null}
        </span>
      </div>
      {allowsMask ? (
        <div className="m-k-card-actions">
          <Button icon={Brush} onPress={() => nav.push('/create/mask')} disabled={disabled} testid="m-create-paint-mask">
            {f.mask ? T.paintMaskAgain : T.paintMask}
          </Button>
          {f.mask ? (
            <Button variant="quiet" onPress={() => st().setMask(null)} disabled={disabled} testid="m-create-mask-remove">
              {T.removeMask}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** K1.19: up to five reference photos next to the source. */
export function ReferenceCard({ f, disabled }: { f: CreateFacts; disabled: boolean }) {
  const [busy, setBusy] = useState(false)
  if (!f.source || f.referenceSlots <= 0) return null
  const refs = f.references.slice(0, f.referenceSlots)
  const add = async () => {
    const picked = await pickPhotos({ multiple: true })
    if (picked.length === 0) return
    setBusy(true)
    let failed: unknown = null
    for (const p of picked.slice(0, f.referenceSlots - st().references.length)) {
      try {
        st().addReference(await loadPhoneImage(p.file))
      } catch (err) {
        failed = err
      }
    }
    setBusy(false)
    if (failed) toast(fileProblemText(failed), { tone: 'error', testid: 'create-reference-failed' })
  }
  return (
    <div className="m-k-card" data-testid="m-create-references" data-el="K1.19">
      <span className="m-k-card-text">
        <span className="m-k-card-title">{T.references}</span>
        <span className="m-k-card-sub">{T.referencesHint(f.referenceSlots)}</span>
      </span>
      <div className="m-k-refs">
        {refs.map((ref, i) => (
          <span className="m-k-ref" key={`${i}-${ref.url.length}`}>
            <span className="m-k-thumb">
              <img src={ref.url} alt="" />
            </span>
            {disabled ? null : <RemoveX label={T.removeReference(i + 1)} testid="m-create-reference-remove" onPress={() => st().removeReference(i)} />}
          </span>
        ))}
        {refs.length < f.referenceSlots ? (
          <button type="button" className="m-k-addtile" aria-label={T.addReference} aria-busy={busy || undefined} disabled={disabled || busy} data-testid="m-create-reference-add" {...riskProps('sensor')} onClick={() => void add()}>
            {busy ? <span className="m-ring" aria-hidden="true" /> : <Icon icon={Plus} />}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Enhance: the target size. */
export function EnhanceCard({ disabled }: { disabled: boolean }) {
  const target = useCreateStore((s) => s.targetResolution)
  return (
    <div className="m-k-card m-k-card--inline" data-el="K4.4">
      <span className="m-k-card-title">{T.enhanceTo}</span>
      <Segmented
        label={T.enhanceTo}
        testid="m-create-enhance-size"
        value={target}
        onChange={(v) => st().setTargetResolution(v)}
        options={[
          { value: '2k', label: '2K', disabled, testid: 'm-create-enhance-2k' },
          { value: '4k', label: '4K', disabled, testid: 'm-create-enhance-4k' },
          { value: '8k', label: '8K', disabled, testid: 'm-create-enhance-8k' },
        ]}
      />
    </div>
  )
}

/** Character: the way to the shelf, and who is picked. */
export function CharacterCard({ f }: { f: CreateFacts }) {
  return (
    <ListGroup>
      <Row
        icon={UserRound}
        title={T.yourCharacters}
        subtitle={f.character ? T.characterPicked(f.character.name) : T.yourCharactersSub}
        onPress={() => nav.push('/create/characters')}
        testid="m-create-characters-open"
      />
    </ListGroup>
  )
}

interface VoiceDraft {
  text: string
  mode: 'speak' | 'design'
  voice: string
  description: string
  set: (patch: Partial<Omit<VoiceDraft, 'set'>>) => void
}

/**
 * What the user typed for the voice. It lives outside the card: the card is
 * unmounted by another tab and by a change of the screen shape, and words
 * typed for a paid run must not be lost by that.
 */
const useVoiceDraft = create<VoiceDraft>((set) => ({
  text: '',
  mode: 'speak',
  voice: 'Serena',
  description: '',
  set: (patch) => set(patch),
}))

const VOICES = ['Serena', 'Vivian', 'Dylan', 'Eric', 'Ryan', 'Aiden', 'Sohee', 'Ono_Anna', 'Uncle_Fu'] as const

/** Talking: text to voice, or a sound file, or a voice from the gallery. */
export function VoiceCard({ f, disabled, onMakeVoice }: { f: CreateFacts; disabled: boolean; onMakeVoice: (o: { text: string; mode: 'speak' | 'design'; voice?: string; description?: string }) => void }) {
  const voiceFromJob = useCreateStore((s) => s.voiceFromJob)
  const audioInput = f.audioInput
  const { text, mode, voice, description, set: setDraft } = useVoiceDraft()
  const setText = (v: string) => setDraft({ text: v })
  const setMode = (v: 'speak' | 'design') => setDraft({ mode: v })
  const setVoice = (v: string) => setDraft({ voice: v })
  const setDescription = (v: string) => setDraft({ description: v })
  const [problem, setProblem] = useState<string | null>(null)

  const pickAudio = async () => {
    const [picked] = await pickFiles({ accept: 'audio/*' })
    if (!picked) return
    const bad = checkFile(picked.file, 'audio')
    if (bad) {
      setProblem(bad.kind === 'too-large' ? T.file.tooLarge(bad.sizeMb, bad.limitMb) : bad.kind === 'empty' ? T.file.empty : T.file.wrongKind.audio)
      return
    }
    setProblem(null)
    st().setAudioInput(mediaRefFrom(picked.file))
  }

  if (audioInput || voiceFromJob) {
    return (
      <div className="m-k-card" data-testid="m-create-voice" data-state="ready">
        <div className="m-k-card-head">
          <span className="m-k-thumb" aria-hidden="true">
            <Icon icon={AudioLines} />
          </span>
          <span className="m-k-card-text">
            <span className="m-k-card-title">{T.voice}</span>
            <span className="m-k-card-sub">{audioInput ? T.voiceFileReady(audioInput.name) : T.voiceReady(voiceFromJob?.label ?? '')}</span>
          </span>
        </div>
        {audioInput ? <audio src={audioInput.url} controls style={{ width: '100%' }} aria-label={T.voice} /> : null}
        <div className="m-k-card-actions">
          <Button
            variant="quiet"
            disabled={disabled}
            testid="m-create-voice-remove"
            onPress={() => {
              st().setAudioInput(null)
              st().setVoiceFromJob(null)
            }}
          >
            {T.voiceRemove}
          </Button>
        </div>
      </div>
    )
  }
  // A voice is billed by its characters where the catalogue says so: the button shows the price of THIS text,
  // the number that goes along with the start as its ceiling (hooks/useCloudCreate.ts, makeVoice).
  const voiceModel = mode === 'design' ? 'qwen3-tts-design' : 'qwen3-tts'
  const price = lengthUnit(voiceModel, 'tts', text.trim(), undefined) ?? cloudModelById(voiceModel)?.credits?.base
  return (
    <div className="m-k-card m-k-voice" data-testid="m-create-voice" data-state="empty">
      {/* The title alone: the buttons below say the three ways to a voice (round 45, the card fits the first screen). */}
      <span className="m-k-card-title">{T.voice}</span>
      <TextArea label={T.voiceText} placeholder={T.voiceTextHint} value={text} onChange={setText} rows={2} maxLength={2000} disabled={disabled} testid="m-create-voice-text" />
      <Segmented
        label={T.voiceMode}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'speak', label: T.voiceModeSpeak, testid: 'm-create-voice-mode-speak' },
          { value: 'design', label: T.voiceModeDesign, testid: 'm-create-voice-mode-design' },
        ]}
      />
      {mode === 'speak' ? (
        // One row that moves sideways: nine names in a wrap took three rows of the first screen.
        <ChipGroup label={T.voiceName} role="radiogroup">
          {VOICES.map((v) => (
            <Chip key={v} kind="choice" selected={voice === v} onPress={() => setVoice(v)} testid={`m-create-voice-name-${v.toLowerCase()}`}>
              {v.replace('_', ' ')}
            </Chip>
          ))}
        </ChipGroup>
      ) : (
        <Field label={T.voiceDescription} hint={T.voiceDescriptionHint} value={description} onChange={setDescription} maxLength={300} testid="m-create-voice-description" />
      )}
      {problem ? (
        <Notice variant="error" testid="m-create-voice-error">
          {problem}
        </Notice>
      ) : null}
      <div className="m-k-card-actions">
        <Button
          variant="cloud"
          risk="paid"
          testid="m-create-voice-speak"
          disabled={disabled || text.trim().length === 0 || !f.online}
          disabledReason={!f.online ? T.block.offline : undefined}
          onPress={() => onMakeVoice({ text, mode, voice: mode === 'speak' ? voice : undefined, description: mode === 'design' ? description : undefined })}
        >
          {price ? `${T.makeVoice}, ${creditsLabel(price)}` : T.makeVoice}
        </Button>
        <Button onPress={() => void pickAudio()} disabled={disabled} testid="m-create-voice-file">
          {T.voiceFile}
        </Button>
        <Button onPress={() => openGalleryPicker('voice')} disabled={disabled} testid="m-create-voice-gallery">
          {T.voiceFromGallery}
        </Button>
      </div>
    </div>
  )
}

/** A video from the phone: the motion video of Motion, the clip of a re-sync model. */
export function VideoInputCard({ f, title, sub, disabled, testid }: { f: CreateFacts; title: string; sub: string; disabled: boolean; testid: string }) {
  const [problem, setProblem] = useState<string | null>(null)
  const video = f.videoInput
  const pick = async () => {
    const [picked] = await pickFiles({ accept: 'video/*' })
    if (!picked) return
    const bad = checkFile(picked.file, 'video')
    if (bad) {
      setProblem(bad.kind === 'too-large' ? T.file.tooLarge(bad.sizeMb, bad.limitMb) : bad.kind === 'empty' ? T.file.empty : T.file.wrongKind.video)
      return
    }
    setProblem(null)
    st().setVideoInput(mediaRefFrom(picked.file))
  }
  const problemNote = problem ? (
    <Notice variant="error" testid={`${testid}-error`}>
      {problem}
    </Notice>
  ) : null
  if (!video) {
    return (
      <AddCard icon={VideoIcon} title={title} sub={sub} action={T.addVideo} onPress={() => void pick()} disabled={disabled} testid={`${testid}-add`} cardTestid={testid} state="empty">
        {problemNote}
      </AddCard>
    )
  }
  return (
    <div className="m-k-card" data-testid={testid} data-state="ready">
      <div className="m-k-card-head">
        <span className="m-k-thumb" aria-hidden="true">
          <Icon icon={VideoIcon} />
        </span>
        <span className="m-k-card-text">
          <span className="m-k-card-title">{title}</span>
          <span className="m-k-card-sub">{T.motionVideoReady(video.name)}</span>
        </span>
      </div>
      <video className="m-k-video" src={video.url} controls playsInline preload="metadata" aria-label={title} />
      {problemNote}
      <div className="m-k-card-actions">
        <Button icon={Plus} onPress={() => void pick()} disabled={disabled} testid={`${testid}-add`}>
          {T.addVideo}
        </Button>
        <Button variant="quiet" onPress={() => st().setVideoInput(null)} disabled={disabled} testid={`${testid}-remove`}>
          {T.motionVideoRemove}
        </Button>
      </div>
    </div>
  )
}

/** Extend: one of the user's own clips. */
export function ExtendCard({ disabled }: { disabled: boolean }) {
  const extendSource = useCreateStore((s) => s.extendSource)
  if (!extendSource) {
    return <AddCard icon={Clapperboard} title={T.pickClip} sub={T.pickClipSub} action={T.pickClip} onPress={() => openGalleryPicker('extend')} disabled={disabled} testid="m-create-extend-pick" cardTestid="m-create-extend" state="empty" />
  }
  return (
    <div className="m-k-card" data-testid="m-create-extend" data-state="ready">
      <div className="m-k-card-head">
        <span className="m-k-thumb" aria-hidden="true">
          <Icon icon={Clapperboard} />
        </span>
        <span className="m-k-card-text">
          <span className="m-k-card-title">{T.pickClip}</span>
          <span className="m-k-card-sub">{T.clipPicked(extendSource.label)}</span>
        </span>
      </div>
      <div className="m-k-card-actions">
        <Button onPress={() => openGalleryPicker('extend')} disabled={disabled} testid="m-create-extend-pick">
          {T.pickClip}
        </Button>
        <Button variant="quiet" onPress={() => st().setExtendSource(null)} disabled={disabled} testid="m-create-extend-remove">
          {T.clipRemove}
        </Button>
      </div>
    </div>
  )
}

/** Music: which text the prompt field holds, the second text, and the length. */
export function MusicCard({ f, disabled }: { f: CreateFacts; disabled: boolean }) {
  const lyrics = useCreateStore((s) => s.musicLyrics)
  const duration = useCreateStore((s) => s.musicDuration)
  const options = useCreateStore((s) => s.cloudStudioOptions)
  const [tab, setTab] = useState<'main' | 'second'>('main')
  const text = musicText(f.model.id)
  const length = musicLength(f.model.id)
  const second = text.second
  const secondValue = second?.option ? String(studioShownValue(f.model.id, options, second.option) ?? '') : lyrics
  const setSecond = (v: string) => {
    if (second?.option) st().setCloudStudioOptions({ ...st().cloudStudioOptions, [second.option]: v || undefined })
    else st().setMusicLyrics(v)
  }
  const lengthValue = length?.option ? Math.round(Number(studioShownValue(f.model.id, options, length.option) ?? length.min * length.perSecond) / length.perSecond) : duration
  const setLength = (v: number) => {
    if (length?.option) st().setCloudStudioOptions({ ...st().cloudStudioOptions, [length.option]: v * length.perSecond })
    else st().setMusicDuration(v)
  }
  const mainName = text.main === 'lyrics' ? T.musicLyrics : T.musicStyle
  const secondName = second?.is === 'lyrics' ? T.musicLyrics : T.musicStyle
  return (
    <div className="m-k-card m-k-card--flat" data-testid="m-create-music">
      {second ? (
        <Segmented
          label={T.musicText}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'main', label: mainName, testid: 'm-create-music-main' },
            { value: 'second', label: secondName, testid: 'm-create-music-second' },
          ]}
        />
      ) : null}
      {second && tab === 'second' ? (
        <TextArea
          label={second.is === 'lyrics' ? T.musicLyricsLabel : T.musicStyleLabel}
          hint={second.is === 'lyrics' ? T.musicLyricsHint : T.musicStyleHint}
          value={secondValue}
          onChange={setSecond}
          rows={5}
          maxLength={2000}
          disabled={disabled}
          testid="m-create-music-text"
        />
      ) : null}
      {length ? (
        <Slider label={T.length} min={length.min} max={length.max} step={length.step} value={Math.min(length.max, Math.max(length.min, lengthValue))} onChange={setLength} format={formatSeconds} disabled={disabled} testid="m-create-music-length" />
      ) : (
        <span className="m-k-card-sub">{T.run.musicModelDecides}</span>
      )}
    </div>
  )
}
