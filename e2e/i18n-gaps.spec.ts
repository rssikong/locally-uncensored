import { test, type Page } from '@playwright/test'
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
 *   $env:LU_I18N_SCAN='1'; npx playwright test e2e/i18n-gaps.spec.ts
 *
 * Output: test-results/i18n-gaps.json (gitignored) + a console summary.
 *
 * Why it matters: strings reach the screen through paths the AST cannot see —
 * a constant passed as a prop, an array of options, a sentence assembled at
 * runtime. Only a rendered page can tell you about those.
 */

const BRANDS = [
  'LU', 'LU Cloud', 'ComfyUI', 'Ollama', 'LM Studio', 'Hugging Face', 'CivitAI',
  'GGUF', 'LoRA', 'MCP', 'API', 'GPU', 'VRAM', 'CPU', 'TTS', 'STT', 'Piper',
  'Whisper', 'Qwen', 'Llama', 'Gemma', 'Mistral', 'DeepSeek', 'OpenAI',
  'Anthropic', 'OpenRouter', 'Groq', 'Together', 'Jan', 'GPT4All', 'KoboldCpp',
  'vLLM', 'LocalAI', 'TabbyAPI', 'Aphrodite', 'SGLang', 'MLX', 'Metal', 'CUDA',
  'Vulkan', 'ROCm', 'Flux', 'SDXL', 'Wan', 'Hunyuan', 'AnimateDiff', 'FramePack',
  'ACE Step', 'Windows', 'macOS', 'Linux', 'Android', 'iOS', 'GitHub', 'Discord',
]

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
  const views = ['聊天', '创作', '语音', '对比', '跑分', '模型', '设置']
  for (const view of views) {
    const button = page.getByRole('button', { name: view, exact: true }).first()
    if ((await button.count()) === 0) continue
    await button.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(1200)
    await harvest(page, view, hits)
  }
  await harvest(page, 'chat', hits)

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

  const fs = await import('node:fs')
  fs.mkdirSync('test-results', { recursive: true })
  fs.writeFileSync('test-results/i18n-gaps.json', JSON.stringify(report, null, 2), 'utf8')

  console.log(`\n仍显示英文的文本：${report.length} 条（写入 test-results/i18n-gaps.json）`)
  for (const item of report.slice(0, 40)) {
    console.log(`  [${item.kind}] ${JSON.stringify(item.text).slice(0, 80)}  (${item.views.join('/')})`)
  }
})
