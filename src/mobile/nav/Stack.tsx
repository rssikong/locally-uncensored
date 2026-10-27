/**
 * Renders the active stack of pages.
 *
 * The top page is visible. The one below stays mounted, `inert` and hidden,
 * so its scroll position and its inputs are still there when the user comes
 * back. Anything deeper is unmounted and gets its scroll position back from
 * ui/Page when it returns.
 *
 * Going back, the page that leaves stays for one short slide to the right
 * (EXIT_MS) and is then unmounted. Only a plain step back within the same
 * stack gets it: a tab switch, a reset or a replaced page change at once.
 * With reduced motion it is a short fade (styles/base.css).
 */
import { useEffect, useRef, useState } from 'react'
import { ErrorState, Button, Page, RootPage, SkeletonRows } from '../ui'
import { lastPushedKey, navApi } from './api'
import { PageContext } from './context'
import { activeStack } from './core'
import { useEdgeSwipe } from './edge-swipe'
import { LazyScreen } from './LazyScreen'
import { routeLoader } from './loaders'
import { routeDef } from './routes'
import { useNavStore } from './store'
import type { PageEntry } from './types'

/** Pages kept mounted: the visible one and the one below. */
export const MOUNTED_PAGES = 2

/** After this long the leaving page is unmounted even if its animation never reported an end. */
export const EXIT_MS = 320

/**
 * Pure: the page that leaves when the stack went from `before` to `after`,
 * or null when the change was not one plain step back.
 */
export function leavingPage(before: readonly PageEntry[], after: readonly PageEntry[]): PageEntry | null {
  if (before.length < 2 || after.length !== before.length - 1) return null
  for (let i = 0; i < after.length; i += 1) {
    if (after[i].key !== before[i].key) return null
  }
  return before[before.length - 1]
}

function Fallback({ entry, isRoot }: { entry: PageEntry; isRoot: boolean }) {
  const def = routeDef(entry.route)
  const title = def?.title ?? ''
  if (isRoot) {
    return (
      <RootPage title={title}>
        <SkeletonRows />
      </RootPage>
    )
  }
  return (
    <Page title={title}>
      <SkeletonRows />
    </Page>
  )
}

function Broken({ entry, isRoot, retry }: { entry: PageEntry; isRoot: boolean; retry: () => void }) {
  const def = routeDef(entry.route)
  const body = (
    <ErrorState
      title="This page could not be shown"
      testid="m-page-error"
      actions={
        <>
          <Button variant="primary" block onPress={retry} testid="m-page-error-retry">
            Try again
          </Button>
          {isRoot ? null : (
            <Button block onPress={() => void navApi.back()} testid="m-page-error-back">
              Back
            </Button>
          )}
        </>
      }
    >
      Something went wrong while opening it. Your chats and settings are not affected.
    </ErrorState>
  )
  if (isRoot) return <RootPage title={def?.title ?? ''}>{body}</RootPage>
  return <Page title={def?.title ?? ''}>{body}</Page>
}

function Unknown({ entry }: { entry: PageEntry }) {
  return (
    <Page title="Not found">
      <ErrorState title="This page does not exist" testid="m-page-unknown" actions={<Button block onPress={() => void navApi.back()}>Back</Button>}>
        {`LU has no page for ${entry.route}.`}
      </ErrorState>
    </Page>
  )
}

interface PageSlotProps {
  entry: PageEntry
  isTop: boolean
  isRoot: boolean
  covered: boolean
  enter: boolean
  edgeSwipe: boolean
  /** The page is on its way out: visible for the slide, takes no input. */
  leaving?: boolean
  onLeft?: () => void
}

function PageSlot({ entry, isTop, isRoot, covered, enter, edgeSwipe, leaving, onLeft }: PageSlotProps) {
  const ref = useRef<HTMLDivElement>(null)
  const swipe = useEdgeSwipe(
    () => ref.current,
    () => void navApi.back(),
  )
  const def = routeDef(entry.route)
  const load = routeLoader(entry.route)
  return (
    <div
      ref={ref}
      className="m-page"
      data-route={entry.route}
      data-m-hidden={isTop || leaving ? undefined : ''}
      data-m-enter={enter ? 'push' : undefined}
      data-m-exit={leaving ? 'pop' : undefined}
      aria-hidden={leaving ? true : undefined}
      onAnimationEnd={leaving ? (event) => event.target === event.currentTarget && onLeft?.() : undefined}
      // A page under another page, a sheet or a dialog takes no focus and no taps.
      inert={!isTop || covered}
    >
      <PageContext.Provider value={{ entry, isTop: isTop && !covered, isRoot, place: leaving ? 'leaving' : isTop ? 'top' : 'under' }}>
        {def && load ? (
          <LazyScreen
            load={load}
            fallback={<Fallback entry={entry} isRoot={isRoot} />}
            renderError={(retry) => <Broken entry={entry} isRoot={isRoot} retry={retry} />}
          />
        ) : (
          <Unknown entry={entry} />
        )}
      </PageContext.Provider>
      {edgeSwipe && isTop && !isRoot && !covered ? <div className="m-edge" aria-hidden="true" {...swipe} /> : null}
    </div>
  )
}

export function Stack({ edgeSwipe }: { edgeSwipe: boolean }) {
  const stack = useNavStore(activeStack)
  const tab = useNavStore((s) => s.tab)
  const flow = useNavStore((s) => s.flow)
  const covered = useNavStore((s) => s.overlays.length > 0)
  // The page the last change pushed slides in; restored, replaced and uncovered pages do not.
  const pushed = lastPushedKey()

  // What the last render showed, to see a step back the moment it happens.
  const [seen, setSeen] = useState({ stack, tab, flow })
  const [leaving, setLeaving] = useState<PageEntry | null>(null)
  if (seen.stack !== stack) {
    const sameStack = seen.tab === tab && seen.flow === flow
    setSeen({ stack, tab, flow })
    setLeaving(sameStack ? leavingPage(seen.stack, stack) : null)
  }
  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(() => setLeaving(null), EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [leaving])

  const from = Math.max(0, stack.length - MOUNTED_PAGES)
  // One list for the staying pages and the leaving one: with its old key in
  // the same list React keeps the leaving page mounted instead of building it anew.
  const slots = stack.slice(from).map((entry, i) => {
    const index = from + i
    const isTop = index === stack.length - 1
    return (
      <PageSlot
        key={entry.key}
        entry={entry}
        isTop={isTop}
        isRoot={!flow && index === 0}
        covered={covered}
        enter={isTop && pushed === entry.key}
        edgeSwipe={edgeSwipe}
      />
    )
  })
  if (leaving && !stack.some((entry) => entry.key === leaving.key)) {
    slots.push(
      <PageSlot
        key={leaving.key}
        entry={leaving}
        isTop={false}
        isRoot={false}
        covered={covered}
        enter={false}
        edgeSwipe={false}
        leaving
        onLeft={() => setLeaving(null)}
      />,
    )
  }
  return (
    <div className="m-stack" data-testid="m-stack">
      {slots}
    </div>
  )
}
