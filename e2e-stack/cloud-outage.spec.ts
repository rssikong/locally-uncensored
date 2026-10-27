import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tauriMockInit, DEFAULT_MODEL_NAME, DEFAULT_ASSISTANT_REPLY } from '../e2e/support/tauri-mock'
import { seedOnboardingDone, cloudSwitch } from '../e2e/support/cloud-mock'

/**
 * 3.0.8, A28: the LU Cloud outage line, the desktop UI against the local web
 * stack with the switch of the server set (LU_OUTAGE_DESKTOP). The status
 * route, the sign in and the model list are the server's own. What fails is
 * the way to the cloud: the chat and job requests are cut in the browser, the
 * way a customer meets an outage, while the status route still answers.
 *
 * The stack is started by the caller with the switch on and a sentence, and
 * restarted from here (`stack.mjs web`) with a new sentence and then off.
 *
 * Run: LU_STACK_WEB_APP=<web app folder> LU_OUTAGE_PROOF=<dir> \
 *      node scripts/create-chat-stack-probe.mjs <web repo> e2e-stack/cloud-outage.spec.ts
 */
const CLOUD = process.env.LU_STACK_CLOUD ?? ''
const PROOF = process.env.LU_OUTAGE_PROOF
/** The web app folder of the web repository, where its stack script runs. */
const WEB_APP = process.env.LU_STACK_WEB_APP ?? ''
const FIRST = process.env.LU_OUTAGE_DESKTOP_MESSAGE ?? ''
const SECOND = 'LU Cloud is back for most requests, video is still slow (test).'
type Account = { email: string; password: string }
const RELEASED = JSON.parse(process.env.LU_STACK_RELEASED ?? '{}') as Account
const FIT = /Mistral Small 3\.2 24B/

const banner = (page: Page) => page.getByTestId('cloud-outage-banner')

async function shot(page: Page, name: string) {
  if (!PROOF) return
  mkdirSync(PROOF, { recursive: true })
  await page.screenshot({ path: join(PROOF, `${name}.png`) })
}

/** Restarts the web server of the stack with the switch as given. */
function restartWeb(env: Record<string, string>) {
  execFileSync(process.execPath, ['e2e-local/create-chat/stack.mjs', 'web', 'allowlist'], {
    cwd: WEB_APP,
    env: { ...process.env, ...env },
    stdio: 'pipe',
  })
}

async function signIn(page: Page, account: Account) {
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME })
  await seedOnboardingDone(page)
  await page.goto('/')
  await cloudSwitch(page).click()
  await page.getByRole('button', { name: /Already subscribed\? Sign in/i }).click()
  await page.getByPlaceholder('Email').fill(account.email)
  await page.getByPlaceholder('Password').fill(account.password)
  await page.getByRole('button', { name: /^Sign in$/i }).click()
  await expect(cloudSwitch(page)).toBeChecked({ timeout: 30_000 })
}

async function newChat(page: Page) {
  await page.getByRole('button', { name: /New Chat/i }).first().click()
  await page.getByRole('button', { name: 'Select chat model', exact: true }).click()
  await page.getByRole('button', { name: FIT }).first().click()
}

async function ask(page: Page, text: string) {
  const composer = page.locator('textarea').first()
  await expect(composer).toBeEnabled({ timeout: 30_000 })
  await composer.fill(text)
  await composer.press('Enter')
}

/** The cloud is cut: every chat and job request fails on the way. Under this
 *  stack the chat to the cloud's name goes through the app's proxy, which the
 *  Tauri mock answers, so the cut is made there too: the proxy fails the way
 *  the real one does when the far side is gone. */
async function cutTheCloud(page: Page) {
  await page.evaluate((cloud) => {
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: { url?: string }) => Promise<unknown> } }
    const inner = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = (cmd, args) =>
      cmd.startsWith('proxy_localhost') && (args?.url ?? '').startsWith(`${cloud}/api/inference/`)
        ? Promise.reject('proxy_localhost: error sending request for url')
        : inner(cmd, args)
  }, CLOUD)
  await page.route(`${CLOUD}/api/inference/v1/chat/completions`, (route) => route.abort('failed'))
  await page.route((url) => url.href.startsWith(CLOUD) && url.pathname.startsWith('/api/jobs'), (route) => (route.request().method() === 'GET' ? route.continue() : route.abort('failed')))
}

