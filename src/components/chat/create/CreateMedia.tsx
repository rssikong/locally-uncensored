// MIRRORED from the web app (components/chat/create/CreateMedia.tsx), without its comments. Do not edit here.
// scripts/create-chat-mirror.mjs writes this file, and web-parity.test.ts
// holds it to its source. Only the import paths differ, the places listed
// under PATCHES in that script, and the classes under CLASSES.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Pause, Play, X } from 'lucide-react'
import type { CreateMediaView } from './types'
import { formatClock, formatCredits } from './format'
import { saveChatMedia as download } from './save-media'
import { OverTheApp } from './OverTheApp'
import { PromptDetails } from '../../create/experimental/PromptDetails'

function fileName(media: CreateMediaView): string {
  const ext = media.kind === 'image' ? 'png' : media.kind === 'video' ? 'mp4' : 'mp3'
  const base = media.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lu-create'
  return `${base}.${ext}`
}

function Lightbox({ src, prompt, onClose }: { src: string; prompt?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
      className="lu-on-dark fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
    >
      <img src={src} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
      {prompt && (
        <PromptDetails
          item={{ prompt }}
          open
          className="absolute bottom-4 left-1/2 max-h-[40vh] w-[calc(100%-2rem)] -translate-x-1/2 overflow-y-auto bg-black/70"
        />
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 rounded-full bg-neutral-700 p-2 text-neutral-100 hover:bg-neutral-600"
      >
        <X size={16} />
      </button>
    </div>
  )
}

function waveBars(seed: string, count: number): number[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  const bars: number[] = []
  for (let i = 0; i < count; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    const r = ((h ^ (h >>> 16)) >>> 0) / 4294967295
    const envelope = 0.45 + 0.55 * Math.sin((Math.PI * (i + 0.5)) / count)
    bars.push(Math.max(0.12, Math.min(1, envelope * (0.35 + 0.65 * r))))
  }
  return bars
}

function AudioTrack({ media }: { media: CreateMediaView }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const bars = useMemo(() => waveBars(media.url, 56), [media.url])
  const share = duration > 0 ? time / duration : 0
  const toggle = () => {
    const el = ref.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el || !duration) return
    const box = e.currentTarget.getBoundingClientRect()
    el.currentTime = ((e.clientX - box.left) / box.width) * duration
  }
  return (
    <div className="flex items-center gap-3 px-3 py-3">
      <audio
        ref={ref}
        src={media.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        className="flex h-[var(--control-h-md)] w-[var(--control-h-md)] shrink-0 items-center justify-center rounded-full bg-lu-accent text-gray-950 transition-colors hover:bg-lu-accent-hover"
      >
        {playing ? <Pause size={14} className="fill-current" /> : <Play size={14} className="ml-0.5 fill-current" />}
      </button>
      <div className="flex h-[var(--control-h-md)] min-w-0 flex-1 cursor-pointer items-center gap-[2px]" onClick={seek} aria-hidden>
        {bars.map((b, i) => (
          <span
            key={i}
            className={`flex-1 rounded-full ${i / bars.length < share ? 'bg-lu-accent' : 'bg-white/15'}`}
            style={{ height: `${Math.round(b * 100)}%` }}
          />
        ))}
      </div>
      <span className="shrink-0 t-micro tabular-nums text-gray-500">
        {formatClock(playing || time > 0 ? time : duration)}
      </span>
    </div>
  )
}

export function CreateMedia({ media }: { media: CreateMediaView }) {
  const [zoom, setZoom] = useState(false)
  return (
    <figure className="w-full max-w-[440px] overflow-hidden rounded-xl border border-white/[0.06] bg-white dark:bg-lu-panel">
      {media.kind === 'image' && (
        <button type="button" onClick={() => setZoom(true)} className="block w-full cursor-zoom-in bg-black/40" aria-label="Open image">
          <img src={media.url} alt={media.title} className="mx-auto block max-h-[420px] w-auto max-w-full object-contain" />
        </button>
      )}
      {media.kind === 'video' && (
        <video
          src={media.url}
          poster={media.poster}
          controls
          playsInline
          loop
          preload="metadata"
          className="block max-h-[420px] w-full bg-black/40"
        />
      )}
      {media.kind === 'audio' && <AudioTrack media={media} />}
      <figcaption className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-1.5 t-micro">
        <span className="min-w-0 flex-1 truncate text-gray-400">
          {media.title}
          <span className="text-gray-600"> · {media.model}</span>
        </span>
        {typeof media.credits === 'number' && (
          <span className="shrink-0 tabular-nums text-gray-600">{formatCredits(media.credits)} credits</span>
        )}
        <button
          type="button"
          onClick={() => void download(media.url, fileName(media))}
          aria-label="Download"
          title="Download"
          className="shrink-0 rounded-md p-1 text-gray-500 transition-colors hover:bg-white/10 hover:text-gray-900 dark:hover:text-gray-200"
        >
          <Download size={12} />
        </button>
      </figcaption>
      {zoom && media.kind === 'image' && <OverTheApp><Lightbox src={media.url} prompt={media.prompt} onClose={() => setZoom(false)} /></OverTheApp>}
    </figure>
  )
}

export function CreateMediaPending({
  aspect = 16 / 9,
  label,
  elapsed,
  expected,
}: {
  aspect?: number
  label: string
  elapsed: number
  expected?: number
}) {
  return (
    <div
      className="lu-develop relative w-full max-w-[440px] overflow-hidden rounded-xl border border-white/[0.06]"
      style={{ aspectRatio: String(aspect) }}
      role="status"
      aria-label={`${label}, creating`}
    >
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3 py-2 t-micro">
        <span className="text-gray-300">{label}</span>
        <span className="tabular-nums text-gray-500">
          {formatClock(elapsed)}{expected ? ` of about ${formatClock(expected)}` : ''}
        </span>
      </div>
    </div>
  )
}
