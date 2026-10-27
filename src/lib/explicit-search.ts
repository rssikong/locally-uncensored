/**
 * The user ordered a web search in so many words. What was ordered, and what
 * follows when the model answers without searching.
 *
 * WHY (re-check on Android 8 GB, N2). A new chat as it comes: Agent off, Web
 * search on, a model with 2B parameters. "Search the web: who won the 2026
 * FIFA World Cup?", three of three: no tool call. Once an invented winner,
 * twice "I cannot search the web". The turn did reach the model with the
 * search tool in its list (lib/chat-tool-intent.ts routes it there), the
 * model just did not call it, and nothing in the loop held an answer without
 * a call against what the user had asked for. The line under the answer
 * ("No tool ran ...") looks at what the ANSWER claims, and neither of these
 * answers claims a source.
 *
 * A pictures request has had its answer to this for a long time: where the
 * model does not make the call, the loop makes it (useAgentChat, the media
 * fallback). This is the same for a search, and only for an order as plain as
 * the ones below. A question that merely would be better with a search stays
 * the model's call.
 *
 * Pure. The loop asks `searchFallbackQuery`, the chat page asks
 * `explicitSearchQuery`.
 */

/** Polite or hedging words in front of the order. */
const LEAD_IN =
  '(?:(?:hey|hi|ok(?:ay)?|please|pls|bitte|kannst\\s+du|koenntest\\s+du|könntest\\s+du|can\\s+you|could\\s+you|would\\s+you|i\\s+want\\s+you\\s+to|i\\s+need\\s+you\\s+to|mal)[\\s,]+)*'

/** What may stand between the order and what to look for. */
const JOIN = '(?:\\s*[:\\-]\\s*|\\s+(?:for|about|on|nach|zu|ueber|über)\\s+|\\s+)'

const NET_EN = '(?:the\\s+)?(?:web|internet|net)'
const NET_DE = '(?:im|in\\s+dem|das)\\s+(?:web|netz|internet)'

/**
 * Orders with the query at the end. Each one names the web itself: "search my
 * notes for X" or "search for bugs" is not a web search.
 */
const ORDERS_QUERY_LAST: readonly RegExp[] = [
  // search the web: X / search the internet for X / search online for X
  new RegExp(`^${LEAD_IN}(?:do\\s+a\\s+|run\\s+a\\s+)?search\\s+(?:${NET_EN}|online)${JOIN}(.+)$`, 'is'),
  // web search: X / do a web search for X
  new RegExp(`^${LEAD_IN}(?:do\\s+a\\s+|run\\s+a\\s+)?web\\s*search${JOIN}(.+)$`, 'is'),
  // google X / google: X / google mal nach X
  new RegExp(`^${LEAD_IN}(?:google|googel|googl)e?(?:\\s+mal)?${JOIN}(.+)$`, 'is'),
  // look up online: X / look it up on the web: X
  new RegExp(`^${LEAD_IN}look\\s+(?:(?:it|this|that)\\s+)?up\\s+(?:online|on\\s+${NET_EN})${JOIN}(.+)$`, 'is'),
  // suche im Web nach X / such im Internet: X / durchsuche das Internet nach X
  new RegExp(`^${LEAD_IN}(?:durch)?such(?:e|en|st)?(?:\\s+mal)?(?:\\s+bitte)?\\s+(?:${NET_DE}|online)${JOIN}(.+)$`, 'is'),
  // recherchiere im Internet zu X / schau im Netz nach X (query follows)
  new RegExp(`^${LEAD_IN}(?:recherchier(?:e|en|st)?|schau(?:e|st)?|guck(?:e|st)?|sieh)(?:\\s+mal)?(?:\\s+bitte)?\\s+(?:${NET_DE}|online)(?:\\s+nach)?${JOIN}(.+)$`, 'is'),
]

