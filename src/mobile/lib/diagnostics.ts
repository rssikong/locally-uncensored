/**
 * What a diagnostics page shows, as data: device, memory, free storage,
 * accelerator, engine state and the speed of the last answer.
 *
 * The page itself belongs to strand 5 (settings). This file is the supply:
 *   useDiagnostics()          the figures, refreshed on mount and on demand
 *   buildDiagnosticsReport()  the same as plain text, for "Share diagnostics"
 *   reportGenerationSpeed()   the small measuring seam the chat feeds
 *
 * Speed: the chat strand calls reportGenerationSpeed({ tokens, ms, model })
 * once per finished on device answer, with the tokens generated and the time
 * from the first token to the last. Nothing here measures by itself. The
 * figure of a simulator or emulator says nothing about a phone and is
 * labelled as such.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { bundledEngineStatus } from '../../api/engine'
import { displayModelName as bareModelName } from '../../api/providers/model-name'
import { formatBytes } from '../../lib/formatters'
import { persistentStorageState, type PersistentStorageState } from '../../lib/storage-health'
import { currentFontScale } from '../platform/font-scale'
import { getFitDevice, type DeviceInfo } from '../platform/device'
import { currentTheme } from '../platform/theme'
import { bridgeIsBundled } from '../platform/bridge'
import type { ResolvedDevice } from './device-fit'

export interface GenerationSpeedInput {
  /** Tokens the model generated. */
  tokens: number
  /** Time it took, in ms, from the first token to the last. */
  ms: number
  /** Name of the model, as the chat shows it. */
  model: string
  /** Where it ran. Default: 'device'. Cloud answers are not what this page is about, but may be reported. */
  where?: 'device' | 'cloud'
}

export interface GenerationSpeed {
  tokens: number
  ms: number
  model: string
  where: 'device' | 'cloud'
  /** Tokens per second, one decimal. */
  tokensPerSecond: number
  /** When it was reported, ms since the epoch. */
  at: number
}

export const LAST_SPEED_KEY = 'lu-mobile-last-speed'

let lastSpeed: GenerationSpeed | null | undefined
const speedListeners = new Set<() => void>()

function isSpeed(value: unknown): value is GenerationSpeed {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.tokens === 'number' && typeof v.ms === 'number' && typeof v.model === 'string' &&
    typeof v.tokensPerSecond === 'number' && typeof v.at === 'number' && (v.where === 'device' || v.where === 'cloud')
  )
}

