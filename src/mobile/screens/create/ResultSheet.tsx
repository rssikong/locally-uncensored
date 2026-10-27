/**
 * K8 Result actions. Sheet "result", opened with nav.openSheet('result', { id }), strand 3 (Create).
 *
 * K8.1 Edit with mask (K9), K8.2 Enhance, K8.3 Remove background,
 * K8.4 Animate, K8.5 Extend (video only), K8.6 Save as character (sub page:
 * up to five frames of a clip, a name, Save), K8.7 Use as source,
 * K8.8 Delete (asks first), K8.9 Close is the close button of the sheet.
 * Sound gets "Use as voice". Every result has "Report" where the store
 * rules ask for it.
 */
import { useEffect, useRef, useState } from 'react'
import { AudioLines, Brush, FastForward, Film, Flag, ImageDown, Maximize2, Scissors, Sparkles, Trash2, UserRoundPlus } from 'lucide-react'
import type { GalleryItem } from '../../../stores/createStore'
import { useCreateStore } from '../../../stores/createStore'
import { saveCharacter } from '../../../lib/saved-characters'
import { brokenStoreError } from '../../lib/storage-alerts'
import { grabFrame } from '../../../lib/video-frames'
import { nav, useSheet } from '../../nav'
import { CREATE_STRINGS as T } from '../../strings/create'
import { Button, EmptyState, Field, ListGroup, Notice, Row, Sheet, toast } from '../../ui'
import { deleteItems, takeItemAsExtend, takeItemAsSource, takeItemAsVoice } from './parts/actions'
import { fetchItemBlob } from './parts/adapters/result-url'
import { reportItem, storePolicy } from './parts/policy'
import type { ToolId } from './parts/tools'
import { RemoveX, useCloseOwnSheet, useGalleryItem } from './parts/ui'

const MAX_FRAMES = 5

