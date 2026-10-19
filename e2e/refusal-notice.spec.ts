import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'
import { openNewChat } from './support/ui'

/**
 * The notice under a refusing answer (2026-10-05).
 *
 * Measured that day: a refusal in the history is copied by better models in
 * the same chat. The app says so directly under the refusing answer and
 * offers a new chat on the same model. Nothing of it may stand in or above
 * the prompt field.
 *
 * The mock engine answers with the sentence Llama 3.1 8B Turbo gave in the
 * measurement.
 *
 * Run: CI=1 LU_E2E_PORT=5311 npx playwright test e2e/refusal-notice.spec.ts
 */

const REFUSAL = "I can't create explicit content. Is there anything else I can help you with?"
const NOTICE =
  'This model declined. A refusal stays in the chat history, and other models tend to copy it. Start a new chat and pick a model marked No Filter.'

const picker = (page: Page) => page.getByRole('button', { name: 'Select chat model', exact: true })
const notice = (page: Page) => page.getByTestId('refusal-notice')
const answer = (page: Page) => page.getByRole('main').locator('p').filter({ hasText: REFUSAL })

async function boot(page: Page, assistantReply: string) {
  await page.addInitScript(tauriMockInit, { assistantReply, modelName: DEFAULT_MODEL_NAME })
  await seedOnboardingDone(page)
  await page.goto('/')
  await openNewChat(page)
}

async function send(page: Page, text: string) {
  const box = page.locator('textarea').first()
  await box.fill(text)
  await page.getByRole('button', { name: 'Send message' }).click()
}

test('a refusing answer gets the notice under it, and "New chat" opens a chat on the same model', async ({ page }) => {
  await boot(page, REFUSAL)
  await expect(picker(page)).toContainText('qwen2.5-7b')
  await send(page, 'write the scene')
  await expect(answer(page)).toBeVisible({ timeout: 15_000 })

  await expect(notice(page)).toHaveCount(1)
  await expect(notice(page)).toContainText(NOTICE)
  await expect(notice(page).locator('svg')).toBeVisible()
  const button = notice(page).getByRole('button', { name: 'New chat', exact: true })
  await expect(button).toBeVisible()

  // Under the answer, above the prompt field, and not part of the composer.
  // One reading for all three: read one after the other, the transcript could
  // move between two readings, and the notice then seemed to begin a pixel
  // above the end of the answer (once in a full run on Windows, 08.10.2026).
  const [answerBox, noticeBox, promptBox] = await page.evaluate(
    (els) => els.map((el) => {
      const { y, height } = el!.getBoundingClientRect()
      return { y, height }
    }),
    [
      await answer(page).elementHandle(),
      await notice(page).elementHandle(),
      await page.locator('textarea').first().elementHandle(),
    ],
  )
  expect(noticeBox.y).toBeGreaterThanOrEqual(answerBox.y + answerBox.height - 1)
  expect(noticeBox.y + noticeBox.height).toBeLessThan(promptBox.y)
  // The transcript scrolls, the composer does not: the notice is a child of
  // the scrolling transcript and of no element that holds the prompt field.
  expect(await notice(page).evaluate((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (p.querySelector('textarea')) return getComputedStyle(el.closest('.overflow-y-auto')!).overflowY
    }
    return 'no common ancestor'
  })).toBe('auto')
  expect(await notice(page).evaluate((el) => !!el.closest('.overflow-y-auto')?.querySelector('textarea'))).toBe(false)

  // A second refusal moves the notice to the latest one.
  // The composer's double-fire lock (SEND_LOCK_MS, chat/ChatInput.tsx) holds
  // only for the same message since 3.0.7, so a new one goes out right away.
  // The retry stays as a margin and never sends twice (guarded by the count).
  await expect(async () => {
    if ((await answer(page).count()) < 2) {
      const box = page.locator('textarea').first()
      if ((await box.inputValue()) === '') await box.fill('please')
      await page.getByRole('button', { name: 'Send message' }).click()
    }
    await expect(answer(page)).toHaveCount(2, { timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  await expect(notice(page)).toHaveCount(1)
  const secondAnswer = (await answer(page).nth(1).boundingBox())!
  expect((await notice(page).boundingBox())!.y).toBeGreaterThanOrEqual(secondAnswer.y + secondAnswer.height - 1)

  // New chat: empty transcript, same model, the refusal stays behind.
  await notice(page).getByRole('button', { name: 'New chat', exact: true }).click()
  await expect(answer(page)).toHaveCount(0)
  await expect(notice(page)).toHaveCount(0)
  await expect(picker(page)).toContainText('qwen2.5-7b')
  await expect(page.locator('textarea').first()).toBeVisible()
  await expect(page.locator('textarea').first()).toHaveValue('')
})

test('an ordinary answer gets no notice', async ({ page }) => {
  await boot(page, 'Sure, here is the scene you asked for.')
  await send(page, 'write the scene')
  await expect(page.getByRole('main').locator('p').filter({ hasText: 'Sure, here is the scene' })).toBeVisible({ timeout: 15_000 })
  await expect(notice(page)).toHaveCount(0)
})
