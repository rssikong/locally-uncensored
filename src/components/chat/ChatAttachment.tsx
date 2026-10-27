import { useEffect, useRef, useState } from 'react'
import type { ImageAttachment } from '../../types/chat'
import { attachmentBlob, originalAttachment, previewAttachment, referenceId } from '../../lib/chat-attachments'
import { backendCall, isTauri } from '../../api/backend'
import { isMobile } from '../../lib/device-kind'
import { saveOrShare } from '../../lib/save-or-share'

/** Offscreen messages hold no data URLs, decoded images or object URLs. */
export function ChatAttachment({ image }: { image: ImageAttachment }) {
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    const element = host.current
    if (!element) return
    const observer = new IntersectionObserver(entries => setVisible(entries[0]?.isIntersecting ?? false), { rootMargin: '120px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let objectUrl: string | undefined
    // Thumbnails have their own small queue, so scrolling never delays a send.
    void previewAttachment(image, () => cancelled).then(prepared => {
      if (cancelled) return
      objectUrl = URL.createObjectURL(attachmentBlob(prepared.data, prepared.mimeType))
      setUrl(objectUrl)
      setError(undefined)
    }).catch(() => { if (!cancelled) setError('Preview unavailable. Click to save the original.') })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); setUrl(undefined) }
  }, [image, visible])
  async function save() {
    try {
      const id = referenceId(image.data)
      const extension = (image.mimeType.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '')
      // Desktop: a native Save As. An anchor on a blob URL is unreliable in
      // WebView2 (see save_binary_file_dialog), so it is the browser path only.
      // Not on a phone: its dialog commands answer with an error, the original
      // goes to the share sheet below instead.
      if (isTauri() && !isMobile()) {
        if (id) {
          await backendCall('save_chat_attachment_dialog', { id, defaultName: image.name || 'image', mimeType: image.mimeType })
        } else {
          const bytes = new Uint8Array(await attachmentBlob(image.data, image.mimeType).arrayBuffer())
          const outcome = await saveOrShare({ filename: image.name || 'image', mime: image.mimeType, bytes }, { extension, extLabel: 'Image' })
          if (outcome.status === 'error') throw new Error(outcome.error)
        }
        return
      }
      // Browser build: a download. Phone: the share sheet. Both get the
      // stored original, not the thumbnail.
      const original = await originalAttachment(image)
      const bytes = new Uint8Array(await attachmentBlob(original.data, image.mimeType).arrayBuffer())
      const outcome = await saveOrShare({ filename: image.name || `image.${extension}`, mime: image.mimeType, bytes })
      if (outcome.status === 'error') {
        // On a phone the reason is worth showing: it is about sharing, not
        // about the attachment.
        if (isMobile()) { setError(outcome.error); return }
        throw new Error(outcome.error)
      }
    } catch { setError('Attachment unavailable. Please attach the original image again.') }
  }
  return <div ref={host} className="w-[180px] min-h-[120px]">
    <button type="button" onClick={() => void save()} title="Save original image" className="text-left">
      {url ? <img src={url} width={180} height={120} decoding="async" alt={image.name}
        className="max-w-[180px] max-h-[120px] object-contain rounded-md border border-white/10 hover:border-white/25 transition-colors" />
        : <span className="text-xs text-zinc-400">{image.name}</span>}
    </button>
    {error && <p role="status" className="text-xs text-zinc-400">{error}</p>}
  </div>
}
