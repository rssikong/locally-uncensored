/**
 * 术语表的加载、校验、分词、归一与违规检测。
 *
 * ── 为什么要分词，而不是数子串 ────────────────────────────────────────
 *
 * `提示词` 包含 `提示`。若按 `value.includes('提示')` 统计，`提示词` 的每一次
 * 出现都会给 `提示` 记一票，`提示` 于是凭空变成"多数派"，归一就会把
 * 「提示词」整片改成「提示」。所以统计前必须先做**最长优先**切分：
 * 从每个位置开始，用表里最长的那个词形去匹配，匹配到就整段跳过。
 *
 * ── 为什么多数派不在这里算 ────────────────────────────────────────────
 *
 * 这个文件只负责"按表执行"。表里的 `canonical` 是人冻结下来的，运行时不回看
 * 统计结果 —— 否则上游加一句新文案就可能翻转多数派，译文今天改成 A、明天改回 B。
 * 多数派只在 `proposals()` 里出现，用于生成提案，供人决定要不要冻结。
 *
 * ── 一个词的两种身份 ──────────────────────────────────────────────────
 *
 * `mode: "normalize"` 的词会被改写，并且出现在 check 的阻断名单里；
 * `mode: "report"` 的词只统计、只打印，永不改写 —— 同形不同义（memory=内存/记忆）
 * 必须走这条，因为按值替换会把"记忆"改成"内存"，把功能说成硬件。
 */

const MODES = new Set(['normalize', 'report', 'off'])
const SCOPES = new Set(['keys', 'values', 'both'])
const TABLES = new Set(['entries', 'patterns'])

/** 提案的稳定性门槛：占比不足、或与第二名差距不足，都标记为 unstable。 */
export const STABILITY = { minShare: 0.6, minGap: 0.15 }

function compile(source, field, id) {
  try {
    return new RegExp(source, 'i')
  } catch (error) {
    throw new Error(`术语 ${id}: ${field} 不是合法正则 ${JSON.stringify(source)}（${error.message}）`)
  }
}

function requireString(value, field, id) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`术语 ${id}: ${field} 必须是非空字符串`)
  }
  return value
}

/**
 * 校验并编译一张表。任何问题都 throw —— 不 catch、不降级。
 *
 * 理由和 overrides 的 fail-closed 一样：一张被悄悄读成空的表，会让门禁恒真
 * 却仍然打印"通过"，那比没有门禁更糟，因为它会让人以为守住了。
 */
