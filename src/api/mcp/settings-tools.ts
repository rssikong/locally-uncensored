// The two tools that read and change LU's own settings on request (A11):
// "stell Auto Compact auf 80". get_settings only reads. set_setting changes
// nothing until the user accepts the card in the tool call, also in Bypass.
//
// Like the Create tools they stand apart from BUILTIN_TOOLS: that list is
// mirrored to the phone and offered in every Code turn. These two ride along
// only when a message is about settings (SETTINGS_KEYWORDS in
// lib/tool-selection.ts), and only on surfaces that draw the card: the chat,
// Agent and Code. A sub-agent, a voice session, a workflow or the local API
// never get them (run.settingsCard is unset there, see below).
//
// What may be changed, and how, is lib/settings-catalog.ts.
import { v4 as uuid } from 'uuid'
import type { MCPToolDefinition, ToolArgs } from './types'
import type { ToolRegistry } from './tool-registry'
import type { AgentRunContext } from '../agent-context'
import { GET_SETTINGS, SET_SETTING, SETTINGS_TOOL_NAMES, isSettingsToolName, SETTINGS_PROMPT_LINE } from '../../lib/settings-tool-names'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSettingsConfirmStore } from '../../stores/settingsConfirmStore'
import {
  CATALOG, LOCK_RULES, describeEntry, findEntry, isHiddenKey, lockedRule, normKey, patchFor,
  readValue, sameValue, similarKeys, tabName,
} from '../../lib/settings-catalog'

export { GET_SETTINGS, SET_SETTING, SETTINGS_TOOL_NAMES, isSettingsToolName, SETTINGS_PROMPT_LINE }

export const SETTINGS_TOOLS: MCPToolDefinition[] = [
  {
    name: GET_SETTINGS,
    description: 'Read LU app settings: key, current value, allowed values, one line each. '
      + 'Pass query to filter (a key or a word like compact). Read only. Call before set_setting.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Optional filter.' } },
      required: [],
    },
    category: 'system',
    source: 'builtin',
  },
  {
    name: SET_SETTING,
    description: 'Change one LU app setting. Nothing changes until the user accepts the card. '
      + 'Locked keys are refused. Use a key and a value get_settings lists.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Setting key from get_settings.' },
        value: { type: ['string', 'number', 'boolean'], description: 'New value, e.g. 80, on, dark.' },
      },
      required: ['key', 'value'],
    },
    category: 'system',
    source: 'builtin',
  },
]

const LOCKED_LINE = 'Locked, only the user changes these in Settings: '
  + LOCK_RULES.map((r) => r.what.toLowerCase()).join(', ') + '.'

function lockedReply(key: string): string | null {
  const rule = lockedRule(key)
  if (!rule) return null
  return `Refused: ${rule.what} is locked. Nothing changed. Only the user can change it, in ${rule.where}. Tell the user so.`
}

export async function executeGetSettings(args: ToolArgs): Promise<string> {
  const settings = useSettingsStore.getState().settings
  const query = typeof args?.query === 'string' ? args.query.trim() : ''
  if (!query) {
    return ['LU settings (key = value | allowed | what):', ...CATALOG.map((c) => describeEntry(c, settings)), LOCKED_LINE].join('\n')
  }
  const exact = findEntry(query)
  if (exact) return describeEntry(exact, settings)
  const q = normKey(query)
  const words = query.toLowerCase().split(/[^a-z0-9äöüß]+/).filter((w) => w.length >= 3)
  const hits = CATALOG.filter((c) => {
    const hay = `${c.key} ${c.label} ${c.help}`.toLowerCase()
    return (q.length >= 3 && normKey(hay).includes(q)) || words.some((w) => hay.includes(w))
  })
  if (hits.length) return hits.map((c) => describeEntry(c, settings)).join('\n')
  const locked = lockedReply(query)
  if (locked) return locked
  return `No setting matches "${query}". Call get_settings without a query for the full list.`
}