/** K8.6: keep photos of the figure in a result under a name, on this phone. */
function SaveCharacter({ item, onDone }: { item: GalleryItem; onDone: () => void }) {
  const [name, setName] = useState('')
  const [frames, setFrames] = useState<{ url: string; blob: Blob }[]>([])
  const [media, setMedia] = useState<{ url: string; blob: Blob } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const made = useRef<string[]>([])

  useEffect(() => {
    let alive = true
    // The bytes come through fetch, so a frame can be read from the clip without a tainted canvas.
    void fetchItemBlob(item)
      .then((blob) => {
        if (!alive) return
        const url = URL.createObjectURL(blob)
        made.current.push(url)
        setMedia({ url, blob })
      })
      .catch(() => {
        if (alive) setProblem(T.result.gone)
      })
    const urls = made.current
    return () => {
      alive = false
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [item])

  const addFrame = async () => {
    if (!video.current || frames.length >= MAX_FRAMES) return
    try {
      const blob = await grabFrame(video.current)
      const url = URL.createObjectURL(blob)
      made.current.push(url)
      setFrames((list) => [...list, { url, blob }])
      setProblem(null)
    } catch {
      setProblem(T.result.frameFailed)
    }
  }
  const save = async () => {
    const photos = item.type === 'image' ? (media ? [media.blob] : []) : frames.map((f) => f.blob)
    if (!name.trim()) {
      setProblem(T.result.characterNeedName)
      return
    }
    if (photos.length === 0) {
      setProblem(T.result.characterNeedFrame)
      return
    }
    setSaving(true)
    try {
      const out = await saveCharacter(name, photos)
      toast(T.result.characterSaved(out.character.name, out.added), { testid: 'create-character-saved' })
      onDone()
    } catch (err) {
      // The words of the engine ("Internal error opening backing store") say nothing to a user; a restart is what helps (D-VW).
      setProblem(err instanceof Error ? (brokenStoreError(String(err)) ? T.result.characterNeedsRestart : err.message) : T.result.gone)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="m-k-sec" data-testid="m-create-save-character">
      <Field label={T.result.characterName} placeholder={T.result.characterNamePlaceholder} value={name} onChange={setName} maxLength={40} testid="m-create-save-character-name" />
      {item.type === 'video' ? (
        <>
          <span className="m-label">{T.result.characterFrames}</span>
          {media ? <video ref={video} className="m-k-video" src={media.url} controls playsInline muted preload="auto" aria-label={T.result.characterFrames} /> : <span className="m-cap">{T.result.preparing}</span>}
          <span className="m-cap">{T.result.characterFramesHint(MAX_FRAMES)}</span>
          <Button onPress={() => void addFrame()} disabled={!media || frames.length >= MAX_FRAMES} testid="m-create-save-character-frame">
            {T.result.addFrame}
          </Button>
          {frames.length > 0 ? (
            <div className="m-k-frames">
              {frames.map((frame, i) => (
                <span className="m-k-ref" key={frame.url}>
                  <span className="m-k-thumb">
                    <img src={frame.url} alt="" />
                  </span>
                  <RemoveX label={T.result.removeFrame(i + 1)} testid="m-create-save-character-frame-remove" onPress={() => setFrames((list) => list.filter((f) => f.url !== frame.url))} />
                </span>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <span className="m-cap">{T.result.characterImageHint}</span>
      )}
      {problem ? (
        <Notice variant="error" testid="m-create-save-character-error">
          {problem}
        </Notice>
      ) : null}
      <Button variant="primary" block busy={saving} disabled={!media} onPress={() => void save()} testid="m-create-save-character-save">
        {T.result.characterSave}
      </Button>
    </div>
  )
}

export default function ResultSheet() {
  const { props, sub, pushSub } = useSheet<{ id?: string } | undefined>()
  // Some actions fetch the result first. By then another sheet may be on top.
  const close = useCloseOwnSheet()
  const item = useGalleryItem(props?.id)
  const running = useCreateStore((s) => s.isGenerating)
  const [busy, setBusy] = useState<string | null>(null)

  if (!item) {
    return (
      <Sheet title={T.result.title}>
        <EmptyState title={T.result.gone} testid="m-create-result-gone" />
      </Sheet>
    )
  }
  if (sub === 'character') {
    return (
      <Sheet title={T.result.characterTitle}>
        <SaveCharacter item={item} onDone={close} />
      </Sheet>
    )
  }

  const toTool = async (name: string, tool: ToolId, then?: () => void) => {
    if (busy) return
    setBusy(name)
    const ok = await takeItemAsSource(item, tool)
    setBusy(null)
    if (!ok) return
    nav.resetTo('create')
    then?.()
  }
  const remove = async () => {
    const yes = await nav.confirm({ title: T.result.deleteTitle, text: T.result.deleteText, confirmLabel: T.result.delete, cancelLabel: T.result.keep, tone: 'danger', testid: 'create-delete' })
    if (!yes) return
    deleteItems([item.id])
    toast(T.gal.deleted(1), { testid: 'create-deleted' })
    close()
    // The viewer of a deleted result has nothing left to show.
    const top = nav.getState().stacks.create.at(-1)
    if (top?.route === '/create/item/:id' && top.params.id === item.id) nav.back()
  }
  const sub2 = (name: string, text?: string) => (busy === name ? T.result.preparing : text)
  const locked = running || busy !== null
  const isImage = item.type === 'image'
  const isVideo = item.type === 'video'

  return (
    <Sheet title={T.result.title}>
      <ListGroup>
        {isImage ? (
          <>
            <Row icon={Brush} title={T.result.editMask} subtitle={sub2('mask', T.result.editMaskSub)} disabled={locked} onPress={() => void toTool('mask', 'edit', () => nav.push('/create/mask'))} testid="m-create-result-edit-mask" el="K8.1" />
            <Row icon={Maximize2} title={T.result.enhance} subtitle={sub2('enhance', T.result.enhanceSub)} disabled={locked} onPress={() => void toTool('enhance', 'upscale')} testid="m-create-result-enhance" el="K8.2" />
            <Row icon={Scissors} title={T.result.removeBg} subtitle={sub2('removebg')} disabled={locked} onPress={() => void toTool('removebg', 'removebg')} testid="m-create-result-removebg" el="K8.3" />
            <Row icon={Film} title={T.result.animate} subtitle={sub2('animate')} disabled={locked} onPress={() => void toTool('animate', 'animate')} testid="m-create-result-animate-row" el="K8.4" />
          </>
        ) : null}
        {isVideo && item.jobId ? (
          <>
            <Row
              icon={FastForward}
              title={T.result.extend}
              subtitle={T.result.extendSub}
              disabled={locked}
              onPress={() => {
                if (takeItemAsExtend(item)) nav.resetTo('create')
              }}
              testid="m-create-result-extend-row"
              el="K8.5"
            />
            <Row icon={Sparkles} title={T.result.enhanceVideo} disabled={locked} onPress={() => nav.openSheet('create-enhance', { id: item.id })} testid="m-create-result-enhance-video" />
          </>
        ) : null}
        {item.type === 'audio' && item.jobId ? (
          <Row
            icon={AudioLines}
            title={T.result.useVoice}
            subtitle={T.result.useVoiceSub}
            disabled={locked}
            onPress={() => {
              if (takeItemAsVoice(item)) nav.resetTo('create')
            }}
            testid="m-create-result-use-voice"
          />
        ) : null}
        {isImage || isVideo ? <Row icon={UserRoundPlus} title={T.result.saveCharacter} subtitle={T.result.saveCharacterSub} onPress={() => pushSub('character')} testid="m-create-result-save-character" el="K8.6" /> : null}
        {isImage ? <Row icon={ImageDown} title={T.result.useSource} subtitle={sub2('source')} disabled={locked} onPress={() => void toTool('source', 'edit')} testid="m-create-result-use-source" el="K8.7" /> : null}
      </ListGroup>
      <ListGroup>
        {storePolicy().reportContent ? <Row icon={Flag} title={T.policy.report} chevron={false} onPress={() => reportItem(item)} testid="m-create-result-report-row" /> : null}
        <Row icon={Trash2} title={T.result.delete} danger chevron={false} onPress={() => void remove()} testid="m-create-result-delete" el="K8.8" />
      </ListGroup>
    </Sheet>
  )
}
