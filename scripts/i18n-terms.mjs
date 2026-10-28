#!/usr/bin/env node
/**
 * 术语表的人用入口。
 *
 *   node scripts/i18n-terms.mjs --report              当前分布（默认动作，退出码恒 0）
 *   node scripts/i18n-terms.mjs --propose [--only=a,b] 多数派提案 + 稳定性标记，写 test-results/
 *   node scripts/i18n-terms.mjs --check [--strict]     违规清单；--strict 时退出码 1
 *
 * 门禁不在这个脚本里 —— `scripts/i18n-check.mjs` 才是阻断点（巡检与发布都调它）。
 * 这里只是让人能看清"现在长什么样"和"该冻哪个译法"。
 *
 * 为什么 --propose 不直接写 terms.json：多数派是**决策输入**，不是规则。
 * 自动落盘会让术语表随上游文案漂移，译文跟着抖。提案落 test-results/（已 gitignore），
 * 由人确认后手工冻结 —— 这一步没有自动化，是有意的。
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadTerms, findViolations, proposals, STABILITY } from './lib/i18n-terms.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const TERMS = join(root, 'src', 'lib', 'i18n', 'terms.json')
const DICT = join(root, 'src', 'lib', 'i18n', 'zh-CN.ts')

const arg = (name) => {
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (withEquals) return withEquals.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const MODE = process.argv.includes('--propose')
  ? 'propose'
  : process.argv.includes('--check')
    ? 'check'
    : 'report'
const strict = process.argv.includes('--strict')
const onlyList = arg('only')
const only = onlyList ? new Set(onlyList.split(',').map((s) => s.trim()).filter(Boolean)) : null

/** 终端里中文占两列，按 code point 数补空格会歪。 */
function displayWidth(text) {
  let width = 0
  for (const char of text) width += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60]/.test(char) ? 2 : 1
  return width
}

function pad(text, width) {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)))
}

function loadDictionary() {
  const url = new URL(`file://${DICT.replace(/\\/g, '/')}`).href
  return import(url)
}

let table
try {
  table = loadTerms(readFileSync, TERMS)
} catch (error) {
  console.error(`i18n-terms: ${error.message}`)
  process.exit(2)
}

const { ZH_CN = {}, ZH_PATTERNS = [] } = await loadDictionary()
const entries = ZH_CN
const patterns = ZH_PATTERNS

const normalizeCount = table.terms.filter((t) => t.mode === 'normalize').length
const reportCount = table.terms.filter((t) => t.mode === 'report').length

function header() {
  return `术语表：${table.terms.length} 词（normalize ${normalizeCount} / report ${reportCount}）  词条 ${Object.keys(entries).length}  模式 ${patterns.length}`
}

if (MODE === 'report' || MODE === 'propose') {
  console.log(header())

  if (table.terms.length === 0) {
    console.log('（空表：没有任何术语规则。用 --propose 生成候选，确认后填进 src/lib/i18n/terms.json）')
  } else {
    const rows = proposals(entries, patterns, table, { only })
    console.log('')
    console.log(
      pad('id', 14) + pad('canonical', 14) + pad('票数', 8) + pad('分布', 34) + pad('混用', 6) + 'share',
    )
    for (const row of rows) {
      const dist = Object.entries(row.counts)
        .map(([form, n]) => `${form} ${n}`)
        .join('  ')
      const mark = row.unstable ? '  unstable' : ''
      console.log(
        pad(row.id, 14) +
          pad(row.canonical, 14) +
          pad(String(row.counts[row.canonical] ?? 0), 8) +
          pad(dist || '（作用域内无命中）', 34) +
          pad(String(row.mixed), 6) +
          `${Math.round(row.share * 100)}%${mark}`,
      )
      if (!row.matchesFrozen && row.total > 0) {
        console.log(pad('', 14) + `注意：多数派是「${row.top}」，与冻结的「${row.canonical}」不同`)
      }
    }
    console.log('')
    console.log(
      `稳定性门槛：占比 ≥ ${Math.round(STABILITY.minShare * 100)}% 且领先 ≥ ${Math.round(STABILITY.minGap * 100)} 个百分点；不满足标 unstable，建议保持 report。`,
    )
  }

  if (MODE === 'propose') {
    const rows = proposals(entries, patterns, table, { only })
    const dir = join(root, 'test-results')
    mkdirSync(dir, { recursive: true })
    const out = join(dir, 'i18n-terms-proposal.json')
    writeFileSync(
      out,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          stability: STABILITY,
          proposals: rows,
          next: '人工确认后把 canonical / variants / mode 填进 src/lib/i18n/terms.json（这份提案本身不要提交）',
        },
        null,
        2,
      ),
      'utf8',
    )
    console.log(`\n提案已写入 ${out}`)
  }
}

if (MODE === 'check') {
  console.log(header())
  const violations = findViolations(entries, patterns, table, { only })

  if (violations.length === 0) {
    console.log('术语一致：没有违规。')
    process.exit(0)
  }

  console.log(`\n${violations.length} 处术语不一致：`)
  for (const v of violations.slice(0, 40)) {
    const where = v.table === 'entries' ? '词条' : '模式'
    const kind = v.kind === 'mixed' ? '同条混用' : '变体'
    console.log(`  [${v.term}] ${where}·${kind}：出现「${v.actual}」，应为「${v.expected}」`)
    console.log(`      ${JSON.stringify(v.key)}`)
  }
  if (violations.length > 40) console.log(`  …还有 ${violations.length - 40} 处`)

  const normalizeTerms = table.terms.filter((t) => t.mode === 'normalize').length
  if (normalizeTerms === 0) {
    console.log('\n注意：表里没有 normalize 的词，所以上面的违规不会被门禁拦截。')
  } else {
    console.log('\n修：node scripts/i18n-apply.mjs --sweep')
  }

  if (strict) process.exit(1)
}
