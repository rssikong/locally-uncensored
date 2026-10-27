/**
 * The fenced code blocks of an answer, counted in ONE place.
 *
 * The chat draws a "Preview" button on a web page block and opens
 * /chat/:id/preview/:blockId with the block id "<messageId>~<index>". The
 * preview page then has to find the same block again. Both sides count with
 * the functions of this file, so they cannot mean different blocks.
 *
 * Pure, no React: usable from a screen, a slot and a test alike.
 */

export interface FencedBlock {
  /** The first word after the opening fence, as written ("html", "TS"), or "". */
  language: string
  code: string
  /** The line of the opening fence, 1 based, as a Markdown parser reports it. */
  line: number
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/

/** Every fenced block of a text, in order. A block that is never closed runs to the end (an answer that is still streaming). */
export function fencedBlocks(text: string): FencedBlock[] {
  const lines = text.split('\n')
  const blocks: FencedBlock[] = []
  let open: string | null = null
  let language = ''
  let line = 0
  let body: string[] = []
  lines.forEach((raw, i) => {
    const match = FENCE.exec(raw)
    if (open === null) {
      if (!match) return
      open = match[1][0]
      language = match[2].trim().split(/\s+/)[0] ?? ''
      line = i + 1
      body = []
      return
    }
    if (match && match[1][0] === open && raw.trim().length === match[1].length) {
      blocks.push({ language, code: body.join('\n'), line })
      open = null
      return
    }
    body.push(raw)
  })
  if (open !== null) blocks.push({ language, code: body.join('\n'), line })
  return blocks
}

/**
 * The position of the fenced block that starts at `line` (1 based) among all
 * fenced blocks of `text`, counted from 0. A line that is not an opening
 * fence gives the next block after it, and the last block when there is none.
 */
export function fencedBlockIndex(text: string, line: number): number {
  const blocks = fencedBlocks(text)
  const at = blocks.findIndex((block) => block.line >= line)
  return at >= 0 ? at : Math.max(0, blocks.length - 1)
}

/** The id of a code block: the message and the position of the block in its text. */
export function previewBlockId(messageId: string, index: number): string {
  return `${messageId}~${index}`
}

export function parsePreviewBlockId(blockId: string): { messageId: string; index: number } | null {
  const at = blockId.lastIndexOf('~')
  if (at <= 0) return null
  const index = Number(blockId.slice(at + 1))
  if (!Number.isInteger(index) || index < 0) return null
  return { messageId: blockId.slice(0, at), index }
}

/** Only a web page can be shown: html, an svg drawing, or a block without a language that starts like a document. */
export function isPreviewableBlock(language: string | undefined, code: string): boolean {
  const lang = (language ?? '').toLowerCase()
  if (lang === 'html' || lang === 'htm' || lang === 'xhtml' || lang === 'svg') return true
  if (lang) return false
  return /^\s*(<!doctype html|<html[\s>]|<svg[\s>])/i.test(code)
}

/** The block an address means, or null when the text has no such block, it is empty or it is not a web page. */
export function findPreviewBlock(text: string | undefined, index: number): FencedBlock | null {
  if (!text) return null
  const block = fencedBlocks(text)[index]
  if (!block || !block.code.trim() || !isPreviewableBlock(block.language, block.code)) return null
  return block
}

/** Inline images are shown only when they carry their own bytes. A remote address stays a link: nothing loads unasked. */
export function isInlineImageSrc(src: string | undefined): boolean {
  return !!src && (src.startsWith('data:image/') || src.startsWith('blob:'))
}

/** A name for a code block: its language in small letters, or `fallback` when it has none. */
export function languageLabel(language: string | undefined, fallback: string): string {
  const lang = (language ?? '').trim()
  return lang ? lang.toLowerCase() : fallback
}

/** What of a message the text of its answer is made of. */
export interface AnswerSource {
  content?: string | null
  /** The blocks of an agent run; the ones with phase "answer" hold text of the answer. */
  agentBlocks?: ReadonlyArray<{ phase: string; content?: string | null }> | null
}

/**
 * The text of an answer, the same for the one who draws it and the one who
 * looks a block up in it. A plain answer is its content. An agent run often
 * leaves the content empty and keeps the text in its answer blocks: then it
 * is those, in order, with an empty line between them.
 */
export function answerText(message: AnswerSource | null | undefined): string {
  if (!message) return ''
  const own = message.content ?? ''
  if (own.trim()) return own
  return (message.agentBlocks ?? [])
    .filter((block) => block.phase === 'answer')
    .map((block) => (block.content ?? '').trim())
    .filter(Boolean)
    .join('\n\n')
}
