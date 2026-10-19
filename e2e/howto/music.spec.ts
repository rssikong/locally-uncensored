import { test } from '@playwright/test'
import { HOWTO_OUT } from './rec'
import { bootNoPrice } from './no-price'

// How Music works. Every caption is a statement the app makes itself
// (src/lib/render/music-ui.ts, musicHowtoLines). Network fixtures:
// no-price.ts (no price: none is public for Music).
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

test('music', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(90_000)
  const rec = await bootNoPrice(page, 'music', 'How Music works')
  await rec.openCreate('Music')
  // Before the film: ACE-Step 1.5, the app's own model that sings written
  // lyrics. The catalog (no-price.ts) lists no Studio model, so the first row
  // is ACE-Step (fast), which writes its own.
  await page.locator('button[aria-haspopup="listbox"]').last().click()
  await page.getByRole('option', { name: /ACE-Step 1\.5/ }).click()
  await page.getByRole('button', { name: /Lyrics/ }).first().waitFor()
  await page.mouse.move(600, 880)
  const prompt = page.locator('textarea').first()
  const lyricsChip = page.getByRole('button', { name: /Lyrics/ }).first()

  await rec.key()
  rec.scene('The prompt sets the style. Use comma-separated tags.')
  await rec.cam(prompt, 1.5)
  await rec.click(prompt, { dur: 0.75, at: { fx: 0.15 } })
  await rec.move({ x: 935, y: 852 }, { dur: 0.4, real: false })
  await rec.type(prompt, 'slow jazz, smoky female vocals, upright bass')

  rec.scene('Open Lyrics to write your own words.')
  await rec.click(lyricsChip, { after: 0.5 })

  rec.scene('Mark the parts with [Verse], [Chorus] and [Bridge].')
  const lyrics = page.getByRole('textbox', { name: 'Lyrics' })
  await rec.click(lyrics, { dur: 0.45, at: { fx: 0.12 } })
  await rec.move({ x: 930, y: 790 }, { dur: 0.4, real: false })
  await rec.type(lyrics, "[Verse]\nRain on the harbor, the lights burn low\n[Chorus]\nStay till the morning, don't let go", { per: 2, cps: 24 })

  rec.scene('No Lyrics button? Then that model writes its own lyrics.')
  await rec.move(page.locator('button[aria-haspopup="listbox"]').last(), { dur: 0.7 })
  rec.hold(1.2)
  await rec.cam('full', 1, 1.1)
  rec.hold(1.4)
  rec.finish()
})
