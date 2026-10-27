/**
 * Turn a file reference of a chat into something the viewer can show and the
 * share sheet can take: the bytes of an image, the text of an artifact, or
 * only the description when the bytes were never kept.
 */
import type { Conversation } from '../../../../types/chat'
import { attachmentBlob, originalAttachment } from '../../../../lib/chat-attachments'
import type { Draft } from './logic/drafts'
import { decodeFileRef } from './logic/messages'
import { readWorkspaceFile } from './workspace-files'

export type FileSource =
  | { kind: 'image'; name: string; mime: string; blob: Blob }
  | { kind: 'text'; name: string; mime: string; text: string; blob: Blob }
  /** No preview. `blob` is set when the bytes can still be shared, `summary` is what the model was told. */
  | { kind: 'other'; name: string; mime: string; size: number; summary?: string; blob?: Blob }

/** Mime types that read as text in the viewer. */
export function isTextMime(mime: string, name: string): boolean {
  if (/^text\//.test(mime)) return true
  if (/(json|xml|javascript|typescript|yaml|x-sh|sql|csv|svg)/.test(mime)) return true
  return /\.(md|txt|json|csv|tsv|xml|html?|css|js|jsx|ts|tsx|py|rs|go|java|kt|swift|c|h|cpp|sh|yaml|yml|toml|ini|log|sql|svg)$/i.test(name)
}

function extensionFor(mime: string): string {
  const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '')
  return ext || 'png'
}

/** An image name always carries an extension, so Photos and share targets know the type. */
export function imageFileName(name: string | undefined, mime: string): string {
  const base = (name ?? '').trim() || 'image'
  return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.${extensionFor(mime)}`
}

/** Null when the reference points at nothing (a deleted message, a draft that was sent). */
export async function resolveFile(fileId: string, chat: Conversation | undefined, draft: Draft | undefined): Promise<FileSource | null> {
  const ref = decodeFileRef(fileId)
  if (!ref) return null
  // A file the agent wrote into the folder of this chat, read through the file commands of the app.
  if (ref.kind === 'workspace') return chat ? readWorkspaceFile(chat.id, ref.path) : null
  if (ref.kind === 'draft-image') {
    const image = draft?.images[ref.index]
    if (!image) return null
    return { kind: 'image', name: imageFileName(image.name, image.mimeType), mime: image.mimeType, blob: attachmentBlob(image.data, image.mimeType) }
  }
  if (ref.kind === 'draft-file') {
    const input = draft?.files[ref.index]
    if (!input) return null
    const { attachment, file } = input
    const mime = file?.type || 'application/octet-stream'
    if (file && isTextMime(mime, attachment.name) && file.size <= 512 * 1024) {
      return { kind: 'text', name: attachment.name, mime: mime || 'text/plain', text: await file.text(), blob: file }
    }
    if (file && /^image\//.test(mime)) return { kind: 'image', name: attachment.name, mime, blob: file }
    return { kind: 'other', name: attachment.name, mime, size: attachment.size, summary: attachment.summary, blob: file }
  }
  const message = chat?.messages.find((m) => m.id === ref.messageId)
  if (!message) return null
  if (ref.kind === 'image') {
    const image = message.images?.[ref.index]
    if (!image) return null
    const original = await originalAttachment(image)
    return { kind: 'image', name: imageFileName(image.name, image.mimeType), mime: image.mimeType, blob: attachmentBlob(original.data, image.mimeType) }
  }
  if (ref.kind === 'artifact') {
    const artifact = message.artifacts?.find((a) => a.id === ref.artifactId)
    if (!artifact) return null
    const blob = new Blob([artifact.content], { type: artifact.mime || 'text/plain' })
    if (isTextMime(artifact.mime, artifact.name)) return { kind: 'text', name: artifact.name, mime: artifact.mime || 'text/plain', text: artifact.content, blob }
    return { kind: 'other', name: artifact.name, mime: artifact.mime, size: blob.size, blob }
  }
  const file = message.files?.[ref.index]
  if (!file) return null
  return { kind: 'other', name: file.name, mime: 'application/octet-stream', size: file.size, summary: file.summary }
}
