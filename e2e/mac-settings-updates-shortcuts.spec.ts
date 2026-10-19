import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from './support/tauri-mock'
import { routeCloud, seedOnboardingDone, cloudSwitch } from './support/cloud-mock'

/**
 * Fehlerkontrolle Mac 2, Funde 4, 5, 6 and 8, in the running app.
 *
 * A Mac reads its own hardware, its own data folder, a calm sentence when a
 * release has no Mac build, and its own keys. Each test has its Windows
 * counterpart at the bottom: the same screens there read what they always did.
 */

const BASE: TauriMockOptions = { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME }

/** What the updater plugin answers for a release that lacks this platform. */
const noBuildFor = (target: string) => `the platform \`${target}\` was not found in the response \`platforms\` object`

interface Machine {
  ramGb: number
  chip: { vendor: string; name: string; memory_mib: number | null; shared_memory_mib: number | null } | null
  logDir: string
  updaterError: string
}

const MAC_BOOK: Machine = {
  // system_info is left a little short on purpose: the readout must come from
  // the probe's shared_memory_mib, as the Rust side now reports it.
  ramGb: 15,
  chip: { vendor: 'apple', name: 'Apple M2 Pro', memory_mib: null, shared_memory_mib: 16 * 1024 },
  logDir: '/Users/ada/Library/Application Support/lu-labs/logs',
  updaterError: noBuildFor('darwin-aarch64'),
}

const WINDOWS_BOX: Machine = {
  ramGb: 32,
  chip: { vendor: 'nvidia', name: 'NVIDIA GeForce RTX 3060', memory_mib: 12288, shared_memory_mib: null },
  logDir: 'C:\\Users\\ada\\AppData\\Local\\lu-labs\\logs',
  updaterError: noBuildFor('windows-x86_64'),
}

/**
 * The hardware probes, the log location and the updater, answered for one
 * machine. Wraps the router the Tauri mock installed, so it must be added
 * after `tauriMockInit` (init scripts run in the order they were added).
 */
async function giveMachine(page: Page, machine: Machine) {
  await page.addInitScript((m: Machine) => {
    const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown, o?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__
    if (!internals) return
    const inner = internals.invoke.bind(internals)
    internals.invoke = (cmd: string, args?: unknown, o?: unknown) => {
      if (cmd === 'system_info') return Promise.resolve({ totalMemory: m.ramGb * 1_073_741_824 })
      if (cmd === 'detect_gpus') return Promise.resolve(m.chip ? [{ index: 0, source: 'e2e', ...m.chip }] : [])
      if (cmd === 'log_file_path') return Promise.resolve({ dir: m.logDir, file: `${m.logDir}/lu.log`, exists: false, size_bytes: 0 })
      if (cmd === 'plugin:updater|check') return Promise.reject(m.updaterError)
      return inner(cmd, args, o)
    }
  }, machine)
}

async function openApp(page: Page, platform: 'mac' | 'windows') {
  await page.addInitScript(tauriMockInit, { ...BASE, platform })
  await giveMachine(page, platform === 'mac' ? MAC_BOOK : WINDOWS_BOX)
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
}

async function openSettings(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'General', exact: true }).click()
}

/** Opens a folded Settings section by its title and returns its body. */
async function openSection(page: Page, title: string) {
  const head = page.locator('button[aria-controls]').filter({ hasText: new RegExp(`^${title.replace(/[()]/g, '\\$&')}$`) })
  await head.scrollIntoViewIfNeeded()
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  const id = await head.getAttribute('aria-controls')
  const body = page.locator(`[id="${id}"]`)
  await expect(body).toBeVisible()
  return body
}

