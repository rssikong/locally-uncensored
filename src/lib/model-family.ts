// Model families, the grouping of the chat model picker.
//
// Users pick by lineage first (Qwen, DeepSeek, GLM ...); which backend serves
// a model is a detail of the row. Grouping is purely visual: name and provider
// still resolve chat routing exactly as before.

// Normalize a model name into a comparable base form:
//   openai::qwen3.6-27b        -> qwen3.6-27b
//   richardyoung/qwen3-14b:... -> qwen3-14b
//   Qwen3.6-27B-Q4_K_M.gguf    -> qwen3.6-27b-q4_k_m.gguf
function normalizeModelName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/^[^:]+(?::[a-z0-9-]+)?::/, '')    // strip openai:: / anthropic:: / openai:<entry>:: (#173)
    .replace(/^[^/]+\//, '')    // strip repo-author/ prefix
    .replace(/:.+$/, '')        // strip :tag suffix
}

// Ordered, first match wins. Prefixes on the normalized name.
const FAMILY_MATCHERS: Array<{ family: string; test: RegExp }> = [
  { family: 'Qwen',       test: /^qwen|^qwq/ },
  { family: 'DeepSeek',   test: /^deepseek/ },
  { family: 'GLM',        test: /^glm|^chatglm|^zai/ },
  { family: 'Kimi',       test: /^kimi|^moonshot/ },
  { family: 'Llama',      test: /^llama|^meta[-_]?llama/ },
  { family: 'Gemma',      test: /^gemma/ },
  { family: 'MiniMax',    test: /^minimax/ },
  { family: 'Hermes',     test: /^hermes|^nous-/ },
  { family: 'gpt-oss',    test: /^gpt-oss/ },
  { family: 'Mistral',    test: /^mistral|^mixtral/ },
  { family: 'Phi',        test: /^phi-?\d|^phi_?\d/ },
  { family: 'Dolphin',    test: /^dolphin/ },
  { family: 'Yi',         test: /^yi-/ },
  { family: 'Command',    test: /^command/ },
  { family: 'Claude',     test: /^claude/ },
  { family: 'GPT / o-series', test: /^gpt-|^o1-|^o3-/ },
  { family: 'Gemini',     test: /^gemini/ },
  { family: 'Grok',       test: /^grok/ },
]

/** Everything without a family of its own, always the last group. */
export const OTHER_FAMILY = 'Other'

/** Display order of the groups: the matcher order above, then 'Other'. */
const FAMILY_RANK: Record<string, number> = Object.fromEntries(FAMILY_MATCHERS.map((m, i) => [m.family, i]))

export function modelFamily(modelName: string): string {
  const n = normalizeModelName(modelName)
  for (const { family, test } of FAMILY_MATCHERS) {
    if (test.test(n)) return family
  }
  return OTHER_FAMILY
}

/**
 * The family each name is listed under.
 *
 * A family with a single model does not get a head of its own: it goes to
 * 'Other'. A head over one row is a line of chrome that says what the row
 * already says, and a list of seven local models used to need four of them.
 * Decided over the WHOLE list, before any search or filter, so a model does
 * not change its group while the user narrows the list.
 */
export function assignFamilies(names: readonly string[]): Map<string, string> {
  const count = new Map<string, number>()
  for (const name of names) {
    const family = modelFamily(name)
    count.set(family, (count.get(family) ?? 0) + 1)
  }
  return new Map(names.map((name) => {
    const family = modelFamily(name)
    return [name, (count.get(family) ?? 0) > 1 ? family : OTHER_FAMILY]
  }))
}

/** Rows in family groups, groups in display order, rows in the order given. */
export function groupByFamily<T extends { family: string }>(rows: readonly T[]): { family: string; rows: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const row of rows) groups.set(row.family, [...(groups.get(row.family) ?? []), row])
  const rank = (family: string) =>
    family === OTHER_FAMILY ? Number.MAX_SAFE_INTEGER : FAMILY_RANK[family] ?? Number.MAX_SAFE_INTEGER - 1
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([family, grouped]) => ({ family, rows: grouped }))
}
