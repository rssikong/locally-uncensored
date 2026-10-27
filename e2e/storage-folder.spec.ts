import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'

/**
 * Discord feature request "Storage Management" (3.0.8) on the real Settings
 * page, with the backend stubbed (e2e/support/tauri-mock.ts): Settings,
 * Storage, Storage folder. Check shows the plan, a move asks first and then
 * reports each part.
 * Screenshots land in test-results/308-wuensche for the owner's design check.
 *
 * Run: npx playwright test e2e/storage-folder.spec.ts
 */

const SHOTS = resolve(process.cwd(), 'test-results/308-wuensche')
const GB = 1024 ** 3

async function bootStorage(page: Page) {
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME, platform: 'windows' as const })
  await page.addInitScript(({ GB }) => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> }
      __storageCalls: Array<{ cmd: string; args: unknown }>
    }
    w.__storageCalls = []
    const C = { mount: 'C:\\', free: 18 * GB, total: 476 * GB, system: true }
    const D = { mount: 'D:\\', free: 612 * GB, total: 931 * GB, system: false }
    const tree = (files: number, bytes: number, conflicts = 0) => ({ files, bytes, crossBytes: bytes, sameVolume: false, conflicts })
    const invoke = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
      if (cmd.startsWith('storage_')) w.__storageCalls.push({ cmd, args })
      if (cmd === 'storage_status') {
        return {
          root: null, comfyHere: true, comfyPath: 'C:\\Users\\Sam\\ComfyUI', comfyDownloadsInModelFolder: false, moving: false, example: 'D:\\LU',
          places: [
            { id: 'models', path: 'C:\\Users\\Sam\\AppData\\Roaming\\Locally Uncensored\\models', drive: C },
            { id: 'comfyModels', path: 'C:\\Users\\Sam\\ComfyUI\\models', drive: C },
            { id: 'gallery', path: 'C:\\Users\\Sam\\ComfyUI\\output', drive: C },
            { id: 'runtime', path: 'C:\\Users\\Sam\\AppData\\Local\\lu-labs', drive: C },
          ],
        }
      }
      if (cmd === 'storage_plan') {
        return {
          root: 'D:\\LU', modelsDir: 'D:\\LU\\Models', galleryDir: 'D:\\LU\\Gallery', runtimeDir: 'D:\\LU\\Runtime',
          drive: D, enoughSpace: true, blocker: null, stops: ['ComfyUI', 'the LU Engine'], crossBytes: 118 * GB,
          items: [
            { id: 'luEngine', group: 'models', from: 'C:\\Users\\Sam\\AppData\\Roaming\\Locally Uncensored\\models', to: 'D:\\LU\\Models', plan: tree(4, 31 * GB) },
            { id: 'comfy:checkpoints', group: 'comfyModels', from: 'C:\\Users\\Sam\\ComfyUI\\models\\checkpoints', to: 'D:\\LU\\Models\\checkpoints', plan: tree(6, 52 * GB) },
            { id: 'comfy:loras', group: 'comfyModels', from: 'C:\\Users\\Sam\\ComfyUI\\models\\loras', to: 'D:\\LU\\Models\\loras', plan: tree(23, 9 * GB, 2) },
            { id: 'gallery', group: 'gallery', from: 'C:\\Users\\Sam\\ComfyUI\\output', to: 'D:\\LU\\Gallery', plan: tree(1412, 14 * GB) },
            { id: 'runtime:voice', group: 'runtime', from: 'C:\\Users\\Sam\\AppData\\Local\\lu-labs\\voice', to: 'D:\\LU\\Runtime\\voice', plan: tree(1, 12 * GB) },
          ],
        }
      }
      if (cmd === 'storage_apply') {
        const r = (movedFiles: number, movedBytes: number, kept = 0) => ({ movedFiles, movedBytes, kept, failed: [], failedCount: 0, cancelled: false })
        return {
          root: 'D:\\LU', modelsDir: 'D:\\LU\\Models', galleryDir: 'D:\\LU\\Gallery', runtimeDir: 'D:\\LU\\Runtime',
          moved: [
            { id: 'luEngine', group: 'models', from: '', to: '', report: r(4, 31 * GB) },
            { id: 'comfy:checkpoints', group: 'comfyModels', from: '', to: '', report: r(6, 52 * GB) },
            { id: 'comfy:loras', group: 'comfyModels', from: '', to: '', report: r(21, 9 * GB, 2) },
            { id: 'gallery', group: 'gallery', from: '', to: '', report: r(1412, 14 * GB) },
          ],
          runtime: [{ kind: 'voice', from: 'C:\\Users\\Sam\\AppData\\Local\\lu-labs\\voice', to: 'D:\\LU\\Runtime\\voice', status: 'moved', detail: '' }],
          stopped: ['ComfyUI', 'the LU Engine'], cancelled: false,
        }
      }
      return invoke(cmd, args)
    }
  }, { GB })
  await seedOnboardingDone(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).first().click()
  await page.getByRole('button', { name: 'AI Backends', exact: true }).first().click()
  const storage = page.getByRole('button', { name: /^Storage/ }).first()
  if ((await storage.getAttribute('aria-expanded')) === 'false') await storage.click()
}

