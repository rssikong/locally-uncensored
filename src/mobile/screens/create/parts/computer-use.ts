/**
 * What the page and the settings sheet of "My computer" agree on (A17): the
 * tool row, the tool in force, its kind and the photos it takes. One hook,
 * so the sheet never shows the settings of another kind than the page runs.
 */
import { kindInfo, type ComputerCapabilities, type ComputerKind, type ComputerKindInfo } from '../../../remote/desktopCreate'
import { useComputerForm, type StartImage } from './computer-form'
import { useComputerAvailability, useComputerCapsStore, useCreateSource, type CapsState } from './computer-source'
import { computerToolInForce, computerTools, kindOfTool, toolInputs, type ComputerTool, type ComputerToolState, type ToolInputs } from './computer-tools'

export interface ComputerToolView {
  caps: CapsState
  capsOk: ComputerCapabilities | null
  row: ComputerToolState[]
  tool: ComputerTool
  /** The tool can run now; else `reason` says why. */
  available: boolean
  reason: string
  limits: ToolInputs
  /** The photos this run takes (the first `limits.max` of the form). */
  used: StartImage[]
  kind: ComputerKind
  info: ComputerKindInfo | null
}

export function useComputerTool(): ComputerToolView {
  const avail = useComputerAvailability()
  const caps = useComputerCapsStore((s) => s.caps)
  const chosen = useCreateSource((s) => s.tool)
  const inputs = useComputerForm((s) => s.inputs)
  const capsOk = caps.state === 'ok' ? caps.caps : null
  const row = computerTools(avail.features, capsOk)
  const tool = computerToolInForce(chosen, row) ?? 'image'
  const state = row.find((t) => t.id === tool)
  const limits = toolInputs(tool, capsOk)
  const used = inputs.slice(0, limits.max)
  const kind = kindOfTool(tool, used.length > 0, capsOk)
  return {
    caps,
    capsOk,
    row,
    tool,
    available: state?.available ?? false,
    reason: state?.reason ?? '',
    limits,
    used,
    kind,
    info: kindInfo(capsOk, kind),
  }
}
