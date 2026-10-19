import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_MODEL_NAME, DEFAULT_ASSISTANT_REPLY } from './support/tauri-mock'
import { seedOnboardingDone, routeCloud, signInViaGate, cloudSwitch } from './support/cloud-mock'
import { mkdirSync } from 'node:fs'

/**
 * Create in chat, desktop, Cloud mode (P8).
 *
 * The server decides who gets it (features.createChat in /api/me) and with
 * which model (create_in_chat in the model list). The model proposes an order,
 * the customer approves it by click or by word, only then a job is booked, and
 * every booking call names the chat as its origin.
 */
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
const PROOF = process.env.LU_CREATE_CHAT_PROOF

interface Wire { chats: Array<Record<string, unknown>>; jobs: Array<{ origin: string | null; body: Record<string, unknown> }>; cancels: number }

const sse = (chunks: unknown[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
const say = (text: string) => sse([
  { choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
])
const order = (id: string) => sse([
  { choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name: 'create_order', arguments: JSON.stringify({ items: [{ intent: 'image', prompt: 'a red fox in the snow' }] }) } }] }, finish_reason: null }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
])

async function boot(page: Page, opts: { createChat?: boolean; jobStatus?: () => string } = {}): Promise<Wire> {
  const wire: Wire = { chats: [], jobs: [], cancels: 0 }
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME })
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true, paidPlan: true, tierCatalog: true, createChat: opts.createChat })
  await page.route('**/api/inference/v1/chat/completions', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(route.request().postData() ?? '{}') as { messages: Array<{ role: string; content: unknown }>; tools?: unknown[] }
    wire.chats.push(body)
    const last = body.messages[body.messages.length - 1]
    const text = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '')
    let reply: string
    if (last?.role === 'tool') reply = say('Here is the order. Say yes or press Start.')
    else if (/red fox/i.test(text) && body.tools?.length) reply = order(`call-${wire.chats.length}`)
    else if (/is finished/i.test(text)) reply = say('Your fox is ready.')
    else reply = say('Plain answer.')
    return route.fulfill({ status: 200, headers: cors, contentType: 'text/event-stream', body: reply })
  })
  await page.route('https://lu-labs.ai/api/jobs', async (route) => {
    const req = route.request()
    if (req.method() !== 'POST') return route.fallback()
    wire.jobs.push({ origin: await req.headerValue('x-lu-origin'), body: JSON.parse(req.postData() ?? '{}') })
    return route.fallback()
  })
  await page.route('https://lu-labs.ai/api/jobs/job-e2e-1/cancel', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    wire.cancels += 1
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ status: 'canceled', refunded: true }) })
  })
  if (opts.jobStatus) {
    await page.route('https://lu-labs.ai/api/jobs/job-e2e-1', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      const status = opts.jobStatus!()
      if (status === 'succeeded') return route.fallback()
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ job: {
        id: 'job-e2e-1', kind: 'image', model: 'z-image-turbo', provider: null, status, result_url: null, attestation: null,
        cost_units: 0, created_at: new Date().toISOString(), completed_at: null, error: null,
      } }) })
    })
  }
  await page.goto('/')
  await signInViaGate(page)
  await expect(cloudSwitch(page)).toBeChecked()
  await page.getByRole('button', { name: /New Chat/i }).first().click()
  return wire
}

async function pick(page: Page, model: RegExp) {
  await page.getByRole('button', { name: 'Select chat model', exact: true }).click()
  await page.getByRole('button', { name: model }).first().click()
}

const plugins = (page: Page) => page.getByRole('main').getByRole('button', { name: 'Plugins' }).first()
const createSwitch = (page: Page) => page.getByTestId('plugins-create-switch')

async function switchCreateOn(page: Page) {
  await plugins(page).click()
  await expect(createSwitch(page)).toBeVisible()
  await createSwitch(page).click()
  await expect(page.getByTestId('plugins-dot-create')).toBeVisible()
  await page.keyboard.press('Escape')
}

