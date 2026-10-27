/**
 * Which code block a preview address means (C11).
 *
 * The chat page builds the address /chat/:id/preview/:blockId with the block
 * id "<messageId>~<index>": the message and the position of the fenced block
 * in its text, counted from 0. The counting here follows the same rule as the
 * Markdown view of the chat strand, so both mean the same block. Until the
 * strands are merged this is a copy of that rule (wish in agent.md).
 */

export interface FencedBlock {
  language: string
  code: string
}

export function parsePreviewBlockId(blockId: string): { messageId: string; index: number } | null {
  const at = blockId.lastIndexOf('~')
  if (at <= 0) return null
  const index = Number(blockId.slice(at + 1))
  if (!Number.isInteger(index) || index < 0) return null
  return { messageId: blockId.slice(0, at), index }
}

/** Pure: every fenced block of a text, in order. A block that is never closed runs to the end. */
export function fencedBlocks(text: string): FencedBlock[] {
  const lines = text.split('\n')
  const blocks: FencedBlock[] = []
  let open: string | null = null
  let language = ''
  let body: string[] = []
  for (const line of lines) {
    const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (open === null) {
      if (!match) continue
      open = match[1][0]
      language = match[2].trim().split(/\s+/)[0] ?? ''
      body = []
      continue
    }
    if (match && match[1][0] === open && line.trim().length === match[1].length) {
      blocks.push({ language, code: body.join('\n') })
      open = null
      continue
    }
    body.push(line)
  }
  if (open !== null) blocks.push({ language, code: body.join('\n') })
  return blocks
}

/** Only a web page can be shown: html, or an svg drawing, or a block that starts like a document. */
export function isPreviewable(block: FencedBlock): boolean {
  const lang = block.language.toLowerCase()
  if (lang === 'html' || lang === 'htm' || lang === 'xhtml' || lang === 'svg') return true
  if (lang) return false
  return /^\s*(<!doctype html|<html[\s>]|<svg[\s>])/i.test(block.code)
}

/** The block an address means, or null when the message has no such block or it is not a web page. */
export function findPreviewBlock(text: string | undefined, index: number): FencedBlock | null {
  if (!text) return null
  const block = fencedBlocks(text)[index]
  if (!block || !block.code.trim() || !isPreviewable(block)) return null
  return block
}
