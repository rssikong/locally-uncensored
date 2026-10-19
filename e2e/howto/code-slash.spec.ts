import { test, expect } from '@playwright/test'
import { Rec, HOWTO_OUT } from './rec'
import { scriptModel, openCode } from './model'

// How Code works: slash commands. Captions are the menu's own lines
// (src/lib/agent-commands.ts), the loop bar (LoopBar.tsx) and what /goal
// answers in the transcript (useCodex.ts, GoalBar.tsx).
//
// FIXTURE: one scripted model answer (./model.ts) for the first /loop pass. It
// ends with the loop's own "not done yet" marker, so the app arms pass 2 and
// draws its loop bar by itself. /goal never reaches a model.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

test('code-slash', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const rec = await Rec.boot(page, 'code-slash', 'How Code works: slash commands')
  await scriptModel(page, [{ text: 'Ran pytest: 2 of 5 tests still fail. Fixing the next one.\n\nLOOP_CONTINUE' }])
  await openCode(page)

  const composer = page.locator('textarea').first()
  const send = page.getByRole('button', { name: 'Send message' })
  const park = { x: 1040, y: 812 }
  const band = { up: 340, down: 90 }

  await rec.key()
  rec.scene('Type / at the start of a line to open the agent commands.')
  await rec.cam({ x: 596, y: 680 }, 1.4)
  await rec.click(composer, { dur: 0.7, at: { fx: 0.3 }, after: 0.1 })
  await rec.move(park, { dur: 0.3, real: false })
  await rec.type(composer, '/', { band })
  rec.hold(1.5)

  await rec.type(composer, 'lo', { band, cps: 8 })
  rec.scene('/loop works, then re-checks again and again; 30s is the pause between passes.')
  await rec.click(page.getByRole('button', { name: /^\/loop/ }), { dur: 0.6, at: { fx: 0.2 }, after: 0.2 })
  await rec.move(park, { dur: 0.3, real: false })
  await rec.type(composer, '30s fix the tests, done when pytest is green', { band, cps: 30, per: 2 })
  await rec.click(send, {
    dur: 0.45, after: 0.3,
    until: () => expect(page.getByText(/next in \d+s/)).toBeVisible({ timeout: 30_000 }),
    // The bar's countdown reads a stale clock for its first second (it showed
    // "next in 36s" for a 30 s pause); photograph it after its first tick.
    settle: 1400,
  })
  rec.hold(1.3)

  await rec.cam({ x: 596, y: 560 }, 1.25, 0.9)
  await rec.click(composer, { dur: 0.4, at: { fx: 0.3 }, after: 0.05 })
  await rec.move(park, { dur: 0.3, real: false })
  await rec.type(composer, '/goal ship v1 with green tests', { band, cps: 30, per: 2 })
  await rec.click(send, {
    dur: 0.45, after: 0.2,
    until: () => expect(page.getByText('Goal set:')).toBeVisible({ timeout: 30_000 }),
  })
  rec.scene('/goal sets a goal every following turn will see; /goal clear drops it.')
  rec.hold(2.0)

  await rec.cam({ x: 596, y: 680 }, 1.4, 0.9)
  await rec.type(composer, '/pl', { band, cps: 8 })
  rec.scene('/plan works out the steps before changing anything.')
  await rec.move(page.getByRole('button', { name: /^\/plan/ }), { dur: 0.6, at: { fx: 0.12 } })
  rec.hold(1.3)
  rec.finish(1.2)
})
