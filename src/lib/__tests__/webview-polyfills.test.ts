/**
 * The two functions pdf.js calls and an older web view does not have
 * (acceptance on Android 8 GB, B5: "Promise.withResolvers is not a function"
 * on Android System WebView 113).
 *
 * Run: npx vitest run src/lib/__tests__/webview-polyfills.test.ts
 */
import { describe, expect, it } from 'vitest'
import { installWebViewPolyfills } from '../webview-polyfills'

// The library the app is typed against (ES2023) does not know these two, which
// is the first guard against using them in the app's own code.
interface Resolvers<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void }
type WithResolvers = { withResolvers: <T>() => Resolvers<T> }
type WithAny = { any: (signals: AbortSignal[]) => AbortSignal }

/** A scope like the one of a web view that is missing all of them. */
function oldScope(): typeof globalThis {
  class OldPromise<T> extends Promise<T> {}
  class OldSignal extends EventTarget {
    aborted = false
    reason: unknown = undefined
  }
  class OldController {
    signal = new OldSignal()
    abort(reason?: unknown) {
      if (this.signal.aborted) return
      this.signal.aborted = true
      this.signal.reason = reason
      this.signal.dispatchEvent(new Event('abort'))
    }
  }
  Object.defineProperty(OldPromise, 'withResolvers', { value: undefined, configurable: true, writable: true })
  return { Promise: OldPromise, AbortSignal: OldSignal, AbortController: OldController } as unknown as typeof globalThis
}

describe('installWebViewPolyfills', () => {
  it('adds what is missing and says what it added', () => {
    const scope = oldScope()
    expect(installWebViewPolyfills(scope)).toEqual(['promise-with-resolvers', 'abort-signal-any'])
    // A second run finds everything in place.
    expect(installWebViewPolyfills(scope)).toEqual([])
  })

  it('changes nothing where the web view has all of it', () => {
    const before = { withResolvers: (Promise as unknown as WithResolvers).withResolvers, any: (AbortSignal as unknown as WithAny).any }
    expect(installWebViewPolyfills()).toEqual([])
    expect((Promise as unknown as WithResolvers).withResolvers).toBe(before.withResolvers)
    expect((AbortSignal as unknown as WithAny).any).toBe(before.any)
  })

  it('Promise.withResolvers: resolves and rejects from outside, and keeps the class it was called on', async () => {
    const scope = oldScope()
    installWebViewPolyfills(scope)
    const P = scope.Promise as unknown as PromiseConstructor & WithResolvers
    const a = P.withResolvers<number>()
    a.resolve(7)
    await expect(a.promise).resolves.toBe(7)
    expect(a.promise).toBeInstanceOf(P)
    const b = P.withResolvers<number>()
    b.reject(new Error('no'))
    await expect(b.promise).rejects.toThrow('no')
    // pdf.js destructures the call: no receiver.
    const { withResolvers } = P
    const c = (withResolvers as () => Resolvers<string>)()
    c.resolve('free')
    await expect(c.promise).resolves.toBe('free')
  })

  it('AbortSignal.any: follows the first signal that aborts, with its reason', () => {
    const scope = oldScope()
    installWebViewPolyfills(scope)
    const Controller = scope.AbortController
    const any = (scope.AbortSignal as unknown as WithAny).any
    const one = new Controller()
    const two = new Controller()
    const both = any([one.signal, two.signal])
    expect(both.aborted).toBe(false)
    two.abort('second')
    expect(both.aborted).toBe(true)
    expect(both.reason).toBe('second')
    one.abort('first')
    expect(both.reason).toBe('second')
    // One that is aborted already.
    expect(any([one.signal, new Controller().signal]).aborted).toBe(true)
  })
})

/**
 * Walking a stream with `for await` (re-check on Android 8 GB, A-04: "t is
 * not async iterable" on web view 113, Chromium has it from 124 on).
 */
