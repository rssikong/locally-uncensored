/**
 * Small building blocks of the strand that the base components do not have:
 * a card whose head is one tap target, the mono line with size and
 * quantization, a block of text with the page gutter.
 *
 * Substitutes until the scaffold offers them (wishes in
 * mobile-docs/geruest-wuensche/models.md). Colours and measures come from the
 * tokens, type from the classes of styles/.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Icon } from '../../../ui'
import { textUnitPx } from '../../../ui/text-zoom'

const HEAD: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 'var(--m-s2)',
  width: '100%',
  minHeight: 'var(--m-touch)',
  textAlign: 'left',
  color: 'inherit',
  padding: 0,
}

const HEAD_TEXT: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 auto', minWidth: 0 }

export interface ItemCardProps {
  testid: string
  /** Stable id of the list item (data-m-id). */
  id: string
  state?: string
  /** Accent edge: the chosen card of a radio list. */
  selected?: boolean
  children: ReactNode
}

/** A card in a list. Carries the test id and the stable id of the item. */
export function ItemCard({ testid, id, state, selected, children }: ItemCardProps) {
  return (
    <div className="m-card" data-testid={testid} data-m-id={id} data-state={state} style={selected ? { borderColor: 'var(--m-accent)', background: 'var(--m-accent-soft)' } : undefined}>
      <div className="m-stackv" style={{ gap: 'var(--m-s3)' }}>
        {children}
      </div>
    </div>
  )
}

export interface CardHeadProps {
  /** Accessible name of the target ("Open Gemma 3 4B"). */
  label: string
  onPress: () => void
  testid: string
  el?: string
  /** Radio of a list: role and state instead of a plain button. */
  radio?: { checked: boolean; disabled?: boolean }
  children: ReactNode
}

/** The head of a card as one target of at least 44 px: name, size, marks, verdict. */
export function CardHead({ label, onPress, testid, el, radio, children }: CardHeadProps) {
  return (
    <button
      type="button"
      style={HEAD}
      role={radio ? 'radio' : undefined}
      aria-checked={radio ? radio.checked : undefined}
      aria-disabled={radio?.disabled || undefined}
      aria-label={label}
      data-testid={testid}
      data-el={el}
      onClick={onPress}
    >
      {radio ? <span className="m-radio" aria-hidden="true" style={{ marginTop: 2, flex: 'none' }} /> : null}
      <span style={HEAD_TEXT}>{children}</span>
      {radio ? null : <Icon icon={ChevronRight} small className="m-row-chev" />}
    </button>
  )
}

/** Name of the model in a card. */
export function CardName({ children }: { children: ReactNode }) {
  return <span className="m-card-title">{children}</span>
}

/** Size and quantization in mono: "2.5 GB · Q4_K_M". */
export function MonoLine({ parts }: { parts: Array<string | null | undefined | false> }) {
  const shown = parts.filter(Boolean) as string[]
  if (shown.length === 0) return null
  return <span className="m-mono m-t3" style={{ overflowWrap: 'anywhere' }}>{shown.join(' · ')}</span>
}

/** Text with the gutter of the page. */
export function Para({ children, cap, testid }: { children: ReactNode; cap?: boolean; testid?: string }) {
  return (
    <p className={cap ? 'm-pad m-cap' : 'm-pad m-t2'} style={{ margin: '0 0 var(--m-s3)' }} data-testid={testid}>
      {children}
    </p>
  )
}

/** A block with the gutter of the page and the usual gap below. */
export function Block({ children, gap = true }: { children: ReactNode; gap?: boolean }) {
  return (
    <div className="m-pad" style={gap ? { marginBottom: 'var(--m-s3)' } : undefined}>
      {children}
    </div>
  )
}

/** A value row inside a card: label left, value right, both wrap. */
export function Fact({ label, value, testid }: { label: string; value: ReactNode; testid?: string }) {
  return (
    <div className="m-rowh" style={{ justifyContent: 'space-between', alignItems: 'baseline' }} data-testid={testid}>
      <span className="m-cap">{label}</span>
      <span className="m-mono" style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  )
}

/**
 * The content of a page footer that can grow (progress, two buttons and the
 * main button). With large text on a small screen it would push the page
 * out, so it takes at most half the height and scrolls inside.
 */
export function FootStack({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--m-s2)', maxHeight: '46dvh', overflowY: 'auto' }}>{children}</div>
}

/** Below this many text lines of height a footer with more than its main button leaves no room for the page. */
export const SHORT_SCREEN_UNITS = 26
/** Below this many text units of width a one line field has no room for a placeholder of three words. */
export const NARROW_SCREEN_UNITS = 16

export interface ScreenFit {
  /** Short for its text: 320x568 at 200 percent, or a phone on its side. */
  short: boolean
  /** Narrow for its text: 320 px at 200 percent. */
  narrow: boolean
}

/** Pure: the screen measured in units of the root font size, because a footer and a field grow with the text and not with the pixels. */
export function screenFit(width: number, height: number, rootPx: number): ScreenFit {
  const unit = rootPx > 0 ? rootPx : 16
  return { short: height / unit < SHORT_SCREEN_UNITS, narrow: width / unit < NARROW_SCREEN_UNITS }
}

function fitNow(): ScreenFit {
  if (typeof window === 'undefined') return { short: false, narrow: false }
  return screenFit(window.innerWidth, window.innerHeight, textUnitPx())
}

/**
 * How the screen fits its text right now. A page that is short keeps only its
 * main button in the footer and moves progress, hints and the second button
 * into the scrolling part; a field on a narrow screen takes a one word
 * placeholder. Follows rotation, the keyboard and the text size.
 */
export function useScreenFit(): ScreenFit {
  const [fit, setFit] = useState(fitNow)
  useEffect(() => {
    const update = () => {
      const next = fitNow()
      setFit((now) => (now.short === next.short && now.narrow === next.narrow ? now : next))
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    // The text size is set on <html> by the shell after the first paint and when the system setting changes.
    const watch = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update)
    watch?.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-font-scale'] })
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      watch?.disconnect()
    }
  }, [])
  return fit
}
