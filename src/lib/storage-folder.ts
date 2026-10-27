/**
 * What Settings → Storage says, kept apart from the component so every
 * sentence can be tested without a browser (Discord "Storage Management").
 */

import type { Drive, ItemGroup, ItemPlan, ItemReport, PlaceId, StorageApplied, StoragePlan } from '../api/storage'
import { formatBytes } from './formatters'

export const PLACE_LABEL: Record<PlaceId, string> = {
  models: 'Models (LU Engine)',
  comfyModels: 'ComfyUI models',
  gallery: 'Gallery',
  runtime: 'Voice engine and Python',
}

export const GROUP_LABEL: Record<ItemGroup, string> = {
  models: 'LU Engine models',
  comfyModels: 'ComfyUI models',
  gallery: 'Gallery pictures and videos',
  runtime: 'Voice engine, read-aloud voices and LU\'s Python',
}

/** The groups in the order the list shows them. */
export const GROUP_ORDER: ItemGroup[] = ['models', 'comfyModels', 'gallery', 'runtime']

/** "C:\ · 45.0 GB free of 931.5 GB · system drive" */
export function driveLine(drive: Drive | null): string {
  if (!drive) return 'Drive not found'
  const system = drive.system ? ' · system drive' : ''
  return `${drive.mount} · ${formatBytes(drive.free)} free of ${formatBytes(drive.total)}${system}`
}

/** Whether a place sits on the system drive, the thing the setting is for. */
export function onSystemDrive(drive: Drive | null): boolean {
  return !!drive?.system
}

export interface GroupSummary {
  group: ItemGroup
  files: number
  bytes: number
  crossBytes: number
  conflicts: number
  sameVolume: boolean
  items: ItemPlan[]
}

export function groupsOf(plan: StoragePlan): GroupSummary[] {
  const out: GroupSummary[] = []
  for (const group of GROUP_ORDER) {
    const items = plan.items.filter((i) => i.group === group)
    if (items.length === 0) continue
    out.push({
      group,
      items,
      files: items.reduce((n, i) => n + i.plan.files, 0),
      bytes: items.reduce((n, i) => n + i.plan.bytes, 0),
      crossBytes: items.reduce((n, i) => n + i.plan.crossBytes, 0),
      conflicts: items.reduce((n, i) => n + i.plan.conflicts, 0),
      sameVolume: items.every((i) => i.plan.sameVolume),
    })
  }
  return out
}

/** The ids the user unticked, from the groups that are off. */
export function skippedIds(plan: StoragePlan, off: Set<ItemGroup>): string[] {
  return plan.items.filter((i) => off.has(i.group)).map((i) => i.id)
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** The line under one group of the plan. */
export function groupLine(g: GroupSummary): string {
  const how = g.group === 'runtime'
    ? 'copied, started once at the new place, then the old folders go to the Recycle Bin or Trash'
    : g.sameVolume
      ? 'same drive, renamed in place, no copy'
      : 'copied to the new drive, checked, then removed from the old one'
  const what = g.group === 'runtime' ? formatBytes(g.bytes) : `${count(g.files, 'file', 'files')}, ${formatBytes(g.bytes)}`
  const kept = g.conflicts > 0 ? ` ${count(g.conflicts, 'file is', 'files are')} already in the new folder and stay in both places.` : ''
  return `${what}: ${how}.${kept}`
}

/** The space line of the plan, or null when nothing has to be copied. */
export function spaceLine(plan: StoragePlan, wantedCrossBytes: number): string | null {
  if (wantedCrossBytes === 0) return null
  const free = plan.drive ? formatBytes(plan.drive.free) : 'an unknown amount'
  const where = plan.drive?.mount ?? 'the new drive'
  return `The move copies ${formatBytes(wantedCrossBytes)} to ${where}, which has ${free} free.`
}

/** Bytes that cross drives for the groups that are on. */
export function wantedCrossBytes(plan: StoragePlan, off: Set<ItemGroup>): number {
  return plan.items.filter((i) => !off.has(i.group)).reduce((n, i) => n + i.plan.crossBytes, 0)
}

/** LU keeps this much free on the drive after a move (SPARE_BYTES in storage.rs). */
export const SPARE_BYTES = 2 * 1024 * 1024 * 1024

export function enoughSpace(plan: StoragePlan, wanted: number): boolean {
  if (!plan.drive) return true
  return plan.drive.free >= wanted + SPARE_BYTES
}

/** What the confirmation says before a single file moves. */
export function moveConfirmText(plan: StoragePlan, onWindows: boolean): string {
  const bin = onWindows ? 'Recycle Bin' : 'Trash'
  const stops = plan.stops.length ? `LU stops ${plan.stops.join(' and ')} first; ${plan.stops.length === 1 ? 'it starts' : 'they start'} again the next time you use ${plan.stops.length === 1 ? 'it' : 'them'}. ` : ''
  return `${stops}Files on the same drive are renamed. Files going to another drive are copied, checked, and only then removed from the old place, so every file is always in one place at least. A file that is already in the new folder is never replaced, both copies stay. Nothing else is deleted, and empty old folders stay. The voice engine and LU's Python are copied, started once from the new folder, and then the old folders go to the ${bin}. A large move can take a while; you can cancel between files.`
}

/** One line per moved group, after the move. */
export function reportLines(applied: StorageApplied): string[] {
  const lines: string[] = []
  for (const group of GROUP_ORDER) {
    if (group === 'runtime') continue
    const reports: ItemReport[] = applied.moved.filter((m) => m.group === group)
    if (reports.length === 0) continue
    const moved = reports.reduce((n, r) => n + r.report.movedFiles, 0)
    const bytes = reports.reduce((n, r) => n + r.report.movedBytes, 0)
    const kept = reports.reduce((n, r) => n + r.report.kept, 0)
    const failed = reports.reduce((n, r) => n + r.report.failedCount, 0)
    let line = `${GROUP_LABEL[group]}: ${count(moved, 'file', 'files')} moved (${formatBytes(bytes)}).`
    if (kept) line += ` ${count(kept, 'file was', 'files were')} already there and ${kept === 1 ? 'stays' : 'stay'} in both places.`
    if (failed) line += ` ${count(failed, 'file stays', 'files stay')} at the old place: ${reports.flatMap((r) => r.report.failed).slice(0, 3).join('; ')}.`
    lines.push(line)
  }
  if (applied.cancelled) lines.push('Cancelled. What was not moved yet stays at the old place and keeps working.')
  return lines
}

/** Whether a report has anything that went wrong. */
export function reportHasProblems(applied: StorageApplied): boolean {
  return applied.moved.some((m) => m.report.failedCount > 0) || applied.runtime.some((r) => r.status !== 'moved')
}

/** The progress line while a move runs. */
export function progressLine(done: number, total: number, file: string): string {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return `Moving ${formatBytes(done)} of ${formatBytes(total)} (${pct} %)${file ? ` · ${file}` : ''}`
}

/** What the folder becomes, one line per part. */
export function layoutLines(plan: StoragePlan): string[] {
  const lines = [`Models: ${plan.modelsDir}`]
  if (plan.galleryDir) lines.push(`Gallery: ${plan.galleryDir}`)
  lines.push(`Voice engine and Python: ${plan.runtimeDir}`)
  return lines
}