test('signed out: no line, even with the switch on', async ({ page }) => {
  const asked: string[] = []
  page.on('request', (req) => { if (req.url().includes('/api/app/status')) asked.push(req.url()) })
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME })
  await seedOnboardingDone(page)
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(3_000)
  await expect(banner(page)).toHaveCount(0)
  expect(asked).toEqual([])
  await shot(page, '01-abgemeldet-kein-banner')
})

test('signed in: the line, the sentence in chat, agent and Create, a new sentence, then off', async ({ page }) => {
  test.setTimeout(600_000)
  expect(FIRST, 'start the stack with LU_OUTAGE_DESKTOP=1 and LU_OUTAGE_DESKTOP_MESSAGE').not.toBe('')
  await signIn(page, RELEASED)

  // At start: the line with the server's sentence.
  await expect(banner(page)).toHaveText(FIRST, { timeout: 20_000 })
  await shot(page, '02-banner-nach-start')

  // Closable, and it stays closed for the same sentence.
  await banner(page).getByRole('button').click()
  await expect(banner(page)).toHaveCount(0)
  await shot(page, '03-banner-geschlossen')

  // Chat: the cloud fails, the sentence instead of a raw error.
  await cutTheCloud(page)
  await newChat(page)
  await ask(page, 'Hello, are you there?')
  const lastAnswer = page.getByRole('main').getByText(FIRST).last()
  await expect(lastAnswer).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('main').getByText(/Error: |Failed to fetch/)).toHaveCount(0)
  await expect(banner(page)).toHaveCount(0)
  await shot(page, '04-chat-meldung')

  // Agent: the same sentence instead of "Agent error".
  await page.getByRole('button', { name: /New Chat/i }).first().click()
  const toggle = page.getByRole('main').getByRole('button', { name: 'Agent', exact: true })
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  await toggle.click()
  const sandbox = page.getByRole('button', { name: /^Sandbox/ })
  if (await sandbox.isVisible({ timeout: 5_000 }).catch(() => false)) await sandbox.click()
  await ask(page, 'List the files in my sandbox.')
  await expect(page.getByRole('main').getByText(FIRST).last()).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole('main').getByText(/Agent error/)).toHaveCount(0)
  await shot(page, '05-agent-meldung')

  // Create: the same sentence instead of the raw error.
  await page.getByRole('button', { name: /^Create$/ }).first().click()
  const composer = page.locator('textarea').first()
  await expect(composer).toBeVisible({ timeout: 20_000 })
  await composer.fill('a lighthouse at dusk, cinematic')
  await page.getByRole('button', { name: /^Create$/ }).last().click()
  await expect(page.getByText(FIRST).last()).toBeVisible({ timeout: 60_000 })
  await shot(page, '06-create-meldung')

  // A new sentence on the server: the closed line comes back with it, asked
  // right after the next failed request.
  restartWeb({ LU_OUTAGE_DESKTOP: '1', LU_OUTAGE_DESKTOP_MESSAGE: SECOND })
  await page.waitForTimeout(16_000) // the gap between two questions
  await page.getByRole('button', { name: /^Create$/ }).last().click()
  await expect(banner(page)).toHaveText(SECOND, { timeout: 60_000 })
  await shot(page, '07-neuer-text-banner-wieder-da')

  // Off: the line goes, and a failure reads as before.
  restartWeb({ LU_OUTAGE_DESKTOP: '0', LU_OUTAGE_DESKTOP_MESSAGE: '' })
  await page.waitForTimeout(16_000)
  await page.getByRole('button', { name: /^Create$/ }).last().click()
  await expect(banner(page)).toHaveCount(0, { timeout: 60_000 })
  await expect(page.getByText(/Could not reach the LU Cloud server/).last()).toBeVisible({ timeout: 60_000 })
  await shot(page, '08-aus-kein-banner-alter-fehler')

  // Back on for the next run of this walk.
  restartWeb({ LU_OUTAGE_DESKTOP: '1', LU_OUTAGE_DESKTOP_MESSAGE: FIRST })
})
