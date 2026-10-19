import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'
import { openNewChat } from './support/ui'

/**
 * David's wish for 3.0.7: emoticons typed in the chat composer become emojis
 * once the word is over, one Backspace takes it back, and Enter sends a face
 * that ends the message as its emoji. Typed with the keyboard here, so the
 * caret is the browser's own and not a test's guess.
 */
async function boot(page: Page) {
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME })
  await seedOnboardingDone(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await openNewChat(page)
  const field = page.locator('textarea[data-lu-composer]')
  await field.click()
  return field
}

test('the chat composer turns emoticons into emojis while typing', async ({ page }) => {
  const field = await boot(page)
  await page.keyboard.type('hi :D and <3 ')
  await expect(field).toHaveValue('hi 😃 and ❤️ ')

  // One Backspace right after a turn takes it back, and typing goes on there.
  await page.keyboard.type(';) ')
  await expect(field).toHaveValue('hi 😃 and ❤️ 😉 ')
  await page.keyboard.press('Backspace')
  await expect(field).toHaveValue('hi 😃 and ❤️ ;) ')
  await page.keyboard.type('ok')
  await expect(field).toHaveValue('hi 😃 and ❤️ ;) ok')

  // Typing in the middle turns there, and the caret stays where it was.
  await page.keyboard.press('Home')
  await page.keyboard.type(':) ')
  await expect(field).toHaveValue('🙂 hi 😃 and ❤️ ;) ok')
  await page.keyboard.type('x')
  await expect(field).toHaveValue('🙂 xhi 😃 and ❤️ ;) ok')
})

test('Enter sends a face that ends the message as its emoji', async ({ page }) => {
  const field = await boot(page)
  await page.keyboard.type('thanks :)')
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue('')
  await expect(page.getByText('thanks 🙂', { exact: true })).toBeVisible()
})
