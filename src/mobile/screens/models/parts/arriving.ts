/**
 * "A model for this phone is on its way": the one readable source for every
 * screen that would otherwise say "No model yet" while a download runs
 * (acceptance Android 08.10.2026, M1: the last onboarding step said "You're
 * all set" and the chat "No model yet. Install a model" during the download
 * of the starter model).
 *
 * `arrivingModel` is pure. `useArrivingModel` is the hook for a screen: it
 * reads the download store and the network, and makes sure the watch of the
 * strand runs, so the rows are there after a restart too. It answers null
 * when no chat model is being downloaded.
 *
 *   const arriving = useArrivingModel()
 *   if (arriving) show(`${arriving.name} is downloading, ${arriving.percent}%`)
 */
import { useEffect, useMemo } from 'react'
import type { DownloadProgress } from '../../../../types/downloads'
import { useDownloadStore } from '../../../../stores/downloadStore'
import { useOnline } from '../../../resilience/useOnline'
import { downloadKind, isFailure, isOpen, percentOf, shareOf, type DownloadKind } from './download-state'
import { bareName, displayName, isDocumentModel } from './installed'
import { installModelsWatch } from './watch'

export type ArrivingState =
  /** Bytes are moving, or will in a moment (waiting to start, checking the file). */
  | 'downloading'
  /** Paused by the user, or held until the network is back. It goes on without a new download. */
  | 'paused'
  /** The transfer stopped with a failure the user has to look at. */
  | 'failed'

export interface ArrivingModel {
  /** The id of the download: the file name. Transfer and the download store know it by this. */
  id: string
  /** The model as the screens name it ("Qwen 3.5 0.8B"). */
  name: string
  /** The bare file name, as the list of installed models has it. */
  file: string
  state: ArrivingState
  /** The exact kind, for a screen that wants to say more. */
  kind: DownloadKind
  /** 0 to 1. */
  share: number
  /** 0 to 100, whole. */
  percent: number
}

function stateOf(kind: DownloadKind): ArrivingState {
  if (isFailure(kind)) return 'failed'
  return kind === 'paused' || kind === 'pausing' || kind === 'waiting-network' ? 'paused' : 'downloading'
}

const ORDER: Record<ArrivingState, number> = { downloading: 0, paused: 1, failed: 2 }

/**
 * The chat model that is being downloaded. With several, `prefer` (a bare
 * file name, the model picked in the onboarding) wins, then the one that
 * moves, then the one that is furthest. The document model is not a chat
 * model and never counts.
 */
export function arrivingModel(
  rows: Readonly<Record<string, DownloadProgress>>,
  online: boolean,
  expected: Readonly<Record<string, number | undefined>> = {},
  prefer: string | null = null,
): ArrivingModel | null {
  const list: ArrivingModel[] = []
  for (const [id, row] of Object.entries(rows)) {
    const file = bareName(id)
    if (!isOpen(row) || isDocumentModel({ name: file })) continue
    const kind = downloadKind(row, online)
    list.push({ id, name: displayName({ name: file }), file, state: stateOf(kind), kind, share: shareOf(row, expected[id]), percent: percentOf(row, expected[id]) })
  }
  if (list.length === 0) return null
  const wanted = prefer ? list.find((m) => m.file === bareName(prefer)) : undefined
  if (wanted) return wanted
  return list.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.share - a.share || a.id.localeCompare(b.id))[0]
}

/** The chat model that is being downloaded right now, or null. Re-renders as it moves. */
export function useArrivingModel(prefer: string | null = null): ArrivingModel | null {
  const rows = useDownloadStore((s) => s.downloads)
  const meta = useDownloadStore((s) => s.downloadMeta)
  const online = useOnline()
  useEffect(() => {
    installModelsWatch()
  }, [])
  return useMemo(() => {
    const expected: Record<string, number | undefined> = {}
    for (const id of Object.keys(rows)) expected[id] = meta[id]?.expectedBytes
    return arrivingModel(rows, online, expected, prefer)
  }, [rows, meta, online, prefer])
}
