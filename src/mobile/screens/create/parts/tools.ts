/**
 * The tools of Create on a phone. Pure: no store, no network.
 *
 * A tool is one intent of the create store. What a tool needs (a source
 * image, a prompt, a painted area) is written down here once, so the page,
 * the sheets and the tests read the same table.
 */
import type { CreateIntent } from '../../../../stores/createStore'

export type ToolId = CreateIntent

export interface ToolFacts {
  id: ToolId
  /** What the result is. */
  kind: 'image' | 'video' | 'audio'
  /** The tool starts from an image the user brings. */
  needsSource: boolean
  /** yes: a prompt is required. optional: it may stay empty. no: there is no prompt field. */
  prompt: 'yes' | 'optional' | 'no'
  /** none: no painted area. model: the picked model decides. required: always. */
  mask: 'none' | 'model' | 'required'
  /** Several source images can run one after another. */
  batch: boolean
  /** The rail of prompt styles is shown. */
  styles: boolean
  /** The tool has a model choice of its own. */
  hasModels: boolean
}

export const TOOLS: readonly ToolFacts[] = [
  { id: 'image', kind: 'image', needsSource: false, prompt: 'yes', mask: 'none', batch: false, styles: true, hasModels: true },
  { id: 'edit', kind: 'image', needsSource: true, prompt: 'yes', mask: 'model', batch: true, styles: false, hasModels: true },
  { id: 'removebg', kind: 'image', needsSource: true, prompt: 'no', mask: 'none', batch: true, styles: false, hasModels: false },
  { id: 'upscale', kind: 'image', needsSource: true, prompt: 'no', mask: 'none', batch: true, styles: false, hasModels: false },
  { id: 'eraser', kind: 'image', needsSource: true, prompt: 'no', mask: 'required', batch: false, styles: false, hasModels: false },
  { id: 'video', kind: 'video', needsSource: false, prompt: 'yes', mask: 'none', batch: false, styles: true, hasModels: true },
  { id: 'animate', kind: 'video', needsSource: true, prompt: 'yes', mask: 'none', batch: false, styles: false, hasModels: true },
  { id: 'character', kind: 'image', needsSource: false, prompt: 'yes', mask: 'none', batch: false, styles: false, hasModels: true },
  { id: 'lipsync', kind: 'video', needsSource: false, prompt: 'no', mask: 'none', batch: false, styles: false, hasModels: true },
  { id: 'music', kind: 'audio', needsSource: false, prompt: 'yes', mask: 'none', batch: false, styles: false, hasModels: true },
  { id: 'extend', kind: 'video', needsSource: false, prompt: 'yes', mask: 'none', batch: false, styles: false, hasModels: true },
  { id: 'motion', kind: 'video', needsSource: false, prompt: 'optional', mask: 'none', batch: false, styles: false, hasModels: true },
]

export const TOOL_IDS: readonly ToolId[] = TOOLS.map((t) => t.id)

/**
 * The tiles of these four tools carry data-m-risk="paid" (TESTIDS.md, duty 6;
 * acceptance Android, re-run, N9). Picking a tool books nothing, the run
 * does. Their names (animate, eraser, extend, removebg) are words the sweep
 * of the acceptance frame refuses to tap, and the mark says on the element
 * what the frame decides from the name, so the list of controls "blocked
 * without a mark" stays a list of real gaps.
 */
const MARKED_TOOL_CHOICES: readonly ToolId[] = ['animate', 'eraser', 'extend', 'removebg']

export function toolChoiceRisk(id: ToolId): 'paid' | undefined {
  return MARKED_TOOL_CHOICES.includes(id) ? 'paid' : undefined
}

export function toolFacts(id: ToolId): ToolFacts {
  return TOOLS.find((t) => t.id === id) ?? TOOLS[0]
}

/** Which tools the catalog can run right now. A missing answer counts as no. */
export type ToolProbe = Partial<Record<ToolId, boolean>>

/** The tools the catalog offers, in the fixed order of the tool row. */
export function availableTools(probe: ToolProbe): ToolId[] {
  return TOOL_IDS.filter((id) => probe[id] === true)
}

/** The tool to show when the chosen one is not offered (any more). */
export function fallbackTool(current: ToolId, available: readonly ToolId[]): ToolId | null {
  if (available.includes(current)) return current
  return available[0] ?? null
}

/** Whether this run needs a painted area. `maskless` is what the picked edit model says about itself. */
export function toolNeedsMask(id: ToolId, maskless: boolean): boolean {
  const mask = toolFacts(id).mask
  if (mask === 'required') return true
  if (mask === 'model') return !maskless
  return false
}

/** Whether the tool can take a painted area at all (Edit may, Erase must). */
export function toolAllowsMask(id: ToolId): boolean {
  return toolFacts(id).mask !== 'none'
}
