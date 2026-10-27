/**
 * A picture attached in the chat as the input of image_generate / video_generate
 * (A12, Discord "Can't generate images", 20.10.2026).
 *
 * The model never held the bytes of an attached picture, and nothing handed
 * them to the tool. So it guessed a filename ("image.png"), the tool looked for
 * it in ComfyUI's output folder and answered `could not read input image
 * "image.png" (HTTP 404)`, whatever the user told it.
 *
 * Now every image attached in a chat has a number, counted from the first
 * message on: "attachment 1", "attachment 2". The user message tells the model
 * which numbers it carries (imageAttachmentNote), the tool takes that number
 * as `inputImage`, and the executor uploads the picture to ComfyUI's input
 * folder before the workflow is built (builtin-tools, stageChatAttachment).
 * The filename of an attachment works too, since that is what users name.
 */

export interface ChatImageEntry {
  /** 1-based, counted over the image attachments of the whole chat. */
  number: number
  name: string
  mimeType: string
  /** Inline base64 or an lu-attachment:v1 reference (lib/chat-attachments). */
  data: string
}

interface MessageWithImages {
  role: string
  images?: { name?: string; mimeType?: string; data?: string }[]
}

/** The images the user attached in this chat, in the order they were sent. */
export function chatImageAttachments(messages: readonly MessageWithImages[]): ChatImageEntry[] {
  const out: ChatImageEntry[] = []
  for (const m of messages) {
    if (m.role !== 'user') continue
    for (const img of m.images ?? []) {
      if (!img?.data) continue
      out.push({ number: out.length + 1, name: img.name || 'image', mimeType: img.mimeType || 'image/png', data: img.data })
    }
  }
  return out
}

export const attachmentLabel = (n: number) => `attachment ${n}`

/**
 * The line the model reads on a user message with pictures, so it passes the
 * number and does not guess a filename. `firstNumber` is the number of the
 * first picture of this message in the chat.
 */
export function imageAttachmentNote(images: readonly { name: string }[], firstNumber: number): string {
  if (!images.length) return ''
  const listed = images.map((img, i) => `${attachmentLabel(firstNumber + i)} ("${img.name}")`).join(', ')
  const first = attachmentLabel(firstNumber)
  return `[Attached ${images.length === 1 ? 'image' : 'images'}: ${listed}. `
    + `To change or animate ${images.length === 1 ? 'it' : 'one'}, call image_generate or video_generate with inputImage "${first}"`
    + `${images.length === 1 ? '' : ' (or the number of another one)'}. Do not pass a filename for it.]`
}

/** "attachment 1", "Attachment #2", "attachment:1", "att 1", "Anhang 1" → the number. */
export function parseAttachmentNumber(ref: string): number | null {
  const m = ref.trim().match(/^(?:attachment|attached image|att|anhang)\s*[#:_-]?\s*(\d{1,3})$/i)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 ? n : null
}

function listing(entries: readonly ChatImageEntry[]): string {
  return entries.map((e) => `${attachmentLabel(e.number)} ("${e.name}")`).join(', ')
}

export type AttachmentPick =
  /** The reference names this attachment. */
  | { entry: ChatImageEntry }
  /** It asks for an attachment that is not there. Goes to model and user as is. */
  | { error: string }
  /** Not an attachment reference: a generated image or a ComfyUI file. */
  | null

/**
 * Which attachment does `inputImage` mean? By number first; then by its
 * filename, the newest one of that name, because the user names the picture
 * as their system showed it to them.
 */
export function pickAttachment(ref: string, entries: readonly ChatImageEntry[]): AttachmentPick {
  const n = parseAttachmentNumber(ref)
  if (n != null) {
    if (!entries.length) {
      return { error: `No image is attached in this chat, so there is no ${attachmentLabel(n)}. Ask the user to attach the picture to their message, then call the tool again with inputImage "attachment 1".` }
    }
    const entry = entries[n - 1]
    if (!entry) {
      return { error: `There is no ${attachmentLabel(n)}. This chat has ${entries.length === 1 ? 'one attached image' : `${entries.length} attached images`}: ${listing(entries)}.` }
    }
    return { entry }
  }
  const base = ref.trim().replace(/^.*[\\/]/, '').toLowerCase()
  if (!base) return null
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].name.toLowerCase() === base) return { entry: entries[i] }
  }
  return null
}

/** The upload name in ComfyUI's input folder: marked as ours, extension kept.
 *  The upload overwrites a file of the same name, so `tag` (the attachment's
 *  content id) keeps two chats' "image.png" apart. */
export function stagedAttachmentName(entry: ChatImageEntry, tag: string): string {
  const clean = entry.name.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '') || 'image.png'
  return `lu-chat-${tag.replace(/\W+/g, '').slice(0, 12)}-${clean}`
}

/** The line over the composer when the model cannot see the attached picture. */
export const BLIND_MODEL_NOTICE =
  "This model can't read images. Switch to a vision model (Gemma 4, LLaVA, Qwen-VL) to use the attachment."

/** The same, where the model can still hand the picture to the image tools:
 *  the old line made a customer give up on an edit that works (box run A12). */
export const BLIND_MODEL_TOOL_NOTICE =
  "This model can't see the picture, but it can hand it to image or video generation to change or animate it. To ask about what is in it, switch to a vision model (Gemma 4, LLaVA, Qwen-VL)."

export function blindModelNotice(handsToImageTool: boolean): string {
  return handsToImageTool ? BLIND_MODEL_TOOL_NOTICE : BLIND_MODEL_NOTICE
}
