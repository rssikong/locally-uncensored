/**
 * The diagnostics of "Troubleshooting" (E19): what LU knows about this phone
 * and the engine, as rows for the page and as a text for "Copy report".
 *
 * Device figures come from the platform seam (getDeviceInfo: `device_info`
 * of the native bridge with model, system, chip, memory, storage and text
 * scale, or what the WebView can estimate, or nothing). The engine comes from
 * the engine API. Nothing is guessed, and a missing value never reads "Not
 * available": the row says whether the installed app would know it, a
 * simulator does not report it, or this phone does not.
 *
 * The scaffold supplies the reading (src/mobile/lib/diagnostics.ts):
 * `readDiagnostics()` is the ONE read of the device (so "Copy report" here
 * and `buildDiagnosticsReport()` anywhere else tell the same), and
 * `lastGenerationSpeed()` is the speed the chat measured on a real answer.
 * This file adds the worded rows of the page, the benchmark figure and the
 * self test, and feeds the self test back through `reportGenerationSpeed`.
 */
import { bundledEngineStatus, listBundledModels, type EngineStatus } from '../../../../api/engine'
import { getProvider } from '../../../../api/providers'
import { formatBytes, formatContextWindow } from '../../../../lib/formatters'
import { storageEstimate, type StorageEstimateReport } from '../../../../lib/storage-health'
import { getLatestSpeed, useBenchmarkStore } from '../../../../stores/benchmarkStore'
import { useGenerationStore } from '../../../../stores/generationStore'
import { MOBILE_CHAT_MODELS } from '../../../data/mobile-models'
import { formatDiagnosticsReport, readDiagnostics, reportGenerationSpeed, type Diagnostics, type GenerationSpeed } from '../../../lib/diagnostics'
import { hasNativeBridge, type DeviceInfo } from '../../../platform'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { crashHeadline, type AppLog } from './app-log'
import { storePolicy } from './policy'
import type { SelfTestRecord } from './prefs'
import type { SessionLogEntry } from './session-log'

const T = SETTINGS_STRINGS.troubleshooting

export type Accelerator = 'gpu' | 'cpu' | 'cpu-fallback' | 'unknown'

export interface DiagnosticsData {
  appVersion: string
  device: DeviceInfo
  /** What the WebView holds for LU: chats, settings, documents. Never the model files. */
  storage: StorageEstimateReport | null
  /**
   * Bytes of the installed model files, which lie outside the WebView and are
   * by far the largest part. null or left out: nobody could ask (a browser,
   * or the engine did not answer). 0: asked, and no model is installed.
   */
  modelsBytes?: number | null
  /** null: the engine cannot be asked here (web preview, or the command failed). */
  engine: EngineStatus | null
  /** Tokens per second of the last benchmark of the loaded model, or null. */
  benchmarkSpeed: number | null
  selfTest: SelfTestRecord | null
  /** The speed of the last real answer, as the chat reported it to the scaffold. Wins over benchmark and self test. */
  measured?: GenerationSpeed | null
  /** The reading of the scaffold behind these figures; its plain lines close the report. */
  scaffold?: Diagnostics | null
  /**
   * The newest crash record of the native layer. undefined: nobody could ask
   * (a browser, a build without the log command), so there is no row at all.
   * null: asked, and nothing is recorded.
   */
  lastCrash?: string | null
}

export interface DiagnosticsRow {
  id: string
  label: string
  value: string
  /** A second line under the value. */
  note?: string
}

/** File name of the loaded model without folder and extension. */
export function modelNameFromPath(path: string | null | undefined): string | null {
  if (!path) return null
  const file = path.split(/[\\/]/).pop() ?? ''
  const name = file.replace(/\.gguf$/i, '')
  return name || null
}

const CATALOGUE_NAMES: ReadonlyMap<string, string> = new Map(MOBILE_CHAT_MODELS.map((m) => [m.filename.replace(/\.gguf$/i, ''), m.name]))

/**
 * Pure: a model as a person knows it. The engine, the chat and the benchmark
 * name a model by its file ("SmolLM2-360M-Instruct-Q4_K_M"), some with the
 * provider in front ("openai::..."). The user picked it as "SmolLM2 360M", so
 * that is what the page shows; a file the catalogue does not know keeps its
 * file name, without provider, folder and extension.
 */
export function shownModelName(raw: string | null | undefined): string {
  if (!raw) return ''
  const bare = raw.includes('::') ? raw.slice(raw.indexOf('::') + 2) : raw
  const file = modelNameFromPath(bare) ?? bare
  return CATALOGUE_NAMES.get(file) ?? file
}

