/**
 * Where Create makes things: LU Cloud, or "My computer" (LU 3.0.7).
 *
 * "My computer" is offered only when all of this holds:
 *   - the build has it (store switch `remoteCreate`, never without Remote),
 *   - a computer is paired over the sealed channel and connected (there is
 *     no plain way to Create on a computer, not even in the Wi-Fi),
 *   - the computer names a Create word (`create-image`, `create-video`, and
 *     since A17 `create-edit`, `create-upscale`, `create-removebg`,
 *     `create-music`) in its signed in status, which it does only while
 *     Create is on there for this phone.
 * Otherwise Create is LU Cloud, as before, and the choice is not shown.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { remoteCreateOffered } from '../../../policy/gates'
import { remote, remoteSession, useRemote } from '../../remote/parts/session'
import type { DesktopChannel } from '../../../remote/remoteClientStore'
import { FEATURE_CREATE_GALLERY, __resetCapabilitiesForTests, computerOffers, getCapabilities, type ComputerCapabilities } from '../../../remote/desktopCreate'
import { isComputerTool, type ComputerTool } from './computer-tools'
import { installComputerRun, resumeComputerJobs, useComputerRun } from './computer-run'
import { lifecycleState } from '../../../platform/lifecycle'
import { REMOTE_STRINGS as RS } from '../../../strings/remote'
import { sayNotice, setWaiting } from '../../remote/parts/notices'
import { installAgentCreate } from './computer-agent'
import { toast } from '../../../ui'

export type CreateSource = 'cloud' | 'computer'

const SOURCE_KEY = 'lu-create-source'
const TOOL_KEY = 'lu-create-computer-tool'

function readTool(): ComputerTool {
  try {
    const v = localStorage.getItem(TOOL_KEY)
    return isComputerTool(v) ? v : 'image'
  } catch {
    return 'image'
  }
}

function readSource(): CreateSource {
  try {
    return localStorage.getItem(SOURCE_KEY) === 'computer' ? 'computer' : 'cloud'
  } catch {
    return 'cloud'
  }
}

interface SourceStore {
  source: CreateSource
  /** The tool of the row on "My computer" (A17). */
  tool: ComputerTool
  setSource: (s: CreateSource) => void
  setTool: (t: ComputerTool) => void
}

export const useCreateSource = create<SourceStore>()((set) => ({
  source: readSource(),
  tool: readTool(),
  setSource: (source) => {
    try {
      localStorage.setItem(SOURCE_KEY, source)
    } catch {
      /* the choice holds for this run */
    }
    set({ source })
  },
  setTool: (tool) => {
    try {
      localStorage.setItem(TOOL_KEY, tool)
    } catch {
      /* the choice holds for this run */
    }
    set({ tool })
  },
}))

/** The channel to the computer, or null. Never touches the remote session in a build without it. */
export function computerChannel(): DesktopChannel | null {
  if (!remoteCreateOffered()) return null
  return remote().desktopChannel()
}

export interface ComputerAvailability {
  /** The choice "My computer" is shown at all. */
  offered: boolean
  image: boolean
  video: boolean
  /** The computer shows its gallery to this phone (`create-gallery`). */
  gallery: boolean
  /** The Create words the computer names, for the tool row. */
  features: readonly string[]
  /** The computer's name, for the choice. */
  name: string
}

const NONE: ComputerAvailability = { offered: false, image: false, video: false, gallery: false, features: [], name: '' }

/** Hook: what the computer offers right now. In a build without the switch it never asks the remote session. */
export function useComputerAvailability(): ComputerAvailability {
  // The switch is fixed for a build, so the order of hooks never changes at run time. A build without it never starts the remote session.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return remoteCreateOffered() ? useAvailabilityFromSession() : NONE
}