function readStoredSpeed(): GenerationSpeed | null {
  try {
    const raw = localStorage.getItem(LAST_SPEED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return isSpeed(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Pure: tokens per second with one decimal, or null when the input measures nothing. */
export function tokensPerSecond(tokens: number, ms: number): number | null {
  if (!Number.isFinite(tokens) || !Number.isFinite(ms) || tokens <= 0 || ms <= 0) return null
  return Math.round((tokens / (ms / 1000)) * 10) / 10
}

/**
 * The measuring seam for the chat strand: one call per finished answer.
 * Input that measures nothing (0 tokens, 0 ms) is ignored. Never throws.
 * Returns what was kept, or null.
 */
export function reportGenerationSpeed(input: GenerationSpeedInput): GenerationSpeed | null {
  const rate = tokensPerSecond(input.tokens, input.ms)
  if (rate === null) return null
  const speed: GenerationSpeed = {
    tokens: Math.round(input.tokens),
    ms: Math.round(input.ms),
    // Without the slot of the engine in front: the report is read by people ("openai::" is not where it ran).
    model: bareModelName(String(input.model || '')),
    where: input.where === 'cloud' ? 'cloud' : 'device',
    tokensPerSecond: rate,
    at: Date.now(),
  }
  lastSpeed = speed
  try {
    localStorage.setItem(LAST_SPEED_KEY, JSON.stringify(speed))
  } catch {
    /* storage full: the figure still stands for this session */
  }
  for (const fn of [...speedListeners]) fn()
  return speed
}

/** The speed reported last, also across a restart. Null when no answer was measured yet. */
export function lastGenerationSpeed(): GenerationSpeed | null {
  if (lastSpeed === undefined) lastSpeed = readStoredSpeed()
  return lastSpeed
}

function subscribeSpeed(fn: () => void): () => void {
  speedListeners.add(fn)
  return () => {
    speedListeners.delete(fn)
  }
}

export type EngineState = 'running' | 'starting' | 'stopped' | 'unknown'

export interface EngineDiagnostics {
  state: EngineState
  /** File name of the loaded model, without its folder. */
  model: string | null
  /** Context the engine was started with, in tokens. */
  contextTokens: number | null
  /** gpu, cpu, or null when the engine does not say or is not running. */
  accelerator: 'gpu' | 'cpu' | null
  /** The engine fell back to the processor by itself and says why. */
  note: string | null
}

export interface Diagnostics {
  device: DeviceInfo
  fit: ResolvedDevice
  engine: EngineDiagnostics
  speed: GenerationSpeed | null
  /** 1 is 100 percent. */
  fontScale: number
  theme: 'dark' | 'light'
  persistentStorage: PersistentStorageState
  /** The bridge file of the native layer is part of this build. */
  nativeBridge: boolean
  userAgent: string
  /** When these figures were read. */
  at: number
}

interface EngineStatusLike {
  running?: boolean
  healthy?: boolean
  model_path?: string | null
  ctx?: number | null
  cpuOnly?: boolean
  gpuLayers?: number | null
  accelerator?: string | null
  sanityNote?: string | null
}

function fileName(path: string | null | undefined): string | null {
  if (!path) return null
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return path.slice(cut + 1) || null
}

/** Pure: the engine's status answer in the shape of the page. */
export function engineDiagnosticsFrom(status: EngineStatusLike | null | undefined): EngineDiagnostics {
  if (!status || typeof status !== 'object') {
    return { state: 'unknown', model: null, contextTokens: null, accelerator: null, note: null }
  }
  const running = status.running === true
  let accelerator: 'gpu' | 'cpu' | null = null
  if (running) {
    if (status.accelerator === 'gpu' || status.accelerator === 'cpu') accelerator = status.accelerator
    else if (status.cpuOnly === true) accelerator = 'cpu'
    else if (typeof status.gpuLayers === 'number') accelerator = status.gpuLayers > 0 ? 'gpu' : 'cpu'
  }
  return {
    state: running ? (status.healthy === false ? 'starting' : 'running') : 'stopped',
    model: running ? fileName(status.model_path) : null,
    contextTokens: running && typeof status.ctx === 'number' && status.ctx > 0 ? status.ctx : null,
    accelerator,
    note: typeof status.sanityNote === 'string' && status.sanityNote ? status.sanityNote : null,
  }
}

/** Read everything once. Never throws: what cannot be read is "unknown". */
export async function readDiagnostics(): Promise<Diagnostics> {
  const [{ info, resolved }, engine] = await Promise.all([
    getFitDevice(),
    bundledEngineStatus().then(
      (status) => engineDiagnosticsFrom(status as EngineStatusLike),
      () => engineDiagnosticsFrom(null),
    ),
  ])
  return remember({
    device: info,
    fit: resolved,
    engine,
    speed: lastGenerationSpeed(),
    fontScale: currentFontScale(),
    theme: currentTheme(),
    persistentStorage: persistentStorageState(),
    nativeBridge: bridgeIsBundled(),
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    at: Date.now(),
  })
}

let lastRead: Diagnostics | null = null

function remember(d: Diagnostics): Diagnostics {
  lastRead = d
  return d
}

export interface UseDiagnostics {
  /** Null until the first read is done. */
  data: Diagnostics | null
  loading: boolean
  /** Read again (pull to refresh, a "Refresh" button). */
  refresh: () => Promise<void>
  /** The same figures as plain text. Empty until the first read is done. */
  report: string
}

/** The hook for the diagnostics page. Reads on mount; the speed follows reportGenerationSpeed live. */
export function useDiagnostics(): UseDiagnostics {
  const [data, setData] = useState<Diagnostics | null>(null)
  const [loading, setLoading] = useState(true)
  const speed = useSyncExternalStore(subscribeSpeed, lastGenerationSpeed, () => null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setData(await readDiagnostics())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const live = data ? { ...data, speed } : null
  return { data: live, loading, refresh, report: live ? formatDiagnosticsReport(live) : '' }
}

function bytes(value: number | undefined): string {
  return typeof value === 'number' && value > 0 ? formatBytes(value) : 'unknown'
}

function sourceWords(source: DeviceInfo['source']): string {
  if (source === 'native') return 'reported by the system'
  if (source === 'browser') return 'estimated by the web view'
  return 'not available'
}

/** Pure: the figures as plain text, one fact per line, no personal data. */
export function formatDiagnosticsReport(d: Diagnostics): string {
  const simulated = d.fit.simulator || d.device.simulator === true
  const lines: string[] = [
    'LU diagnostics',
    `Time: ${new Date(d.at).toISOString()}`,
    `App version: ${d.device.appVersion ?? 'unknown'}`,
    `Platform: ${d.device.platform}${d.device.systemVersion ? ` ${d.device.systemVersion}` : ''}`,
    `Device: ${[d.device.manufacturer, d.device.model].filter(Boolean).join(' ') || 'unknown'}${simulated ? ' (simulator)' : ''}`,
    `Chip: ${d.device.chip ?? 'unknown'}`,
    `Memory: ${bytes(d.device.ramTotalBytes)} total, ${bytes(d.device.ramAvailableBytes)} available (${sourceWords(d.device.source)})`,
    `Memory class used for the fit: ${d.fit.device.ramGb > 0 ? `${Math.round(d.fit.device.ramGb * 10) / 10} GB` : 'unknown'} (${d.fit.source}${d.fit.label ? `, ${d.fit.label}` : ''})`,
    `Storage: ${bytes(d.device.storageFreeBytes)} free of ${bytes(d.device.storageTotalBytes)}`,
    `Storage kept by the system: ${d.persistentStorage}`,
    `Engine: ${d.engine.state}${d.engine.model ? `, ${d.engine.model}` : ''}${d.engine.contextTokens ? `, context ${d.engine.contextTokens}` : ''}`,
    `Accelerator: ${d.engine.accelerator ?? 'unknown'}${d.engine.note ? ` (${d.engine.note})` : ''}`,
    d.speed
      ? `Last speed: ${d.speed.tokensPerSecond} tokens per second (${d.speed.tokens} tokens in ${(d.speed.ms / 1000).toFixed(1)} s, ${bareModelName(d.speed.model)}, ${d.speed.where === 'cloud' ? 'LU Cloud' : 'on device'}${simulated && d.speed.where === 'device' ? ', simulator figure' : ''})`
      : 'Last speed: not measured yet',
    `Text size: ${Math.round(d.fontScale * 100)} percent`,
    `Theme: ${d.theme}`,
    `Native bridge: ${d.nativeBridge ? 'yes' : 'no'}`,
    `Web view: ${d.userAgent || 'unknown'}`,
  ]
  return lines.join('\n')
}

/**
 * The report as plain text, at once: built from the figures read last (the
 * start reads them once, the page reads them on mount) with the newest speed.
 * Before any read it carries what is known without asking the device and
 * says so. For a fresh reading use readDiagnosticsReport().
 */
export function buildDiagnosticsReport(): string {
  if (lastRead) return formatDiagnosticsReport({ ...lastRead, speed: lastGenerationSpeed() })
  const speed = lastGenerationSpeed()
  return [
    'LU diagnostics',
    `Time: ${new Date().toISOString()}`,
    'Device figures: not read yet',
    speed ? `Last speed: ${speed.tokensPerSecond} tokens per second (${bareModelName(speed.model)})` : 'Last speed: not measured yet',
    `Text size: ${Math.round(currentFontScale() * 100)} percent`,
    `Web view: ${typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent}`,
  ].join('\n')
}

/** Read everything anew and hand back the report text. */
export async function readDiagnosticsReport(): Promise<string> {
  return formatDiagnosticsReport(await readDiagnostics())
}

/** Only for tests. */
export function __resetDiagnosticsForTests(): void {
  lastSpeed = undefined
  lastRead = null
  speedListeners.clear()
}
