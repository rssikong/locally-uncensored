/**
 * C4 Add to message. Sheet "attach", strand 1 (Chat core).
 *
 * Opened with nav.openSheet('attach', { chatId }). What is picked lands in
 * the draft of that chat and shows as a chip above the text field (C2.15).
 * Photos and files come through the platform seam, which opens the pickers
 * of the system.
 */
import { useState } from 'react'
import { Camera, File, Files, Image as ImageIcon } from 'lucide-react'
import { MAX_CHAT_FILES, MAX_CHAT_FILE_BYTES, prepareChatFile } from '../../../lib/chat-files'
import { MAX_CHAT_IMAGES, prepareChatImages } from '../../../lib/chat-image-input'
import { useModelStore } from '../../../stores/modelStore'
import { useRAGStore } from '../../../stores/ragStore'
import { nav, useSheet } from '../../nav'
import { pickDocuments, pickPhotos, takePhoto, type PickedFile } from '../../platform'
import { CHAT_STRINGS } from '../../strings/chat'
import { ListGroup, Row, Sheet, toast } from '../../ui'
import './parts/chat.css'
import { NEW_CHAT_KEY, useDraftStore } from './parts/logic/drafts'
import { useReadingStore } from './parts/logic/reading'
import { startChat } from './parts/start-chat'
import { modelReadsImages } from './parts/vision'
import { fileAccept, imagesRowState, type ImagesRowState } from './parts/attach-rules'
import { mobileOS } from '../../platform/detect'

const S = CHAT_STRINGS.attach
const FILE_MB = Math.round(MAX_CHAT_FILE_BYTES / (1024 * 1024))
/** What the two picture rows say while no photo can be attached. */
const BLOCKED: Record<Exclude<ImagesRowState, 'ready'>, string> & { ready: undefined } = {
  ready: undefined,
  'none-installed': S.noneInstalled,
  'no-model': S.noModel,
  gone: S.modelGone,
  'no-vision': S.noVision,
}

