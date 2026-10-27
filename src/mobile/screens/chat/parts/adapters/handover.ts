/**
 * Hand a file or a text to the system: share sheet, Photos, clipboard.
 * One place that turns the answers of the platform seam into "done", "the
 * user backed out" or "this phone cannot do it", so every screen of the
 * strand shows a toast only for what really happened.
 */
import type { Conversation } from '../../../../../types/chat'
import { exportAsJSON, exportAsMarkdown, portableConversation } from '../../../../../lib/chat-export'
import { commandIsUnavailable } from '../../../../../lib/engine-command-availability'
import { exportHeading, exportMessageText } from '../../../../../lib/reader-text'
import { saveOrShare } from '../../../../../lib/save-or-share'
import { useModelStore } from '../../../../../stores/modelStore'
import { CHAT_STRINGS } from '../../../../strings/chat'
import { chatModelLabel } from '../model-name'
import { answerBody } from './run-error'
import { copyText, isNativeUnavailable, nativeBridge, saveToDevice, shareFile, shareText } from '../../../../platform'

export type Handover = 'done' | 'cancelled' | 'failed'

/** A file name a share target accepts: letters, digits, dash and underscore, at most 50 long. */
export function exportFileName(title: string, format: 'markdown' | 'json'): string {
  const safe = title.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'chat'
  return `${safe}.${format === 'markdown' ? 'md' : 'json'}`
}

export async function shareBlob(name: string, mime: string, data: Blob | string): Promise<Handover> {
  try {
    const result = await shareFile({ name, mime, data })
    return result.completed ? 'done' : 'cancelled'
  } catch (err) {
    if (!isNativeUnavailable(err)) return 'failed'
  }
  // The platform seam has no way yet. The logic seam may have one the scaffold wired at the root.
  try {
    const bytes = typeof data === 'string' ? undefined : new Uint8Array(await data.arrayBuffer())
    const outcome = await saveOrShare({ filename: name, mime, ...(typeof data === 'string' ? { text: data } : { bytes }) })
    if (outcome.status === 'cancelled') return 'cancelled'
    return outcome.status === 'error' ? 'failed' : 'done'
  } catch {
    return 'failed'
  }
}

/** What "Save to this phone" came to. */
export type SaveOutcome = 'saved' | 'downloaded' | 'cancelled' | 'unavailable' | 'failed'

/**
 * Write a file to a folder the user picks (the save dialog of the system), the
 * way the backup does it (screens/settings/DataPage.tsx). The share sheet
 * alone left the file out of reach on a phone without a fitting target
 * (acceptance on Android, M8).
 */
export async function saveBlobToPhone(name: string, mime: string, data: Blob | string): Promise<SaveOutcome> {
  try {
    const result = await saveToDevice({ name, mime, data, target: 'files' })
    if (!result.saved) return 'cancelled'
    return result.via === 'download' ? 'downloaded' : 'saved'
  } catch (err) {
    return isNativeUnavailable(err) ? 'unavailable' : 'failed'
  }
}

export interface SaveNote {
  ok: boolean
  tone: 'info' | 'warn' | 'error'
  text: string
}

/** Pure: the sentence that stays on screen after "Save to this phone", so the user knows where the file is. */
export function saveNote(outcome: SaveOutcome, name: string): SaveNote {
  const S = CHAT_STRINGS.save
  if (outcome === 'saved') return { ok: true, tone: 'info', text: S.saved(name) }
  if (outcome === 'downloaded') return { ok: true, tone: 'info', text: S.downloaded(name) }
  if (outcome === 'cancelled') return { ok: false, tone: 'warn', text: S.cancelled }
  if (outcome === 'unavailable') return { ok: false, tone: 'warn', text: S.unavailable }
  return { ok: false, tone: 'error', text: S.failed }
}

/**
 * The text of an exported chat. The Markdown form is for a reader: its header names the model the way the chat
 * does ("Qwen 3.5 0.8B"), never by the stored id with the slot of the engine in front (acceptance android-4gb,
 * F10). The JSON form is data for a restore and keeps every id as it is stored.
 */
export async function chatExportText(conversation: Conversation, format: 'markdown' | 'json'): Promise<string> {
  if (format === 'json') return exportAsJSON(await portableConversation(conversation))
  const models = useModelStore.getState().models
  // The text of every message is what a reader sees: a file by its name, never the frame the model gets (F12).
  // What a tool gave back stands under its own heading, never under "You" (check 4 on an iPhone, N9).
  return exportAsMarkdown(conversation, { modelLabel: (id) => chatModelLabel(models, id), messageText: (message) => exportMessageText(message, answerBody), messageHeading: exportHeading })
}

/** Export one chat through the share sheet (C7.2). Images are folded back into the JSON form. */
export async function exportChat(conversation: Conversation, format: 'markdown' | 'json'): Promise<Handover> {
  let content: string
  try {
    content = await chatExportText(conversation, format)
  } catch {
    return 'failed'
  }
  return shareBlob(exportFileName(conversation.title, format), format === 'markdown' ? 'text/markdown' : 'application/json', content)
}

/** Export one chat into a folder of this phone. Answers what happened and the name of the file. */
export async function saveChat(conversation: Conversation, format: 'markdown' | 'json'): Promise<{ outcome: SaveOutcome; name: string }> {
  const name = exportFileName(conversation.title, format)
  let content: string
  try {
    content = await chatExportText(conversation, format)
  } catch {
    return { outcome: 'failed', name }
  }
  return { outcome: await saveBlobToPhone(name, format === 'markdown' ? 'text/markdown' : 'application/json', content), name }
}

/** A build without the plugin answers "no such command": then the next way is tried. */
function bridgeLacksIt(err: unknown): boolean {
  if (isNativeUnavailable(err) || commandIsUnavailable(err)) return true
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'LuNativeUnavailableError'
}

export async function shareMessageText(text: string): Promise<Handover> {
  // First the bridge of the native layer: the share sheet of the system takes the text as text,
  // not as a file named message.txt.
  try {
    const bridge = await nativeBridge()
    if (bridge && typeof bridge.shareFile === 'function') {
      const result = await bridge.shareFile({ text })
      // iOS says whether an action was completed. Android does not: a sheet that was shown counts.
      // No answer at all is a build whose plugin does not know the call: the next way is tried.
      if (result) return result.presented !== false && result.completed !== false ? 'done' : 'cancelled'
    }
  } catch (err) {
    if (!bridgeLacksIt(err)) return 'failed'
  }
  try {
    const result = await shareText(text)
    return result.completed ? 'done' : 'cancelled'
  } catch {
    return 'failed'
  }
}

export async function saveImage(name: string, mime: string, data: Blob): Promise<{ result: Handover; location?: string }> {
  try {
    const saved = await saveToDevice({ name, mime, data, target: 'photos' })
    return { result: saved.saved ? 'done' : 'cancelled', location: saved.location }
  } catch {
    return { result: 'failed' }
  }
}

export { copyText }
