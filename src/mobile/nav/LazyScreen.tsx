/**
 * Loads the file of a route or a sheet and keeps a failure inside that one
 * page: the user sees the error state of this page with "Back" and
 * "Try again", not the error screen of the whole app (ARCHITEKTUR.md 3.1).
 *
 * The desktop has components/layout/LazyView for this. The mobile shell does
 * not import desktop shell components, so this is its own small version with
 * the same three properties: a boundary around the suspense, a retry that
 * really loads again, and one automatic second try.
 */
import { Component, Suspense, lazy, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import { log } from '../../lib/logger'
import type { ScreenLoader } from './define'

/** Loaded components by loader. A page that was open before renders at once, without a skeleton frame. */
const loaded = new Map<ScreenLoader, ComponentType>()

function withOneRetry(load: ScreenLoader): ScreenLoader {
  return () =>
    load().catch((err: unknown) => {
      log.warn('mobile LazyScreen: chunk import failed, retrying once', { error: String(err) })
      return new Promise<{ default: ComponentType }>((resolve, reject) => {
        setTimeout(() => {
          load().then(resolve, reject)
        }, 300)
      })
    })
}

/**
 * Load the file of a screen ahead of showing it, so it is drawn at once and
 * not after a skeleton. Resolves false when the file could not be loaded;
 * the screen then shows its own error state when it is opened.
 */
export function preloadScreen(load: ScreenLoader): Promise<boolean> {
  if (loaded.has(load)) return Promise.resolve(true)
  return withOneRetry(load)().then(
    (mod) => {
      loaded.set(load, mod.default)
      return true
    },
    () => false,
  )
}

function makeLazy(load: ScreenLoader): ComponentType {
  return lazy(() =>
    withOneRetry(load)().then((mod) => {
      loaded.set(load, mod.default)
      return mod
    }),
  )
}

interface BoundaryProps {
  children: ReactNode
  /** Renders the error state. `retry` clears the error and loads again. */
  renderError: (retry: () => void, error: Error) => ReactNode
  onRetry: () => void
}

class ScreenBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error('mobile screen failed', { error: String(error), stack: info.componentStack ?? '' })
  }

  retry = (): void => {
    this.props.onRetry()
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error) return this.props.renderError(this.retry, this.state.error)
    return this.props.children
  }
}

export interface LazyScreenProps {
  /** Must be stable (the loader from the route table), or the screen remounts on every render. */
  load: ScreenLoader
  /** A skeleton in the shape of the screen. */
  fallback: ReactNode
  renderError: (retry: () => void, error: Error) => ReactNode
}

export function LazyScreen({ load, fallback, renderError }: LazyScreenProps) {
  const [View, setView] = useState<ComponentType>(() => loaded.get(load) ?? makeLazy(load))
  return (
    <ScreenBoundary renderError={renderError} onRetry={() => setView(() => makeLazy(load))}>
      <Suspense
        fallback={
          <>
            {/* Marker for tests and screenshots: a screen file is still loading. */}
            <span hidden data-m-loading="" />
            {fallback}
          </>
        }
      >
        <View />
      </Suspense>
    </ScreenBoundary>
  )
}
