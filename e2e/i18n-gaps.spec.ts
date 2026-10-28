import { test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tauriMockInit, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'

/**
 * Find what is still English *on screen*.
 *
 * The static extractor answers "which literals exist in the source". This spec
 * answers the other half — "which of them does the running app actually show,
 * and did the dictionary miss it" — by booting the real UI in Chinese mode and
 * reading the DOM. It is opt-in: it produces a report, it is not a gate.
 *
 *   node scripts/i18n-gaps.mjs          # 包装器：设好环境变量、跑 chromium、读回 JSON
 *   LU_I18N_SCAN=1 npx playwright test e2e/i18n-gaps.spec.ts --project=chromium
 *
 * Output: <repo>/test-results/i18n-gaps.json (gitignored) — 绝对路径会打印出来，
 * 也接受 LU_I18N_GAPS_OUT 覆盖。以前这里写的是相对 cwd 的路径，从别的目录跑就会
 * 写到一个你找不到的地方。
 *
 * Why it matters: strings reach the screen through paths the AST cannot see —
 * a constant passed as a prop, an array of options, a sentence assembled at
 * runtime. Only a rendered page can tell you about those.
 */

// 品牌清单只有一份（scripts/lib/i18n-brands.json）。这里要的是并集：扫描时凡是
// 产品名/技术名都不算"漏译"，而提示词只带 hard 那一半。
const brands = JSON.parse(
  readFileSync(new URL('../scripts/lib/i18n-brands.json', import.meta.url), 'utf8'),
) as { hard: string[]; also: string[] }
const BRANDS = [...brands.hard, ...brands.also]

function looksLikeGap(text: string): boolean {
  const value = text.replace(/\s+/g, ' ').trim()
  if (value.length < 2) return false
  // Already translated: any CJK means the dictionary did its job.
  if (/[\u3400-\u9fff]/.test(value)) return false
  if (!/[A-Za-z]{2}/.test(value)) return false
  if (BRANDS.includes(value)) return false
  if (BRANDS.some((brand) => value === brand || value.startsWith(`${brand}:`))) return false
  // Model names and sizes: every word capitalised (or numeric) and no lowercase
  // word of its own — "DeepSeek V4 Flash 0731", "11 GB", ">20 GB".
  if (/^(?:[A-Z0-9][\w.+-]*\s*)+$/.test(value)) return false
  // identifiers, paths, urls, versions, key caps
  if (/^https?:\/\//i.test(value)) return false
  if (/^[\w.+-]+@[\w.-]+$/.test(value)) return false
  if (/^[a-z0-9]+(?:[-_.:/][a-z0-9]+)*$/i.test(value) && !value.includes(' ')) return false
  if (/^[\d\s.,:%()+-]+$/.test(value)) return false
  if (/^v?\d+(\.\d+)+/.test(value)) return false
  return true
}

type Hit = { text: string; kind: string; view: string }

async function harvest(page: Page, view: string, into: Hit[]): Promise<void> {
  const found = await page.evaluate(() => {
    const attrs = ['placeholder', 'title', 'aria-label', 'alt']
    const out: Array<{ text: string; kind: string }> = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const el = node.parentElement
      const tag = el?.tagName ?? ''
      const skip =
        ['CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA', 'KBD', 'SAMP'].includes(tag) ||
        el?.closest('[data-no-i18n]')
      if (!skip) {
        const text = (node.nodeValue ?? '').trim()
        if (text) out.push({ text, kind: `text:${tag.toLowerCase()}` })
      }
      node = walker.nextNode()
    }
    for (const el of document.body.querySelectorAll('*')) {
      for (const name of attrs) {
        const value = el.getAttribute(name)
        if (value) out.push({ text: value.trim(), kind: `attr:${name}` })
      }
    }
    return out
  })

  for (const hit of found) {
    if (looksLikeGap(hit.text)) into.push({ ...hit, view })
  }
}

test('collect the strings the app still shows in English', async ({ page }) => {
  test.skip(!process.env.LU_I18N_SCAN, 'set LU_I18N_SCAN=1 to run the gap scan')
  test.setTimeout(240_000)

  // Chinese mode before anything boots. resolveLocale() prefers a stored
  // choice over the build-time VITE_LU_LOCALE=en the web server carries.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('lu:locale', 'zh-CN')
    } catch {
      /* ignore */
    }
  })
  await page.addInitScript(tauriMockInit, {
    assistantReply: 'PONG',
    modelName: DEFAULT_MODEL_NAME,
  })
  await seedOnboardingDone(page)
  await page.goto('/')
  await page.waitForTimeout(2500)

  const hits: Hit[] = []

  // 导航按结构定位，不按中文名。`nav[aria-label="Main"]` 里的 Main 不在词典里
  // （词典只有 "Main I2V model" 这类长串），所以术语怎么统一都不会让选择器失效。
  //
  // 以前是 `getByRole('button', { name: '聊天' })` 加 `if (count === 0) continue`：
  // chat 一旦统一成别的译法，那一页就被静默跳过，报告反而变成"全好了"。这才是
  // 这个扫描器最坏的失败方式 —— 它不报错，它报平安。
  const navButtons = page.locator('nav[aria-label="Main"]').first().getByRole('button')
  const navCount = await navButtons.count()
  if (navCount === 0) {
    throw new Error('nav[aria-label="Main"] 里一个按钮都没有 —— Header 结构变了？')
  }

  const visited: string[] = []
  for (let index = 0; index < navCount; index += 1) {
    const button = navButtons.nth(index)
    const label = ((await button.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim()
    await button.click({ timeout: 5000 })
    await page.waitForTimeout(1200)
    // view 用当前真实标签：术语改了，报告跟着改，不会撒谎。
    const name = label || `nav#${index}`
    await harvest(page, name, hits)
    visited.push(name)
  }
  await harvest(page, 'start', hits)

  // 本地模式 7 个目标；云端模式会隐藏 localOnly 的三个，剩 4 个。
  // 少于这个数说明结构变了，必须响 —— 而不是安静地少扫几页。
  const minViews = Number(process.env.LU_I18N_MIN_VIEWS ?? 6)
  if (visited.length < minViews) {
    throw new Error(
      `只访问到 ${visited.length} 个视图（期望 ≥ ${minViews}）：${visited.join(' / ')}` +
        ' —— 导航结构变了，还是 appMode 变成了 cloud？',
    )
  }

  // Deduplicate by text: one entry per distinct string, with where it was seen.
  const unique = new Map<string, Hit & { views: Set<string> }>()
  for (const hit of hits) {
    const existing = unique.get(hit.text)
    if (existing) existing.views.add(hit.view)
    else unique.set(hit.text, { ...hit, views: new Set([hit.view]) })
  }
  const report = [...unique.values()]
    .map((hit) => ({ text: hit.text, kind: hit.kind, views: [...hit.views] }))
    .sort((a, b) => a.text.localeCompare(b.text))

  const outFile = process.env.LU_I18N_GAPS_OUT
    ? resolve(process.env.LU_I18N_GAPS_OUT)
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'i18n-gaps.json')
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8')

  console.log(`\n仍显示英文的文本：${report.length} 条`)
  console.log(`写入 ${outFile}`)
  console.log(`（cwd 是 ${process.cwd()}，路径与它无关）`)
  for (const item of report.slice(0, 40)) {
    console.log(`  [${item.kind}] ${JSON.stringify(item.text).slice(0, 80)}  (${item.views.join('/')})`)
  }
})
