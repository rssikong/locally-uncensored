/**
 * One image of a message as a thumbnail that opens the viewer (C2.32).
 * The bytes are read only once the thumbnail comes near the window, and in
 * the bounded preview size, so a long chat with photos stays light.
 */
import { useEffect, useRef, useState } from 'react'
import type { ImageAttachment } from '../../../../types/chat'
import { attachmentBlob, previewAttachment } from '../../../../lib/chat-attachments'
import { CHAT_STRINGS } from '../../../strings/chat'

const S = CHAT_STRINGS.message

export function ChatImage(props: { image: ImageAttachment; onOpen: () => void }) {
  const { image, onOpen } = props
  const host = useRef<HTMLButtonElement>(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  const [url, setUrl] = useState<string>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = host.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => setNear(entries[0]?.isIntersecting ?? false), { rootMargin: '200px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!near) return
    let cancelled = false
    let objectUrl: string | undefined
    previewAttachment(image, () => cancelled)
      .then((prepared) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(attachmentBlob(prepared.data, prepared.mimeType))
        setUrl(objectUrl)
        setFailed(false)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(undefined)
    }
  }, [image, near])

  const name = image.name || 'image'
  return (
    <button ref={host} type="button" className="m-chat-thumb" aria-label={S.image(name)} data-testid="m-chat-image" data-el="C2.32" data-state={url ? 'ready' : failed ? 'failed' : 'loading'} onClick={onOpen}>
      {url ? <img src={url} alt="" decoding="async" draggable={false} /> : <span>{failed ? S.imageUnavailable : name}</span>}
    </button>
  )
}
