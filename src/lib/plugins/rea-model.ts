// What a local model sees of REA's tools and their results (lib/plugins/rea.ts).
//
// The real run with Qwen 3.8 27B (17.10.2026) found the steps in the right
// order and still never wrote an answer, for these reasons:
//
// - The tools that work on an earlier result (trace_*, compare_*) take that
//   Evidence record either complete or as a reference to the one REA keeps:
//   {"kind":"retained-evidence","evidence_id":"ev_…"}. The schema puts the
//   complete record first, some 7,000 characters of it, and the model copied
//   records it had never seen whole, which REA refused each time. LU's
//   schema keeps only the reference, which is what REA's own guide
//   recommends; a complete record never reaches a local model whole anyway.
//   The model's call is held to that reference too (reaArgsFromModel).
// - A result is Evidence JSON, and most of it is provenance: hashes, node
//   identities, extractor names, the same limitations at every level.
//   analyze_javascript_application on a four file app returned 343,583
//   characters, the sync endpoint at character 230,308; LU's cap keeps the
//   first 40,000 and the last 20,000. The model gets the facts instead,
//   about a tenth of the size, with the evidence_id that names the record.

import type { MCPToolDefinition } from '../../api/mcp/types'

type Schema = Record<string, unknown>

/** The reference REA accepts wherever it takes an earlier record. */
function isRetainedReference(s: unknown): boolean {
  const kind = (s as { properties?: { kind?: { const?: unknown } } } | null)?.properties?.kind
  return kind?.const === 'retained-evidence'
}

/** A complete Evidence record as REA's schemas spell it out. */
function isEvidenceRecord(s: Schema): boolean {
  const p = s.properties as Schema | undefined
  return s.type === 'object' && !!p && 'evidence_id' in p && 'normalized_result' in p
}

function simplify(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(simplify)
  if (!s || typeof s !== 'object') return s
  const o = s as Schema
  for (const union of ['anyOf', 'oneOf'] as const) {
    const branches = o[union]
    if (!Array.isArray(branches)) continue
    const ref = branches.find(isRetainedReference)
    if (ref) {
      const { [union]: _dropped, ...rest } = o
      return { ...rest, ...(simplify(ref) as Schema) }
    }
  }
  // Where only a complete record is taken (native observation lists), the
  // record's own 7,000 character schema says nothing a model can act on.
  if (isEvidenceRecord(o)) {
    return { type: 'object', description: 'A complete Evidence record exactly as a REA tool returned it.' }
  }
  const out: Schema = {}
  for (const [k, v] of Object.entries(o)) out[k] = simplify(v)
  return out
}

/** A REA tool as LU offers it to the model: earlier records by reference. */
export function reaToolForModel(tool: MCPToolDefinition): MCPToolDefinition {
  return { ...tool, inputSchema: simplify(tool.inputSchema) as MCPToolDefinition['inputSchema'] }
}

/**
 * The model's arguments as REA takes them. Ollama does not hold a model to
 * a schema's `const`, and on the second real run Qwen 3.8 27B passed the
 * right evidence id as {"kind":"evidence", …}; REA refused it as invalid
 * input. Where LU's schema takes a reference, an object that names an
 * evidence id is that reference, whatever kind the model wrote.
 */
export function reaArgsFromModel(schema: unknown, args: unknown): unknown {
  if (!schema || typeof schema !== 'object' || !args || typeof args !== 'object') return args
  const s = schema as Schema
  if (Array.isArray(args)) return s.items ? args.map((a) => reaArgsFromModel(s.items, a)) : args
  const a = args as Record<string, unknown>
  if (isRetainedReference(s)) {
    const id = a.evidence_id
    return typeof id === 'string' && /^ev_[a-f0-9]{64}$/.test(id) ? { kind: 'retained-evidence', evidence_id: id } : args
  }
  const props = s.properties as Schema | undefined
  if (!props) return args
  const out: Record<string, unknown> = { ...a }
  for (const [k, v] of Object.entries(a)) if (k in props) out[k] = reaArgsFromModel(props[k], v)
  return out
}