export function acceleratorOf(engine: EngineStatus | null): Accelerator {
  if (!engine || !engine.running) return 'unknown'
  if (engine.cpuOnly) return 'cpu-fallback'
  if (engine.gpuLayers === 0) return 'cpu'
  return 'gpu'
}

function speedText(tps: number): string {
  return T.speedValue(tps >= 10 ? tps.toFixed(0) : tps.toFixed(1))
}

const OS_NAME: Record<string, string> = { ios: 'iOS', android: 'Android' }

/**
 * Why a device figure is missing, in words. There is no "Not available" on
 * this page: either the installed app would know (this is a preview in a
 * browser), or a simulator does not report it, or this phone does not.
 */
function missing(d: DiagnosticsData): string {
  if (d.device.source !== 'native') return T.needsApp
  return d.device.simulator ? T.simulatorSilent : T.notReported
}

function bytes(value: number | undefined, d: DiagnosticsData): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? formatBytes(value) : missing(d)
}

/** Why the engine has no answer: no engine in a browser, or it did not answer on the phone. */
function engineMissing(d: DiagnosticsData): string {
  return d.device.source === 'native' ? T.engineSilent : T.needsApp
}

function acceleratorText(a: Accelerator, d: DiagnosticsData): string {
  if (a === 'gpu') return T.accelGpu
  if (a === 'cpu') return T.accelCpu
  if (a === 'cpu-fallback') return T.accelCpuFallback
  return engineMissing(d)
}

function systemText(d: DiagnosticsData): string {
  const name = OS_NAME[d.device.platform]
  if (d.device.systemVersion) return name ? `${name} ${d.device.systemVersion}` : d.device.systemVersion
  return missing(d)
}

/** The text size in percent as the shell draws it, with the factor the phone reported where it did. */
function textSize(d: DiagnosticsData): { value: string; note?: string } | null {
  const drawn = d.scaffold?.fontScale
  const reported = d.device.fontScale
  const scale = typeof drawn === 'number' && drawn > 0 ? drawn : reported
  if (typeof scale !== 'number' || !(scale > 0)) return null
  const percent = (n: number) => `${Math.round(n * 100)} %`
  const differs = typeof reported === 'number' && reported > 0 && Math.abs(reported - scale) >= 0.01
  return { value: percent(scale), note: differs ? T.textSizePhone(percent(reported)) : T.textSizeFollows }
}

/**
 * Pure: "Storage used by LU" as ONE sum of what LU keeps on the phone, the
 * models included, with the parts on the second line. A part nobody could
 * read is named as missing instead of being counted as zero.
 */
function storageUsedRow(d: DiagnosticsData): DiagnosticsRow {
  const rest = d.storage ? d.storage.usageBytes : null
  const models = typeof d.modelsBytes === 'number' && Number.isFinite(d.modelsBytes) && d.modelsBytes >= 0 ? d.modelsBytes : null
  const base = { id: 'storage-used', label: T.storageUsed }
  if (rest === null && models === null) return { ...base, value: T.notReported }
  if (models === null) return { ...base, value: formatBytes(rest ?? 0), note: d.device.source === 'native' ? T.storageWithoutModels : undefined }
  if (rest === null) return { ...base, value: formatBytes(models), note: T.storageModelsOnly(formatBytes(models)) }
  return { ...base, value: formatBytes(models + rest), note: T.storageBreakdown(formatBytes(models), formatBytes(rest)) }
}