/** The line set_setting puts under its answer, so the card can undo the
 *  change later, also after a restart. */
const MARK = /<!-- lu-setting (\{.*\}) -->/

export interface SettingChange { key: string; from: unknown; to: unknown }

export function parseSettingChange(result: string | null | undefined): SettingChange | null {
  const m = typeof result === 'string' ? MARK.exec(result) : null
  if (!m) return null
  try {
    const v = JSON.parse(m[1]) as Partial<SettingChange>
    return typeof v.key === 'string' && 'from' in v && 'to' in v ? { key: v.key, from: v.from, to: v.to } : null
  } catch {
    return null
  }
}

export async function executeSetSetting(args: ToolArgs, run?: AgentRunContext, signal?: AbortSignal): Promise<string> {
  const key = typeof args?.key === 'string' ? args.key.trim() : ''
  if (!key) return 'Error: key is missing. Call get_settings for the keys. Nothing changed.'
  if (!run?.settingsCard) {
    return 'Error: settings can only be changed in a chat where the user sees the confirmation card. Nothing changed.'
  }
  const entry = findEntry(key)
  if (!entry) {
    const locked = lockedReply(key)
    if (locked) return locked
    const near = isHiddenKey(key) ? [] : similarKeys(key)
    return `Error: there is no setting "${key}". ${near.length ? `Closest: ${near.join(', ')}. ` : ''}Call get_settings. Nothing changed.`
  }
  const parsed = entry.parse(args.value)
  if (!parsed.ok) {
    return `Error: ${entry.label} (${entry.key}) ${parsed.error}. Allowed: ${entry.allowed}. Nothing changed.`
  }
  if (entry.safe && !entry.safe(parsed.value)) {
    return `Refused: from the chat ${entry.label} can only be set to ${entry.allowed}. ${entry.safeWhy}. Nothing changed. The user can change it in ${tabName(entry.tab)}.`
  }
  const before = readValue(useSettingsStore.getState().settings, entry.key)
  if (sameValue(before, parsed.value)) return `${entry.label} is already ${entry.show(before)}. Nothing changed.`

  const from = entry.show(before)
  const to = entry.show(parsed.value)
  const allowed = await useSettingsConfirmStore.getState().ask({
    id: uuid(),
    toolCallId: run.toolCallId,
    conversationId: run.conversationId,
    key: entry.key,
    label: entry.label,
    from,
    to,
    note: /Applies[^.]*\./.exec(entry.help)?.[0],
  }, signal ?? run.abortSignal)
  if (!allowed) return `The user declined. ${entry.label} stays ${from}. Do not ask again unless the user asks.`

  const store = useSettingsStore.getState()
  store.updateSettings(patchFor(store.settings, entry.key, parsed.value))
  const mark = JSON.stringify({ key: entry.key, from: before, to: parsed.value })
  return `Changed: ${entry.label} ${from} → ${to}. The user can undo it on the card.\n<!-- lu-setting ${mark} -->`
}

/** Undo from the card: back to the value before, through the same catalog. */
export function undoSettingChange(change: SettingChange): boolean {
  const entry = findEntry(change.key)
  if (!entry) return false
  const store = useSettingsStore.getState()
  store.updateSettings(patchFor(store.settings, entry.key, change.from))
  return true
}

/** Where the value stands now against the change on the card. */
export function settingChangeState(change: SettingChange): 'applied' | 'undone' | 'moved' {
  const now = readValue(useSettingsStore.getState().settings, change.key)
  if (sameValue(now, change.to)) return 'applied'
  if (sameValue(now, change.from)) return 'undone'
  return 'moved'
}

export function registerSettingsTools(registry: ToolRegistry): void {
  registry.registerBuiltin(SETTINGS_TOOLS[0], (a) => executeGetSettings(a))
  registry.registerBuiltin(SETTINGS_TOOLS[1], (a, run, signal) => executeSetSetting(a, run, signal))
}