/** Keys that are provenance at any depth: identities, extractor names, hashes. */
const PROVENANCE = new Set([
  'identity', 'identifier_strategy', 'extractor', 'observation_id', 'evidence_contexts', 'fingerprints',
  'artifact', 'source_map_reference', 'context_id', 'role_key', 'integrity_contradictions',
])
/** Kept at the top of a record and of its normalized_result, dropped below,
 *  where every node repeats them. */
const REPEATED = new Set(['limitations', 'unknowns', 'coverage', 'evidence', 'evidence_links', 'evidence_ids'])
/** A bare digest or a node identity ("jsrg_node_<64 hex>"); evidence ids stay. */
const DIGEST = /^[a-z_]*[a-f0-9]{40,}$/

function facts(v: unknown, depth: number): unknown {
  if (Array.isArray(v)) {
    const a = v.map((x) => facts(x, depth + 1)).filter((x) => x !== undefined)
    return a.length ? a : undefined
  }
  if (v && typeof v === 'object') {
    const out: Schema = {}
    for (const [k, x] of Object.entries(v)) {
      if (PROVENANCE.has(k) || /sha256|digest/.test(k)) continue
      if (depth > 1 && REPEATED.has(k)) continue
      const y = facts(x, depth + 1)
      if (y === undefined || y === null) continue
      if (typeof y === 'object' && !Array.isArray(y) && Object.keys(y).length === 0) continue
      out[k] = y
    }
    return Object.keys(out).length ? out : undefined
  }
  if (typeof v === 'string' && DIGEST.test(v) && !v.startsWith('ev_')) return undefined
  return v
}

/** Above this the facts are cut here, so the note on how to go on survives. */
export const REA_RESULT_MAX = 40000

/**
 * How to go on from a cut list, per tool. These lists take no page and no
 * filter, and their record cannot be read back in parts either, so the
 * general advice below sent the model in circles (A37, xxcoder 26.10.2026:
 * list_procedures of a Windows program, cut at 40,000 of about 400,000
 * characters, main never reached). The search tools are complete.
 */
const CUT_LIST_ADVICE: Record<string, string> = {
  list_procedures: 'This list cannot be paged. Find a function with search_procedures (a name such as main, WinMain or entry; regex allowed) or procedure_address, then decompile it with procedure_pseudo_code.',
  list_names: 'This list cannot be paged. Find a symbol with search_procedures or address_name, or search text with search_strings.',
}

/**
 * A REA result as LU hands it to the model: the facts of an Evidence record
 * without its provenance. Anything that is not JSON (an error text, a short
 * answer) passes unchanged up to the same limit. `tool` names the REA tool
 * that answered, for advice that fits it when the result is cut.
 */
export function reaResultForModel(text: string, tool?: string): string {
  let out = text
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object') out = JSON.stringify(facts(parsed, 0) ?? {})
  } catch {
    // Not JSON: REA's own error texts are short and read as they are.
  }
  if (out.length <= REA_RESULT_MAX) return out
  const id = /"evidence_id":"(ev_[a-f0-9]{64})"/.exec(text)?.[1]
  const advice = tool ? CUT_LIST_ADVICE[tool] : undefined
  if (advice) {
    return out.slice(0, REA_RESULT_MAX)
      + `\n\n[LU cut this result at ${REA_RESULT_MAX} of ${out.length} characters. ${advice}]`
  }
  return out.slice(0, REA_RESULT_MAX)
    + `\n\n[LU cut this result at ${REA_RESULT_MAX} of ${out.length} characters.`
    + (id ? ` REA keeps the whole record as ${id}: pass {"kind":"retained-evidence","evidence_id":"${id}"} to a tool that takes it.` : '')
    + ' Call the tool again with detail "summary", or narrow it (source_paths, a seed, a page), for the rest.]'
}
