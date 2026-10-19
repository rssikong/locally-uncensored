/**
 * What the "Voice and Python folder" row says, kept apart from the component
 * so every sentence can be tested without a browser.
 *
 * Discord wish D2: models could already go to another drive, the voice engine
 * and LU's own Python could not. They get one folder of their own and not the
 * model folder, because LU scans the model folder for GGUF files four levels
 * deep and a Python environment holds tens of thousands of files.
 */

import type { MoveOutcome, RuntimeEntry, RuntimeKind } from '../api/runtime-folder'
import { formatBytes } from './formatters'

export const RUNTIME_KIND_LABEL: Record<RuntimeKind, string> = {
  voice: 'Voice engine',
  python: "LU's own Python",
  piperVoices: 'Read-aloud voices',
}

/** A path with one kind of slash and no trailing one, in lower case. */
function normalized(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Whether `candidate` is the model folder or lies inside it. The model folder
 * is scanned for models, so the voice engine and the Python must not sit in
 * it. Compared without regard to case or slash direction: Windows and the
 * default macOS volume do not tell them apart either.
 */
export function runtimeFolderClash(candidate: string, modelFolder: string): boolean {
  const c = normalized(candidate)
  const m = normalized(modelFolder)
  if (!c || !m) return false
  return c === m || c.startsWith(`${m}/`)
}

export const RUNTIME_FOLDER_CLASH =
  'This is inside the LU Engine folder, which LU scans for models. Give the voice engine and the Python a folder of their own.'

/** The line under one entry. */
export function runtimeEntryNote(entry: RuntimeEntry, chosen: string | null): string {
  if (!entry.installed) return 'Not installed. A new install goes here.'
  const size = entry.bytes > 0 ? ` (${formatBytes(entry.bytes)})` : ''
  if (entry.atTarget) return `Installed here${size}.`
  return chosen
    ? `Installed in the old folder${size}. It keeps working there until you move it.`
    : `Installed in a folder chosen earlier${size}. It keeps working there.`
}

/** Whether there is anything the Move button could move. */
export function canMoveRuntime(entries: RuntimeEntry[], chosen: string | null): boolean {
  return chosen !== null && entries.some((e) => e.installed && !e.atTarget)
}

/** What the confirmation says before anything is copied. */
export function moveConfirmText(onWindows: boolean): string {
  const bin = onWindows ? 'Recycle Bin' : 'Trash'
  return `LU copies the files to the new folder, checks the copy, starts it once there, and only then puts the old files in the ${bin}. Nothing is deleted for good. Voice and dictation stop while it runs, and it can take several minutes.`
}

/** One line per moved folder. */
export function moveOutcomeLine(outcome: MoveOutcome): string {
  const label = RUNTIME_KIND_LABEL[outcome.kind] ?? outcome.kind
  const detail = outcome.detail ? ` ${outcome.detail}` : ''
  if (outcome.status === 'moved') return `${label}: moved to ${outcome.to}.`
  if (outcome.status === 'movedOldKept') return `${label}: moved to ${outcome.to}.${detail}`
  return `${label}: not moved.${detail}`
}
