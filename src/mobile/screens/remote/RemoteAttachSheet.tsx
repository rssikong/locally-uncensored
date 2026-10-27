/**
 * Add photos to a message of a remote chat. Sheet "remote-attach", strand 6
 * (C4 for R4).
 *
 * Camera and library through the platform seam. The photos wait above the
 * text field of the chat until Send. Files other than photos are not
 * offered: the desktop takes pictures with a chat message and nothing else
 * (REMOTE-PROTOKOLL.md, /api/chat `images`).
 */
import { useState } from 'react'
import { Camera, Image as ImageIcon } from 'lucide-react'
import { MAX_REMOTE_IMAGES } from '../../remote/remoteClientStore'
import { useSheet } from '../../nav'
import { pickPhotos, takePhoto } from '../../platform'
import { REMOTE_STRINGS as S } from '../../strings/remote'
import { ListGroup, Row, Sheet, toast } from '../../ui'
import { addPickedPhotos, photoRoom, usePendingPhotos } from './parts/photos'
import './parts/remote.css'

export default function RemoteAttachSheet() {
  const sheet = useSheet<{ chatId?: string } | undefined>()
  const chatId = sheet.props?.chatId ?? ''
  const have = usePendingPhotos(chatId).length
  const [busy, setBusy] = useState<'camera' | 'library' | null>(null)
  const full = photoRoom(have) === 0
  // Without a chat there is no message a photo could go with. The rows say so instead of taking a tap that does nothing (N14).
  const blocked = !chatId ? S.attach.noChat : full ? S.attach.tooMany(MAX_REMOTE_IMAGES) : undefined

  const add = async (how: 'camera' | 'library') => {
    if (busy || !chatId) return
    setBusy(how)
    try {
      let files: File[] = []
      if (how === 'camera') {
        const shot = await takePhoto()
        files = shot ? [shot.file] : []
      } else {
        files = (await pickPhotos({ multiple: true })).map((picked) => picked.file)
      }
      if (files.length === 0) return
      const result = await addPickedPhotos(chatId, files)
      if (result.overLimit) toast(S.attach.tooMany(MAX_REMOTE_IMAGES), { tone: 'error', testid: 'remote-attach-limit' })
      else if (result.failed) toast(S.attach.failed, { tone: 'error', testid: 'remote-attach-error' })
      if (result.added > 0) sheet.close()
    } catch {
      toast(how === 'camera' ? S.attach.cameraFailed : S.attach.failed, { tone: 'error', testid: 'remote-attach-error' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Sheet title={S.attach.title}>
      <ListGroup testid="m-remote-attach">
        <Row
          title={S.attach.camera}
          icon={Camera}
          onPress={() => void add('camera')}
          subtitle={busy === 'camera' ? S.attach.preparing : undefined}
          disabled={!!blocked}
          disabledReason={blocked}
          risk="sensor" testid="m-remote-attach-camera"
        />
        <Row
          title={S.attach.library}
          icon={ImageIcon}
          onPress={() => void add('library')}
          subtitle={busy === 'library' ? S.attach.preparing : S.attach.librarySub(MAX_REMOTE_IMAGES)}
          disabled={!!blocked}
          disabledReason={blocked}
          risk="sensor" testid="m-remote-attach-library"
        />
      </ListGroup>
      <p className="m-remote-sheet-text">{S.attach.hint}</p>
    </Sheet>
  )
}
