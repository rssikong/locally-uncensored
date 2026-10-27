/**
 * What a download row means on the phone.
 *
 * The download store reports six raw states and, for a failure, an English
 * sentence written for the desktop. The phone shows its own states (DESIGN.md
 * M3 and 5.4) and its own sentences, picked by the kind of failure and never
 * by passing the desktop sentence through.
 *
 * Pure: tested in ../__tests__/download-state.test.ts.
 */
import { formatBytes, formatEta } from '../../../../lib/formatters'
import type { DownloadProgress } from '../../../../types/downloads'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { withoutPaths } from '../../../lib/no-paths'

export type DownloadKind =
  | 'waiting'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'waiting-network'
  | 'verifying'
  | 'done'
  /** The transfer broke (network gone, app closed). The part is kept. */
  | 'interrupted'
  /** The storage ran out while downloading. The part is kept. */
  | 'storage'
  /** The file did not match its checksum and was removed. */
  | 'checksum'
  /** The source wants a sign in (401, 403). */
  | 'gated'
  /** The file is not at its address any more (404, 410). */
  | 'gone'
  /** The source did not answer (429, 5xx). */
  | 'unreachable'
  /** The address is refused (native code `blocked`: a redirect to an address that is not allowed). Final, the part is gone. */
  | 'blocked'

const HTTP = /\(HTTP (\d{3})\)/

/** The kind of a failed row, read from the markers the native side puts into its message. */
export function errorKind(error: string | undefined | null): Exclude<DownloadKind, 'waiting' | 'running' | 'pausing' | 'paused' | 'waiting-network' | 'verifying' | 'done'> {
  const text = error ?? ''
  // The row carries the sentence of the native side and not its code. Every refusal of an address says "address ... not allowed".
  if (/\baddress\b[^.]*\bnot allowed\b/i.test(text)) return 'blocked'
  if (/not enough free space|no space left|disk full|storage full/i.test(text)) return 'storage'
  if (/does not match the checksum|checksum|sha256 mismatch/i.test(text)) return 'checksum'
  const status = Number(HTTP.exec(text)?.[1] ?? 0)
  if (status === 401 || status === 403) return 'gated'
  if (status === 404 || status === 410) return 'gone'
  if (status === 429 || (status >= 500 && status <= 599)) return 'unreachable'
  return 'interrupted'
}

export function downloadKind(row: DownloadProgress, online: boolean): DownloadKind {
  switch (row.status) {
    case 'complete':
      return 'done'
    case 'paused':
      return 'paused'
    case 'pausing':
      return 'pausing'
    case 'error': {
      const kind = errorKind(row.error)
      // A broken transfer without a network is not a failure yet: it goes on by itself.
      return kind === 'interrupted' && !online ? 'waiting-network' : kind
    }
    case 'connecting':
      return online ? 'waiting' : 'waiting-network'
    case 'downloading':
      if (!online) return 'waiting-network'
      return row.total > 0 && row.progress >= row.total ? 'verifying' : 'running'
  }
}

/** Rows that still move or will move by themselves. They make the dot at the Models tab. */
export function isActive(row: DownloadProgress): boolean {
  return row.status === 'connecting' || row.status === 'downloading' || row.status === 'pausing'
}

/** Rows a user still has to look at: everything but a finished one. */
export function isOpen(row: DownloadProgress): boolean {
  return row.status !== 'complete'
}

export function totalBytesOf(row: DownloadProgress, expectedBytes?: number): number {
  return row.total > 1 ? row.total : expectedBytes && expectedBytes > 0 ? expectedBytes : 0
}

/** 0 to 1. A finished row is 1 whatever its numbers say (a row marked done by hand carries 1 of 1). */
export function shareOf(row: DownloadProgress, expectedBytes?: number): number {
  if (row.status === 'complete') return 1
  const total = totalBytesOf(row, expectedBytes)
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, row.progress / total))
}

export function percentOf(row: DownloadProgress, expectedBytes?: number): number {
  return Math.round(shareOf(row, expectedBytes) * 100)
}

/** "0.8 GB of 2.0 GB", or only what arrived while the total is unknown. */
export function sizesText(row: DownloadProgress, expectedBytes?: number): string {
  const total = totalBytesOf(row, expectedBytes)
  if (total <= 0) return row.progress > 1 ? formatBytes(row.progress) : ''
  return S.download.sizes(formatBytes(Math.min(row.progress, total)), formatBytes(total))
}

/**
 * "3.2 MB/s, about 4 min left". Empty unless the row is moving. An estimate, and worded as one.
 * `secondsLeft` is what parts/pace.ts measured: without it (the first seconds, the last seconds) the line names
 * the rate alone, because a time taken from the rate of the first moment was wrong by a factor of fifty (P6).
 */
export function paceText(row: DownloadProgress, expectedBytes?: number, secondsLeft?: number | null): string {
  if (row.status !== 'downloading' || !(row.speed > 0)) return ''
  const total = totalBytesOf(row, expectedBytes)
  const parts = [S.download.speed(formatBytes(row.speed))]
  if (total > row.progress && typeof secondsLeft === 'number' && secondsLeft > 0) parts.push(S.download.eta(formatEta(secondsLeft)))
  return parts.join(', ')
}

