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

/**
 * Does this URL show a clip rather than a picture. VHS_VideoCombine writes
 * .mp4, some workflows .webm; animated .webp animates fine inside <img> and
 * stays a picture. A /view URL carries the name in its `filename=` param (its
 * tail is `&type=output`), any other URL in its path. Ask this of the ORIGINAL
 * address: a rescued blob: URL has no name left to read.
 */
export function isInlineVideoUrl(url: string): boolean {
  const m = /[?&]filename=([^&]+)/i.exec(url)
  if (m) {
    try { return /\.(mp4|webm)$/i.test(decodeURIComponent(m[1])) } catch { return /\.(mp4|webm)$/i.test(m[1]) }
  }
  return /\.(mp4|webm)(?=[?#]|$)/i.test(url)
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

/**
 * How long the rescue keeps asking, in ms between tries. A chat reopened right
 * after the app starts asks before ComfyUI is up: the direct load and the first
 * proxy fetch both fail, and a single try left the picture or clip broken for
 * good although the file was on disk all along (3.0.8 A1, David's box run:
 * the clip came back as a broken "Generated image" after LU was restarted).
 * The same holds while ComfyUI restarts. A cold ComfyUI start takes up to a
 * minute or two, so the tries grow to 30 s and stop after about ten minutes.
 */
export const RESCUE_RETRY_MS = [1000, 2000, 3000, 5000, 8000, 13000, 20000, ...Array<number>(18).fill(30000)]

export interface ComfyViewRescue {
  /** The blob: URL standing in for the address, once the bytes arrived. */
  url: string | null
  /** The direct load failed and the proxy is still being asked. */
  waiting: boolean
}

/**
 * The blob: URL standing in for `url` once its direct load failed. Only the
 * /view address is ever stored with the chat (filename, subfolder, type), so
 * the bytes are fetched fresh every time the chat is shown, never from an old
 * blob: URL.
 */
export function useComfyViewRescueState(url: string | null, failed: boolean): ComfyViewRescue {
  const [rescued, setRescued] = useState<{ base: string; url: string } | null>(null)
  const [gaveUp, setGaveUp] = useState<string | null>(null)
  const active = failed && isRescuableComfyView(url) && isTauri()
  useEffect(() => {
    if (!active || !url) return
    let live = true
    let made: string | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const attempt = (n: number) => {
      fetchLocalhostBytes(url)
        .then((bytes) => {
          made = URL.createObjectURL(new Blob([bytes], { type: comfyMediaMime(viewFilename(url)) }))
          if (!live) { URL.revokeObjectURL(made); return }
          setRescued({ base: url, url: made })
        })
        .catch(() => {
          if (!live) return
          if (n >= RESCUE_RETRY_MS.length) { setGaveUp(url); return }
          timer = setTimeout(() => attempt(n + 1), RESCUE_RETRY_MS[n])
        })
    }
    attempt(0)
    return () => {
      live = false
      if (timer) clearTimeout(timer)
      if (made) URL.revokeObjectURL(made)
    }
  }, [active, url])
  const got = rescued && rescued.base === url ? rescued.url : null
  return { url: got, waiting: active && !got && gaveUp !== url }
}

/** The blob: URL standing in for `url` once its direct load failed, else null. */
export function useComfyViewRescue(url: string | null, failed: boolean): string | null {
  return useComfyViewRescueState(url, failed).url
}
