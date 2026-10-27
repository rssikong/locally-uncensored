import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'

/**
 * Two wishes from the 3.0.4 bug hunt, on the real Settings page:
 *  - Discord 2026-09-23: limit the download speed. The number
 *    typed under Storage reaches `set_download_limit`.
 *  - GitHub Discussion 4 2026-09-22: statistics for the Local API.
 *    A running API shows what went through it.
 * Screenshots land in test-results/304-wishes for the owner's design check.
 *
 * Run: npx playwright test e2e/download-limit-and-local-api-usage.spec.ts
 */

const SHOTS = resolve(process.cwd(), 'test-results/304-wishes')

async function boot(page: Page) {
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME })
  await page.addInitScript(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> }
      __limits: unknown[]
    }
    w.__limits = []
    const invoke = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
      if (cmd === 'set_download_limit') { w.__limits.push(args); return null }
      if (cmd === 'local_api_status') return { running: true, address: '127.0.0.1:8129' }
      if (cmd === 'local_api_usage') {
        return {
          since: Date.now() - 1_800_000, requests: 1234, failed: 2, active: 1,
          promptTokens: 48210, completionTokens: 9034, withoutCounts: 3,
          lastModel: 'ollama/qwen3:8b', lastAt: Date.now() - 4000,
        }
      }
      return invoke(cmd, args)
    }
  })
  await seedOnboardingDone(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).first().click()
}

test('the download speed limit reaches the downloader', async ({ page }) => {
  await boot(page)
  await page.getByRole('button', { name: 'AI Backends', exact: true }).first().click()
  const storage = page.getByRole('button', { name: /Storage/ }).first()
  if ((await storage.getAttribute('aria-expanded')) === 'false') await storage.click()
  const box = page.getByLabel('Download speed limit in MB/s')
  await expect(box).toBeVisible()
  await box.fill('8')
  await box.press('Enter')
  await expect(page.getByText('Model downloads share 8 MB/s between them. 0 removes the limit.')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __limits: unknown[] }).__limits)).toContainEqual({ mbPerSec: 8 })
  await box.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/download-limit.png` })
})

test('a running Local API shows what went through it', async ({ page }) => {
  await boot(page)
  await page.getByRole('button', { name: 'Voice & Remote', exact: true }).first().click()
  for (let i = 0; i < 20; i++) {
    const collapsed = page.locator('main button[aria-expanded="false"]:visible')
    if ((await collapsed.count()) === 0) break
    await collapsed.first().click()
    await page.waitForTimeout(150)
  }
  const usage = page.getByTestId('local-api-usage')
  await expect(usage).toBeVisible()
  await expect(usage.getByText('1,234 (2 failed)')).toBeVisible()
  await expect(usage.getByText('ollama/qwen3:8b, just now')).toBeVisible()
  await usage.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/local-api-usage.png` })
})