export default function AttachSheet() {
  const sheet = useSheet<{ chatId?: string } | undefined>()
  const chatKey = sheet.props?.chatId ?? NEW_CHAT_KEY
  const activeModel = useModelStore((s) => s.activeModel)
  const models = useModelStore((s) => s.models)
  const documents = useRAGStore((s) => s.documents[chatKey]?.length ?? 0)
  const [busy, setBusy] = useState<'photo' | 'library' | 'file' | null>(null)

  // Without a model the rows do not speak of a "chosen model" (P7), and a model that is gone promises nothing (round 22, N11).
  const images = imagesRowState(activeModel, models, (name) => modelReadsImages(name, models))
  const canSee = images === 'ready'
  const blocked = BLOCKED[images]
  const isSavedChat = chatKey !== NEW_CHAT_KEY

  const toVisionModels = () => {
    // The sheet "model" replaces this one: the user picks a model that reads images and comes back to the chat.
    sheet.close()
    nav.openSheet('model', { vision: true })
  }

  const toDocuments = () => {
    if (isSavedChat) {
      nav.push('/chat/:id/documents', { id: chatKey })
      return
    }
    // A document comes before the first question, so the chat starts here and not with the first message.
    const id = startChat({ keepDraft: true })
    if (!id) {
      sheet.close()
      toast(CHAT_STRINGS.chat.chooseFirst, { testid: 'choose-model' })
      nav.openSheet('model')
      return
    }
    sheet.close()
    nav.replace('/chat/:id', { id })
    nav.push('/chat/:id/documents', { id })
  }

  const addImages = async (picked: PickedFile[]) => {
    if (picked.length === 0) return
    const room = MAX_CHAT_IMAGES - (useDraftStore.getState().drafts[chatKey]?.images.length ?? 0)
    if (room <= 0) {
      toast(S.tooManyImages(MAX_CHAT_IMAGES), { tone: 'error', testid: 'attach-limit' })
      return
    }
    const { images, errors } = await prepareChatImages(
      picked.map((p) => p.file),
      room,
    )
    if (images.length > 0) useDraftStore.getState().addImages(chatKey, images)
    if (picked.length > room) toast(S.tooManyImages(MAX_CHAT_IMAGES), { tone: 'error', testid: 'attach-limit' })
    else if (errors.length > 0) toast(errors[0] || S.imageFailed, { tone: 'error', testid: 'attach-error' })
    if (images.length > 0) sheet.close()
  }

  const addFiles = async (picked: PickedFile[]) => {
    if (picked.length === 0) return
    const room = MAX_CHAT_FILES - (useDraftStore.getState().drafts[chatKey]?.files.length ?? 0)
    if (room <= 0) {
      toast(S.tooManyFiles(MAX_CHAT_FILES), { tone: 'error', testid: 'attach-limit' })
      return
    }
    let problem: { text: string; id: string } | null = picked.length > room ? { text: S.tooManyFiles(MAX_CHAT_FILES), id: 'attach-limit' } : null
    let closed = false
    for (const item of picked.slice(0, room)) {
      if (item.size > MAX_CHAT_FILE_BYTES) {
        problem = { text: S.tooLarge(FILE_MB), id: 'attach-too-large' }
        continue
      }
      // Reading a PDF or a scan takes seconds: the sheet gives way to the chat, where a chip says what is being read.
      const reading = useReadingStore.getState()
      reading.begin(chatKey, item.file.name)
      if (!closed) {
        closed = true
        sheet.close()
      }
      try {
        // The reader of the documents of a chat reads a PDF or a Word file here too (round 23, N15).
        const prepared = await prepareChatFile(item.file, { readDocument: async (file) => (await import('../../../api/rag')).extractText(file) })
        useDraftStore.getState().addFiles(chatKey, [prepared])
        if (prepared.notice && !problem) problem = { text: prepared.notice, id: 'attach-unreadable' }
      } catch {
        problem = { text: S.fileFailed, id: 'attach-error' }
      } finally {
        reading.end(chatKey, item.file.name)
      }
    }
    if (problem) toast(problem.text, { tone: 'error', testid: problem.id })
  }

  const run = (kind: 'photo' | 'library' | 'file', work: () => Promise<void>) => {
    if (busy) return
    setBusy(kind)
    void work()
      .catch(() => toast(kind === 'file' ? S.fileFailed : S.imageFailed, { tone: 'error', testid: 'attach-error' }))
      .finally(() => setBusy(null))
  }

  return (
    <Sheet title={S.title}>
      <ListGroup>
        <Row
          title={S.takePhoto}
          icon={Camera}
          subtitle={canSee ? (busy === 'photo' ? S.preparing : undefined) : blocked}
          chevron={false}
          onPress={canSee ? () => run('photo', async () => addImages([await takePhoto()].filter((p): p is PickedFile => !!p))) : toVisionModels}
          risk="sensor" testid="m-chat-attach-photo"
          el="C4.1"
        />
        <Row
          title={S.library}
          icon={ImageIcon}
          subtitle={canSee ? (busy === 'library' ? S.preparing : S.librarySub(MAX_CHAT_IMAGES)) : blocked}
          chevron={false}
          onPress={canSee ? () => run('library', async () => addImages(await pickPhotos({ multiple: true }))) : toVisionModels}
          risk="sensor" testid="m-chat-attach-library"
          el="C4.2"
        />
        <Row
          title={S.file}
          icon={File}
          subtitle={busy === 'file' ? S.preparing : S.fileSub(MAX_CHAT_FILES, FILE_MB)}
          chevron={false}
          onPress={() => run('file', async () => addFiles(await pickDocuments({ multiple: true, maxFiles: MAX_CHAT_FILES + 1, maxBytes: MAX_CHAT_FILE_BYTES, accept: fileAccept(mobileOS()) })))}
          testid="m-chat-attach-file"
          el="C4.3"
        />
        <Row
          title={S.documents}
          icon={Files}
          subtitle={isSavedChat ? S.documentsSub(documents) : S.documentsFirst}
          onPress={toDocuments}
          testid="m-chat-attach-documents"
          el="C4.4"
        />
      </ListGroup>
    </Sheet>
  )
}
