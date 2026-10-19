import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_MODEL_NAME, type TauriMockOptions } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'
import { openNewChat } from './support/ui'

/**
 * GH #165: a group member whose model left the model list.
 *
 * The user's LM Studio folder changed and a second server was closed. Both
 * models vanished from the picker and from the group menu, but stayed in the
 * group: the header said "3 models" next to fewer highlighted rows, the banner
 * said "1 round = 3 answers", every round had a turn under the missing name,
 * and the backend answered it with whatever model it had loaded. The only way
 * out was to bring the model back, untick it and hide it again.
 *
 * Also GH #165: KoboldCpp in Ollama mode reports its model twice, and the
 * group menu showed two identical rows that ticked together.
 *
 * Run: LU_E2E_PORT=5294 CI=1 npx playwright test e2e/group-chat-unavailable-member.spec.ts
 */

const FIRST = 'qwen3:4b'
const SECOND = 'koboldcpp/baron'
const GONE = 'gemma-4-ortenzya:31b'

interface WireBody { model: string }

async function chatModels(page: Page): Promise<string[]> {
  const raw = await page.evaluate(() => {
    const bodies: unknown = Reflect.get(window, '__E2E_CHAT_BODIES__')
    return Array.isArray(bodies) ? bodies.map(String) : []
  })
  return raw.map((b) => (JSON.parse(b) as WireBody).model)
}

const participant = (page: Page, model: string) =>
  page.locator(`[data-testid="group-participant"][data-model="${model}"]`)

async function openGroupMenu(page: Page) {
  await page.getByRole('button', { name: /Plugins/ }).click()
  // The section remembers that it was open while the page lives.
  if (!(await page.getByTestId('group-participant').first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /Group chat/ }).click()
  }
}

test('a member whose model left the list is shown, sits out, and can be removed directly', async ({ page }) => {
  const opts: TauriMockOptions = {
    assistantReply: 'A short answer.',
    modelName: DEFAULT_MODEL_NAME,
    platform: 'mac',
    // KoboldCpp's double entry.
    ollamaModels: [FIRST, SECOND, SECOND, GONE],
  }
  await page.addInitScript(tauriMockInit, opts)
  await seedOnboardingDone(page)
  await page.goto('/')
  await openNewChat(page)
  await openGroupMenu(page)

  // One row per model, even though the server listed SECOND twice.
  await expect(participant(page, SECOND)).toHaveCount(1)
  for (const model of [FIRST, SECOND, GONE]) {
    await participant(page, model).getByRole('button').first().click()
  }
  await expect(page.getByTestId('group-chat-count')).toHaveText('3 models')

  // GONE's server closes: the next refresh no longer lists it.
  await page.evaluate((still) => {
    Reflect.set(window, '__E2E_OLLAMA_MODELS__', still)
    window.dispatchEvent(new Event('lu-models-refresh'))
  }, [FIRST, SECOND])

  // Still in the menu, marked as unavailable, and counted honestly.
  const gone = participant(page, GONE)
  await expect(gone).toHaveAttribute('data-unavailable', 'true')
  await expect(gone.getByTestId('group-participant-unavailable')).toBeVisible()
  await expect(page.getByTestId('group-chat-count')).toHaveText('2 models, 1 unavailable')
  await page.keyboard.press('Escape')
  await expect(page.getByText(/1 round = 2 answers/)).toBeVisible()

  // A round: no request under the missing name, two answers, two labels.
  await page.evaluate(() => { Reflect.set(window, '__E2E_CHAT_BODIES__', []) })
  await page.locator('textarea').first().fill('hello everyone')
  await page.getByRole('button', { name: /Send message/i }).click()
  await expect(page.getByTestId('answered-by')).toHaveCount(2, { timeout: 30_000 })
  await expect.poll(() => chatModels(page)).toEqual([FIRST, SECOND])
  await expect(page.getByTestId('answered-by').filter({ hasText: /gemma-4-ortenzya/ })).toHaveCount(0)

  // Removed straight from the menu, without bringing the model back.
  await openGroupMenu(page)
  await participant(page, GONE).getByTestId('group-participant-remove').click()
  await expect(participant(page, GONE)).toHaveCount(0)
  await expect(page.getByTestId('group-chat-count')).toHaveText('2 models')
})
