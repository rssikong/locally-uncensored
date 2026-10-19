// @vitest-environment jsdom
/**
 * A still out of a video (lib/video-frames): the frame is drawn at the video's
 * own size and comes back as a JPEG, and a video without a picture says so.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DEFAULT_EVEN_FRAMES, MAX_EVEN_FRAMES, MIN_EVEN_FRAMES, clampFrameCount, evenFrameTimes, frameFileName, framesAcrossVideo, grabFrame, lastFrame } from '../video-frames'

afterEach(() => vi.restoreAllMocks())

function fakeCanvas(toBlob: (cb: (b: Blob | null) => void, type: string, q: number) => void, draw = vi.fn()) {
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: draw }), toBlob }
  const real = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => (tag === 'canvas' ? canvas : real(tag))) as typeof document.createElement)
  return { canvas, draw }
}

describe('grabFrame', () => {
  it('draws the frame at the size of the video and returns a JPEG', async () => {
    const seen: { type: string; q: number }[] = []
    const { canvas, draw } = fakeCanvas((cb, type, q) => { seen.push({ type, q }); cb(new Blob(['jpg'], { type })) })
    const video = { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement
    const blob = await grabFrame(video)
    expect(canvas.width).toBe(1280)
    expect(canvas.height).toBe(720)
    expect(draw).toHaveBeenCalledWith(video, 0, 0, 1280, 720)
    expect(seen).toEqual([{ type: 'image/jpeg', q: 0.92 }])
    expect(blob.type).toBe('image/jpeg')
  })

  it('a video that has not loaded says so', async () => {
    await expect(grabFrame({ videoWidth: 0, videoHeight: 0 } as HTMLVideoElement)).rejects.toThrow('The video has no picture yet. Let it load, then try again.')
  })

  it('a frame the browser will not hand out is an error, not a broken photo', async () => {
    fakeCanvas((cb) => cb(null))
    await expect(grabFrame({ videoWidth: 64, videoHeight: 64 } as HTMLVideoElement)).rejects.toThrow('Could not read this frame.')
    fakeCanvas(() => { throw new Error('SecurityError') })
    await expect(grabFrame({ videoWidth: 64, videoHeight: 64 } as HTMLVideoElement)).rejects.toThrow('Could not read this frame.')
  })
})

describe('frameFileName', () => {
  it('numbers the frames under the character name', () => {
    expect(frameFileName('Mira Vale', 0)).toBe('mira-vale-01.jpg')
    expect(frameFileName('Zoë / 2', 11)).toBe('zoë-2-12.jpg')
    expect(frameFileName('  ', 0)).toBe('character-01.jpg')
  })
})

describe('frames spread over a clip', () => {
  it('takes the middle of each equal part, never the very first or last frame', () => {
    expect(evenFrameTimes(8, 8)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5])
    expect(evenFrameTimes(2, 4)).toEqual([0.25, 0.75, 1.25, 1.75])
  })

  it('keeps the count between 4 and 20, and a clip without a length gives nothing', () => {
    expect([clampFrameCount(1), clampFrameCount(7.6), clampFrameCount(99), clampFrameCount(NaN)])
      .toEqual([MIN_EVEN_FRAMES, 8, MAX_EVEN_FRAMES, DEFAULT_EVEN_FRAMES])
    expect([MIN_EVEN_FRAMES, DEFAULT_EVEN_FRAMES, MAX_EVEN_FRAMES]).toEqual([4, 8, 20])
    expect(evenFrameTimes(Infinity, 8)).toEqual([])
    expect(evenFrameTimes(NaN, 8)).toEqual([])
    expect(evenFrameTimes(0, 8)).toEqual([])
  })
})

/** A video element as far as framesAcrossVideo uses it: it loads, it seeks,
 *  and each seek lands where it was sent. */
function fakeVideo(duration: number, { failSeek = false } = {}) {
  const target = new EventTarget()
  const seeks: number[] = []
  let time = 0
  const video = {
    muted: false, preload: '', playsInline: false, videoWidth: 320, videoHeight: 240, duration,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    removeAttribute: vi.fn(),
    load: vi.fn(),
    get currentTime() { return time },
    set currentTime(t: number) {
      time = t
      seeks.push(t)
      setTimeout(() => target.dispatchEvent(new Event(failSeek ? 'error' : 'seeked')), 0)
    },
    set src(_url: string) { setTimeout(() => target.dispatchEvent(new Event('loadeddata')), 0) },
  }
  return { video, seeks }
}

