/**
 * Check files and Repair, the rules without the screen (GH #113, wish G16).
 *
 * GH #113: a video bundle whose download broke off midway stayed in limbo.
 * The card read Retry, Retry did not get it out, and nothing in the app could
 * say which of the bundle's files were whole. Check files answers that per
 * file against the catalog; Repair fetches exactly the files that are not
 * whole, through the download path that fetched them the first time. A file
 * that is there and wrong goes to the Trash first, never deleted for good.
 *
 * Pure, so the whole flow can be proven with stand-ins for the backend.
 */

import type { FileCheckRequest, FileState, FileVerdict } from '../api/model-verify'
import { catalogFileBytes } from './bundle-state'
import { imagePartFileName } from './image-part'
import { formatBytes } from './formatters'

/** One file a check is about, with what Repair needs to fetch it again. */
export interface CheckTarget extends FileCheckRequest {
  /** What the download is told to plan with: the exact size, else the
   *  catalog estimate. Never used to judge the file. */
  downloadBytes?: number
  /** A file the model works without (a chat model's image part). Missing is
   *  then a choice, not damage, and Repair leaves it out. */
  optional?: boolean
}

/** The catalog fields a bundle file carries. */
interface CatalogFile {
  filename?: string
  subfolder?: string
  downloadUrl?: string
  sizeGB?: number
  sizeBytes?: number
  sha256?: string
}

/** Every file of a bundle that the download path can fetch. */
export function bundleCheckTargets(files: readonly CatalogFile[]): CheckTarget[] {
  return files
    .filter((f) => f.filename && f.subfolder && f.downloadUrl)
    .map((f) => ({
      filename: f.filename!,
      subfolder: f.subfolder!,
      url: f.downloadUrl!,
      expectedBytes: f.sizeBytes,
      downloadBytes: catalogFileBytes(f) || undefined,
      sha256: f.sha256,
    }))
}

/** The catalog fields of a chat model entry. */
interface CatalogChatModel extends CatalogFile {
  mmprojUrl?: string
  mmprojBytes?: number
  mmprojSha256?: string
}

/** A chat GGUF and, when the catalog names one, its image part, both in the
 *  folder the built-in engine reads. */
export function chatModelCheckTargets(model: CatalogChatModel, destDir: string): CheckTarget[] {
  if (!model.filename || !model.downloadUrl) return []
  const out: CheckTarget[] = [{
    filename: model.filename,
    destDir,
    url: model.downloadUrl,
    expectedBytes: model.sizeBytes,
    downloadBytes: catalogFileBytes(model) || undefined,
    sha256: model.sha256,
  }]
  if (model.mmprojUrl) {
    out.push({
      filename: imagePartFileName(model.filename),
      destDir,
      url: model.mmprojUrl,
      expectedBytes: model.mmprojBytes,
      downloadBytes: model.mmprojBytes,
      sha256: model.mmprojSha256,
      optional: true,
    })
  }
  return out
}

/** What a verdict means for Repair. */
export type RepairStep = 'none' | 'fetch' | 'trash-and-fetch'

export function repairStepFor(state: FileState, optional = false): RepairStep {
  switch (state) {
    case 'wrong_size':
    case 'wrong_checksum':
      return 'trash-and-fetch'
    // A partial resumes where it stopped; one that cannot be resumed is
    // handled by the download itself (it goes to the Trash on a 416).
    case 'incomplete':
      return 'fetch'
    case 'missing':
      return optional ? 'none' : 'fetch'
    default:
      return 'none'
  }
}

/** The verdicts Repair will act on, with their targets. */
export function filesToRepair(targets: readonly CheckTarget[], verdicts: readonly FileVerdict[]): Array<{ target: CheckTarget; verdict: FileVerdict; step: Exclude<RepairStep, 'none'> }> {
  const byName = new Map(targets.map((t) => [t.filename, t]))
  const out: Array<{ target: CheckTarget; verdict: FileVerdict; step: Exclude<RepairStep, 'none'> }> = []
  for (const v of verdicts) {
    const target = byName.get(v.filename)
    if (!target) continue
    const step = repairStepFor(v.state, target.optional)
    if (step !== 'none') out.push({ target, verdict: v, step })
  }
  return out
}

/** The word on a file's row. */
export function stateLabel(state: FileState, optional = false): string {
  switch (state) {
    case 'ok': return 'OK'
    case 'missing': return optional ? 'Not added' : 'Missing'
    case 'wrong_size': return 'Wrong size'
    case 'wrong_checksum': return 'Checksum mismatch'
    case 'incomplete': return 'Incomplete download'
    case 'unconfirmed': return 'Not confirmed'
  }
}

/** The tone of a file's row: broken files are red, the rest stay calm. */
export function stateTone(state: FileState, optional = false): 'good' | 'bad' | 'calm' {
  if (state === 'ok') return 'good'
  if (state === 'unconfirmed') return 'calm'
  if (state === 'missing' && optional) return 'calm'
  return 'bad'
}

