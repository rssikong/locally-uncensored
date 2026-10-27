/**
 * Display safety net: the user must only ever see real prose answers plus the
 * rendered tool-call BLOCKS, never raw orchestration.
 *
 * This lived inside CodexView until 2.5.9, which meant it protected the Code
 * tab ONLY. Agent mode and plain chat render through MessageBubble and were
 * getting the raw string — so the exact leak the owner reported twice
 * (`ool_call>` from Qwen3-32B through LU Cloud) was still on screen after the
 * "fix", because the fix was in the other view. Shared module now: one strip,
 * every surface.
 *
 * Two tiers on purpose:
 *   - The default set removes text that is NEVER a legitimate answer.
 *   - `aggressive` additionally removes tool-call JSON dumps. That is right
 *     while a tool loop is driving (Code, Agent), but wrong in plain chat,
 *     where `{"name": …, "arguments": …}` can be exactly what the user asked
 *     the model to print.
 */

import { extractToolCallsWithRanges, stripRanges } from './tool-call-repair'
import { stripNonCanonicalTags } from './thinking-stripper'

export interface StripOptions {
  /** Also strip tool-call JSON emitted as prose. On for Code + Agent. */
  aggressive?: boolean
}

export function stripModelNoise(text: string, opts: StripOptions = {}): string {
  // Reasoning first, through the same routine that settles a turn: a thought
  // is never part of the answer, whichever surface shows or speaks it.
  let t = stripNonCanonicalTags(text)
  // ChatML / special-token delimiters. A degenerating local model can spew its
  // own template tokens as content — qwen2.5-coder:14b emitted a burst of
  // <|im_start|> mid-stream 2026-06-02. <|im_start|>, <|im_end|>, <|endoftext|>,
  // <|assistant|> etc. are NEVER real answer text, so strip any <|word|> token.
  t = t.replace(/<\|[a-z0-9_]+\|>/gi, '')
  // tool_call / tool_response / tool_result tags + their content. qwen2.5-
  // coder:7b (confirmed live 2026-06-02) HALLUCINATES hermes-style
  // <tool_response> Error: … </tool_response> blocks INTO its prose. Native
  // tool results are role:'tool' messages and never reach assistant content,
  // so anything matching these tags is noise meant only for the model.
  t = t.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').replace(/<\/?tool_call>/gi, '')
  t = t.replace(/<tool_response>[\s\S]*?<\/tool_response>/gi, '').replace(/<\/?tool_response>/gi, '')
  t = t.replace(/<tool_result>[\s\S]*?<\/tool_result>/gi, '').replace(/<\/?tool_result>/gi, '')
  // The same tag with its opening bracket already eaten. Captured off the wire
  // 2026-07-25: Qwen3-32B through LU Cloud sends `</think>\n\nool_call>` as
  // content next to a valid tool_calls array — the PROVIDER's parser drops the
  // `<t`, so a pattern anchored on `<` cannot see the remainder. Line-anchored
  // so prose is never touched.
  t = t.replace(/^[ \t]*<?[|/]*t?ool_(?:call|calls|response|result)s?[|/]*>[ \t]*$/gim, '')
  // The /loop control markers. They are protocol between the driver and the
  // model, not something the user needs to read. The template asks for a reason
  // after the marker, so drop the whole line rather than leaving a dangling
  // "(verified by …)".
  t = t.replace(/^[ \t]*LOOP_(?:DONE|CONTINUE)\b.*$/gm, '')
  // The autonomous-continue NUDGE, if a weak model parrots it back as its own
  // answer (qwen2.5-coder:7b did this verbatim). It is OUR fixed instruction,
  // so the orchestration sentence never reads as a real answer.
  t = t.replace(/(?:please wait[,;:]?\s*(?:while\s+)?i\s+(?:will\s+)?)?continue working autonomously[\s\S]*?finished and verified\.?/gi, '')

  // An answer that is nothing but empty tag pairs. A model that cannot drive
  // tools answered a search question with `<source></source>` and nothing else
  // (SmolLM2 360M on a phone, 09.10.2026): the frame of an answer it never
  // filled. Only when the WHOLE answer is that, so a tag somebody asked for,
  // in prose or in a code block, is never touched.
  if (/^(?:\s*<([a-z][a-z0-9_-]{0,31})>\s*<\/\1>\s*)+$/i.test(t)) t = ''

  if (opts.aggressive) {
    // Tool-call JSON the model emitted as CONTENT, PARSE-FREE. The structured
    // extractor relies on JSON.parse via repairJson — which FAILS when the
    // model puts LITERAL newlines inside a string value (qwen2.5-coder:14b
    // emitted ```json {"name":"file_write","arguments":{"content":"line1<real
    // newline>line2"}}``` 2026-06-02), so that whole blob would leak as the
    // "answer". Strip it by pattern, no parsing:
    // (a) a fenced ```…``` block whose body is a "name"+"arguments" tool call.
    t = t.replace(/```[a-z]*\s*\n?\s*\{[\s\S]*?["']name["']\s*:[\s\S]*?["']arguments["']\s*:[\s\S]*?```/gi, '')
    // (b) an unfenced / truncated {"name":"…","arguments": … blob — strip from
    //     the header to end of text (a tool-call dump is never real prose, and
    //     a truncated one has no clean close for the brace-balancer to find).
    t = t.replace(/\{\s*["']?(?:name|tool|function)["']?\s*:\s*["'][a-z0-9_]+["']\s*,\s*["']?(?:arguments|args|parameters|input)["']?\s*:[\s\S]*$/i, '')
    try {
      const { ranges } = extractToolCallsWithRanges(t)
      if (ranges.length) t = stripRanges(t, ranges)
    } catch { /* ignore — never let a strip error hide the answer */ }
    // Range-based stripping removes the CALLS but leaves whatever wrapped them.
    // Live Agent run on the ship exe 2026-07-25: the model wrote its two calls
    // as one ```json array, both objects were lifted out, and the user was left
    // with a block containing `[` , `,` , `]`. A fence with no letter or digit
    // left in it is pure residue. Aggressive tier only, so a plain-chat answer
    // that is deliberately an empty array still renders.
    t = t.replace(/```[a-z_]*\s*([\s\S]*?)```/gi, (m, inner) =>
      /[A-Za-z0-9]/.test(inner) ? m : '')
  }

  return t.trim()
}
