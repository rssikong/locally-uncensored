/**
 * Universal thinking-tag stripper — runs during streaming so raw tags never
 * reach the user bubble, regardless of what the model emits.
 *
 * Different model families encode their "internal reasoning" differently:
 *   - Qwen3 / DeepSeek-R1 / QwQ / Hermes3 / Llama / Mistral / GLM / Nemotron
 *     → `<think>…</think>` (inline)
 *   - Gemma 3 / Gemma 4
 *     → `<|?channel|?>\s*thought\s*…` channel tags (inline, often without
 *       a closing tag — Ollama sometimes truncates mid-stream)
 *   - Some abliterated variants or older model cards
 *     → `<thought>…</thought>` / `<reasoning>…</reasoning>` / `<reflect>…</reflect>`
 *
 * The user-visible contract: once the Thinking toggle is OFF, **no** reasoning
 * markup may appear in the assistant bubble. The state-machine in useChat.ts
 * handles the canonical `<think>` case char-by-char; this module handles the
 * non-canonical formats that don't fit that pattern (channel tags, alt names,
 * orphan open-tags without matching close).
 */

// ── Patterns ──────────────────────────────────────────────────────────
//
// Every pattern must use the `g` (global) flag: they run across the full
// content on every emitted chunk.

const BLOCK_PATTERNS: RegExp[] = [
  // Alt thinking-tag names that a small fraction of model cards emit.
  /<thought>[\s\S]*?<\/thought>/gi,
  /<reasoning>[\s\S]*?<\/reasoning>/gi,
  /<reflect>[\s\S]*?<\/reflect>/gi,
  /<deepthink>[\s\S]*?<\/deepthink>/gi,
]

// A Gemma thought: the channel marker, the word `thought`, the reasoning, and
// the next channel marker of any shape as its closer. Gemma 4 writes
// `<|channel>thought … <channel|>`, older builds `<|channel|>thought …
// </channel>`. A thought whose closer has not arrived yet (mid-stream, or a
// turn cut off) runs to the end of the text, so the half block is never shown
// and never read aloud as if it were the answer.
const CHANNEL_THOUGHT = /<\|?channel\|?>?\s*thought\b([\s\S]*?)(?:<\/?\|?channel\|?>|$)/gi
// A channel marker on its own, with no thought behind it.
const CHANNEL_MARKER = /<\/?\|?channel\|?>/gi

/**
 * Split the Gemma channel thoughts off `content`.
 *
 * Returns the answer without them and the reasoning that was inside, so the
 * caller can route it into the thinking panel.
 */
export function splitChannelThought(content: string): { content: string; thinking: string } {
  if (!content) return { content, thinking: '' }
  const thoughts: string[] = []
  const out = content
    .replace(CHANNEL_THOUGHT, (_m, inner: string) => {
      if (inner.trim()) thoughts.push(inner.trim())
      return ''
    })
    .replace(CHANNEL_MARKER, '')
  return { content: out, thinking: thoughts.join('\n\n') }
}

/**
 * Strip non-canonical thinking tags (channel thoughts, alt names) but leave
 * the canonical `<think>…</think>` alone: the useChat.ts state-machine handles
 * those char-by-char and needs to see the raw `<think>` marker to detect the
 * transition.
 *
 * Safe to call on an in-progress stream buffer. Named blocks are only removed
 * when both ends are present; a channel thought is removed from its opener on,
 * closed or not.
 */
export function stripNonCanonicalTags(content: string): string {
  if (!content) return content
  let out = content
  for (const pat of BLOCK_PATTERNS) {
    out = out.replace(pat, '')
  }
  return splitChannelThought(out).content
}

/**
 * Split off a `<think>` that never got its closer.
 *
 * A turn can end mid-thought: the user pressed Stop, the stream died, or the
 * model walked into the context wall. The balanced `<think>…</think>` regex in
 * the agent loops cannot see that, and `finalStripThinkingTags` deliberately
 * leaves canonical markers alone while the Thinking toggle is ON — so the raw
 * opener plus the entire reasoning text landed in the answer bubble, but only
 * with thinking ON. Found on the installed 2.6.2 build, Coding + Ollama +
 * hermes, after stopping a run mid-turn.
 *
 * Returns the answer without the dangling block, and the reasoning that was in
 * it, so the caller can route it into the thinking panel instead of dropping
 * text the model actually produced.
 */
export function splitUnclosedThink(content: string): { content: string; thinking: string } {
  if (!content) return { content, thinking: '' }
  const open = content.lastIndexOf('<think>')
  if (open === -1) return { content, thinking: '' }
  // A closer after the last opener means the block is balanced, not orphaned.
  if (content.indexOf('</think>', open) !== -1) return { content, thinking: '' }
  return {
    content: content.slice(0, open),
    thinking: content.slice(open + '<think>'.length),
  }
}