async function ask(page: Page, text: string) {
  const composer = page.locator('textarea').first()
  await expect(composer).toBeEnabled({ timeout: 20_000 })
  await composer.fill(text)
  // The turn before has to be over: a composer that is still generating
  // ignores Enter.
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled({ timeout: 20_000 })
  await composer.press('Enter')
}

async function shot(page: Page, name: string) {
  if (!PROOF) return
  mkdirSync(PROOF, { recursive: true })
  await page.screenshot({ path: `${PROOF}/${name}.png` })
}

test('a server from before Create in chat: no switch, no tools, no word in the prompt', async ({ page }) => {
  const wire = await boot(page)
  await pick(page, /GLM 5\.3 Flash/)
  await plugins(page).click()
  // The menu is open (Chat Tools, the old marker here, have no row since 3.0.7).
  await expect(page.getByText('Caveman', { exact: false }).first()).toBeVisible()
  await expect(createSwitch(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await ask(page, 'make an image of a red fox in the snow')
  await expect(page.getByText('Plain answer.')).toBeVisible({ timeout: 20_000 })
  const sent = JSON.stringify(wire.chats)
  expect(sent).not.toContain('create_order')
  expect(sent).not.toContain('create_options')
  expect(sent).not.toMatch(/Create switch|Plugins menu/)
  expect(wire.jobs).toEqual([])
})

test('an account the server does not release: exactly as before', async ({ page }) => {
  const wire = await boot(page, { createChat: false })
  await pick(page, /GLM 5\.3 Flash/)
  await plugins(page).click()
  await expect(createSwitch(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await ask(page, 'make an image of a red fox in the snow')
  await expect(page.getByText('Plain answer.')).toBeVisible({ timeout: 20_000 })
  expect(JSON.stringify(wire.chats)).not.toContain('create_order')
})

test('a model the server does not release shows the switch greyed, with a short reason', async ({ page }) => {
  await boot(page, { createChat: true })
  await pick(page, /Qwen3 30B/)
  await plugins(page).click()
  await expect(createSwitch(page)).toBeVisible()
  await expect(createSwitch(page)).toBeDisabled()
  await expect(page.getByTestId('plugins-create-reason')).toHaveText(/\S/)
  await shot(page, 'switch-greyed')
  // Nothing sits in or above the composer.
  const composer = page.locator('textarea').first()
  await expect(composer).toBeVisible()
})

test('order, approval by click, result, report, gallery', async ({ page }) => {
  const wire = await boot(page, { createChat: true })
  await pick(page, /GLM 5\.3 Flash/)
  await switchCreateOn(page)
  await ask(page, 'make an image of a red fox in the snow')

  const card = page.getByTestId('create-order').first()
  await expect(card).toBeVisible({ timeout: 30_000 })
  await expect(card.getByRole('button', { name: /^Start/ })).toBeVisible()
  await expect(card).toContainText(/credits/i)
  // Laid out, not booked.
  expect(wire.jobs).toEqual([])
  const first = wire.chats[0] as { tools: Array<{ function: { name: string } }>; messages: Array<{ role: string; content: string }> }
  expect(first.tools.map((t) => t.function.name)).toEqual(expect.arrayContaining(['create_options', 'create_order']))
  await shot(page, 'order-awaiting')

  await card.getByRole('button', { name: /^Start/ }).click()
  await expect(card.locator('img').first()).toBeVisible({ timeout: 30_000 })
  expect(wire.jobs).toHaveLength(1)
  expect(wire.jobs[0].origin).toBe('create-chat')
  expect(wire.jobs[0].body.prompt).toBe('a red fox in the snow')
  // The model hears about it and answers; the report itself is not shown.
  await expect(page.getByText('Your fox is ready.')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/\[Create report\]|is finished/)).toHaveCount(0)
  await shot(page, 'order-done')

  // The big view of the picture shows the prompt of its run, with Copy.
  await card.getByRole('button', { name: 'Open image' }).click()
  const big = page.getByRole('dialog', { name: 'Image preview' })
  await expect(big.getByTestId('prompt-text')).toHaveText('a red fox in the snow')
  await expect(big.getByRole('button', { name: 'Copy prompt' })).toBeVisible()
  // The view lies over the whole app: its prompt is not behind the composer
  // and its Close button is not behind the title bar.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await big.getByRole('button', { name: 'Copy prompt' }).click()
  await expect(big.getByRole('button', { name: 'Copy prompt' })).toHaveText('Copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('a red fox in the snow')
  await shot(page, 'order-big-view')
  await big.getByRole('button', { name: 'Close' }).click()
  await expect(big).toHaveCount(0)

  await page.getByRole('button', { name: /^Create$/ }).click()
  await page.getByRole('button', { name: 'Open the gallery' }).click()
  await expect(page.locator('aside').filter({ hasText: 'Gallery' }).locator('.group').first()).toBeVisible({ timeout: 15_000 })
})

test('approval by word: "yes" starts the order without a model turn in between', async ({ page }) => {
  const wire = await boot(page, { createChat: true })
  await pick(page, /GLM 5\.3 Flash/)
  await switchCreateOn(page)
  await ask(page, 'make an image of a red fox in the snow')
  const card = page.getByTestId('create-order').first()
  await expect(card.getByRole('button', { name: /^Start/ })).toBeVisible({ timeout: 30_000 })
  const before = wire.chats.length
  // The composer's double-fire guard (700 ms) holds only for the same message
  // since 3.0.7, so "yes" would go out at once. The wait stays as a margin.
  await page.waitForTimeout(800)
  await ask(page, 'yes')
  await expect(card.locator('img').first()).toBeVisible({ timeout: 30_000 })
  expect(wire.jobs).toHaveLength(1)
  expect(wire.jobs[0].origin).toBe('create-chat')
  // The "yes" itself is not sent to the model as a question of its own.
  const asked = wire.chats.slice(before).filter((c) => {
    const m = (c as { messages: Array<{ role: string; content: unknown }> }).messages
    return m[m.length - 1].role === 'user' && m[m.length - 1].content === 'yes'
  })
  expect(asked).toEqual([])
})

test('"Not now" books nothing', async ({ page }) => {
  const wire = await boot(page, { createChat: true })
  await pick(page, /GLM 5\.3 Flash/)
  await switchCreateOn(page)
  await ask(page, 'make an image of a red fox in the snow')
  const card = page.getByTestId('create-order').first()
  await card.getByRole('button', { name: 'Not now' }).click({ timeout: 30_000 })
  await expect(card).toContainText('Not started')
  expect(wire.jobs).toEqual([])
})

test('Stop cancels the running job', async ({ page }) => {
  const wire = await boot(page, { createChat: true, jobStatus: () => 'processing' })
  await pick(page, /GLM 5\.3 Flash/)
  await switchCreateOn(page)
  await ask(page, 'make an image of a red fox in the snow')
  const card = page.getByTestId('create-order').first()
  await card.getByRole('button', { name: /^Start/ }).click({ timeout: 30_000 })
  await shot(page, 'order-running')
  await card.getByRole('button', { name: 'Stop' }).click({ timeout: 30_000 })
  await expect(card).toContainText('Stopped', { timeout: 30_000 })
  expect(wire.cancels).toBeGreaterThan(0)
})

test('Local mode has no Create switch', async ({ page }) => {
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME })
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, createChat: true })
  await page.goto('/')
  await page.getByRole('button', { name: /New Chat/i }).first().click()
  await plugins(page).click()
  await expect(createSwitch(page)).toHaveCount(0)
})

