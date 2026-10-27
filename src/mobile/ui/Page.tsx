import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { navApi } from '../nav/api'
import { PageContext, pageControlId } from '../nav/context'
import { testProps, type Testable } from './common'
import { hyphenated } from './hyphenate'
import { IconButton } from './IconButton'
import { FootJump } from './FootJump'
import { useFootScrolls } from './screen-shape'
import { installRoom } from './room'

/**
 * Things the frame of the shell hands to every page. MobileRoot fills it;
 * that keeps src/mobile/ui free of imports from resilience/ and screens/.
 */
export interface PageChrome {
  /** The offline line (G7), shown under the header of pages that need the network. */
  offlineBanner: ReactNode
}
export const PageChromeContext = createContext<PageChrome>({ offlineBanner: null })

/** Scroll positions by page key, so a page that was unmounted comes back where it was. */
const scrollMemory = new Map<string, number>()

export interface PageProps extends Testable {
  /** Title in the header. One line where possible, two at most; a long word is hyphenated, never cut in the middle of a syllable. */
  title: string
  /** A line under the title in mono ("On Studio Mac"). */
  subtitle?: string
  /** Screen slug: data-testid becomes m-<screen>-screen. */
  screen?: string
  /** Up to two IconButtons at the right of the header. */
  actions?: ReactNode
  /** Lines under the header: engine notices, goal line. The offline line comes on its own with `needsNetwork`. */
  banner?: ReactNode
  /**
   * Fixed below the scrolling content: the main button, or a composer. The
   * standard footer takes at most 46 percent of the page and scrolls inside
   * beyond that, so large text on a small phone never pushes the content out.
   * On a page that is too low for it (a phone on its side, see
   * ui/screen-shape.ts) the standard footer stands at the end of the
   * scrolling content instead.
   */
  footer?: ReactNode
  /** Footer without the border and padding of the standard one (a composer brings its own). */
  bareFooter?: boolean
  /** This page cannot work without the network: show the offline line when there is none. */
  needsNetwork?: boolean
  /** Hide the back arrow (first step of a flow). */
  noBack?: boolean
  /** Replace what the back arrow does. Default: nav.back(). */
  onBack?: () => void
  children?: ReactNode
  /** No padding wrapper around the content. */
  flush?: boolean
  /**
   * A page whose content is a field of text: while the keyboard is open the round button to the footer
   * (ui/FootJump.tsx) is not shown, because it would lie over the end of the text that is being written
   * (short check of package 10, iOS, F5). It is back when the keyboard goes.
   */
  noJumpWithKeyboard?: boolean
}

function useScrollMemory(key: string | undefined) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !key) return
    const saved = scrollMemory.get(key)
    if (saved) el.scrollTop = saved
    const onScroll = () => scrollMemory.set(key, el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [key])
  return ref
}

function useTitleFocus(isTop: boolean) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    // A new page puts the focus on its title, so a screen reader reads it (DESIGN.md 10).
    // Not when a field already has it: that would close the keyboard.
    if (!isTop) return
    const active = document.activeElement
    if (active && active !== document.body && ref.current?.closest('.m-page')?.contains(active)) return
    ref.current?.focus({ preventScroll: true })
  }, [isTop])
  return ref
}

/**
 * Where the footer of a page goes. A bare footer (a composer) always stays
 * fixed below the content. The standard one is fixed too, except on a page
 * that is too low for it: there it is the last thing of the scrolling content,
 * and a round button over the corner of the content leads to it while it is
 * out of sight (ui/FootJump.tsx), so the main button of a page is never more
 * than one tap away.
 * data-m-foot on the page says which it is: none, bare, fixed or scrolls.
 */
function useFoot(footer: ReactNode, bare: boolean | undefined): { kind: 'none' | 'bare' | 'fixed' | 'scrolls'; inBody: ReactNode; below: ReactNode } {
  const scrolls = useFootScrolls()
  if (!footer) return { kind: 'none', inBody: null, below: null }
  if (bare) return { kind: 'bare', inBody: null, below: footer }
  if (scrolls) return { kind: 'scrolls', inBody: <footer className="m-foot m-foot--scrolls">{footer}</footer>, below: null }
  return { kind: 'fixed', inBody: null, below: <footer className="m-foot">{footer}</footer> }
}