export function validateTerms(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('术语表: 顶层必须是对象')
  if (raw.version !== 1) throw new Error(`术语表: 不支持的 version ${JSON.stringify(raw.version)}`)
  const list = raw.terms
  if (!Array.isArray(list)) throw new Error('术语表: terms 必须是数组')

  const ids = new Set()
  const forms = new Map() // 词形 -> termId，跨词重复即歧义
  const compiled = []

  for (const item of list) {
    const id = requireString(item?.id, 'id', '(缺 id)')
    if (ids.has(id)) throw new Error(`术语表: id 重复 ${JSON.stringify(id)}`)
    ids.add(id)

    const mode = item.mode
    if (!MODES.has(mode)) throw new Error(`术语 ${id}: mode 必须是 normalize/report/off，收到 ${JSON.stringify(mode)}`)
    const scope = item.scope ?? 'keys'
    if (!SCOPES.has(scope)) throw new Error(`术语 ${id}: scope 非法 ${JSON.stringify(scope)}`)

    const tables = item.tables ?? ['entries', 'patterns']
    if (!Array.isArray(tables) || tables.some((t) => !TABLES.has(t))) {
      throw new Error(`术语 ${id}: tables 只能是 entries/patterns 的子集`)
    }

    const english = compile(requireString(item.english, 'english', id), 'english', id)

    const canonical = typeof item.canonical === 'string' ? item.canonical : ''
    const variants = Array.isArray(item.variants) ? item.variants : []
    if (mode !== 'off' && !canonical) throw new Error(`术语 ${id}: canonical 不能为空`)
    for (const v of variants) requireString(v, 'variants[]', id)

    if (mode === 'normalize') {
      if (variants.includes(canonical)) throw new Error(`术语 ${id}: 变体与 canonical 相同`)
      // 归一模式下，词形之间不能互为子串 —— 否则替换会来回拉锯，永不稳定。
      const pool = [canonical, ...variants]
      for (const a of pool) {
        for (const b of pool) {
          if (a === b) continue
          if (b.includes(a)) {
            throw new Error(`术语 ${id}: 词形 ${JSON.stringify(a)} 是 ${JSON.stringify(b)} 的子串，归一会抖动`)
          }
        }
      }
      if (typeof item.rationale !== 'string' || item.rationale.trim() === '') {
        throw new Error(`术语 ${id}: normalize 必须写 rationale（为什么是这个译法）`)
      }
    }

    for (const form of [canonical, ...variants]) {
      if (!form) continue
      const owner = forms.get(form)
      if (owner && owner !== id) {
        throw new Error(`术语表: 词形 ${JSON.stringify(form)} 同时属于 ${owner} 和 ${id}`)
      }
      forms.set(form, id)
    }

    compiled.push({
      ...item,
      id,
      mode,
      scope,
      tables,
      canonical,
      variants,
      _en: english,
      _allowKeys: (item.allowKeys ?? []).map((s, i) => compile(s, `allowKeys[${i}]`, id)),
      _allowValues: (item.allowValues ?? []).map((s, i) => compile(s, `allowValues[${i}]`, id)),
    })
  }

  // 最长优先：`提示词` 必须排在 `提示` 前面，否则短词永远先命中。
  const ordered = []
  for (const term of compiled) {
    for (const form of [term.canonical, ...term.variants]) {
      if (form) ordered.push({ form, term })
    }
  }
  ordered.sort((a, b) => b.form.length - a.form.length || a.form.localeCompare(b.form))

  return { ...raw, terms: compiled, _forms: ordered }
}

/** 读文件并校验。文件缺失 / JSON 语法错都 throw，带路径。 */
export function loadTerms(readFileSync, path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`术语表: 无法读取 ${path}（${error.message}）`)
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new Error(`术语表: ${path} 不是合法 JSON（${error.message}）`)
  }
  return validateTerms(raw)
}

/**
 * 最长优先切分。返回逐段 token：命中的 token 带所属 term，未命中的逐字符。
 * 归一与统计都基于它，这样「提示词」不会被拆成「提示」+「词」。
 */
export function tokenize(text, table) {
  const tokens = []
  let index = 0
  while (index < text.length) {
    let hit = null
    for (const candidate of table._forms) {
      if (text.startsWith(candidate.form, index)) {
        hit = candidate
        break
      }
    }
    if (hit) {
      tokens.push({ text: hit.form, term: hit.term })
      index += hit.form.length
    } else {
      tokens.push({ text: text[index], term: null })
      index += 1
    }
  }
  return tokens
}

function allowed(term, key, value) {
  if (term._allowKeys.some((re) => re.test(key))) return true
  if (term._allowValues.some((re) => re.test(value))) return true
  return false
}

/**
 * 这个词管不管这一条。`keys` 用英文 key 把关（chat 只管 key 里含 chat 的条目，
 * 所以 conversation 的 48 条「对话」根本不在作用域内）；`values` / `both` 不设门槛。
 */
function inScope(term, key) {
  if (term.scope === 'keys') return term._en.test(key)
  return true
}

function hitsOf(term, value, table) {
  const tokens = tokenize(value, table)
  const mine = tokens.filter((t) => t.term && t.term.id === term.id)
  return {
    canonical: mine.filter((t) => t.text === term.canonical).length,
    variants: mine.filter((t) => term.variants.includes(t.text)),
  }
}

/**
 * 把一条译文里的变体改写成 canonical。返回新的值与被改动的明细。
 * 幂等：改写结果里不再含变体，再跑一次不会产生变化。
 */
