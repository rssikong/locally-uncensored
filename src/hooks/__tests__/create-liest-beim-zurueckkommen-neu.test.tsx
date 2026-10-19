// @vitest-environment jsdom
/**
 * Box run d307-b, H3: a model copied into a ComfyUI folder by hand only
 * appeared in Create after a visit to the Models page. Coming back to the app
 * now reads the lists again, at most every 30 s, never right after the mount
 * read and never while a render runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { useRereadOnReturn, REREAD_MIN_INTERVAL_MS } from '../useRereadOnReturn'

const HERE = dirname(fileURLToPath(import.meta.url))

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

describe('useRereadOnReturn', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'))
    setVisibility('visible')
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('does not read again right after the mount, which already read', () => {
    const reread = vi.fn()
    renderHook(() => useRereadOnReturn(reread))
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(reread).not.toHaveBeenCalled()
  })

  it('reads once when the user comes back after the interval, even if focus and visibility fire together', () => {
    const reread = vi.fn()
    renderHook(() => useRereadOnReturn(reread))
    vi.advanceTimersByTime(REREAD_MIN_INTERVAL_MS)
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(reread).toHaveBeenCalledTimes(1)
  })

  it('asks ComfyUI at most once per 30 s however often the window is focused', () => {
    const reread = vi.fn()
    renderHook(() => useRereadOnReturn(reread))
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(5_000)
      window.dispatchEvent(new Event('focus'))
    }
    // 100 s of alt-tabbing every 5 s: reads at 30 s, 60 s and 90 s.
    expect(reread).toHaveBeenCalledTimes(3)
  })

  it('ignores a visibility change to hidden', () => {
    const reread = vi.fn()
    renderHook(() => useRereadOnReturn(reread))
    vi.advanceTimersByTime(REREAD_MIN_INTERVAL_MS)
    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(reread).not.toHaveBeenCalled()
  })

  it('holds back while the caller says skip, and reads on the next return', () => {
    const reread = vi.fn()
    let busy = true
    renderHook(() => useRereadOnReturn(reread, { skip: () => busy }))
    vi.advanceTimersByTime(REREAD_MIN_INTERVAL_MS)
    window.dispatchEvent(new Event('focus'))
    expect(reread).not.toHaveBeenCalled()
    busy = false
    window.dispatchEvent(new Event('focus'))
    expect(reread).toHaveBeenCalledTimes(1)
  })

  it('stops listening when Create closes', () => {
    const reread = vi.fn()
    const { unmount } = renderHook(() => useRereadOnReturn(reread))
    unmount()
    vi.advanceTimersByTime(REREAD_MIN_INTERVAL_MS)
    window.dispatchEvent(new Event('focus'))
    expect(reread).not.toHaveBeenCalled()
  })
})

describe('Create wires the re-read', () => {
  it('CreateContext re-reads both the model lists and the LoRA lists on return, not during a render', () => {
    const src = readFileSync(resolve(HERE, '../../components/create/experimental/CreateContext.tsx'), 'utf8')
    const call = src.slice(src.indexOf('useRereadOnReturn('), src.indexOf('useRereadOnReturn(') + 300)
    expect(call).toContain('fetchModels()')
    expect(call).toContain('refreshModelLists()')
    expect(call).toContain('isGenerating')
  })
})