test.describe('a Mac', () => {
  test('Hardware is a readout: chip, shared memory, Metal, and nothing to pick', async ({ page }) => {
    await openApp(page, 'mac')
    await openSettings(page)
    await expect(page.locator('button[aria-controls]').filter({ hasText: 'GPU picker' })).toHaveCount(0)

    const body = await openSection(page, 'Hardware')
    await expect(body.getByTestId('apple-hardware-chip')).toHaveText('Apple M2 Pro')
    await expect(body.getByTestId('apple-hardware-memory')).toHaveText('16 GB, shared by processor and graphics')
    await expect(body.getByTestId('apple-hardware-graphics')).toHaveText('Metal')
    await expect(body.locator('input, select, button')).toHaveCount(0)
    await expect(body).not.toContainText(/CUDA|NVIDIA|VRAM|Vendor/)
  })

  test('Privacy names the real data folder of this Mac', async ({ page }) => {
    await openApp(page, 'mac')
    await openSettings(page)
    const body = await openSection(page, 'Privacy')
    await expect(body.getByTestId('data-folder-path')).toHaveText('/Users/ada/Library/Application Support/lu-labs')
    await expect(body.getByTestId('data-folder-models')).toHaveText('Locally Uncensored/models')
    await expect(body).not.toContainText('%APPDATA%')
    await expect(body).not.toContainText('on Windows')
  })

  test('a release without a Mac build: one calm sentence, no connection advice, no badge', async ({ page }) => {
    await openApp(page, 'mac')
    await openSettings(page)
    const body = await openSection(page, 'Updates')
    await body.getByRole('button', { name: 'Check for updates' }).click()
    await expect(body.getByTestId('update-no-build')).toHaveText('No update for this Mac yet.')
    await expect(body.getByTestId('update-check-failed')).toHaveCount(0)
    await expect(body).not.toContainText('Check your connection')
    await expect(body).not.toContainText('You are on the latest version.')
    // Nothing was found, so nothing is offered anywhere.
    await expect(body.getByRole('button', { name: /Download|Restart Now/ })).toHaveCount(0)
  })

  test('the shortcut help says Command, and Command is what the app answers to', async ({ page }) => {
    await openApp(page, 'mac')

    const help = page.getByRole('dialog', { name: 'Keyboard Shortcuts' })
    // The key listener mounts a moment after the shell is drawn, and a press
    // before that is lost. Press until the help stands.
    await expect(async () => {
      await page.keyboard.press('Meta+/')
      await expect(help).toBeVisible({ timeout: 1500 })
    }).toPass()
    await expect(help.locator('kbd')).toHaveText(['⌘K', '⌘N', '⌘L', '⌘E', '⇧⌘D', '⌘/', 'Escape'])
    await expect(help).not.toContainText('Ctrl')
    await page.keyboard.press('Escape')
    await expect(help).toHaveCount(0)

    await page.keyboard.press('Meta+k')
    const search = page.getByRole('combobox', { name: 'Search actions' })
    await expect(search).toBeVisible()
    const labels = await page.getByRole('listbox', { name: 'Actions' }).locator('kbd').allTextContents()
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.join(' ')).not.toMatch(/Ctrl|Shift|Alt/)
    expect(labels).toContain('⌘N')
  })
})

test.describe('WINDOWS CONTROL: the same screens read what they always did', () => {
  test('Hardware is the GPU picker', async ({ page }) => {
    await openApp(page, 'windows')
    await openSettings(page)
    const body = await openSection(page, 'Hardware (GPU picker)')
    await expect(body.getByText('NVIDIA (CUDA_VISIBLE_DEVICES)')).toBeVisible()
    await expect(body.getByText('NVIDIA GeForce RTX 3060')).toBeVisible()
    await expect(body.getByTestId('apple-hardware')).toHaveCount(0)
    await expect(body.locator('input[name="gpu-vendor"]')).toHaveCount(4)
  })

  // Until 3.0.7 this sentence named %APPDATA%/Locally Uncensored as the one
  // folder and said "LU writes nothing else". Neither held: os_paths::data_dir()
  // is data_local_dir() joined with lu-labs, and only the chat backup
  // (system::persistent_dir) and the engine's chat models
  // (os_paths::builtin_models_dir) sit under %APPDATA%\Locally Uncensored.
  test('Privacy names the Windows folders', async ({ page }) => {
    await openApp(page, 'windows')
    await openSettings(page)
    const body = await openSection(page, 'Privacy')
    await expect(body).toContainText('Conversations, memories, and generated media live in %LOCALAPPDATA%\\lu-labs on Windows. Back up the folder, move it between machines, or delete it.')
    await expect(body.getByTestId('data-folder-path')).toHaveText('%LOCALAPPDATA%\\lu-labs')
    await expect(body.getByTestId('data-folder-models')).toHaveText('%APPDATA%\\Locally Uncensored')
    await expect(body).not.toContainText('LU writes nothing else')
    await expect(body).not.toContainText('Application Support')
  })

  test('the same updater answer is a failed check there', async ({ page }) => {
    await openApp(page, 'windows')
    await openSettings(page)
    const body = await openSection(page, 'Updates')
    await body.getByRole('button', { name: 'Check for updates' }).click()
    await expect(body.getByTestId('update-check-failed')).toHaveText('Could not check for updates. Check your connection and try again.')
    await expect(body.getByTestId('update-no-build')).toHaveCount(0)
  })

  test('the shortcut help says Ctrl, and Ctrl is what the app answers to', async ({ page }) => {
    await openApp(page, 'windows')
    const help = page.getByRole('dialog', { name: 'Keyboard Shortcuts' })
    // The key listener mounts a moment after the shell is drawn, and a press
    // before that is lost. Press until the help stands.
    await expect(async () => {
      await page.keyboard.press('Control+/')
      await expect(help).toBeVisible({ timeout: 1500 })
    }).toPass()
    await expect(help.locator('kbd')).toHaveText(['Ctrl+K', 'Ctrl+N', 'Ctrl+L', 'Ctrl+E', 'Ctrl+Shift+D', 'Ctrl+/', 'Escape'])
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('combobox', { name: 'Search actions' })).toBeVisible()
    const labels = await page.getByRole('listbox', { name: 'Actions' }).locator('kbd').allTextContents()
    expect(labels).toContain('Ctrl+N')
  })
})
