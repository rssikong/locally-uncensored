/**
 * The sheet table: every bottom sheet from DESIGN.md.
 *
 * A sheet is opened with nav.openSheet(id, props) and nothing else. That way
 * every sheet is part of the back stack and the system back gesture closes it.
 * Like the routes, each sheet has one placeholder file, named in
 * nav/loaders.ts and not here (see nav/routes.ts for the reason), and a
 * strand adds sheets of its own in screens/<strand>/sheets.ts.
 */
import { defineSheets, type SheetDef } from './define'
import { CHAT_SHEETS } from '../screens/chat/sheets'
import { AGENT_SHEETS } from '../screens/agent/sheets'
import { CREATE_SHEETS } from '../screens/create/sheets'
import { ONBOARDING_SHEETS } from '../screens/onboarding/sheets'
import { MODELS_SHEETS } from '../screens/models/sheets'
import { SETTINGS_SHEETS } from '../screens/settings/sheets'
import { REMOTE_SHEETS } from '../screens/remote/sheets'

const CORE_SHEETS = defineSheets({
  // ---- Chat (strand 1) ----
  model: { code: 'C3', title: 'Model', owner: 'chat' },
  attach: { code: 'C4', title: 'Add to message', owner: 'chat' },
  message: { code: 'C6', title: 'Message', owner: 'chat' },
  'chat-menu': { code: 'C7', title: 'Chat', owner: 'chat' },
  // ---- Agent (strand 2) ----
  'chat-options': { code: 'C5', title: 'Chat options', owner: 'agent' },
  approval: { code: 'C12', title: 'Allow this step?', owner: 'agent', locked: true },
  // ---- Create (strand 3) ----
  tools: { code: 'K2', title: 'Tools', owner: 'create' },
  'create-model': { code: 'K3', title: 'Model', owner: 'create' },
  'run-settings': { code: 'K4', title: 'Run settings', owner: 'create' },
  source: { code: 'K5', title: 'Add source', owner: 'create' },
  result: { code: 'K8', title: 'Result', owner: 'create' },
  // ---- Global (strand 5), section 4.7 ----
  credits: { code: 'G5', title: "You're out of credits", owner: 'settings' },
  session: { code: 'G6', title: 'Please sign in again', owner: 'settings' },
  price: { code: 'G13', title: 'Price of this answer', owner: 'settings' },
  'link-offer': { code: 'G14', title: 'Continue?', owner: 'settings' },
  // ---- store building blocks (scaffold, src/mobile/policy) ----
  report: { code: 'P1', title: 'Report this content', owner: 'shell' },
  'ai-consent': { code: 'P2', title: 'LU Cloud processes your content', owner: 'shell' },
  // ---- internal ----
  'dev-demo': { code: 'DEV', title: 'Demo sheet', owner: 'shell' },
})

export const SHEETS = {
  ...CORE_SHEETS,
  ...CHAT_SHEETS,
  ...AGENT_SHEETS,
  ...CREATE_SHEETS,
  ...ONBOARDING_SHEETS,
  ...MODELS_SHEETS,
  ...SETTINGS_SHEETS,
  ...REMOTE_SHEETS,
} satisfies Record<string, SheetDef>

export type SheetId = keyof typeof SHEETS

export const SHEET_IDS = Object.keys(SHEETS) as SheetId[]

export function sheetDef(id: string): SheetDef | undefined {
  return (SHEETS as Record<string, SheetDef>)[id]
}
