#!/usr/bin/env node
/**
 * Translate the groups `i18n-extract.mjs` found, through any OpenAI-compatible
 * chat endpoint.
 *
 *   TRANSLATE_ENDPOINT=https://api.deepseek.com/v1/chat/completions \
 *   TRANSLATE_MODEL=deepseek-chat \
 *   TRANSLATE_TOKEN=… \
 *   node scripts/i18n-translate.mjs --in extract.json --out translations.json
 *
 * Design notes that matter more than the code:
 *
 *  - The MODEL DOES NOT DECIDE WHAT TO TRANSLATE. `--in` is the only source of
 *    work; ids it invents are dropped, ids it forgets are reported. The paths
 *    that must never be translated are already excluded by the extractor.
 *  - The marker `[[0]]` is the contract. A sentence with an inline value is
 *    translated as one sentence and must come back with the same markers, so
 *    `i18n-apply` can split it into the pieces the runtime bridge replaces.
 *  - A failed batch never fails the pipeline. Those strings stay English, which
 *    is the safe state; the sync commit still lands.
 *  - The token never reaches a log. Error bodies are redacted before printing.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DICT = join(root, 'src', 'lib', 'i18n', 'zh-CN.ts')

/** `--in=x` and `--in x` both work: the workflow writes one, a person the other. */
const arg = (name) => {
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (withEquals) return withEquals.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}
const IN = arg('in')
const OUT = arg('out')
if (!IN || !OUT) {
  console.error('用法: i18n-translate.mjs --in=extract.json --out=translations.json')
  process.exit(2)
}

const endpoint = process.env.TRANSLATE_ENDPOINT
const model = process.env.TRANSLATE_MODEL
const token = process.env.TRANSLATE_TOKEN
if (!endpoint || !model) {
  console.error('缺少 TRANSLATE_ENDPOINT 或 TRANSLATE_MODEL')
  process.exit(2)
}

const BATCH = Number(process.env.TRANSLATE_BATCH ?? 60)
const ATTEMPTS = 3

const dictUrl = new URL(`file://${DICT.replace(/\\/g, '/')}`).href
const module = await import(dictUrl).catch(() => ({}))
const existing = module.ZH_CN ?? {}
const existingPatterns = new Set((module.ZH_PATTERNS ?? []).map(([key]) => key))
const toPattern = (text) => text.replace(/\[\[(\d+)\]\]/g, (_, index) => `{${index}}`).trim()

const extract = JSON.parse(await readFile(IN, 'utf8'))
const pending = (extract.items ?? []).filter((group) =>
  group.kind === 'template'
    ? !existingPatterns.has(toPattern(group.sentence))
    : group.fragments.some((fragment) => !(fragment in existing)),
)

console.log(`待译分组 ${pending.length} / 共 ${extract.items?.length ?? 0}（已有词条 ${Object.keys(existing).length}）`)
if (pending.length === 0) {
  await writeFile(OUT, JSON.stringify({ groups: [], results: [] }, null, 2), 'utf8')
  console.log('没有需要翻译的内容')
  process.exit(0)
}

const SYSTEM = `You translate the user interface of a desktop AI application into Simplified Chinese.

Rules:
- Translate only interface copy. Keep product and technology names exactly as written: LU, LU Cloud, ComfyUI, Ollama, LM Studio, Hugging Face, CivitAI, GGUF, LoRA, MCP, API, GPU, VRAM, token.
- Keep code, file paths, file extensions, URLs, keyboard shortcuts and option flags untouched.
- The marker [[0]], [[1]] … stands for a value the app inserts (a number, a name). Keep every marker, exactly once, in the same order.
- Chinese must read like software written in Chinese: short, direct, no machine-translation stiffness. No trailing full stop on buttons and menu items.
- Never invent entries. Return exactly one result per input id.
- Output JSON only: {"results":[{"id":"g1","text":"…"}]}`

const redact = (text) => String(text ?? '').replace(/\bsk-[A-Za-z0-9_-]+/g, 'sk-***').replace(/Bearer\s+\S+/gi, 'Bearer ***')

async function ask(batch) {
  const body = {
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify(batch.map(({ id, sentence }) => ({ id, sentence }))) },
    ],
  }

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      })
      const text = await response.text()
      if (!response.ok) {
        console.error(`  HTTP ${response.status}: ${redact(text).slice(0, 300)}`)
        throw new Error(`HTTP ${response.status}`)
      }
      const payload = JSON.parse(text)
      const content = payload?.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new Error('响应里没有 choices[0].message.content')
      const parsed = JSON.parse(content)
      if (!Array.isArray(parsed?.results)) throw new Error('响应里没有 results 数组')
      return parsed.results
    } catch (error) {
      console.error(`  第 ${attempt} 次失败：${redact(error.message)}`)
      if (attempt === ATTEMPTS) return []
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
    }
  }
  return []
}

const markers = (text) => (text.match(/\[\[\d+\]\]/g) ?? []).join(',')

const results = []
const dropped = []

for (let start = 0; start < pending.length; start += BATCH) {
  const batch = pending.slice(start, start + BATCH)
  console.log(`批次 ${start / BATCH + 1}：${batch.length} 组`)
  const answers = await ask(batch)
  const byId = new Map(batch.map((group) => [group.id, group]))

  for (const answer of answers) {
    const group = byId.get(answer?.id)
    if (!group) {
      dropped.push(`未知 id ${answer?.id}`)
      continue
    }
    const text = String(answer.text ?? '').trim()
    if (!text) {
      dropped.push(`${group.id} 空译文`)
      continue
    }
    if (markers(text) !== markers(group.sentence)) {
      dropped.push(`${group.id} 标记不一致`)
      continue
    }
    results.push({ id: group.id, text })
    byId.delete(group.id)
  }
  for (const group of byId.values()) dropped.push(`${group.id} 模型未返回`)
}

await writeFile(OUT, JSON.stringify({ groups: pending, results }, null, 2), 'utf8')
console.log(`已译 ${results.length} 组，丢弃 ${dropped.length} 组，写入 ${OUT}`)
for (const line of dropped.slice(0, 15)) console.log(`  丢弃 ${line}`)
if (dropped.length > 15) console.log(`  …还有 ${dropped.length - 15} 条`)