/** Pure: the rows of the diagnostics section, in the order of the checklist. */
export function diagnosticsRows(d: DiagnosticsData): DiagnosticsRow[] {
  const estimated = d.device.source === 'browser' ? T.estimated : undefined
  const model = modelNameFromPath(d.engine?.model_path)
  const running = !!d.engine?.running

  let speed: { value: string; note?: string } = { value: T.speedNone }
  if (d.measured && d.measured.where === 'device') speed = { value: speedText(d.measured.tokensPerSecond), note: T.speedFrom(shownModelName(d.measured.model)) }
  else if (d.benchmarkSpeed !== null && model) speed = { value: speedText(d.benchmarkSpeed), note: T.speedFrom(shownModelName(model)) }
  else if (d.selfTest) speed = { value: speedText(d.selfTest.tokensPerSecond), note: T.speedFrom(shownModelName(d.selfTest.model)) }

  const maker = d.device.manufacturer && d.device.model && !d.device.model.toLowerCase().startsWith(d.device.manufacturer.toLowerCase()) ? `${d.device.manufacturer} ` : ''
  const deviceNote = d.device.simulator ? T.simulator : (OS_NAME[d.device.platform] ?? undefined)
  const size = textSize(d)

  const rows: DiagnosticsRow[] = [
    { id: 'device', label: T.device, value: d.device.model ? `${maker}${d.device.model}` : missing(d), note: deviceNote },
    { id: 'system', label: T.platform, value: systemText(d), note: d.device.chip ? T.chip(d.device.chip) : undefined },
    { id: 'app-version', label: T.appVersion, value: d.appVersion },
    // The store preset of this build (M5): the one fact that decides age question, catalogue and buying.
    { id: 'store-preset', label: T.storePreset, value: SETTINGS_STRINGS.about.storeBuildNames[storePolicy().preset], note: storePolicy().preset },
    { id: 'memory', label: T.memory, value: bytes(d.device.ramTotalBytes, d), note: d.device.ramTotalBytes ? (estimated ?? (d.device.lowMemory ? T.memoryLow : undefined)) : undefined },
    { id: 'memory-free', label: T.memoryFree, value: bytes(d.device.ramAvailableBytes, d) },
    {
      id: 'storage-free',
      label: T.storageFree,
      value: bytes(d.device.storageFreeBytes, d),
      note: d.device.storageFreeBytes ? (estimated ?? (d.device.storageTotalBytes ? T.storageOf(formatBytes(d.device.storageTotalBytes)) : undefined)) : undefined,
    },
    storageUsedRow(d),
  ]
  if (size) rows.push({ id: 'text-size', label: T.textSize, value: size.value, note: size.note })
  rows.push(
    { id: 'accelerator', label: T.accelerator, value: d.engine ? (running ? acceleratorText(acceleratorOf(d.engine), d) : T.engineOff) : engineMissing(d), note: d.engine?.sanityNote ?? undefined },
    {
      id: 'model',
      label: T.modelLoaded,
      value: d.engine ? (model && running ? shownModelName(model) : T.noModel) : engineMissing(d),
      note: running && d.engine?.ctx ? T.contextLoaded(formatContextWindow(d.engine.ctx)) : undefined,
    },
    { id: 'speed', label: T.lastSpeed, value: speed.value, note: speed.note },
  )
  // Only where the native layer could be asked: a row that could never say anything is no row.
  if (d.lastCrash !== undefined) rows.push({ id: 'crash', label: T.lastCrash, value: crashHeadline(d.lastCrash) ?? T.lastCrashNone, note: d.lastCrash ? T.lastCrashNote : undefined })
  return rows
}

/** Pure: the text of "Copy report". First line is the title, then one line per row. */
export function buildReport(d: DiagnosticsData, now: number = Date.now()): string {
  const lines = [T.reportTitle, new Date(now).toISOString(), '']
  for (const row of diagnosticsRows(d)) lines.push(`${row.label}: ${row.value}${row.note ? ` (${row.note})` : ''}`)
  // The page shows the name a person knows. Support needs the exact file, so the report carries it as well.
  const file = d.engine?.running ? modelNameFromPath(d.engine.model_path) : null
  if (file && file !== shownModelName(file)) lines.push(`${T.modelFile}: ${file}`)
  // What the scaffold read on top (system version, chip, text size, theme, web view), for whoever reads the report.
  if (d.scaffold) lines.push('', ...formatDiagnosticsReport({ ...d.scaffold, speed: d.measured ?? d.scaffold.speed }).split('\n').slice(1))
  return lines.join('\n')
}

/**
 * Pure: the text of "Share log". The report first, then the end of the app
 * log with the last crash record (read from the file of the native layer),
 * then what this session recorded in the WebView. Where the file could not be
 * read the text says so instead of leaving a gap.
 */
export function buildLogText(
  d: DiagnosticsData,
  log: readonly SessionLogEntry[],
  storageFailures: ReadonlyArray<{ key: string; at: number }>,
  now: number = Date.now(),
  appLog: AppLog | null = null,
): string {
  const lines = [buildReport(d, now), '', T.appLogHeading]
  if (appLog) {
    if (appLog.tail.truncated) lines.push(T.appLogTruncated(appLog.tail.lineCount))
    lines.push(appLog.text.trimEnd())
  } else {
    lines.push(T.appLogMissing)
  }
  lines.push('', T.logHeading)
  if (log.length === 0) lines.push(T.logNoErrors)
  for (const entry of log) lines.push(`${new Date(entry.at).toISOString()} ${entry.kind} ${entry.message}`)
  if (storageFailures.length > 0) {
    lines.push('', T.storageHeading)
    for (const failure of storageFailures) lines.push(`${new Date(failure.at).toISOString()} ${failure.key}`)
  }
  return lines.join('\n')
}