/** The line under a file's state. */
export function stateDetail(v: FileVerdict, optional = false): string {
  const expected = v.expectedBytes ? formatBytes(v.expectedBytes) : null
  switch (v.state) {
    case 'ok':
      return v.checked === 'sha256' ? 'Size and checksum match.' : 'Size matches. The catalog lists no checksum for this file.'
    case 'missing':
      return optional ? 'Optional. The model runs without it.' : 'Not on disk.'
    case 'wrong_size':
      return expected
        ? `${formatBytes(v.actualBytes)} on disk, ${expected} expected.`
        : `${formatBytes(v.actualBytes)} on disk, another size expected.`
    case 'wrong_checksum':
      return 'The size is right, the content is not.'
    case 'incomplete':
      return expected && v.partialBytes != null
        ? `${formatBytes(v.partialBytes)} of ${expected} downloaded.`
        : 'Only a part of the file was downloaded.'
    case 'unconfirmed':
      return 'On disk, but the host did not state its size and the catalog lists no checksum. Check again when you are online.'
  }
}

/** One sentence over the whole check. */
export function checkSummary(targets: readonly CheckTarget[], verdicts: readonly FileVerdict[]): string {
  const total = verdicts.length
  const broken = filesToRepair(targets, verdicts).length
  const unconfirmed = verdicts.filter((v) => v.state === 'unconfirmed').length
  const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`
  if (broken === 0 && unconfirmed === 0) return total === 1 ? 'The file is OK.' : `All ${files(total)} are OK.`
  const parts: string[] = []
  if (broken > 0) parts.push(`${broken} of ${files(total)} ${broken === 1 ? 'needs' : 'need'} a repair.`)
  if (unconfirmed > 0) parts.push(`${files(unconfirmed)} could not be confirmed.`)
  if (broken === 0) parts.unshift('Nothing to repair.')
  return parts.join(' ')
}

/** How far the digest is, 0 to 100. */
export function checkPercent(hashed: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.round((hashed / total) * 100))
}

/** What Repair needs from the outside world. */
export interface RepairDeps {
  /** Move the file to the Trash. Throws when the Trash refuses. */
  trash: (target: CheckTarget) => Promise<unknown>
  /** Start the download of one file. */
  start: (target: CheckTarget) => Promise<{ status: string; error?: string }>
}

export interface RepairReport {
  /** Files whose download started (or that turned out to be there). */
  started: string[]
  /** Files that went to the Trash first. */
  trashed: string[]
  failed: Array<{ filename: string; error: string }>
}

/**
 * Repair: every broken file goes to the Trash, every missing or broken one
 * is fetched again. A file the Trash refused is NOT fetched: the download
 * would write over it, and that is the permanent delete this never does.
 */
export async function repairFiles(
  targets: readonly CheckTarget[],
  verdicts: readonly FileVerdict[],
  deps: RepairDeps,
): Promise<RepairReport> {
  const report: RepairReport = { started: [], trashed: [], failed: [] }
  for (const { target, step } of filesToRepair(targets, verdicts)) {
    if (step === 'trash-and-fetch') {
      try {
        await deps.trash(target)
        report.trashed.push(target.filename)
      } catch (err) {
        report.failed.push({ filename: target.filename, error: err instanceof Error ? err.message : String(err) })
        continue
      }
    }
    try {
      const answer = await deps.start(target)
      if (answer.status === 'error') {
        report.failed.push({ filename: target.filename, error: answer.error || `${target.filename} could not be started.` })
      } else {
        report.started.push(target.filename)
      }
    } catch (err) {
      report.failed.push({ filename: target.filename, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return report
}

/** One sentence after Repair. */
export function repairSummary(r: RepairReport, bin = 'Trash'): string {
  const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`
  const parts: string[] = []
  if (r.started.length > 0) {
    parts.push(`${files(r.started.length)} ${r.started.length === 1 ? 'is' : 'are'} downloading again. Check again when the download list says done.`)
  }
  if (r.trashed.length > 0) {
    parts.push(`The broken ${r.trashed.length === 1 ? 'file is' : 'files are'} in the ${bin}.`)
  }
  if (r.failed.length > 0) parts.push(`${files(r.failed.length)} could not be repaired.`)
  return parts.join(' ') || 'Nothing to repair.'
}

/** A GGUF name reduced to what identifies the file: last path part, lower
 *  case, without `.gguf`. */
function ggufBase(name: string): string {
  return (name.split(/[\\/]/).pop() || '').toLowerCase().replace(/\.gguf$/, '')
}

/**
 * Can Check files speak about this chat row. Only for the built-in engine,
 * whose GGUFs lie flat in the one folder the download wrote them to, only for
 * a single file (a split model's parts are not in the catalog one by one),
 * and only when the installed file IS the catalog's file by name. A fuzzy
 * match (another quant, LM Studio's nested folders, Ollama's store) would
 * send the check to a file that is not there and Repair to a second download.
 */
export function chatModelCheckable(
  model: { filename?: string; downloadUrl?: string },
  entry: { name?: string; model?: string } | null,
  builtin: boolean,
): boolean {
  if (!builtin || !entry || !model.filename || !model.downloadUrl) return false
  if (/-\d{4,5}-of-\d{4,5}\.gguf$/i.test(model.filename)) return false
  const want = ggufBase(model.filename)
  return [entry.name, entry.model].some((n) => !!n && ggufBase(n) === want)
}
