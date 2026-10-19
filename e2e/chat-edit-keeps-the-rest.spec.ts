import { test, expect, type Page, type Locator } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'

/**
 * GH #172: editing an earlier user message used to resend it at once and
 * delete every later message for good, also when the person only wanted to
 * fix a typo. With no model loaded the backend even started to load one.
 *
 * The chat is seeded the way an older build stored it (no versions on any
 * message), so the same run also proves that such a chat opens and edits.
 *
 *  - "Save" changes the text only: every later turn stays, nothing is sent.
 *  - Enter in the edit field is "Save" too, so one key can never send.
 *  - "Save & resend" asks again but keeps the old continuation as a version
 *    of the chat, switchable with "< 1/2 >", and that survives a reload.
 *
 * Run: LU_E2E_PORT=5296 CI=1 npx playwright test e2e/chat-edit-keeps-the-rest.spec.ts
 */

const CONV_ID = 'seeded-branch-chat'
const TURNS = [
  ['Q1 tell me about the harbour', 'A1 the harbour is old'],
  ['Q2 and the lighthouse', 'A2 the lighthouse is red'],
  ['Q3 who lives there', 'A3 a keeper and a cat'],
] as const

function seededChat() {
  const now = Date.now()
  const messages = TURNS.flatMap(([q, a], i) => [
    { id: `u${i + 1}`, role: 'user', content: q, timestamp: now - 10_000 + i * 2 },
    { id: `a${i + 1}`, role: 'assistant', content: a, timestamp: now - 10_000 + i * 2 + 1, modelId: 'qwen2.5-7b-instruct-q4_k_m' },
  ])
  return {
    state: {
      conversations: [{
        id: CONV_ID, title: 'Harbour story', messages, model: DEFAULT_MODEL_NAME,
        systemPrompt: '', mode: 'lu', createdAt: now - 20_000, updatedAt: now - 10_000, personaEnabled: false,
      }],
      activeConversationId: CONV_ID,
    },
    version: 0,
  }
}

async function boot(page: Page) {
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME })
  await seedOnboardingDone(page)
  // Seeded once per test through the legacy localStorage key, which the app
  // moves into IndexedDB on its first read; a reload must not seed again.
  await page.addInitScript((raw: string) => {
    if (sessionStorage.getItem('e2e-seeded')) return
    sessionStorage.setItem('e2e-seeded', '1')
    localStorage.setItem('chat-conversations', raw)
  }, JSON.stringify(seededChat()))
  await page.goto('/')
  await expect(said(page, TURNS[2][1])).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => { Reflect.set(window, '__E2E_CHAT_BODIES__', []) })
}

/** A paragraph in the transcript. The composer is a textarea, never a <p>. */
function said(page: Page, text: string): Locator {
  return page.getByRole('main').locator('p').filter({ hasText: text })
}

/** The whole bubble a text sits in: its action bar and edit field live there. */
function bubbleOf(page: Page, text: string): Locator {
  return said(page, text).first().locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " group ")][1]')
}

async function chatRequests(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bodies: unknown = Reflect.get(window, '__E2E_CHAT_BODIES__')
    return Array.isArray(bodies) ? bodies.length : 0
  })
}

/**
 * Open the edit field of one message. While it is open the message has no
 * paragraph any more, so the bubble is pinned by a mark set from the focused
 * edit field (the field takes the focus when it opens).
 */
async function startEdit(page: Page, text: string): Promise<Locator> {
  const bubble = bubbleOf(page, text)
  await bubble.hover()
  await bubble.getByRole('button', { name: 'Edit message' }).click()
  await expect(page.locator('main textarea:focus')).toBeVisible()
  await page.evaluate(() => {
    document.activeElement?.closest('.group')?.setAttribute('data-e2e-editing', '1')
  })
  const pinned = page.locator('[data-e2e-editing="1"]')
  await expect(pinned.locator('textarea')).toBeVisible()
  return pinned
}

async function persistedMessages(page: Page): Promise<string[] | null> {
  return page.evaluate(async (id) => {
    const raw: string | null = await new Promise((res) => {
      const req = indexedDB.open('locally-uncensored-store', 1)
      req.onsuccess = () => {
        const r = req.result.transaction('kv', 'readonly').objectStore('kv').get('chat-conversations')
        r.onsuccess = () => res(typeof r.result === 'string' ? r.result : null)
        r.onerror = () => res(null)
      }
      req.onerror = () => res(null)
    })
    if (!raw) return null
    const conv = JSON.parse(raw).state.conversations.find((c: { id: string }) => c.id === id)
    return conv ? conv.messages.map((m: { content: string }) => m.content) : null
  }, CONV_ID)
}

