// The names of the two settings tools (A11), apart from their executors so
// the catalog filters (sub-agent, voice, workflow, agent chat) can know them
// without importing the stores behind api/mcp/settings-tools.ts.
export const GET_SETTINGS = 'get_settings'
export const SET_SETTING = 'set_setting'
export const SETTINGS_TOOL_NAMES = [GET_SETTINGS, SET_SETTING] as const

export function isSettingsToolName(name: string): boolean {
  return name === GET_SETTINGS || name === SET_SETTING
}

/** The one line the system prompt gets on a turn that carries the pair. */
export const SETTINGS_PROMPT_LINE = 'LU app settings: read them with get_settings, change one with set_setting. '
  + 'The user confirms every change on a card; locked settings only the user changes.'