// Proof pictures for the build book. Only with LU_CREATE_CHAT_PROOF set.
for (const theme of ['dark', 'light'] as const) {
  for (const [label, width, height] of [['wide', 1440, 900], ['narrow', 760, 820]] as const) {
    test(`proof ${theme} ${label}`, async ({ page }) => {
      test.skip(!PROOF, 'pictures only on request')
      await page.setViewportSize({ width, height })
      await boot(page, { createChat: true })
      // The app starts dark; the header button switches.
      if (theme === 'light') await page.getByRole('button', { name: 'Light Mode' }).click()
      await pick(page, /GLM 5\.3 Flash/)
      await plugins(page).click()
      await expect(createSwitch(page)).toBeVisible()
      await page.waitForTimeout(600)
      await shot(page, `${theme}-${label}-1-switch`)
      await createSwitch(page).click()
      await page.keyboard.press('Escape')
      await ask(page, 'make an image of a red fox in the snow')
      const card = page.getByTestId('create-order').first()
      await expect(card.getByRole('button', { name: /^Start/ })).toBeVisible({ timeout: 30_000 })
      await page.waitForTimeout(400)
      await shot(page, `${theme}-${label}-2-order`)
      await card.getByRole('button', { name: /^Start/ }).click()
      await expect(page.getByText('Your fox is ready.')).toBeVisible({ timeout: 30_000 })
      await page.waitForTimeout(400)
      await shot(page, `${theme}-${label}-3-done`)
    })
  }
}

