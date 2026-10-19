/**
 * Reading one workflow file for the Workflows view: API format as it is, the
 * regular ComfyUI save format converted through the node definitions of the
 * running ComfyUI (comfy-ui-format.ts).
 */
import { comfyuiUrl, localFetch } from './backend'
import { validateWorkflowJson } from './workflows'
import {
  convertUiGraph, isComfyUiGraph, uiGraphNodeTypes, uiGraphProblem,
  type ComfyNodeDef, type ComfyNodeDefs,
} from './comfy-ui-format'
import type { ComfyApiGraph } from '../types/comfy-graph'

export type WorkflowReadResult =
  | { ok: true; graph: ComfyApiGraph; format: 'api' | 'ui'; notes: string[] }
  | { ok: false; reason: string; missingNodeTypes?: string[] }

/** `null` means ComfyUI did not answer, so nothing may be concluded. */
export type NodeDefsLoader = (types: string[]) => Promise<ComfyNodeDefs | null>

export const COMFY_NOT_RUNNING =
  'ComfyUI has to be running to import a workflow saved in the regular format, '
  + 'because the node settings are read from it. Start ComfyUI and try again, '
  + 'or export the workflow with Save (API Format).'

const DEF_TIMEOUT_MS = 15_000
const PARALLEL = 6

/**
 * The definitions of the given node types, one `/object_info/<Type>` call each.
 * A type ComfyUI does not know is simply absent (ComfyUI answers `{}`). Any
 * failed call returns `null`: a half answer must not turn into "node missing".
 */
export async function loadNodeDefs(types: string[]): Promise<ComfyNodeDefs | null> {
  const defs: ComfyNodeDefs = {}
  try {
    for (let i = 0; i < types.length; i += PARALLEL) {
      const chunk = types.slice(i, i + PARALLEL)
      const answers = await Promise.all(chunk.map(async (type) => {
        const res = await localFetch(comfyuiUrl(`/object_info/${encodeURIComponent(type)}`), { timeoutMs: DEF_TIMEOUT_MS })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return [type, await res.json()] as const
      }))
      for (const [type, data] of answers) {
        const def: unknown = data && typeof data === 'object' ? (data as Record<string, unknown>)[type] : undefined
        if (def && typeof def === 'object' && !Array.isArray(def)) defs[type] = def as ComfyNodeDef
      }
    }
  } catch {
    return null
  }
  return defs
}

export async function readWorkflowText(
  rawText: string,
  loadDefs: NodeDefsLoader = loadNodeDefs,
): Promise<WorkflowReadResult> {
  let json: unknown
  try {
    json = JSON.parse(rawText)
  } catch {
    return { ok: false, reason: 'That file does not contain valid JSON.' }
  }

  if (validateWorkflowJson(json)) return { ok: true, graph: json, format: 'api', notes: [] }

  if (!isComfyUiGraph(json)) {
    return { ok: false, reason: 'This is not a ComfyUI workflow. Save it from ComfyUI with Save, Export or Save (API Format).' }
  }

  const problem = uiGraphProblem(json)
  if (problem) return { ok: false, reason: problem }

  const types = uiGraphNodeTypes(json)
  if (types.length === 0) return { ok: false, reason: 'This workflow contains no nodes that run.' }

  const defs = await loadDefs(types)
  if (!defs) return { ok: false, reason: COMFY_NOT_RUNNING }

  const converted = convertUiGraph(json, defs)
  if (!converted.ok) return converted
  return { ok: true, graph: converted.graph, format: 'ui', notes: converted.notes }
}
