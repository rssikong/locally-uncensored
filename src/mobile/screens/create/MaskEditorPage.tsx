/**
 * K9 Paint the area. Route /create/mask, full screen, strand 3 (Create).
 *
 * Built for touch. One finger paints, two fingers zoom and move. The brush
 * size is a slider, Undo and Redo are buttons, there is an eraser, Invert
 * and Clear. K9.1 Cancel (asks when something was painted), K9.2 Done,
 * K9.3 Brush and Eraser, K9.4 brush size, K9.5 Undo, K9.6 Clear.
 *
 * Memory: the canvas the finger paints on is capped (parts/mask-strokes.ts,
 * workSize), the mask is a list of strokes in source coordinates, and Undo
 * drops the last stroke and paints the list again. No image copy per step.
 * The exported mask is painted from the same list at the source size.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { Check, Eraser, FlipHorizontal2, Maximize, Redo2, Trash2, Undo2, X } from 'lucide-react'
import { useCreateStore, type ImageRef } from '../../../stores/createStore'
import { nav, usePage } from '../../nav'
import { readDevSwitches } from '../../platform/detect'
import { haptic } from '../../platform/haptics'
import { CREATE_STRINGS as T } from '../../strings/create'
import { Button, EmptyState, IconButton, Page, Segmented, Slider, toast } from '../../ui'
import { loadPhoneImageFromBlob } from './parts/photos'
import { runModel } from './parts/catalog'
import {
  EMPTY_MASK, VIEW_START, addStroke, brushRange, canRedo, canUndo, clampView, clearMask, exportSize, fitRect, hasPaint, invertMask, maskCoverage,
  paintMask, paintStroke, pinchView, redo, toImagePoint, undo, workSize, type MaskDoc, type Point, type Size, type View,
} from './parts/mask-strokes'
import { toolNeedsMask } from './parts/tools'
import { useScreenShape } from './parts/ui'
import './parts/create.css'

/** The colour of the painted area on screen. The exported mask is white on black. */
const PAINT = '#ff3d71'

/** What was painted on a source, kept while the app runs, so "Change mask" opens where the user left. */
const DOCS = new WeakMap<ImageRef, MaskDoc>()

function decode(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('decode failed'))
    img.src = url
  })
}

/** Paint the list at the source size and hand back a white on black PNG, plus how much of it is painted. */
async function exportMask(doc: MaskDoc, source: Size): Promise<{ url: string; coverage: number }> {
  const size = exportSize(source)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  paintMask(ctx, doc, size, size.scale, '#ffffff')
  // Count the painted share on a small copy: reading 16 million pixels back would double the memory.
  const k = Math.min(1, 512 / Math.max(size.width, size.height))
  const small = document.createElement('canvas')
  small.width = Math.max(1, Math.round(size.width * k))
  small.height = Math.max(1, Math.round(size.height * k))
  const sctx = small.getContext('2d')
  let coverage = 0
  if (sctx) {
    sctx.drawImage(canvas, 0, 0, small.width, small.height)
    coverage = maskCoverage(sctx.getImageData(0, 0, small.width, small.height).data, 1, 2)
  }
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size.width, size.height)
  const url = canvas.toDataURL('image/png')
  canvas.width = 0
  canvas.height = 0
  small.width = 0
  small.height = 0
  return { url, coverage }
}

interface LiveStroke {
  pointerId: number
  mode: 'paint' | 'erase'
  size: number
  points: number[]
}

export interface EditorProps {
  source: ImageRef
  /**
   * Another owner of the mask than the cloud form (A17: Edit on "My
   * computer"). It decides whether painting is a must and takes the mask
   * (null: nothing painted). Without it the cloud form owns it, as always.
   */
  owner?: { mustPaint: boolean; save: (mask: ImageRef | null) => void }
}