function fakeMedia(duration: number, opts?: { failSeek?: boolean }) {
  const { video, seeks } = fakeVideo(duration, opts)
  const drawn: number[] = []
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: () => drawn.push(video.currentTime) }),
    toBlob: (cb: (b: Blob | null) => void, type: string) => cb(new Blob([`at ${video.currentTime}`], { type })),
  }
  const real = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'video' ? video : tag === 'canvas' ? canvas : real(tag)) as typeof document.createElement)
  return { video, seeks, drawn }
}

describe('framesAcrossVideo', () => {
  it('seeks to each place in turn and draws the frame shown there', async () => {
    const { video, seeks, drawn } = fakeMedia(4)
    const heard: number[] = []
    const frames = await framesAcrossVideo('blob:clip', 4, { onFrame: (_b, i) => heard.push(i) })
    expect(seeks).toEqual([0.5, 1.5, 2.5, 3.5])
    expect(drawn).toEqual([0.5, 1.5, 2.5, 3.5])
    expect(await Promise.all(frames.map((f) => f.text()))).toEqual(['at 0.5', 'at 1.5', 'at 2.5', 'at 3.5'])
    expect(frames.every((f) => f.type === 'image/jpeg')).toBe(true)
    expect(heard).toEqual([0, 1, 2, 3])
    // The decoder is let go at once.
    expect(video.removeAttribute).toHaveBeenCalledWith('src')
    expect(video.load).toHaveBeenCalled()
  })

  it('stops after the frame in hand when the window closes', async () => {
    const { seeks } = fakeMedia(10)
    const stop = new AbortController()
    const frames = await framesAcrossVideo('blob:clip', 8, { signal: stop.signal, onFrame: (_b, i) => { if (i === 1) stop.abort() } })
    expect(frames).toHaveLength(2)
    expect(seeks).toHaveLength(2)
  })

  it('a clip without a length, or one that will not seek, is an error in plain words', async () => {
    fakeMedia(Infinity)
    await expect(framesAcrossVideo('blob:clip', 8)).rejects.toThrow('Could not read how long this video is.')
    vi.restoreAllMocks()
    const { video } = fakeMedia(4, { failSeek: true })
    await expect(framesAcrossVideo('blob:clip', 4)).rejects.toThrow('Could not move through the video.')
    expect(video.load).toHaveBeenCalled()
  })
})

/** A video element that loads at once and seeks where it is told. A duration
 *  of Infinity stands for a clip a browser recorded: it knows its length only
 *  once it was sought past the end. */
function fakeClip(duration: number, realLength = 4) {
  const target = new EventTarget()
  const seeks: number[] = []
  const video = {
    muted: false, preload: '', videoWidth: 768, videoHeight: 512, duration,
    addEventListener: target.addEventListener.bind(target),
    set src(_url: string) { queueMicrotask(() => target.dispatchEvent(new Event('loadedmetadata'))) },
    set currentTime(t: number) {
      seeks.push(t)
      if (!Number.isFinite(video.duration)) video.duration = realLength
      queueMicrotask(() => target.dispatchEvent(new Event('seeked')))
    },
  }
  return { video: video as unknown as HTMLVideoElement, seeks }
}

describe('lastFrame (Extend Video)', () => {
  it('seeks just before the end and draws that frame at the size of the video, as a PNG', async () => {
    const seen: string[] = []
    const { canvas, draw } = fakeCanvas((cb, type) => { seen.push(type); cb(new Blob(['png'], { type })) })
    const { video, seeks } = fakeClip(2.04)
    const blob = await lastFrame('blob:clip', () => video)
    expect(seeks).toEqual([1.99])
    expect([canvas.width, canvas.height]).toEqual([768, 512])
    expect(draw).toHaveBeenCalledWith(video, 0, 0)
    expect(seen).toEqual(['image/png'])
    expect(blob.type).toBe('image/png')
  })

  it('a recorded clip without a duration is sought past its end first, then to its last frame', async () => {
    fakeCanvas((cb, type) => cb(new Blob(['png'], { type })))
    const { video, seeks } = fakeClip(Infinity, 3)
    await lastFrame('blob:clip', () => video)
    expect(seeks).toEqual([1e7, 2.95])
  })

  it('a frame the browser will not hand out is an error', async () => {
    fakeCanvas((cb) => cb(null))
    const { video } = fakeClip(2)
    await expect(lastFrame('blob:clip', () => video)).rejects.toThrow('could not capture the frame')
  })
})