function useAvailabilityFromSession(): ComputerAvailability {
  const status = useRemote((s) => s.status)
  const pinned = useRemote((s) => !!s.connection?.pin)
  const features = useRemote((s) => s.features)
  const name = useRemote((s) => s.connection?.pin?.name || s.connection?.hostName || '')
  if (status !== 'connected' || !pinned) return NONE
  const image = computerOffers(features, 'image')
  const video = computerOffers(features, 'video')
  return { offered: computerOffers(features), image, video, gallery: features.includes(FEATURE_CREATE_GALLERY), features, name }
}

/** The source in force: "My computer" only while it is offered. */
export function useEffectiveSource(): CreateSource {
  const chosen = useCreateSource((s) => s.source)
  const avail = useComputerAvailability()
  return chosen === 'computer' && avail.offered ? 'computer' : 'cloud'
}

let wired = false

/**
 * Start the follower of computer jobs once: it gets the channel, and every
 * time the computer is connected again the open jobs are asked for.
 */
export function installComputerSource(): void {
  if (wired || !remoteCreateOffered()) return
  wired = true
  // A17: image_generate and video_generate of Agent mode in the remote chat run as jobs here.
  installAgentCreate(computerChannel)
  installComputerRun({
    channel: computerChannel,
    notify: (text, tone) => toast(text, { tone, testid: tone === 'error' ? 'create-computer-failed' : 'create-computer-landed' }),
    // A17: "Render ready" as a notification while LU is not on the screen.
    landed: ({ ids, prompt }) => {
      if (ids[0] && lifecycleState() !== 'foreground') void sayNotice({ kind: 'render', about: prompt.slice(0, 60) || 'Create', text: RS.notices.renderText, target: { kind: 'item', id: ids[0] } })
    },
  })
  // While a job runs, LU stays alive in the background to bring the result.
  useComputerRun.subscribe((s) => setWaiting('render', s.view === 'sending' || s.view === 'running' || s.view === 'loading', 'Your computer is working on a render.'))
  let last = remote().status
  remoteSession().useStore.subscribe((st) => {
    if (st.status === last) return
    last = st.status
    // Connected again (a restart of the app, the computer back from sleep): ask for the open jobs.
    if (st.status === 'connected') resumeComputerJobs()
  })
  resumeComputerJobs()
}

export type CapsState = { state: 'loading' } | { state: 'ok'; caps: ComputerCapabilities } | { state: 'error'; code: string; message: string }

/** The capabilities of the computer, shared by the page and its settings sheet. */
export const useComputerCapsStore = create<{ caps: CapsState }>()(() => ({ caps: { state: 'loading' } }))

let capsSeq = 0

/** Ask the computer what it can make. A later answer replaces an earlier one, never the other way round. */
export async function refreshComputerCaps(): Promise<void> {
  const ch = computerChannel()
  if (!ch) return
  const seq = ++capsSeq
  const before = useComputerCapsStore.getState().caps
  if (before.state !== 'ok') useComputerCapsStore.setState({ caps: { state: 'loading' } })
  try {
    const caps = await getCapabilities(ch)
    if (seq === capsSeq) useComputerCapsStore.setState({ caps: { state: 'ok', caps } })
  } catch (err) {
    if (seq !== capsSeq) return
    const e = err as { code?: string; message?: string }
    useComputerCapsStore.setState({ caps: { state: 'error', code: e.code ?? 'unreachable', message: e.message ?? String(err) } })
  }
}

/** Hook: the capabilities, asked when "My computer" is shown and whenever the computer is connected again. */
export function useComputerCaps(active: boolean): { caps: CapsState; reload: () => void } {
  const caps = useComputerCapsStore((s) => s.caps)
  const status = useRemote((s) => s.status)
  useEffect(() => {
    if (active && status === 'connected') void refreshComputerCaps()
  }, [active, status])
  return { caps, reload: () => void refreshComputerCaps() }
}

/** Test seam. */
export function __resetComputerSourceForTests(): void {
  wired = false
  capsSeq = 0
  __resetCapabilitiesForTests()
  useCreateSource.setState({ source: 'cloud', tool: 'image' })
  useComputerCapsStore.setState({ caps: { state: 'loading' } })
}
