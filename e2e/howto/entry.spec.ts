import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { Rec } from './rec'
import { openCode, openChat } from './model'

// Checks the "How it works" entries in the real interface: the line on an
// empty Create stage, the mark in the Code header and next to the Agent
// switch, the card with its one line, and the list it falls back to without
// the film. Fixture: the films are answered from LU_HOWTO_FILMS.
const FILMS = process.env.LU_HOWTO_FILMS ?? ''
const SHOTS = process.env.LU_HOWTO_SHOTS ?? ''
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

test('entries', async ({ page }) => {
  test.skip(!FILMS || !SHOTS, 'set LU_HOWTO_FILMS and LU_HOWTO_SHOTS')
  test.setTimeout(120_000)
  let online = true
  const rec = await Rec.boot(page, '_entry', 'entry', {
    fixtures: async (p) => {
      await p.route('https://lu-labs.ai/howto/*.mp4', (route) => {
        if (!online) return route.abort()
        const name = new URL(route.request().url()).pathname.split('/').pop()!
        return route.fulfill({ contentType: 'video/mp4', body: readFileSync(`${FILMS}/${name}`) })
      })
    },
  })
  await rec.openCreate('Music')
  const music = page.getByTestId('howto-music')
  await expect(music.getByRole('button', { name: 'How Music works' })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/create-music-zu.png` })
  await music.getByRole('button', { name: 'How Music works' }).click()
  await expect(page.getByTestId('howto-line')).toHaveText('Open Lyrics to write your own words.', { timeout: 15_000 })
  await page.screenshot({ path: `${SHOTS}/create-music-offen.png` })
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('howto-card-music')).toHaveCount(0)

  await page.getByRole('radio', { name: 'Edit / Image to Image', exact: true }).click()
  await page.getByTestId('howto-edit').getByRole('button').click()
  await expect(page.getByTestId('howto-line')).not.toBeEmpty()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${SHOTS}/create-edit-offen.png` })
  await page.keyboard.press('Escape')
  for (const tab of ['Remove Background', 'Enhance Image', 'Erase Object', 'Video', 'Animate Image', 'Character Studio', 'Talking Character', 'Extend Video', 'Motion Control']) {
    await page.getByRole('radio', { name: tab, exact: true }).click()
    await expect(page.locator('[data-testid^="howto-"]').getByRole('button'), tab).toHaveCount(1)
  }
  await page.screenshot({ path: `${SHOTS}/create-motion-zu.png` })
  await page.getByRole('radio', { name: 'Image', exact: true }).click()
  online = false
  await page.getByTestId('howto-image').getByRole('button').click()
  await expect(page.getByTestId('howto-lines').getByRole('listitem')).toHaveCount(4)
  await page.screenshot({ path: `${SHOTS}/create-image-ohne-netz.png` })
  await page.mouse.click(40, 500)
  online = true

  await page.getByRole('banner').getByRole('button', { name: 'Chat', exact: true }).click()
  await openChat(page)
  const agent = page.getByTestId('howto-agent')
  await agent.getByRole('button', { name: 'How Agent works' }).click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOTS}/agent-offen.png` })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Toggle sidebar' }).click()

  await openCode(page)
  const code = page.getByTestId('howto-code')
  await code.getByRole('button', { name: 'How Code works' }).click()
  await expect(page.getByTestId('howto-line')).not.toBeEmpty()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOTS}/code-offen.png` })
  await page.getByRole('button', { name: 'Slash commands' }).click()
  await expect(page.getByTestId('howto-line')).toHaveText('Type / at the start of a line to open the agent commands.')
  await page.keyboard.press('Escape')
})
