/**
 * Pure helpers of the Markdown view: which fenced block a line belongs to,
 * whether a block is a web page, which image addresses are shown inline.
 */

/**
 * The position of the fenced code block that starts at `line` (1 based, as
 * the parser reports it) among all fenced blocks of `text`, counted from 0.
 * This number is the second half of the block id in
 * /chat/:id/preview/:blockId, so it must not depend on anything but the text.
 */
export function fencedBlockIndex(text: string, line: number): number {
  const lines = text.split('\n')
  let open: string | null = null
  let count = 0
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[i])
    if (!match) continue
    const fence = match[1]
    if (open === null) {
      if (i + 1 >= line) return count
      open = fence[0]
      count++
    } else if (fence[0] === open && lines[i].trim().length === fence.length) {
      open = null
    }
  }
  return Math.max(0, count - 1)
}

/** The id of a code block for C11: the message and the position of the block in its text. */
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

/** Only a web page gets "Preview" (C2.23). */
export function isHtmlBlock(language: string | undefined, code: string): boolean {
  const lang = (language ?? '').toLowerCase()
  if (lang === 'html' || lang === 'htm' || lang === 'xhtml') return true
  if (lang) return false
  return /^\s*(<!doctype html|<html[\s>])/i.test(code)
}

/** Inline images are shown only when they carry their own bytes. A remote address stays a link: nothing loads unasked. */
export function isInlineImageSrc(src: string | undefined): boolean {
  return !!src && (src.startsWith('data:image/') || src.startsWith('blob:'))
}

/** A name for a code block without a language. */
export function languageLabel(language: string | undefined, fallback: string): string {
  const lang = (language ?? '').trim()
  return lang ? lang.toLowerCase() : fallback
}