export function stateWord(kind: DownloadKind): string {
  switch (kind) {
    case 'waiting': return S.download.waiting
    case 'running': return S.download.running
    case 'pausing': return S.download.pausing
    case 'paused': return S.download.paused
    case 'waiting-network': return S.download.waitingNetwork
    case 'verifying': return S.download.verifying
    case 'done': return S.download.done
    case 'interrupted': return S.download.interruptedTitle
    case 'storage': return S.download.storageTitle
    case 'checksum': return S.download.checksumTitle
    case 'gated': return S.download.gatedTitle
    case 'gone': return S.download.goneTitle
    case 'unreachable': return S.download.unreachableTitle
    case 'blocked': return S.download.blockedTitle
  }
}

export function isFailure(kind: DownloadKind): boolean {
  return kind === 'interrupted' || kind === 'storage' || kind === 'checksum' || kind === 'gated' || kind === 'gone' || kind === 'unreachable' || kind === 'blocked'
}

const SPACE = /needs ([\d.]+) GB and the drive has ([\d.]+) GB free/

/** Bytes that have to be freed, read from the numbers in the native message. Null when it names none. */
export function missingBytes(error: string | undefined | null): number | null {
  const hit = SPACE.exec(error ?? '')
  if (!hit) return null
  const missing = Number(hit[1]) - Number(hit[2])
  return Number.isFinite(missing) && missing > 0 ? Math.round(missing * 1_073_741_824) : null
}

export interface FailureText {
  title: string
  text: string
}

/** Cause and what is kept, in the phone's own words. */
export function failureText(kind: DownloadKind, row: DownloadProgress, expectedBytes?: number): FailureText {
  const percent = percentOf(row, expectedBytes)
  switch (kind) {
    case 'storage': {
      const missing = missingBytes(row.error)
      return { title: S.download.storageTitle, text: missing ? S.download.storage(percent, formatBytes(missing)) : S.download.storageNoNumber(percent) }
    }
    case 'checksum':
      return { title: S.download.checksumTitle, text: S.download.checksum }
    case 'gated':
      return { title: S.download.gatedTitle, text: S.download.gated }
    case 'gone':
      return { title: S.download.goneTitle, text: S.download.gone }
    case 'unreachable':
      return { title: S.download.unreachableTitle, text: S.download.unreachable }
    case 'blocked':
      return { title: S.download.blockedTitle, text: S.download.blocked }
    default:
      return { title: S.download.interruptedTitle, text: row.progress > 0 ? S.download.interrupted(percent) : S.download.interruptedAtStart }
  }
}

export interface SpaceShortfall {
  needBytes: number
  /** Null when the phone could not say. */
  freeBytes: number | null
  missingBytes: number
}

/**
 * Does the download fit the free storage. `verdict` is the answer of the
 * native space check (null when it could not measure: then nothing blocks).
 */
export function spaceShortfall(
  verdict: { fits: boolean; requiredBytes: number; reservedBytes: number; availableBytes?: number | null } | null,
  needBytes: number,
): SpaceShortfall | null {
  if (!verdict || verdict.fits) return null
  const free = typeof verdict.availableBytes === 'number' ? verdict.availableBytes : null
  const missing = free === null ? needBytes : Math.max(needBytes - free, 0)
  return { needBytes, freeBytes: free, missingBytes: missing > 0 ? missing : needBytes }
}

/** The text of dialog G9. `resume`: the download has a part already and only its rest is asked for. */
export function storageDialogText(name: string, shortfall: SpaceShortfall, resume = false): string {
  const need = formatBytes(shortfall.needBytes)
  if (shortfall.freeBytes === null) return resume ? S.storageDialog.textResumeUnknownFree(name, need) : S.storageDialog.textUnknownFree(name, need)
  const text = resume ? S.storageDialog.textResume : S.storageDialog.text
  return text(name, need, formatBytes(shortfall.freeBytes), formatBytes(shortfall.missingBytes))
}

/** The text of the dialog for storage that ran out while a download was running. */
export function storageRanOutText(name: string, row: DownloadProgress, expectedBytes?: number): string {
  const percent = percentOf(row, expectedBytes)
  const missing = missingBytes(row.error)
  return missing ? S.storageDialog.ranOut(name, percent, formatBytes(missing)) : S.storageDialog.ranOutNoNumber(name, percent)
}

/** Bytes a download with a part still has to fetch. 0 when the size is not known. */
export function remainingBytes(row: DownloadProgress, expectedBytes?: number): number {
  const total = totalBytesOf(row, expectedBytes)
  return total > 0 ? Math.max(total - Math.max(row.progress, 0), 0) : 0
}

const DESKTOP_WORDS = /settings|ai backends|log file|ollama|lm ?studio|comfy|gpu layers|llama-server|vram|sidecar|troubleshoot/i

/**
 * A reason from the engine that may be shown on the phone: its first
 * sentence, unless it speaks about things only the desktop has. Then nothing.
 */
export function phoneReason(reason: unknown): string {
  const text = (reason instanceof Error ? reason.message : String(reason ?? '')).trim()
  if (!text) return ''
  const first = withoutPaths((text.split(/(?<=[.!?])\s/)[0] ?? '').trim())
  if (!first || DESKTOP_WORDS.test(first) || first.length > 160) return ''
  return /[.!?]$/.test(first) ? first : `${first}.`
}

/** A failed start that is about memory. */
export function isMemoryFailure(reason: unknown): boolean {
  const text = reason instanceof Error ? reason.message : String(reason ?? '')
  return /not enough (free )?memory|out of memory|too large for|ram_guard|insufficient memory|cannot allocate/i.test(text)
}
