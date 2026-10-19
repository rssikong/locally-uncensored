import { useEffect, useState } from 'react'
import { isTauri, fetchLocalhostBytes } from '../../api/backend'

/**
 * Desktop rescue for a ComfyUI /view picture in the chat.
 *
 * A current ComfyUI answers the WebView's cross-origin <img>/<video> load of
 * an absolute http://localhost:<port>/view URL with a 403 (Sec-Fetch-Site),
 * the block the Create gallery met in #75 and has rescued since through the
 * app's own localhost proxy (useComfyMedia, proxiedComfyBlobUrl). The chat had
 * no such rescue, so a picture made there stayed a broken frame with a dead
 * localhost link (Discord, thread "I can't launch Wan2.2", 15.10.2026).
 *
 * After the element reported an error, the bytes are fetched through the proxy
 * once and handed back as a blob: URL, which is released when the URL changes
 * or the element goes away. A relative /comfyui/view path (web build) and any
 * URL that is not a ComfyUI /view are left alone.
 */

/** The type of a ComfyUI output file, for the blob the rescue makes. */
export function comfyMediaMime(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || ''
  if (ext === 'mp4') return 'video/mp4'
  if (ext === 'webm') return 'video/webm'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  return 'image/png'
}

/** Is this an absolute ComfyUI /view URL the desktop proxy can fetch. */
export function isRescuableComfyView(url: string | null | undefined): url is string {
  if (!url || !/^https?:\/\//i.test(url)) return false
  return /\/view\?/i.test(url) && /[?&]filename=/i.test(url)
}

function viewFilename(url: string): string {
  const m = /[?&]filename=([^&]+)/i.exec(url)
  try { return m ? decodeURIComponent(m[1]) : '' } catch { return '' }
}

/** The blob: URL standing in for `url` once its direct load failed, else null. */
export function useComfyViewRescue(url: string | null, failed: boolean): string | null {
  const [rescued, setRescued] = useState<{ base: string; url: string } | null>(null)
  useEffect(() => {
    if (!failed || !isRescuableComfyView(url) || !isTauri()) return
    let live = true
    let made: string | null = null
    fetchLocalhostBytes(url)
      .then((bytes) => {
        made = URL.createObjectURL(new Blob([bytes], { type: comfyMediaMime(viewFilename(url)) }))
        if (!live) { URL.revokeObjectURL(made); return }
        setRescued({ base: url, url: made })
      })
      .catch(() => { /* the broken frame stays; there is nothing better to show */ })
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [failed, url])
  return rescued && rescued.base === url ? rescued.url : null
}
