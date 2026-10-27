/**
 * Extra sheets of the strand "agent".
 *
 * The sheets from DESIGN.md are already in nav/sheets.ts, which only the
 * scaffold changes. A sheet this strand needs on top of those goes HERE and
 * is merged into the sheet table automatically. Use the strand name as a
 * prefix so two strands never pick the same id:
 *
 *   'agent-example': { code: 'X1', title: 'Example', owner: 'agent' },
 *
 * Its file goes into ./loaders.ts under the same key:
 *
 *   'agent-example': () => import('./ExampleSheet'),
 *
 * Then nav.openSheet('agent-example', props) is known to the compiler.
 */
import { defineSheets } from '../../nav/define'

export const AGENT_SHEETS = defineSheets({
  'agent-group-persona': { code: 'C13', title: 'Persona', owner: 'agent' },
  'agent-memory-conflict': { code: 'E7', title: 'Which version?', owner: 'agent' },
  'agent-memory-export': { code: 'E7', title: 'Export memories', owner: 'agent' },
  'agent-add-step': { code: 'E10', title: 'Add step', owner: 'agent' },
})