/**
 * The order as a noun: "Websuche: X", "Internetsuche nach X", "mach eine
 * Websuche zu X" (round 10, the rest of N2). The word names the web itself,
 * so it needs no "im Internet" next to it. After the word a colon, a dash or
 * a preposition is asked for: "Websuche ist kaputt" talks about a search and
 * orders none.
 *
 * The router of the chat (lib/chat-tool-intent.ts) does not know these: its
 * search verbs stand at a word boundary, and "Websuche" has none before
 * "suche". That file is the desktop's as well and stays as it is. On a phone
 * the send path asks `explicitSearchQuery` itself and routes such a turn to
 * the tools (hooks/useChat.ts), so the loop that holds the order sees it.
 */
const JOIN_NOUN = '(?:\\s*[:\\-]\\s*|\\s+(?:nach|zu|zum|zur|ueber|über|for|about|on)\\s+)'
const ORDERS_NOUN: readonly RegExp[] = [
  new RegExp(
    `^${LEAD_IN}(?:(?:mach(?:e|st)?|start(?:e|est)?|fuehr(?:e|st)?|führ(?:e|st)?)(?:\\s+mal)?(?:\\s+bitte)?\\s+(?:eine\\s+)?)?(?:web|internet|netz|online)[\\s-]?suche${JOIN_NOUN}(.+)$`,
    'is',
  ),
]

/** Orders with the query in the middle: "look up X online", "suche X im Internet". */
const ORDERS_QUERY_INSIDE: readonly RegExp[] = [
  new RegExp(`^${LEAD_IN}(?:look\\s+up|search\\s+for)\\s+(.+?)\\s+(?:online|on\\s+${NET_EN})\\s*[.!?]*$`, 'is'),
  new RegExp(`^${LEAD_IN}such(?:e|en|st)?(?:\\s+mal)?(?:\\s+bitte)?(?:\\s+nach)?\\s+(.+?)\\s+(?:${NET_DE}|online)\\s*[.!?]*$`, 'is'),
]

/** An address in the order is a page to read, which is the other web tool. */
const ADDRESS = /\bhttps?:\/\/|\bwww\./i

/** Longest query handed to a search. The rest of a long message is context, not a query. */
export const SEARCH_QUERY_MAX = 300