export function normalizeValue(key, value, table, { only = null } = {}) {
  const changes = []
  let out = value

  for (const term of table.terms) {
    if (term.mode !== 'normalize') continue
    if (only && !only.has(term.id)) continue
    if (!inScope(term, key)) continue
    if (allowed(term, key, out)) continue

    const tokens = tokenize(out, table)
    let touched = false
    const rebuilt = tokens.map((token) => {
      if (!token.term || token.term.id !== term.id) return token.text
      if (!term.variants.includes(token.text)) return token.text
      touched = true
      changes.push({ term: term.id, from: token.text, to: term.canonical })
      return term.canonical
    })
    if (touched) out = rebuilt.join('')
  }

  return { value: out, changes }
}

/**
 * 违规清单。只收 `normalize` 的词 —— `report` 的词列出来只会变成噪音，
 * 而噪音会让人直接关掉这条检查。
 */
export function findViolations(entries, patterns, table, { only = null } = {}) {
  const violations = []

  for (const term of table.terms) {
    if (term.mode !== 'normalize') continue
    if (only && !only.has(term.id)) continue

    if (term.tables.includes('entries')) {
      for (const [key, value] of Object.entries(entries ?? {})) {
        if (!inScope(term, key)) continue
        if (allowed(term, key, value)) continue
        const { canonical, variants } = hitsOf(term, value, table)
        if (variants.length === 0) continue
        violations.push({
          term: term.id,
          table: 'entries',
          key,
          expected: term.canonical,
          actual: variants[0].text,
          count: variants.length,
          // 同一条里既有正确形态又有变体：最值得单独标出来，读起来自相矛盾。
          kind: canonical > 0 ? 'mixed' : 'variant',
        })
      }
    }

    if (term.tables.includes('patterns')) {
      for (const [pattern, replacement] of patterns ?? []) {
        if (!inScope(term, pattern)) continue
        if (allowed(term, pattern, replacement)) continue
        const { canonical, variants } = hitsOf(term, replacement, table)
        if (variants.length === 0) continue
        violations.push({
          term: term.id,
          table: 'patterns',
          key: pattern,
          expected: term.canonical,
          actual: variants[0].text,
          count: variants.length,
          kind: canonical > 0 ? 'mixed' : 'variant',
        })
      }
    }
  }

  return violations
}

/**
 * 统计与提案。多数派只在这里出现 —— 它是**冻结时的输入**，不是运行时的规则。
 * `unstable` 表示"这个多数派还不足以拿来定标准"。
 */
export function proposals(entries, patterns, table, { only = null } = {}) {
  const out = []

  for (const term of table.terms) {
    if (term.mode === 'off') continue
    if (only && !only.has(term.id)) continue

    const counts = new Map()
    const bump = (form) => counts.set(form, (counts.get(form) ?? 0) + 1)
    let mixed = 0

    const consume = (keySafe, value) => {
      if (!inScope(term, keySafe)) return
      if (allowed(term, keySafe, value)) return
      const tokens = tokenize(value, table)
      const mine = tokens.filter((t) => t.term && t.term.id === term.id)
      if (mine.length === 0) return
      const hasCanonical = mine.some((t) => t.text === term.canonical)
      const hasVariant = mine.some((t) => term.variants.includes(t.text))
      if (hasCanonical && hasVariant) mixed += 1
      for (const token of mine) bump(token.text)
    }

    if (term.tables.includes('entries')) {
      for (const [key, value] of Object.entries(entries ?? {})) consume(key, value)
    }
    if (term.tables.includes('patterns')) {
      for (const [pattern, replacement] of patterns ?? []) consume(pattern, replacement)
    }

    const total = [...counts.values()].reduce((sum, n) => sum + n, 0)
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    const top = sorted[0] ?? [term.canonical, 0]
    const second = sorted[1] ?? [null, 0]
    const share = total === 0 ? 0 : top[1] / total
    const gap = total === 0 ? 0 : (top[1] - second[1]) / total

    out.push({
      id: term.id,
      mode: term.mode,
      canonical: term.canonical,
      counts: Object.fromEntries(sorted),
      total,
      mixed,
      top: top[0],
      share,
      gap,
      unstable: share < STABILITY.minShare || gap < STABILITY.minGap,
      // 冻结点与当前多数派不一致时提醒（多数派不是真理，但值得解释一句）。
      matchesFrozen: top[0] === term.canonical,
    })
  }

  return out
}
