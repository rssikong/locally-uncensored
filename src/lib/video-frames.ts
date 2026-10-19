// A still out of a playing video: the frame on screen, drawn onto a canvas.
// No decoder, no dependency. The video has to come from a blob: URL (or the
// app's own origin), a frame of a foreign URL cannot be read back.

/** The frame the video shows right now, as a JPEG. */
export function grabFrame(video: HTMLVideoElement, quality = 0.92): Promise<Blob> {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) return Promise.reject(new Error('The video has no picture yet. Let it load, then try again.'))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Could not read this frame.'))
  return new Promise<Blob>((resolve, reject) => {
    try {
      ctx.drawImage(video, 0, 0, width, height)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not read this frame.'))), 'image/jpeg', quality)
    } catch {
      reject(new Error('Could not read this frame.'))
    }
  })
}

/** The file name of the n-th frame of a character. */
export function frameFileName(name: string, index: number): string {
  const base = name.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'character'
  return `${base}-${String(index + 1).padStart(2, '0')}.jpg`
}

/** How many frames "Use frames for a character" takes across a video, and
 *  the range the user can pick from. */
export const DEFAULT_EVEN_FRAMES = 8
export const MIN_EVEN_FRAMES = 4
export const MAX_EVEN_FRAMES = 20

/** A frame count inside the range, whole. */
export function clampFrameCount(count: number): number {
  if (!Number.isFinite(count)) return DEFAULT_EVEN_FRAMES
  return Math.min(MAX_EVEN_FRAMES, Math.max(MIN_EVEN_FRAMES, Math.round(count)))
}

/**
 * Where to take `count` frames so they spread evenly over the clip: the
 * middle of each of `count` equal parts. Never the very first or last frame,
 * which are often a fade or a cut.
 */
export function evenFrameTimes(duration: number, count: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return []
  const n = clampFrameCount(count)
  return Array.from({ length: n }, (_, i) => ((i + 0.5) * duration) / n)
}

/** How long one load or one seek may take before the video counts as stuck. */
const MEDIA_WAIT_MS = 15_000

function waitFor(video: HTMLVideoElement, event: 'loadeddata' | 'seeked', what: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const done = (err?: Error) => {
      clearTimeout(timer)
      video.removeEventListener(event, ok)
      video.removeEventListener('error', fail)
      if (err) reject(err)
      else resolve()
    }
    const ok = () => done()
    const fail = () => done(new Error(`Could not ${what}.`))
    const timer = setTimeout(() => done(new Error(`Could not ${what}: the video did not answer.`)), MEDIA_WAIT_MS)
    video.addEventListener(event, ok)
    video.addEventListener('error', fail)
  })
}

/**
 * `count` frames spread evenly over a video, as JPEGs, in order. The same way
 * the app takes the last frame for Extend: a video element of its own, a seek,
 * the frame drawn onto a canvas. No decoder, no dependency. `src` has to be a
 * blob: URL (or the app's own origin), see grabFrame.
 *
 * `onFrame` hears about each frame as it arrives, so the window can show them
 * one by one. An aborted `signal` stops after the frame in hand.
 */
export async function framesAcrossVideo(
  src: string,
  count: number,
  opts: { signal?: AbortSignal; onFrame?: (frame: Blob, index: number) => void } = {},
): Promise<Blob[]> {
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.playsInline = true
  const loaded = waitFor(video, 'loadeddata', 'load the video')
  video.src = src
  try {
    await loaded
    const times = evenFrameTimes(video.duration, count)
    if (times.length === 0) throw new Error('Could not read how long this video is.')
    const frames: Blob[] = []
    for (const [index, time] of times.entries()) {
      if (opts.signal?.aborted) break
      const seeked = waitFor(video, 'seeked', 'move through the video')
      video.currentTime = time
      await seeked
      const frame = await grabFrame(video)
      frames.push(frame)
      opts.onFrame?.(frame, index)
    }
    return frames
  } finally {
    // Let go of the decoder at once instead of when the element is collected.
    video.removeAttribute('src')
    video.load()
  }
}

/** Resolves on the first `event` of the element, rejects on its `error`. */
function once(el: HTMLMediaElement, event: 'loadedmetadata' | 'seeked', failure: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    el.addEventListener(event, () => resolve(), { once: true })
    el.addEventListener('error', () => reject(new Error(failure)), { once: true })
  })
}

/**
 * The last frame of a video as a PNG, at the video's own size. Extend Video
 * continues a clip from it on Windows and on the Mac: it becomes the start
 * image of an image to video run. The video has to come from a blob: URL (or
 * the app's own origin), as for `grabFrame`.
 *
 * A clip a browser recorded (MediaRecorder) reports no duration until it was
 * sought to its end, so where the duration is not a number the seek goes far
 * past the end first, and the browser then knows it. The frame is taken a
 * moment before the end: some containers refuse a seek to the duration
 * itself.
 */
export async function lastFrame(videoUrl: string, makeVideo: () => HTMLVideoElement = () => document.createElement('video')): Promise<Blob> {
  const video = makeVideo()
  video.muted = true
  video.preload = 'auto'
  const loaded = once(video, 'loadedmetadata', 'could not read the video')
  video.src = videoUrl
  await loaded
  if (!Number.isFinite(video.duration)) {
    const found = once(video, 'seeked', 'could not seek the video')
    video.currentTime = 1e7
    await found
  }
  const end = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1
  const sought = once(video, 'seeked', 'could not seek the video')
  video.currentTime = Math.max(0, end - 0.05)
  await sought
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth || 832
  canvas.height = video.videoHeight || 480
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('could not capture the frame')
  ctx.drawImage(video, 0, 0)
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not capture the frame'))), 'image/png'))
}
