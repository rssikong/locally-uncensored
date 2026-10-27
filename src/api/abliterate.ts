// Remove refusals from a local model (A14). The work happens in Rust and
// Python (src-tauri/src/commands/abliterate); this is the app's side of it.

import { backendCall } from './backend'

export type LicenseKind = 'free' | 'notice'
export type DeviceKind = 'apple' | 'nvidia' | 'amd'
export type Mode = 'gentle' | 'balanced' | 'strong'

export interface LicenseVerdict {
  id: string | null
  kind: LicenseKind
  label: string
  link: string | null
  note: string | null
  cloudAllowed: boolean
}

export interface DeviceOption {
  id: string
  kind: DeviceKind
  name: string
  memoryBytes: number | null
  supported: boolean
  note: string | null
}

export interface Estimate {
  fits: boolean
  whyNot: string | null
  quantization: 'none' | 'bnb4bit'
  memoryNeededBytes: number
  memoryAvailableBytes: number | null
  diskNeededBytes: number
  diskAfterBytes: number
  diskFreeBytes: number | null
  downloadBytes: number
  minutesLow: number
  minutesHigh: number
  outputQuant: string
  outputBytes: number
}

export interface DevicePlan {
  device: DeviceOption
  estimate: Estimate
  estimate100: { minutesLow: number; minutesHigh: number }
}

export interface Plan {
  model: { name: string; path: string; size: number; quant: string }
  alreadyDone?: boolean
  /** null: the file names no original. The dialog asks for the repo. */
  source?: {
    repo: string
    from: 'source' | 'license' | 'catalog' | 'base_model' | 'typed'
    revision: string
    gated: boolean
    private: boolean
    params: number
    downloadBytes: number
    modelType: string | null
    tokenSaved: boolean
  } | null
  license?: LicenseVerdict
  devices?: DevicePlan[]
  quantizeTool?: boolean
  heretic?: string
  cloud?: { available: boolean; allowed: boolean; note: string }
}

export interface Check {
  refusals: number
  falseAlarms: number
  mmlu: number
  n: number
}

export interface RunRecord {
  id: string
  sourcePath: string
  sourceName: string
  outputPath: string
  outputName: string
  repo: string
  revision: string
  license: string
  mode: Mode
  trials: number
  trial: number
  kl: number
  searchRefusalsBefore: number | null
  searchRefusalsAfter: number
  searchPrompts: number | null
  before: Check | null
  after: Check | null
  quant: string
  quantNote: string | null
  device: string
  seconds: number
  finishedAt: number
  discarded: boolean
}

export interface RunStatus {
  status: 'idle' | 'running' | 'done' | 'failed' | 'cancelled'
  id: string
  modelName: string
  sourcePath: string
  repo: string
  phase: string
  phaseLabel: string
  step: number
  total: number
  trials: number
  best: { trial: number; refusals: number; kl: number } | null
  baseRefusals: number | null
  prompts: number | null
  startedAt: number
  elapsedSecs: number
  etaSecs: number | null
  logs: string[]
  error: string | null
  result: RunRecord | null
  resumable: boolean
}

export interface StartArgs {
  path: string
  repo: string
  revision: string
  device: string
  trials: 100 | 200
  mode: Mode
  acceptLicense: boolean
  adult: boolean
}

export function abliteratePlan(path: string, repo?: string): Promise<Plan> {
  return backendCall<Plan>('abliterate_plan', { path, repo: repo ?? null })
}

export function abliterateStart(args: StartArgs): Promise<RunStatus> {
  return backendCall<RunStatus>('abliterate_start', { args })
}

export function abliterateStatus(): Promise<RunStatus> {
  return backendCall<RunStatus>('abliterate_status')
}

export function abliterateCancel(): Promise<RunStatus> {
  return backendCall<RunStatus>('abliterate_cancel')
}

export function abliterateDismiss(): Promise<RunStatus> {
  return backendCall<RunStatus>('abliterate_dismiss')
}

export function abliterateRuns(): Promise<RunRecord[]> {
  return backendCall<RunRecord[]>('abliterate_runs')
}

export function abliterateTrashCopy(path: string): Promise<{ trashed: boolean }> {
  return backendCall<{ trashed: boolean }>('abliterate_trash_copy', { path })
}

/** The share of the current phase that is done, 0..1, or null when the phase
 *  has no count. */
export function phaseShare(s: Pick<RunStatus, 'step' | 'total'>): number | null {
  if (!s.total || s.total <= 0) return null
  return Math.max(0, Math.min(1, s.step / s.total))
}

/** "about 1 h 20 min", "about 12 min". */
export function roughDuration(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} h ${rest} min` : `${h} h`
}

/** "1–2 h", "25–60 min" from an estimate's range in minutes. */
export function minutesRange(low: number, high: number): string {
  if (high < 60) return `${low}–${high} min`
  const lh = low / 60
  const hh = high / 60
  const f = (x: number) => (x < 10 ? (Math.round(x * 2) / 2).toString() : Math.round(x).toString())
  return low < 60 ? `${low} min – ${f(hh)} h` : `${f(lh)}–${f(hh)} h`
}

/** Decimal gigabytes, as disks and downloads are sold. */
export function gb(bytes: number | null | undefined): string {
  if (bytes == null) return '?'
  const v = bytes / 1e9
  return v < 10 ? `${v.toFixed(1)} GB` : `${Math.round(v)} GB`
}
