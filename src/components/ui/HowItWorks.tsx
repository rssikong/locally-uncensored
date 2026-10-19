import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp, ExternalLink, Play, X } from 'lucide-react'
import { HOWTO, howtoGuideUrl, howtoLineAt, howtoVideoUrl } from '../../lib/howto'
import { openExternal } from '../../api/backend'
import { useDismissOnEscape } from '../../hooks/useDismissOnEscape'

interface Props {
  /** Key into HOWTO: a Create intent id, 'code' or 'agent'. */
  topic: string
  /** `line` is the quiet text line of an empty Create stage, `mark` the bare
   *  circled question mark of a toolbar. */
  variant: 'line' | 'mark'
  /** Where the card opens relative to its trigger. */
  placement?: 'above' | 'below-end' | 'above-start'
  /** Icon size of the `mark` variant, to sit level with its toolbar. */
  markSize?: number
}

const GAP = 8
const EDGE = 8

/** Where the card stands for a trigger: on the wanted side if it fits there,
 *  on the other one if not, and never outside the window. */
export function howtoCardPlace(
  trigger: { left: number; right: number; top: number; bottom: number },
  card: { width: number; height: number },
  win: { width: number; height: number },
  placement: NonNullable<Props['placement']>,
): { left: number; top: number } {
  const above = trigger.top - GAP - card.height
  const below = trigger.bottom + GAP
  const wantsAbove = placement !== 'below-end'
  const fitsAbove = above >= EDGE
  const fitsBelow = below + card.height <= win.height - EDGE
  const top = wantsAbove ? (fitsAbove || !fitsBelow ? above : below) : (fitsBelow || !fitsAbove ? below : above)
  const left = placement === 'above'
    ? (trigger.left + trigger.right) / 2 - card.width / 2
    : placement === 'below-end' ? trigger.right - card.width : trigger.left
  const clamp = (v: number, max: number) => Math.max(EDGE, Math.min(v, max))
  return { left: clamp(left, win.width - EDGE - card.width), top: clamp(top, win.height - EDGE - card.height) }
}

/**
 * The entry to "How it works" and the card it opens: a short silent film and
 * ONE line under it that follows the scene. Nothing is loaded until the card
 * is opened; without a connection the card shows its lines as a list instead.
 */
export function HowItWorks({ topic, variant, placement = 'above', markSize = 11 }: Props) {
  const entry = HOWTO[topic]
  const [open, setOpen] = useState(false)
  const [filmIndex, setFilmIndex] = useState(0)
  const [line, setLine] = useState('')
  const [failed, setFailed] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  useDismissOnEscape(open, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => {
      const t = e.target as Node
      if (!rootRef.current?.contains(t) && !cardRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  // The card is drawn on the body, so no stage or toolbar can clip it, and
  // placed again whenever its own size changes (film loaded, list shown).
  useLayoutEffect(() => {
    if (!open) return
    const card = cardRef.current
    const root = rootRef.current
    if (!card || !root) return
    // The app root is zoomed (--ui-scale): rectangles come back in window
    // pixels, `left` and `top` are read in the card's own, so the place is
    // worked out in window pixels and handed over divided by that ratio.
    const put = () => {
      const box = card.getBoundingClientRect()
      const ratio = card.offsetWidth > 0 ? box.width / card.offsetWidth : 1
      const at = howtoCardPlace(
        root.getBoundingClientRect(),
        { width: box.width, height: box.height },
        { width: window.innerWidth, height: window.innerHeight },
        placement,
      )
      setPlace({ left: at.left / ratio, top: at.top / ratio })
    }
    put()
    const seen = new ResizeObserver(put)
    seen.observe(card)
    window.addEventListener('resize', put)
    return () => { seen.disconnect(); window.removeEventListener('resize', put) }
  }, [open, placement])

  if (!entry) return null
  const film = entry.films[Math.min(filmIndex, entry.films.length - 1)]

  const pick = (i: number) => {
    setFilmIndex(i)
    setFailed(false)
    setLine(entry.films[i].steps[0]?.text ?? '')
  }
  const toggle = () => {
    if (!open) pick(filmIndex)
    setOpen((o) => !o)
  }

  // aria-haspopup: the trigger opens a card, it does not unfold a section.
  // Screen readers announce it that way, and the settings walk in
  // e2e/ui-language.spec.ts tells the two apart by it.
  return (
    <div ref={rootRef} className="relative inline-flex" data-testid={`howto-${topic}`}>
      {variant === 'line' ? (
        <button
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="t-control inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-300 transition-colors"
        >
          <Play size={10} /> {entry.title}
        </button>
      ) : (
        <button
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={entry.title}
          title={entry.title}
          className="p-1 rounded text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors shrink-0"
        >
          <CircleHelp size={markSize} />
        </button>
      )}
      {open && createPortal(
        <div
          ref={cardRef}
          role="dialog"
          aria-label={entry.title}
          data-testid={`howto-card-${topic}`}
          style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}
          className="fixed z-50 w-[340px] max-w-[90vw] p-2.5 rounded-lg text-left lu-elevated"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="t-control font-semibold text-gray-800 dark:text-gray-200">{entry.title}</span>
            {entry.films.length > 1 && entry.films.map((f, i) => (
              <button
                key={f.id}
                onClick={() => pick(i)}
                aria-pressed={i === filmIndex}
                className={`t-control px-1.5 rounded transition-colors ${i === filmIndex
                  ? 'text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-white/[0.06]'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
              >
                {f.label}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="p-0.5 rounded text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              <X size={12} />
            </button>
          </div>
          {failed ? (
            <ol className="t-control text-gray-600 dark:text-gray-400 space-y-1 list-decimal pl-4" data-testid="howto-lines">
              {film.steps.map((s) => <li key={s.from}>{s.text}</li>)}
            </ol>
          ) : (
            <>
              <video
                key={film.id}
                src={howtoVideoUrl(film)}
                autoPlay
                loop
                muted
                playsInline
                onTimeUpdate={(e) => setLine(howtoLineAt(film.steps, e.currentTarget.currentTime))}
                onError={() => setFailed(true)}
                className="block w-full rounded-md border border-gray-200 dark:border-white/[0.06] bg-gray-200 dark:bg-lu-canvas"
              />
              <p className="t-control mt-2 min-h-[2.6em] text-gray-600 dark:text-gray-400" data-testid="howto-line">{line}</p>
            </>
          )}
          {howtoGuideUrl(entry) && (
            <button
              onClick={() => { void openExternal(howtoGuideUrl(entry)!) }}
              data-testid="howto-guide"
              className="t-control mt-1.5 inline-flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              Read the full guide <ExternalLink size={10} />
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