/** A pushed page: header with back, title and up to two actions, scrolling content, optional footer. */
export function Page(props: PageProps) {
  const { title, subtitle, screen, actions, banner, footer, bareFooter, needsNetwork, noBack, onBack, children, flush, noJumpWithKeyboard } = props
  const page = useContext(PageContext)
  const chrome = useContext(PageChromeContext)
  const bodyRef = useScrollMemory(page?.entry.key)
  const titleRef = useTitleFocus(page?.isTop ?? true)
  const foot = useFoot(footer, bareFooter)
  useEffect(installRoom, [])
  return (
    <section className="m-screen" aria-label={title} data-testid={screen ? `m-${screen}-screen` : undefined} data-m-foot={foot.kind} data-m-nojump-kb={noJumpWithKeyboard ? '' : undefined} {...testProps(props)}>
      <header className="m-hdr">
        <div className="m-hdr-side">
          {noBack ? null : <IconButton icon={ChevronLeft} label="Back" testid={pageControlId('m-page-back', page?.place)} onPress={onBack ?? (() => void navApi.back())} />}
        </div>
        <h1 className="m-hdr-title" tabIndex={-1} ref={titleRef} data-m-focus-title="">
          <span className="m-hdr-text">{hyphenated(title)}</span>
          {subtitle ? <span className="m-hdr-sub">{subtitle}</span> : null}
        </h1>
        <div className="m-hdr-side m-hdr-side--end">{actions}</div>
      </header>
      {/* One box for all notice lines, so a short screen can cap its height (styles/components.css, "Room"). */}
      <div className="m-banners">
        {needsNetwork ? chrome.offlineBanner : null}
        {banner}
      </div>
      <div className="m-body" ref={bodyRef} data-m-scroll-hint={foot.kind === 'scrolls' ? '' : undefined}>
        {flush ? children : <div className="m-body-inner">{children}</div>}
        {foot.inBody}
      </div>
      <FootJump box={bodyRef} active={foot.kind === 'scrolls'} />
      {foot.below}
    </section>
  )
}

export interface RootPageProps extends Testable {
  /** The large title of a tab root, in Space Grotesk. */
  title: string
  screen?: string
  /** Actions at the right. They wrap under the title when space is tight. */
  actions?: ReactNode
  banner?: ReactNode
  /** Fixed above the tab bar: the action bar ("New chat"), or a composer. */
  footer?: ReactNode
  bareFooter?: boolean
  needsNetwork?: boolean
  children?: ReactNode
  flush?: boolean
}

/** The root of a tab: large title, actions at the right, the tab bar below. */
export function RootPage(props: RootPageProps) {
  const { title, screen, actions, banner, footer, bareFooter, needsNetwork, children, flush } = props
  const page = useContext(PageContext)
  const chrome = useContext(PageChromeContext)
  const bodyRef = useScrollMemory(page?.entry.key)
  const titleRef = useTitleFocus(page?.isTop ?? true)
  useEffect(installRoom, [])

  useEffect(() => {
    // Tapping the active tab at its root scrolls to the top (DESIGN.md 2.3).
    const onTabRoot = () => bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    window.addEventListener('lu:tab-root', onTabRoot)
    return () => window.removeEventListener('lu:tab-root', onTabRoot)
  }, [bodyRef])
  const foot = useFoot(footer, bareFooter)

  return (
    <section className="m-screen" aria-label={title} data-testid={screen ? `m-${screen}-screen` : undefined} data-m-foot={foot.kind} {...testProps(props)}>
      <header className="m-hdr m-hdr--big">
        <h1 className="m-hdr-title" tabIndex={-1} ref={titleRef} data-m-focus-title="">
          <span className="m-hdr-text">{hyphenated(title)}</span>
        </h1>
        {actions ? <div className="m-hdr-actions">{actions}</div> : null}
      </header>
      {/* One box for all notice lines, so a short screen can cap its height (styles/components.css, "Room"). */}
      <div className="m-banners">
        {needsNetwork ? chrome.offlineBanner : null}
        {banner}
      </div>
      <div className="m-body" ref={bodyRef} data-m-scroll-hint={foot.kind === 'scrolls' ? '' : undefined}>
        {flush ? children : <div className="m-body-inner">{children}</div>}
        {foot.inBody}
      </div>
      <FootJump box={bodyRef} active={foot.kind === 'scrolls'} />
      {foot.below}
    </section>
  )
}
