#!/usr/bin/env node
/**
 * 扫描"界面上还是英文"的入口。
 *
 *   node scripts/i18n-gaps.mjs
 *   node scripts/i18n-gaps.mjs --min-views=4        # 云端模式只显示 4 个导航目标
 *
 * 它只是 `e2e/i18n-gaps.spec.ts` 的一层壳：设好 LU_I18N_SCAN、只跑 chromium、
 * 再把 JSON 读回来打一张表。**不是门禁** —— 真浏览器 + 七个页面，抖动成本高，
 * 拿它卡发布只会变成"随机红一下就重跑"。
 *
 * 不做成 npm script 是有意的：package.json 是上游文件，加一条就要多一个补丁，
 * 上游动 dependencies 就冲突，冲突 = 不推送不发版。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = process.env.LU_I18N_GAPS_OUT
  ? resolve(process.env.LU_I18N_GAPS_OUT)
  : resolve(root, 'test-results', 'i18n-gaps.json')

const minViews = process.argv.find((a) => a.startsWith('--min-views='))?.slice('--min-views='.length)

const run = spawnSync(
  'npx',
  ['playwright', 'test', 'e2e/i18n-gaps.spec.ts', '--project=chromium', '--reporter=line'],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      LU_I18N_SCAN: '1',
      ...(minViews ? { LU_I18N_MIN_VIEWS: minViews } : {}),
    },
    // Windows 上 npx 是 .cmd，不经过 shell 会直接 ENOENT。
    shell: process.platform === 'win32',
  },
)

if (!existsSync(outFile)) {
  console.error(`\ni18n-gaps: 没有产出 ${outFile}（测试大概没跑到底，看上面的 Playwright 输出）`)
  process.exit(run.status ?? 1)
}

const report = JSON.parse(readFileSync(outFile, 'utf8'))
const byKind = new Map()
for (const item of report) byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1)

console.log(`\n仍显示英文：${report.length} 条`)
for (const [kind, count] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${kind.padEnd(22)} ${count}`)
}
console.log(`\n文件：${outFile}`)

const widest = [...report].sort((a, b) => b.views.length - a.views.length).slice(0, 10)
if (widest.length > 0) {
  console.log('\n出现页数最多的 10 条（优先补这些，收益最大）：')
  for (const item of widest) {
    console.log(`  ${JSON.stringify(item.text).slice(0, 70)}  (${item.views.join('/')})`)
  }
}

// 退出码跟着 Playwright：扫描崩了要能看出是崩了。但它不进 CI，所以这个码
// 只影响你的终端，不影响发布。
process.exit(run.status ?? 0)