/** The bytes of every installed model file, or null where the engine cannot be asked. */
async function readModelsBytes(): Promise<number | null> {
  if (!hasNativeBridge()) return null
  try {
    const models = await listBundledModels()
    return models.reduce((sum, m) => sum + (typeof m.size === 'number' && m.size > 0 ? m.size : 0), 0)
  } catch {
    return null
  }
}

async function readEngine(): Promise<EngineStatus | null> {
  if (!hasNativeBridge()) return null
  try {
    return (await bundledEngineStatus()) ?? null
  } catch {
    return null
  }
}

/**
 * Collect everything once. Never throws. `lastCrash` is what the caller read
 * from the app log (parts/app-log.ts); left undefined, there is no crash row.
 */
export async function collectDiagnostics(appVersion: string, selfTest: SelfTestRecord | null, lastCrash?: string | null): Promise<DiagnosticsData> {
  const [scaffold, storage, engine, modelsBytes] = await Promise.all([readDiagnostics(), storageEstimate(), readEngine(), readModelsBytes()])
  const model = modelNameFromPath(engine?.model_path)
  const benchmarkSpeed = model ? getLatestSpeed(useBenchmarkStore.getState().results, model) : null
  // The version the native layer was built with is the one installed; the bundle's own number is the fallback.
  const version = scaffold.device.appVersion || appVersion
  return { appVersion: version, device: scaffold.device, storage, modelsBytes, engine, benchmarkSpeed, selfTest, measured: scaffold.speed, scaffold, lastCrash }
}

export type SelfTestResult =
  | { ok: true; accelerator: Accelerator; tokensPerSecond: number; model: string }
  | { ok: false; reason: 'no-engine' | 'no-model' | 'busy' | 'failed'; detail?: string }

/** Pure: tokens per second from what the engine reported, or from the length of the answer. */
export function selfTestSpeed(evalCount: number | undefined, content: string, elapsedMs: number): number {
  const tokens = typeof evalCount === 'number' && evalCount > 0 ? evalCount : Math.max(1, Math.round(content.length / 4))
  const seconds = Math.max(0.001, elapsedMs / 1000)
  return Math.round((tokens / seconds) * 10) / 10
}

/**
 * Ask the engine one short question and time the answer. Uses the model
 * that is loaded, or the first installed one. The provider client revives
 * the engine when it is down, which is what a real chat does too.
 */
export async function runEngineSelfTest(now: () => number = () => Date.now()): Promise<SelfTestResult> {
  if (!hasNativeBridge()) return { ok: false, reason: 'no-engine' }
  if (Object.values(useGenerationStore.getState().generating).some(Boolean)) return { ok: false, reason: 'busy' }
  try {
    const before = await bundledEngineStatus()
    let model = before?.running ? modelNameFromPath(before.model_path) : null
    if (!model) {
      const installed = await listBundledModels()
      model = installed.find((m) => m.loaded)?.name ?? installed[0]?.name ?? null
    }
    if (!model) return { ok: false, reason: 'no-model' }
    const started = now()
    const answer = await getProvider('openai').chatWithTools(model, [{ role: 'user', content: 'Reply with the single word: ready' }], [], { maxTokens: 32, temperature: 0 })
    const elapsed = now() - started
    if (!answer.content.trim() && !answer.thinking) return { ok: false, reason: 'failed' }
    const after = await bundledEngineStatus().catch(() => null)
    const tokensPerSecond = selfTestSpeed(answer.evalCount, answer.content || answer.thinking || '', elapsed)
    // Only a count the engine reported is a measurement; a guess from the length is not handed on.
    if (typeof answer.evalCount === 'number' && answer.evalCount > 0) reportGenerationSpeed({ tokens: answer.evalCount, ms: elapsed, model })
    return { ok: true, accelerator: acceleratorOf(after ?? before), tokensPerSecond, model }
  } catch (err) {
    const detail = err instanceof Error ? err.message.replace(/\s+/g, ' ').slice(0, 200) : undefined
    return { ok: false, reason: 'failed', detail }
  }
}