test('Storage folder: where things are, the plan, the confirmation, the report', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await bootStorage(page)
  const row = page.getByTestId('storage-folder-setting')
  await expect(row.getByTestId('storage-places')).toContainText('C:\\Users\\Sam\\ComfyUI\\output')
  await expect(row.getByText(/· system drive/).first()).toBeVisible()
  await row.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/storage-1-now.png` })

  await page.getByLabel('Storage folder').fill('D:\\LU')
  await row.getByTestId('storage-check').click()
  const plan = row.getByTestId('storage-plan')
  await expect(plan).toContainText('Models: D:\\LU\\Models')
  await expect(plan).toContainText('copied to the new drive, checked, then removed from the old one')
  await expect(plan).toContainText('2 files are already in the new folder and stay in both places')
  await expect(plan).toContainText('The move copies 118.0 GB to D:\\, which has 612.0 GB free.')
  const calls = () => page.evaluate(() => (window as unknown as { __storageCalls: Array<{ cmd: string }> }).__storageCalls.map((c) => c.cmd))
  expect((await calls()).filter((c) => c !== 'storage_status')).toEqual(['storage_plan'])
  await plan.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/storage-2-plan.png` })

  await row.getByTestId('storage-move').click()
  const confirm = row.getByTestId('storage-confirm')
  await expect(confirm).toContainText('LU stops ComfyUI and the LU Engine first')
  await expect(confirm).toContainText('Nothing else is deleted')
  expect((await calls()).filter((c) => c !== 'storage_status')).toEqual(['storage_plan'])
  await confirm.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/storage-3-confirm.png` })

  await row.getByTestId('storage-move-now').click()
  const report = row.getByTestId('storage-report')
  await expect(report).toContainText('From now on LU puts new files in D:\\LU.')
  await expect(report).toContainText('Gallery pictures and videos: 1412 files moved (14.0 GB).')
  await expect(report).toContainText('ComfyUI models: 27 files moved (61.0 GB). 2 files were already there and stay in both places.')
  await expect(report).toContainText('Voice engine: moved to D:\\LU\\Runtime\\voice.')
  const applied = await page.evaluate(() => (window as unknown as { __storageCalls: Array<{ cmd: string; args: unknown }> }).__storageCalls.find((c) => c.cmd === 'storage_apply')?.args)
  expect(applied).toEqual({ root: 'D:\\LU', moveFiles: true, skip: [] })
  // The LU Engine row below reads the new model folder.
  await expect(page.getByLabel('LU Engine folder')).toHaveValue('D:\\LU\\Models')
  await report.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/storage-4-report.png` })
})