function tidy(raw: string): string {
  let q = raw.replace(/\s+/g, ' ').trim()
  // Quotes around the whole of it, and a closing "please".
  q = q.replace(/^["'“„«]+|["'”“»]+$/g, '').trim()
  q = q.replace(/[\s,]+(?:please|pls|bitte|thanks|thank you|danke)[\s.!]*$/i, '').trim()
  return q
}

/**
 * Words a sentence begins with when it is no part of the question but an
 * order about what to do with the results: "Open one result page and tell me
 * the version with the source.", "Then summarise it.", "Antworte auf Deutsch."
 */
const FOLLOW_UP_ORDER =
  /^(?:and\s+|then\s+|and\s+then\s+|after\s+that[,\s]+|afterwards[,\s]+|also[,\s]+|please\s+|und\s+|dann\s+|danach\s+|bitte\s+)*(?:open|read|visit|fetch|tell|give|show|list|name|cite|quote|summari[sz]e|sum\s+up|explain|answer|reply|respond|write|use|include|add|compare|check|verify|keep|make|translate|oeffne|öffne|lies|lese|ruf|sag|sage|nenn|nenne|gib|zeig|zeige|fass|fasse|erklaer|erklär|erkläre|antworte|schreib|schreibe|nutze|benutze|vergleich|vergleiche|pruef|prüf|prüfe|uebersetz|übersetz|übersetze)\b/i

/**
 * The question of an order, without the orders that follow it.
 *
 * "what is the current stable version of Python? Open one result page and
 * tell me the version with the source." went to the search engine whole, and
 * the hits were about "source" and "version" in general (short check on
 * Android, package 8). The first sentence is the query. What follows stays
 * only while it is not an order about the results; from the first such
 * sentence on, the rest is for the model, not for the search engine.
 */
export function questionOfOrder(query: string): string {
  // A sentence ends at a mark that is followed by a space: "3.12" and "node.js" end nothing.
  const sentences = query.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
  if (sentences.length < 2) return query
  const kept = [sentences[0]]
  for (const sentence of sentences.slice(1)) {
    if (FOLLOW_UP_ORDER.test(sentence)) break
    kept.push(sentence)
  }
  const question = kept.join(' ').trim()
  // An order that is nothing but follow-ups keeps its words: better a wide search than none.
  return question.replace(/[^\p{L}\p{N}]/gu, '').length < 2 ? query : question
}

/**
 * The query of an explicit order to search the web, or null when the text is
 * not such an order. Deliberately narrow: the order stands at the start of the
 * message and names the web ("search the web: ...", "web search for ...",
 * "google ...", "suche im Internet nach ..."). Missing an order leaves things
 * as they were; taking a plain question for one would search behind the
 * user's back. Every order here is also one the chat routes to its tools
 * (lib/chat-tool-intent.ts); the test holds the two together. The one
 * exception is the order as a noun (`ORDERS_NOUN`), which only the send path
 * of a phone routes.
 */
export function explicitSearchQuery(text: string): string | null {
  const t = (text || '').trim()
  if (!t || ADDRESS.test(t)) return null
  for (const order of [...ORDERS_QUERY_LAST, ...ORDERS_NOUN, ...ORDERS_QUERY_INSIDE]) {
    const m = order.exec(t)
    if (!m) continue
    const q = tidy(questionOfOrder(tidy(m[1])))
    // "search the web" and nothing else, or a leftover word: no query to run.
    if (q.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return null
    return q.length > SEARCH_QUERY_MAX ? q.slice(0, SEARCH_QUERY_MAX).trim() : q
  }
  return null
}

export interface SearchFallbackInput {
  /** What the user typed for this run. */
  userText: string
  /** The model ended its turn without a tool call. */
  finalTurnWithoutCall: boolean
  /** Tool calls that ran in this run so far. */
  callsRunSoFar: number
  /** The search tool is in the list this run may use (toggle on, permission not blocked). */
  searchOffered: boolean
  /** A read only turn may not be widened. */
  readOnly: boolean
  /** The loop already made this call once in this run. */
  alreadyDone: boolean
}

/**
 * The search the loop runs in place of the model, or null. One per run, only
 * when the user ordered a search, the search tool is offered, and the model
 * ended its first answer without calling anything.
 */
export function searchFallbackQuery(input: SearchFallbackInput): string | null {
  if (!input.finalTurnWithoutCall || input.callsRunSoFar > 0) return null
  if (!input.searchOffered || input.readOnly || input.alreadyDone) return null
  return explicitSearchQuery(input.userText)
}

interface SearchCall {
  function: { name: string; arguments: Record<string, unknown> }
}

/**
 * The first search of a run the user ordered asks for what the user wrote.
 *
 * A small model rewrites the text on its way into the call: "Websuche:
 * Einwohnerzahl Island" became "Inzaehlung der Einwohnerzahl der Insel
 * Island", the search found nothing, and the answer blamed a missing key
 * (check on Android with 4 GB, F4). The order names the query, so the first
 * `web_search` of the list gets it, word for word; its other arguments stay.
 * Later searches of the same run are the model's own.
 *
 * Pure. Hands back the same list when there is nothing to change, so the
 * caller can tell by identity.
 */
export function withOrderedQuery<T extends SearchCall>(calls: readonly T[], userText: string): readonly T[] {
  const ordered = explicitSearchQuery(userText)
  if (!ordered) return calls
  const at = calls.findIndex((call) => call.function.name === 'web_search')
  if (at < 0) return calls
  const args = calls[at].function.arguments ?? {}
  if (args.query === ordered) return calls
  const next = [...calls]
  next[at] = { ...calls[at], function: { ...calls[at].function, arguments: { ...args, query: ordered } } }
  return next
}

