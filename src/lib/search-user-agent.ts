// D16 (3.0.7): the User-Agent of the web search, set under Settings, Search
// Provider. The rules are the ones `custom_user_agent` in
// src-tauri/src/commands/search.rs applies before a request goes out; this
// side only says what that one will do with the value, so the field can tell
// the user before a search quietly uses the default.

/** The longest value taken, as `MAX_USER_AGENT_LEN` on the Rust side. */
export const MAX_USER_AGENT_LEN = 512

/** What the backend is handed: the value without surrounding spaces, or ''
 *  for "use the default". */
export function searchUserAgentArg(raw: string | undefined): string {
  return (raw ?? '').trim()
}

/** One sentence when the value cannot be used and the default is sent in
 *  its place, `null` when it is fine or empty. */
export function userAgentProblem(raw: string | undefined): string | null {
  const text = searchUserAgentArg(raw)
  if (!text) return null
  if (text.length > MAX_USER_AGENT_LEN) {
    return `Longer than ${MAX_USER_AGENT_LEN} characters, so the default is sent instead.`
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x20 || code > 0x7e) {
      return 'Only plain letters, digits, spaces and punctuation work here, so the default is sent instead.'
    }
  }
  return null
}