/**
 * Split off reasoning that arrived with a closer but no opener.
 *
 * The mirror image of `splitUnclosedThink`, and the commoner of the two. Ollama
 * chat templates for the Qwen3 family put the opening `<think>` in the PROMPT,
 * so the model never emits one: what comes back over the wire is the reasoning
 * text, then `</think>`, then the answer. The char-by-char state machine keys
 * on seeing `<think>`, so it never switches, and everything runs through as
 * ordinary content. With the Thinking toggle ON, `finalStripThinkingTags`
 * deliberately leaves canonical markers alone, and the raw `</think>` lands in
 * the answer bubble with the whole thought in front of it.
 *
 * Measured on the installed 2.6.2 build 2026-08-06, Coding + Ollama + hermes,
 * hf.co/DevQuasar/huihui-ai.Qwen3-4B-abliterated-GGUF. Read off the page:
 * "…without stopping. Let's start with the first step. </think>". The owner has
 * been reporting exactly this: a visible think between the steps that is not
 * styled as thinking.
 *
 * Returns the answer after the closer, and the reasoning that preceded it, so
 * the caller routes it to the thinking panel rather than deleting text the
 * model produced.
 */
export function splitOrphanCloser(content: string): { content: string; thinking: string } {
  if (!content) return { content, thinking: '' }
  const close = content.indexOf('</think>')
  if (close === -1) return { content, thinking: '' }
  // An opener anywhere before it means the block is balanced, not orphaned,
  // and the existing paths own it.
  if (content.lastIndexOf('<think>', close) !== -1) return { content, thinking: '' }
  return {
    content: content.slice(close + '</think>'.length),
    thinking: content.slice(0, close),
  }
}

/**
 * Apply a final safety pass on the complete assistant content after the
 * stream finishes. Catches any orphan closing `</think>` that leaked through
 * (e.g. provider restarted mid-stream, first `<think>` lost).
 */
export function finalStripThinkingTags(content: string, keepCanonicalThink = false): string {
  if (!content) return content
  let out = stripNonCanonicalTags(content)
  if (!keepCanonicalThink) {
    // Canonical `<think>` block — strip if still present (shouldn't be,
    // the state-machine handles it, but belt-and-braces).
    out = out.replace(/<think>[\s\S]*?<\/think>/gi, '')
    // Orphan closer alone.
    out = out.replace(/<\/think>/gi, '')
    // Orphan opener alone.
    out = out.replace(/<think>/gi, '')
  }
  return out.trim()
}

/**
 * `</think>` outside code, removed. Only for text whose thought is already
 * split off: there a closer closes nothing. Inside a fenced block or an inline
 * code span it is text the answer means, an example of the tag.
 */
export function dropStrayClosers(content: string): string {
  if (!content || !/<\/think>/i.test(content)) return content
  return content
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/<\/think>(?:[ \t]*\n)?/gi, '')))
    .join('')
}

/**
 * The end-of-turn settlement, in ONE place for every path.
 *
 * Four call sites used to do this by hand and only two of them did it fully.
 * The agent loop and the coding loop ran the balanced block, then
 * splitOrphanCloser, then splitUnclosedThink, then the final strip. Plain chat
 * and group chat ran the char-by-char state machine and nothing else, and that
 * machine only ever triggers on a literal `<think>`. The Qwen3 chat templates
 * put the opener in the PROMPT: the reply starts mid-thought and only ever
 * sends the closer, the machine never switches, and with the Think button ON
 * `finalStripThinkingTags` deliberately leaves canonical markers alone. So the
 * whole thought plus a raw `</think>` stood in the answer bubble and the
 * thinking block stayed empty. That is a thinking model that visibly does not
 * think, on the two paths a user reaches first.
 *
 * `content` is what the turn produced, `thinking` whatever the native channel
 * already delivered. Returns both, settled: reasoning out of the answer, and
 * into the block when the toggle says so.
 */
export function settleThinking(
  content: string,
  thinking: string,
  keepThinking: boolean,
): { content: string; thinking: string } {
  let out = content
  let think = thinking
  const add = (part: string) => {
    if (!keepThinking || !part) return
    think = think ? `${think}\n\n${part}` : part
  }

  // Balanced blocks first, the common well-formed case.
  out = out.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner: string) => {
    add(inner)
    return ''
  })
  // Closer without opener: the pre-opened Qwen3 thought.
  const closer = splitOrphanCloser(out)
  if (closer.thinking) {
    out = closer.content
    add(closer.thinking)
  }
  // Opener without closer: a turn stopped or cut off mid-thought.
  const opener = splitUnclosedThink(out)
  if (opener.thinking) {
    out = opener.content
    add(opener.thinking)
  }
  // A Gemma channel thought, closed or cut off.
  const channel = splitChannelThought(out)
  out = channel.content
  add(channel.thinking)
  // Closers left over once every block is out. Box run 14.10.2026 (Qwen3.5 9B,
  // Think on): a model in a loop wrote `</think>` twelve times, the first one
  // closed the thought and the other eleven stood in the bubble and in the
  // read-aloud text. A closer in code the answer shows on purpose stays.
  out = dropStrayClosers(out)
  // Non-canonical markers (<thought>, <reasoning>, …).
  out = finalStripThinkingTags(out, keepThinking)
  if (!keepThinking) think = ''
  return { content: out, thinking: think }
}
