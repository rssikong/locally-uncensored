/**
 * The name of a chat from the first thing the person typed, without the
 * marks of Markdown (short check 7 on Android, F1: a chat was called
 * "# Title | a | b | |---|---| | 1 | 2 ...").
 *
 * Pure. The phone uses it (stores/chatStore.ts); the desktop keeps the raw
 * start of the message as before.
 */
const TITLE_MAX = 50

export function plainChatTitle(text: string, max: number = TITLE_MAX): string {
  const kept: string[] = []
  let fenced = false
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (/^(```|~~~)/.test(line)) {
      // The fence line carries the language word only; the code itself is still a fair name for the chat.
      fenced = !fenced
      continue
    }
    // A rule, a table's header separator: no words in them.
    if (/^(?:[-*_]\s*){3,}$/.test(line) || /^\|?(?:\s*:?-{2,}:?\s*\|?)+$/.test(line)) continue
    line = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>+\s*/, '')
      .replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`+/g, '')
      .replace(/(\*\*|__|~~)/g, '')
      .replace(/(^|[\s(])[*_]+(?=\S)/g, '$1')
      .replace(/(?<=\S)[*_]+(?=$|[\s).,!?;:])/g, '')
      .replace(/\s*\|\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (line) kept.push(line)
    if (fenced && kept.length >= 3) break
  }
  const title = kept.join(' ').replace(/\s+/g, ' ').trim().slice(0, max).trim()
  // Nothing but marks (a message of "***"): the raw start is better than an empty name.
  return title || text.slice(0, max)
}