export function Editor({ source, owner }: EditorProps) {
  const page = usePage()
  const cloudTool = useCreateStore((s) => s.intent())
  const cloudImageModel = useCreateStore((s) => s.cloudImageModel)
  const cloudVideoModel = useCreateStore((s) => s.cloudVideoModel)
  const cloudOpModel = useCreateStore((s) => s.cloudOpModel)
  const tool = owner ? 'edit' : cloudTool
  const maskless = runModel(tool, { cloudImageModel, cloudVideoModel, cloudOpModel }, null, false).maskless
  const mustPaint = owner ? owner.mustPaint : toolNeedsMask(tool, maskless)

  const image: Size = { width: source.width, height: source.height }
  const work = workSize(image)
  const range = brushRange(image)

  const frameRef = useRef<HTMLDivElement>(null)
  const pictureRef = useRef<HTMLCanvasElement>(null)
  const maskRef = useRef<HTMLCanvasElement>(null)
  const [frame, setFrame] = useState<Size>({ width: 1, height: 1 })
  const [view, setView] = useState<View>(VIEW_START)
  const [doc, setDoc] = useState<MaskDoc>(() => DOCS.get(source) ?? EMPTY_MASK)
  const [mode, setMode] = useState<'paint' | 'erase'>('paint')
  const [brush, setBrush] = useState(range.start)
  const [loaded, setLoaded] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const shape = useScreenShape()

  const docRef = useRef(doc)
  const viewRef = useRef(view)
  const live = useRef<LiveStroke | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<{ ids: [number, number]; a: Point; b: Point; view: View } | null>(null)
  /** After a pinch the finger that stays down does not paint. */
  const afterPinch = useRef(false)
  /** The stroke that was just committed is already on the canvas. */
  const skipPaint = useRef(false)
  const initial = useRef(doc)

  const dirty = doc !== initial.current
  useEffect(() => {
    if (!dirty) return
    nav.setLeaveGuard(page.entry.key, () => true)
    return () => nav.setLeaveGuard(page.entry.key, null)
  }, [dirty, page.entry.key])

  // The picture, once, at the working size.
  useEffect(() => {
    let alive = true
    void decode(source.url)
      .then((img) => {
        const canvas = pictureRef.current
        const ctx = canvas?.getContext('2d')
        if (!alive || !canvas || !ctx) return
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        img.src = ''
        setLoaded('ready')
      })
      .catch(() => {
        if (alive) setLoaded('failed')
      })
    return () => {
      alive = false
    }
  }, [source.url])

  // The frame follows the screen: rotation, the keyboard, a split view.
  useLayoutEffect(() => {
    const el = frameRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setFrame({ width: Math.max(1, r.width), height: Math.max(1, r.height) })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    // A new frame size can leave the image outside its limits.
    setView((v) => clampView(v, frame, image))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.width, frame.height])

  const repaint = useCallback(
    (next: MaskDoc) => {
      const ctx = maskRef.current?.getContext('2d')
      if (ctx) paintMask(ctx, next, work, work.scale, PAINT)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [work.width, work.height, work.scale],
  )
  useEffect(() => {
    docRef.current = doc
    DOCS.set(source, doc)
    if (skipPaint.current) {
      skipPaint.current = false
      return
    }
    repaint(doc)
  }, [doc, repaint, source])
  useEffect(() => {
    viewRef.current = view
  }, [view])

  const local = (e: PointerEvent): Point => {
    const r = frameRef.current?.getBoundingClientRect()
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
  }
  const frameNow = (): Size => {
    const r = frameRef.current?.getBoundingClientRect()
    return { width: Math.max(1, r?.width ?? frame.width), height: Math.max(1, r?.height ?? frame.height) }
  }

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (loaded !== 'ready' || saving) return
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      /* a pointer the system no longer knows: the stroke still works inside the frame */
    }
    if (pointers.current.size === 2) {
      // A second finger: what the first one began was not a stroke.
      if (live.current) {
        live.current = null
        repaint(docRef.current)
      }
      const ids = [...pointers.current.keys()] as [number, number]
      pinch.current = { ids, a: pointers.current.get(ids[0])!, b: pointers.current.get(ids[1])!, view: viewRef.current }
      afterPinch.current = true
      return
    }
    if (pointers.current.size > 2 || afterPinch.current) return
    const ip = toImagePoint(p, frameNow(), image, viewRef.current)
    const stroke: LiveStroke = { pointerId: e.pointerId, mode, size: brush, points: [ip.x, ip.y] }
    live.current = stroke
    const ctx = maskRef.current?.getContext('2d')
    if (ctx) paintStroke(ctx, { type: 'stroke', ...stroke }, work.scale, PAINT)
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    const g = pinch.current
    if (g) {
      const a = pointers.current.get(g.ids[0])
      const b = pointers.current.get(g.ids[1])
      if (a && b) {
        const next = pinchView(g.view, g.a, g.b, a, b, frameNow(), image)
        viewRef.current = next
        setView(next)
      }
      return
    }
    const stroke = live.current
    if (!stroke || stroke.pointerId !== e.pointerId) return
    const ip = toImagePoint(p, frameNow(), image, viewRef.current)
    const n = stroke.points.length
    const lx = stroke.points[n - 2]
    const ly = stroke.points[n - 1]
    // Points closer than half a canvas pixel add nothing but length.
    if (Math.hypot(ip.x - lx, ip.y - ly) * work.scale < 0.5) return
    stroke.points.push(ip.x, ip.y)
    const ctx = maskRef.current?.getContext('2d')
    if (ctx) paintStroke(ctx, { type: 'stroke', mode: stroke.mode, size: stroke.size, points: [lx, ly, ip.x, ip.y] }, work.scale, PAINT)
  }
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null
      if (pointers.current.size === 0) afterPinch.current = false
      return
    }
    if (pointers.current.size === 0) afterPinch.current = false
    const stroke = live.current
    if (!stroke || stroke.pointerId !== e.pointerId) return
    live.current = null
    if (e.type === 'pointercancel') {
      // The system took the touch away (a notification, the edge swipe): the half stroke is dropped.
      repaint(docRef.current)
      return
    }
    skipPaint.current = true
    setTouched(true)
    setDoc((d) => addStroke(d, { mode: stroke.mode, size: stroke.size, points: stroke.points }))
  }

  const change = (fn: (d: MaskDoc) => MaskDoc) => {
    haptic('light')
    setDoc((d) => fn(d))
  }
  const painted = hasPaint(doc)
  const done = async () => {
    if (saving) return
    const st = owner ? { setMask: owner.save } : useCreateStore.getState()
    if (!painted) {
      if (mustPaint) return
      st.setMask(null)
      nav.setLeaveGuard(page.entry.key, null)
      nav.back()
      return
    }
    setSaving(true)
    try {
      const out = await exportMask(doc, image)
      if (out.coverage <= 0) {
        if (mustPaint) {
          toast(tool === 'eraser' ? T.mask.paintFirst : T.mask.paintFirstEdit, { tone: 'error', testid: 'create-mask-empty' })
          setSaving(false)
          return
        }
        st.setMask(null)
      } else {
        st.setMask({ filename: '', url: out.url, width: source.width, height: source.height })
      }
      nav.setLeaveGuard(page.entry.key, null)
      nav.back()
    } catch {
      toast(T.mask.saveFailed, { tone: 'error', testid: 'create-mask-failed' })
      setSaving(false)
    }
  }

  // Where the image sits: the fit at zoom 1, then the view.
  const fit = fitRect(frame, image)
  const left = (fit.x - frame.width / 2) * view.zoom + frame.width / 2 + view.x
  const top = (fit.y - frame.height / 2) * view.zoom + frame.height / 2 + view.y
  const blockDone = !painted && mustPaint
  const paintFirst = tool === 'eraser' ? T.mask.paintFirst : T.mask.paintFirstEdit

  return (
    <section className="m-k-mask" aria-label={T.mask.title} data-testid="m-create-mask-screen" data-state={loaded} data-shape={shape}>
      <div className="m-k-mask-bar">
        <Button variant="quiet" compact icon={X} onPress={() => void nav.back()} testid="m-create-mask-cancel" el="K9.1">
          {T.mask.cancel}
        </Button>
        <h1 className="m-k-mask-title" tabIndex={-1} data-m-focus-title="">
          {T.mask.title}
        </h1>
        <Button variant="primary" compact icon={Check} busy={saving} disabled={blockDone || loaded !== 'ready'} label={blockDone ? `${T.mask.done}. ${paintFirst}` : undefined} onPress={() => void done()} testid="m-create-mask-done" el="K9.2">
          {T.mask.done}
        </Button>
      </div>
      <div className="m-k-mask-body">
        <div
          ref={frameRef}
          className="m-k-mask-frame"
          role="img"
          aria-label={T.mask.canvas}
          data-testid="m-create-mask-canvas"
          data-m-steps={doc.steps.length}
          data-m-painted={painted ? '1' : '0'}
          data-m-zoom={view.zoom.toFixed(2)}
          data-m-pan={`${Math.round(view.x)},${Math.round(view.y)}`}
          data-m-work={`${work.width}x${work.height}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <div className="m-k-mask-layer" style={{ width: fit.width, height: fit.height, transform: `translate(${left}px, ${top}px) scale(${view.zoom})` }}>
            <canvas ref={pictureRef} width={work.width} height={work.height} data-layer="picture" />
            <canvas ref={maskRef} width={work.width} height={work.height} data-layer="mask" data-testid="m-create-mask-layer" />
          </div>
          {loaded === 'loading' ? <div className="m-k-mask-hint">{T.mask.loading}</div> : null}
          {loaded === 'failed' ? <div className="m-k-mask-hint">{T.mask.loadFailed}</div> : null}
          {/* Why Done is not ready stays on screen as long as it holds; the how-to goes with the first touch. */}
          {loaded === 'ready' && blockDone ? (
            <div className="m-k-mask-hint" data-testid="m-create-mask-hint">
              {touched || shape === 'low' ? paintFirst : `${paintFirst}. ${T.mask.hint}`}
            </div>
          ) : loaded === 'ready' && !touched && !painted ? (
            <div className="m-k-mask-hint" data-testid="m-create-mask-hint">
              {T.mask.hint}
            </div>
          ) : null}
        </div>
        <div className="m-k-mask-tools">
          <div className="m-k-mask-row">
            <Segmented
              label={T.mask.tool}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'paint', label: T.mask.brush, testid: 'm-create-mask-brush' },
                { value: 'erase', label: T.mask.eraser, testid: 'm-create-mask-eraser' },
              ]}
              testid="m-create-mask-tool"
              el="K9.3"
            />
            <IconButton icon={Undo2} label={T.mask.undo} edged disabled={!canUndo(doc)} onPress={() => change(undo)} testid="m-create-mask-undo" el="K9.5" />
            <IconButton icon={Redo2} label={T.mask.redo} edged disabled={!canRedo(doc)} onPress={() => change(redo)} testid="m-create-mask-redo" />
          </div>
          <Slider label={T.mask.size} min={range.min} max={range.max} step={range.step} value={brush} onChange={setBrush} format={(v) => `${Math.round(v)} px`} testid="m-create-mask-size" el="K9.4" />
          <div className="m-k-mask-row">
            <Button compact icon={FlipHorizontal2} onPress={() => change(invertMask)} testid="m-create-mask-invert">
              {T.mask.invert}
            </Button>
            <Button compact icon={Trash2} disabled={!painted} onPress={() => change(clearMask)} testid="m-create-mask-wipe" el="K9.6">
              {T.mask.clear}
            </Button>
            <Button compact icon={Maximize} disabled={view.zoom === 1 && view.x === 0 && view.y === 0} onPress={() => setView(VIEW_START)} label={`${T.mask.fit}, ${T.mask.zoom(Math.round(view.zoom * 100))}`} testid="m-create-mask-fit">
              {T.mask.zoom(Math.round(view.zoom * 100))}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function MaskEditorPage() {
  const source = useCreateStore((s) => s.source)
  const [busy, setBusy] = useState(false)
  if (source) return <Editor key={source.url.length + source.width} source={source} />
  const dev = readDevSwitches().devPages
  const sample = async () => {
    setBusy(true)
    try {
      // A picture that ships with the app, so the editor can be tried without the photo library.
      const res = await fetch('/android-chrome-512x512.png')
      const ref = await loadPhoneImageFromBlob(await res.blob(), 'sample.png')
      const st = useCreateStore.getState()
      if (st.intent() !== 'eraser' && st.intent() !== 'edit') st.setIntent('eraser')
      useCreateStore.getState().setSource(ref)
    } catch {
      toast(T.mask.loadFailed, { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Page title={T.mask.title} screen="create-mask">
      <EmptyState
        title={T.mask.noSource}
        icon={Eraser}
        testid="m-create-mask-empty"
        actions={
          <>
            <Button variant="primary" block onPress={() => nav.openSheet('source')} testid="m-create-mask-add-source">
              {T.mask.addSource}
            </Button>
            {dev ? (
              <Button block busy={busy} onPress={() => void sample()} testid="m-create-mask-sample">
                {T.mask.sample}
              </Button>
            ) : null}
          </>
        }
      >
        {T.mask.noSourceText}
      </EmptyState>
    </Page>
  )
}
