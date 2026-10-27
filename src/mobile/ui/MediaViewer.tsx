import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { navApi } from '../nav/api'
import { testProps, type Testable } from './common'
import { IconButton } from './IconButton'
import { MiddleEllipsis } from './MiddleEllipsis'

export interface MediaViewerProps extends Testable {
  kind: 'image' | 'video' | 'audio'
  src: string
  /** Shown in the bar on one line, with the middle left out when it is too long, and used as the accessible name of the media. */
  title: string
  /** IconButtons at the right of the bar: Share, Save, More. */
  actions?: ReactNode
  /** Default: nav.back(). */
  onClose?: () => void
  /** Shown instead of the media when it cannot be previewed. */
  fallback?: ReactNode
}

export const ZOOM_MIN = 1
export const ZOOM_MAX = 4

/** Pure: the next zoom after a pinch. */
export function pinchZoom(startZoom: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return startZoom
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, startZoom * (distance / startDistance)))
}

/**
 * Full screen view for an image, a video or a track. Images zoom with two
 * fingers and with a double tap; both have the same effect, so the gesture is
 * never the only way (DESIGN.md 10). Swiping to the neighbour is left to the
 * screen that knows the neighbours.
 */
export function MediaViewer(props: MediaViewerProps) {
  const { kind, src, title, actions, onClose, fallback } = props
  const [zoom, setZoom] = useState(1)
  const [failed, setFailed] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; zoom: number } | null>(null)
  const lastTap = useRef(0)

  const distance = () => {
    const [a, b] = [...pointers.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }
  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (kind !== 'image') return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) pinch.current = { distance: distance(), zoom }
  }
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinch.current && pointers.current.size === 2) setZoom(pinchZoom(pinch.current.zoom, pinch.current.distance, distance()))
  }
  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    const wasSingle = pointers.current.size === 1 && !pinch.current
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (kind !== 'image' || !wasSingle) return
    const now = Date.now()
    if (now - lastTap.current < 300) setZoom((z) => (z > 1 ? 1 : 2))
    lastTap.current = now
  }

  return (
    <section className="m-viewer" aria-label={title} {...testProps(props)}>
      <div className="m-viewer-bar">
        <IconButton icon={X} label="Close" testid="m-viewer-close" onPress={onClose ?? (() => void navApi.back())} />
        <h1 className="m-viewer-title" tabIndex={-1} data-m-focus-title="">
          <MiddleEllipsis text={title} />
        </h1>
        {actions}
      </div>
      <div className="m-viewer-stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {failed && fallback ? (
          fallback
        ) : kind === 'image' ? (
          <img src={src} alt={title} draggable={false} style={{ transform: `scale(${zoom})` }} onError={() => setFailed(true)} />
        ) : kind === 'video' ? (
          <video src={src} controls playsInline aria-label={title} onError={() => setFailed(true)} />
        ) : (
          <audio src={src} controls aria-label={title} onError={() => setFailed(true)} />
        )}
      </div>
    </section>
  )
}
