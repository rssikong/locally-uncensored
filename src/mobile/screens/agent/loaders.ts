/**
 * Files of the extra pages and sheets of the strand "agent".
 *
 * One line per entry in ./routes.ts and ./sheets.ts, with the same key:
 *
 *   export const AGENT_ROUTE_LOADERS: Record<keyof typeof AGENT_ROUTES, ScreenLoader> = {
 *     '/agent/example/:id': () => import('./ExamplePage'),
 *   }
 *
 * The compiler asks for a loader for every key and refuses one too many.
 * Names and files live in two files so a page can import `nav` without
 * landing in a circle (nav/loaders.ts explains it).
 */
import type { ScreenLoader } from '../../nav/define'
import type { AGENT_ROUTES } from './routes'
import type { AGENT_SHEETS } from './sheets'

export const AGENT_ROUTE_LOADERS: Record<keyof typeof AGENT_ROUTES, ScreenLoader> = {
  '/settings/workflows/:id/step/:stepId': () => import('./WorkflowStepPage'),
}

export const AGENT_SHEET_LOADERS: Record<keyof typeof AGENT_SHEETS, ScreenLoader> = {
  'agent-group-persona': () => import('./GroupPersonaSheet'),
  'agent-memory-conflict': () => import('./MemoryConflictSheet'),
  'agent-memory-export': () => import('./MemoryExportSheet'),
  'agent-add-step': () => import('./AddStepSheet'),
}