test('#172 Save changes the text only: every later turn stays and nothing is sent', async ({ page }) => {
  await boot(page)
  const bubble = await startEdit(page, TURNS[0][0])
  await bubble.locator('textarea').fill('Q1 tell me about the old harbour')
  await bubble.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(said(page, 'Q1 tell me about the old harbour')).toBeVisible()
  for (const [q, a] of TURNS.slice(1)) {
    await expect(said(page, q)).toBeVisible()
    await expect(said(page, a)).toBeVisible()
  }
  await expect(said(page, TURNS[0][1])).toBeVisible()
  // Nothing went to a model, not even a load.
  await page.waitForTimeout(500)
  expect(await chatRequests(page)).toBe(0)
  await expect(page.getByTestId('fork-switcher')).toHaveCount(0)

  // And it is the stored text now, not only the shown one.
  await expect.poll(() => persistedMessages(page)).toEqual([
    'Q1 tell me about the old harbour', TURNS[0][1], TURNS[1][0], TURNS[1][1], TURNS[2][0], TURNS[2][1],
  ])
})

test('#172 Enter in the edit field saves and never sends', async ({ page }) => {
  await boot(page)
  const bubble = await startEdit(page, TURNS[1][0])
  const field = bubble.locator('textarea')
  await field.fill('Q2 and the tall lighthouse')
  await field.press('Enter')

  await expect(said(page, 'Q2 and the tall lighthouse')).toBeVisible()
  await expect(said(page, TURNS[1][1])).toBeVisible()
  await expect(said(page, TURNS[2][0])).toBeVisible()
  await expect(said(page, TURNS[2][1])).toBeVisible()
  await page.waitForTimeout(500)
  expect(await chatRequests(page)).toBe(0)
})

test('#172 Save & resend keeps the old continuation as version 1/2, also after a reload', async ({ page }) => {
  await boot(page)
  const bubble = await startEdit(page, TURNS[1][0])
  await bubble.locator('textarea').fill('Q2 and the harbour master')
  await bubble.getByRole('button', { name: 'Save & resend' }).click()

  // The new continuation: the edited question and a fresh answer.
  await expect(said(page, DEFAULT_ASSISTANT_REPLY)).toBeVisible({ timeout: 30_000 })
  await expect(said(page, 'Q2 and the harbour master')).toBeVisible()
  await expect(said(page, TURNS[2][0])).toHaveCount(0)
  expect(await chatRequests(page)).toBe(1)
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible({ timeout: 30_000 })

  // The old one is a version of the chat, not gone.
  const switcher = page.getByTestId('fork-switcher')
  await expect(switcher).toHaveCount(1)
  await expect(switcher).toContainText('2/2')
  await switcher.getByRole('button', { name: 'Previous version' }).click()
  await expect(switcher).toContainText('1/2')
  for (const [q, a] of TURNS.slice(1)) {
    await expect(said(page, q)).toBeVisible()
    await expect(said(page, a)).toBeVisible()
  }
  await expect(said(page, 'Q2 and the harbour master')).toHaveCount(0)
  await expect(said(page, DEFAULT_ASSISTANT_REPLY)).toHaveCount(0)
  // The first exchange is shared by both versions.
  await expect(said(page, TURNS[0][0])).toBeVisible()
  await expect(said(page, TURNS[0][1])).toBeVisible()

  // Both versions are stored: a reload shows the one that was picked last,
  // and the other is one click away.
  await page.waitForTimeout(400)
  await page.reload()
  await expect(said(page, TURNS[2][1])).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('fork-switcher')).toContainText('1/2')
  await page.getByTestId('fork-switcher').getByRole('button', { name: 'Next version' }).click()
  await expect(page.getByTestId('fork-switcher')).toContainText('2/2')
  await expect(said(page, 'Q2 and the harbour master')).toBeVisible()
  await expect(said(page, DEFAULT_ASSISTANT_REPLY)).toBeVisible()
  await expect(said(page, TURNS[2][0])).toHaveCount(0)
})