test('Regenerate after the report asks the model again and books nothing', async ({ page }) => {
  const wire = await boot(page, { createChat: true })
  await pick(page, /GLM 5\.3 Flash/)
  await switchCreateOn(page)
  await ask(page, 'make an image of a red fox in the snow')
  const card = page.getByTestId('create-order').first()
  await card.getByRole('button', { name: /^Start/ }).click({ timeout: 30_000 })
  await expect(page.getByText('Your fox is ready.')).toBeVisible({ timeout: 30_000 })
  const chats = wire.chats.length

  await page.getByRole('button', { name: 'Regenerate response' }).last().click()
  await expect.poll(() => wire.chats.length, { timeout: 20_000 }).toBeGreaterThan(chats)
  await expect(page.getByText('Your fox is ready.')).toBeVisible({ timeout: 30_000 })
  // The same report went back, not the first question: no second order, no second job.
  const again = wire.chats[wire.chats.length - 1] as { messages: Array<{ role: string; content: unknown }> }
  const last = again.messages[again.messages.length - 1]
  expect(last.role).toBe('user')
  expect(String(last.content)).toMatch(/is finished/)
  await expect(page.getByTestId('create-order')).toHaveCount(1)
  await expect(page.getByText('Your fox is ready.')).toHaveCount(1)
  expect(wire.jobs).toHaveLength(1)
  // The finished card keeps its result.
  await expect(card).toContainText('Done')
})

test('attachments: a clip over 20 MB is refused with a line above the thread, and a message takes three', async ({ page }) => {
  await boot(page, { createChat: true })
  await pick(page, /GLM 5\.3 Flash/)
  await switchCreateOn(page)
  const input = page.getByTestId('composer-file-input')
  const chips = page.getByTestId('composer-media-chip')
  const composer = page.locator('textarea').first()

  await input.setInputFiles({ name: 'long.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(20 * 1024 * 1024 + 1) })
  await expect(page.getByText(/This file is larger than 20 MB/)).toBeVisible()
  await expect(chips).toHaveCount(0)
  // The line is not in the composer and not above it inside its box.
  const noteBox = await page.getByText(/This file is larger than 20 MB/).boundingBox()
  const composerBox = await composer.boundingBox()
  expect(noteBox!.y + noteBox!.height).toBeLessThan(composerBox!.y - 100)

  const small = (name: string, mimeType: string) => ({ name, mimeType, buffer: Buffer.alloc(2048, 1) })
  await input.setInputFiles([small('a.mp3', 'audio/mpeg'), small('b.mp4', 'video/mp4')])
  await expect(chips).toHaveCount(2)
  // Exactly at the limit is fine.
  await input.setInputFiles([
    { name: 'edge.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(20 * 1024 * 1024) },
    small('d.mp3', 'audio/mpeg'),
  ])
  await expect(chips).toHaveCount(3)
  await expect(page.getByText(/A message takes up to 3 clips or sound tracks/)).toBeVisible()
  await expect(chips.nth(2)).toContainText('edge.wav')
})

test('with Create off a clip is a file like any other, as before', async ({ page }) => {
  await boot(page, { createChat: true })
  await pick(page, /GLM 5\.3 Flash/)
  await page.getByTestId('composer-file-input').setInputFiles({ name: 'a.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(2048, 1) })
  await page.waitForTimeout(800)
  await expect(page.getByTestId('composer-media-chip')).toHaveCount(0)
})
