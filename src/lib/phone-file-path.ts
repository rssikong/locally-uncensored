/**
 * How a tool result names a file on a phone.
 *
 * The file tools answer with the absolute path, which on a desktop is what a
 * user wants to see: it is where the file can be opened. On a phone it is the
 * private folder of the app ("/data/user/0/<package>/.../agent-workspace/
 * new-chat-15c857/notes.md"), a place nobody can open, and the model repeats
 * it word for word in its answer (acceptance on Android with 8 GB, B11).
 *
 * There the result names the file as the model named it: relative to the
 * folder of the chat. The files themselves are under "Files in this chat".
 *
 * Phone only. On a desktop every function here returns what it was given.
 */
import { isMobile } from './device-kind'

/** The folder every chat keeps its files in (commands/filesystem.rs). */
const WORKSPACE_DIR = 'agent-workspace'

/** Pure: the part of a path behind the folder of the chat, or the file name when the path is somewhere else. */
export function insideChatFolder(path: string): string {
  const clean = (path ?? '').replace(/\\/g, '/')
  const parts = clean.split('/').filter(Boolean)
  const at = parts.lastIndexOf(WORKSPACE_DIR)
  // agent-workspace/<chat>/<the rest>
  if (at >= 0 && parts.length > at + 2) return parts.slice(at + 2).join('/')
  if (at >= 0 && parts.length === at + 2) return '.'
  if (clean.startsWith('/') || /^[a-zA-Z]:\//.test(clean)) return parts.at(-1) ?? clean
  return clean
}

/** The path as a tool result shows it: unchanged on a desktop, inside the folder of the chat on a phone. */
export function shownToolPath(path: string): string {
  return isMobile() ? insideChatFolder(path) : path
}

/** What file_write answers for a saved file. */
export function fileSavedText(path: string): string {
  return isMobile() ? `File saved: ${insideChatFolder(path)}. The user finds it under "Files in this chat".` : `File saved: ${path}`
}
