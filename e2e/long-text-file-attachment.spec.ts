import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'
import { openNewChat } from './support/ui'

/**
 * GH #171: a long Markdown file attached in chat was cut to its first 4000
 * characters before it was sent, and nobody was told.
 *
 * Played through the composer as a user does it, against the built-in engine
 * of the mock, which runs with an 8192 token window:
 *   - a text that fits the window goes out whole, with no line about it;
 *   - a Japanese story far larger than the window goes out as far as it fits,
 *     the line above the transcript says how much and why, and the chip under
 *     the message keeps saying it.
 *
 * Measured at the payload as well as on the screen.
 *
 * Run: CI=1 LU_E2E_PORT=5297 npx playwright test e2e/long-text-file-attachment.spec.ts
 */

async function lastUserMessage(page: Page): Promise<string> {
  const bodies = await page.evaluate(() => {
    const all: unknown = Reflect.get(window, '__E2E_CHAT_BODIES__')
    return Array.isArray(all) ? all.map(String) : []
  })
  const body = JSON.parse(bodies[bodies.length - 1]) as { messages: Array<{ role: string; content: unknown }> }
  const users = body.messages.filter((m) => m.role === 'user')
  return String(users[users.length - 1].content)
}

async function attachAndSend(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, question: string) {
  const opts: TauriMockOptions = { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME, platform: 'mac' }
  await page.addInitScript(tauriMockInit, opts)
  await seedOnboardingDone(page)
  await page.goto('/')
  await openNewChat(page)
  await page.getByTestId('composer-file-input').setInputFiles(file)
  await expect(page.getByTestId('composer-file-chip')).toContainText(file.name)
  await page.locator('textarea').first().fill(question)
  await page.getByRole('button', { name: /Send message/i }).click()
  await expect(page.getByText(DEFAULT_ASSISTANT_REPLY).first()).toBeVisible({ timeout: 20_000 })
}

test('a text file that fits the window reaches the model whole, without a notice', async ({ page }) => {
  // 14,000 characters: three and a half times what 3.0.6 let through.
  const notes = `# Notes\n${'The ship left the harbour at dawn and sailed north. '.repeat(270)}\nTHE LAST LINE OF THE NOTES.\n`
  expect(notes.length).toBeGreaterThan(14_000)
  await attachAndSend(page, { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from(notes, 'utf-8') }, 'How do the notes end?')

  const sent = await lastUserMessage(page)
  expect(sent).toContain(`The whole text of the file:\n${notes}`)
  expect(sent).toContain('THE LAST LINE OF THE NOTES.')
  await expect(page.getByTestId('chat-file-chip')).toContainText('notes.md')
  await expect(page.getByTestId('chat-file-cut')).toHaveCount(0)
  await expect(page.getByText('Only part of the attached text')).toHaveCount(0)
})

test('a story larger than the window goes out as far as it fits, and the chat says so', async ({ page }) => {
  const line = '朝、ウォルトは港へ向かった。バロンは静かに地図を広げ、二人は次の島について話し合った。\n'
  const story = `# 一日目\n冒頭の場面です。\n${line.repeat(1400)}最後の場面です。物語はここで終わる。\n`
  await attachAndSend(page, { name: 'day-one.md', mimeType: 'text/markdown', buffer: Buffer.from(story, 'utf-8') }, 'How does the last part end?')

  // The model gets the start, and is told it is only the start.
  const sent = await lastUserMessage(page)
  expect(sent).toContain('冒頭の場面です。')
  expect(sent).not.toContain('最後の場面です。物語はここで終わる。')
  expect(sent).toMatch(/Only the first [\d,]+ of [\d,]+ characters of this file are included, because the whole file does not fit into your context window/)

  // The user sees how much went out and why.
  const notices = page.getByTestId('chat-notices')
  await expect(notices).toContainText('Only part of the attached text reached the model.')
  await expect(notices).toContainText(`"day-one.md"`)
  await expect(notices).toContainText(`of ${story.length.toLocaleString('en-US')} characters`)
  await expect(notices).toContainText("the model's context window is 8K tokens")

  // And the chip keeps saying it once the line is gone.
  const mark = page.getByTestId('chat-file-cut')
  await expect(mark).toBeVisible()
  await expect(mark).toContainText(`of ${story.length.toLocaleString('en-US')} characters`)
})
