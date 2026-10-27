// Three things an older web view does not have, for the code that reads a PDF.
//
// WHY (acceptance on Android 8 GB, find B5): Android System WebView 113 on the
// test image, and "Failed to extract text ...: Promise.withResolvers is not a
// function". The same holds for every WKWebView before iOS 17.4. pdf.js 6
// calls these two without carrying a replacement, also in its `legacy`
// build (everything else it needs it brings along, measured in
// src/api/__tests__/rag-pdf-old-webview.test.ts):
//
//   Promise.withResolvers   Chromium 119, Safari 17.4
//   AbortSignal.any         Chromium 116, Safari 17.4
//
// And a third, which is not a function one calls by name (re-check on Android
// 8 GB, A-04: "t is not async iterable", again on web view 113). pdf.js
// collects the text of a page with `for await` over a ReadableStream, and a
// stream can be walked that way only from Chromium 124 on:
//
//   ReadableStream.prototype[Symbol.asyncIterator], .values()   Chromium 124
//
// Nothing is replaced that is there: on a current desktop web view this file
// changes nothing. It has no import and touches no window, so the worker of
// pdf.js can load it too (lib/pdf-worker-compat.ts). pdf.js does most of its
// work in that worker, where a polyfill of the page does not reach.
//
// The oldest web view the app is built for stands in src/dev/webview-target.ts.

interface StreamReader {
  read(): Promise<{ done: boolean; value?: unknown }>
  cancel(reason?: unknown): Promise<void>
  releaseLock(): void
}
interface StreamProto {
  getReader?: () => StreamReader
  values?: unknown
  [Symbol.asyncIterator]?: unknown
}
type Resolvers<T> = { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void }

/**
 * What was missing before this ran. Empty on a current web view. The names
 * are written with dashes on purpose: the check of the phone bundle looks for
 * the real spelling (src/dev/webview-target.ts), and a name is not a call.
 */
export function installWebViewPolyfills(scope: typeof globalThis = globalThis): string[] {
  const added: string[] = []

  const P = scope.Promise as unknown as { withResolvers?: unknown } | undefined
  if (P && typeof P.withResolvers !== 'function') {
    Object.defineProperty(P, 'withResolvers', {
      configurable: true,
      writable: true,
      value: function withResolvers<T>(this: PromiseConstructor): Resolvers<T> {
        let resolve!: Resolvers<T>['resolve']
        let reject!: Resolvers<T>['reject']
        const Ctor = typeof this === 'function' ? this : scope.Promise
        const promise = new Ctor<T>((res, rej) => {
          resolve = res
          reject = rej
        })
        return { promise, resolve, reject }
      },
    })
    added.push('promise-with-resolvers')
  }

  const A = scope.AbortSignal as unknown as { any?: unknown } | undefined
  if (A && typeof scope.AbortController === 'function' && typeof A.any !== 'function') {
    Object.defineProperty(A, 'any', {
      configurable: true,
      writable: true,
      value: function any(signals: Iterable<AbortSignal>): AbortSignal {
        const controller = new scope.AbortController()
        const list = Array.from(signals)
        const already = list.find((signal) => signal.aborted)
        if (already) {
          controller.abort(already.reason)
          return controller.signal
        }
        const listeners = new Map<AbortSignal, () => void>()
        for (const signal of list) {
          const listener = () => {
            controller.abort(signal.reason)
            for (const [other, own] of listeners) other.removeEventListener('abort', own)
          }
          listeners.set(signal, listener)
          signal.addEventListener('abort', listener, { once: true })
        }
        return controller.signal
      },
    })
    added.push('abort-signal-any')
  }

  const S = (scope.ReadableStream as unknown as { prototype?: StreamProto } | undefined)?.prototype
  if (S && typeof S.getReader === 'function' && typeof S[Symbol.asyncIterator] !== 'function') {
    // As the standard has it: one reader for the whole walk, the lock given
    // back at the end, and a walk that is left early (break, throw) cancels
    // the stream unless `preventCancel` was asked for.
    const values = function values(this: { getReader: () => StreamReader }, options?: { preventCancel?: boolean }): AsyncIterableIterator<unknown> {
      const reader = this.getReader()
      const preventCancel = options?.preventCancel === true
      let finished = false
      const finish = () => {
        finished = true
        reader.releaseLock()
      }
      return {
        async next(): Promise<IteratorResult<unknown>> {
          if (finished) return { done: true, value: undefined }
          let step: { done: boolean; value?: unknown }
          try {
            step = await reader.read()
          } catch (err) {
            finish()
            throw err
          }
          if (step.done) {
            finish()
            return { done: true, value: undefined }
          }
          return { done: false, value: step.value }
        },
        async return(value?: unknown): Promise<IteratorResult<unknown>> {
          if (!finished) {
            const cancelled = preventCancel ? undefined : reader.cancel(value)
            finish()
            await cancelled
          }
          return { done: true, value }
        },
        [Symbol.asyncIterator]() {
          return this
        },
      }
    }
    if (typeof S.values !== 'function') Object.defineProperty(S, 'values', { configurable: true, writable: true, value: values })
    Object.defineProperty(S, Symbol.asyncIterator, { configurable: true, writable: true, value: values })
    added.push('readable-stream-async-iterator')
  }

  return added
}

let firstRun: string[] | null = null

/**
 * Install once and remember what was missing the first time. The answer is
 * how the reader of a PDF decides which worker to start: the one of pdf.js as
 * it comes, or the one that installs these functions first.
 */
export function ensureWebViewPolyfills(): string[] {
  if (!firstRun) firstRun = installWebViewPolyfills()
  return firstRun
}

/** Test-only. */
export function __resetWebViewPolyfillsForTests(): void {
  firstRun = null
}
