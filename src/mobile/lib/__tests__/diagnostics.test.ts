/**
 * The supply for the diagnostics page: the measuring seam the chat feeds,
 * the engine status in the shape of the page, and the report as text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetDiagnosticsForTests,
  buildDiagnosticsReport,
  engineDiagnosticsFrom,
  formatDiagnosticsReport,
  lastGenerationSpeed,
  reportGenerationSpeed,
  tokensPerSecond,
  LAST_SPEED_KEY,
  type Diagnostics,
} from '../diagnostics'

afterEach(() => {
  __resetDiagnosticsForTests()
  vi.unstubAllGlobals()
})

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  }
}

describe('reportGenerationSpeed', () => {
  it('turns tokens and milliseconds into tokens per second', () => {
    expect(tokensPerSecond(120, 10_000)).toBe(12)
    expect(tokensPerSecond(7, 3000)).toBe(2.3)
    expect(tokensPerSecond(0, 1000)).toBeNull()
    expect(tokensPerSecond(10, 0)).toBeNull()
    expect(tokensPerSecond(Number.NaN, 5)).toBeNull()
  })

  it('keeps the last measurement, also across a restart', () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    expect(lastGenerationSpeed()).toBeNull()
    const kept = reportGenerationSpeed({ tokens: 96, ms: 8000, model: 'Gemma 3 4B' })
    expect(kept).toMatchObject({ tokens: 96, ms: 8000, model: 'Gemma 3 4B', where: 'device', tokensPerSecond: 12 })
    expect(lastGenerationSpeed()?.tokensPerSecond).toBe(12)
    // A new session reads it back.
    __resetDiagnosticsForTests()
    expect(lastGenerationSpeed()?.model).toBe('Gemma 3 4B')
    expect(storage.data.has(LAST_SPEED_KEY)).toBe(true)
  })

  it('ignores input that measures nothing and never throws without storage', () => {
    expect(reportGenerationSpeed({ tokens: 0, ms: 0, model: 'x' })).toBeNull()
    // No localStorage at all in this environment.
    expect(() => reportGenerationSpeed({ tokens: 10, ms: 1000, model: 'x' })).not.toThrow()
    expect(lastGenerationSpeed()?.tokensPerSecond).toBe(10)
  })

  it('does not trust a stored blob of another shape', () => {
    const storage = memoryStorage()
    storage.setItem(LAST_SPEED_KEY, JSON.stringify({ tokens: 'many' }))
    vi.stubGlobal('localStorage', storage)
    expect(lastGenerationSpeed()).toBeNull()
  })
})

describe('engine status for the page', () => {
  it('reads running, model, context and accelerator', () => {
    expect(engineDiagnosticsFrom({ running: true, healthy: true, model_path: '/data/models/gemma-3-4b.gguf', ctx: 4096, accelerator: 'gpu' })).toEqual({
      state: 'running', model: 'gemma-3-4b.gguf', contextTokens: 4096, accelerator: 'gpu', note: null,
    })
  })

  it('says cpu when the engine fell back, with its note', () => {
    const d = engineDiagnosticsFrom({ running: true, healthy: true, model_path: 'm.gguf', cpuOnly: true, sanityNote: 'The graphics chip gave wrong results.' })
    expect(d.accelerator).toBe('cpu')
    expect(d.note).toBe('The graphics chip gave wrong results.')
  })

  it('a stopped engine has no model and no accelerator, a missing answer is unknown', () => {
    expect(engineDiagnosticsFrom({ running: false, healthy: false, model_path: null })).toMatchObject({ state: 'stopped', model: null, accelerator: null })
    expect(engineDiagnosticsFrom(null).state).toBe('unknown')
    expect(engineDiagnosticsFrom({ running: true, healthy: false, model_path: 'm.gguf' }).state).toBe('starting')
  })
})

describe('the report', () => {
  const base: Diagnostics = {
    device: {
      platform: 'android', model: 'Pixel 8', manufacturer: 'Google', chip: 'Tensor G3', systemVersion: '14', appVersion: '3.0.5',
      ramTotalBytes: 8 * 1024 ** 3, ramAvailableBytes: 3 * 1024 ** 3, storageFreeBytes: 50 * 1024 ** 3, storageTotalBytes: 128 * 1024 ** 3, source: 'native',
    },
    fit: { device: { platform: 'android', ramGb: 8 }, source: 'reported', simulator: false },
    engine: { state: 'running', model: 'gemma-3-4b.gguf', contextTokens: 4096, accelerator: 'gpu', note: null },
    speed: { tokens: 96, ms: 8000, model: 'Gemma 3 4B', where: 'device', tokensPerSecond: 12, at: 1 },
    fontScale: 1.3,
    theme: 'dark',
    persistentStorage: 'granted',
    nativeBridge: true,
    userAgent: 'TestView/1',
    at: Date.UTC(2026, 9, 8, 12, 0, 0),
  }

  it('names device, memory, storage, accelerator, engine and speed, one fact per line', () => {
    const text = formatDiagnosticsReport(base)
    expect(text).toContain('Device: Google Pixel 8')
    expect(text).toContain('Memory: 8.0 GB total, 3.0 GB available (reported by the system)')
    expect(text).toContain('Storage: 50.0 GB free of 128.0 GB')
    expect(text).toContain('Engine: running, gemma-3-4b.gguf, context 4096')
    expect(text).toContain('Accelerator: gpu')
    expect(text).toContain('Last speed: 12 tokens per second (96 tokens in 8.0 s, Gemma 3 4B, on device)')
    expect(text).toContain('Text size: 130 percent')
    expect(text).toContain('Time: 2026-10-08T12:00:00.000Z')
  })

  it('labels a simulator and its speed, so nobody reads them as a phone', () => {
    const text = formatDiagnosticsReport({
      ...base,
      device: { ...base.device, simulator: true, ramAvailableBytes: undefined },
      fit: { device: { platform: 'ios', ramGb: 6 }, source: 'simulator', simulator: true, label: 'Simulator (as iPhone 15, 6 GB)' },
    })
    expect(text).toContain('(simulator)')
    expect(text).toContain('simulator figure')
    expect(text).toContain('unknown available')
    expect(text).toContain('Memory class used for the fit: 6 GB (simulator, Simulator (as iPhone 15, 6 GB))')
  })

  it('says so when nothing was measured or read', () => {
    expect(formatDiagnosticsReport({ ...base, speed: null })).toContain('Last speed: not measured yet')
    // Before the first read the report is still text, and honest about it.
    const early = buildDiagnosticsReport()
    expect(early).toContain('LU diagnostics')
    expect(early).toContain('Device figures: not read yet')
  })

  it('carries no dash a user text may not have', () => {
    expect(formatDiagnosticsReport(base)).not.toMatch(/[–—]/)
  })
})