describe('installWebViewPolyfills: a ReadableStream can be walked with for await', () => {
  type Walkable = { [Symbol.asyncIterator]?: unknown; values?: unknown }

  /** A scope whose stream class is a real one, without the way to walk it. */
  function scopeWithOldStream() {
    class OldStream<T> extends ReadableStream<T> {}
    // Shadows what the runtime has, as a web view before 124 would look.
    Object.defineProperty(OldStream.prototype, Symbol.asyncIterator, { value: undefined, configurable: true, writable: true })
    Object.defineProperty(OldStream.prototype, 'values', { value: undefined, configurable: true, writable: true })
    return { scope: { ReadableStream: OldStream } as unknown as typeof globalThis, OldStream }
  }

  type StreamClass = new (source: UnderlyingDefaultSource<number>) => ReadableStream<number>

  function numbers(Stream: StreamClass, upTo: number, onCancel?: (reason: unknown) => void): ReadableStream<number> {
    let n = 0
    return new Stream({
      pull(controller) {
        n += 1
        if (n > upTo) controller.close()
        else controller.enqueue(n)
      },
      cancel: onCancel,
    })
  }

  // The library the app is typed against does not know that a stream can be
  // walked, which is the first guard against doing it in the app's own code.
  const walk = (stream: ReadableStream<number>) => stream as unknown as AsyncIterable<number>

  it('says what it added, once, and leaves a web view that has it alone', () => {
    const { scope } = scopeWithOldStream()
    expect(installWebViewPolyfills(scope)).toEqual(['readable-stream-async-iterator'])
    expect(installWebViewPolyfills(scope)).toEqual([])
    const own = (ReadableStream.prototype as Walkable)[Symbol.asyncIterator]
    expect(installWebViewPolyfills()).toEqual([])
    expect((ReadableStream.prototype as Walkable)[Symbol.asyncIterator]).toBe(own)
  })

  it('without it the loop fails with the sentence of the report, with it every piece arrives in order', async () => {
    const { scope, OldStream } = scopeWithOldStream()
    let message = ''
    try {
      for await (const n of walk(numbers(OldStream, 3))) void n
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message).toContain('is not async iterable')

    installWebViewPolyfills(scope)
    const stream = numbers(OldStream, 3)
    const seen: number[] = []
    for await (const n of walk(stream)) seen.push(n)
    expect(seen).toEqual([1, 2, 3])
    // The lock is given back at the end.
    expect(stream.locked).toBe(false)
  })

  it('a loop that is left early cancels the stream and gives the lock back', async () => {
    const { scope, OldStream } = scopeWithOldStream()
    installWebViewPolyfills(scope)
    let cancelled = 0
    const stream = numbers(OldStream, 100, () => { cancelled += 1 })
    for await (const n of walk(stream)) if (n === 2) break
    expect(cancelled).toBe(1)
    expect(stream.locked).toBe(false)
  })

  it('values({ preventCancel: true }) leaves the stream open for a second reader', async () => {
    const { scope, OldStream } = scopeWithOldStream()
    installWebViewPolyfills(scope)
    let cancelled = 0
    const stream = numbers(OldStream, 4, () => { cancelled += 1 })
    const kept = (stream as unknown as { values: (o: { preventCancel: boolean }) => AsyncIterable<number> }).values({ preventCancel: true })
    for await (const n of kept) if (n === 2) break
    expect(cancelled).toBe(0)
    const rest: number[] = []
    for await (const n of walk(stream)) rest.push(n)
    expect(rest).toEqual([3, 4])
  })

  it('an error of the stream ends the loop with that error and gives the lock back', async () => {
    const { scope, OldStream } = scopeWithOldStream()
    installWebViewPolyfills(scope)
    const stream: ReadableStream<number> = new (OldStream as StreamClass)({
      pull(controller) {
        controller.error(new Error('the source broke'))
      },
    })
    await expect((async () => { for await (const n of walk(stream)) void n })()).rejects.toThrow('the source broke')
    expect(stream.locked).toBe(false)
  })
})
