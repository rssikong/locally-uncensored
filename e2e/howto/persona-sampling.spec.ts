import { test, expect } from '@playwright/test'
import { Rec, HOWTO_OUT } from './rec'

// Sampling values per persona and per group member (3.0.7, issue 175).
// Recorded on ddeccc9ce (integ/307). Facts, all from that head:
//  - components/settings/SettingsPage.tsx: the Personas section sits on the
//    Agent tab of Settings (PersonaPanel). components/personas/PersonaPanel:
//    a persona you made has "Edit persona" on its card (hover).
//  - components/personas/SystemPromptEditor.tsx PERSONA_SAMPLING_FIELDS: the
//    editor has a box "Sampling for this persona" with Temperature, Top P,
//    Top K, Min P, Max tokens, Repeat penalty, Presence penalty, Frequency
//    penalty, DRY multiplier; placeholder "chat default"; the line "Empty
//    fields follow the chat. A value moved in the chat's Sampling popup still
//    wins. Each value only reaches a backend that reads it."
//  - lib/chat-persona.ts samplingPresetFor: the preset holds for the persona
//    of a chat with the persona switched on, and for a group member's own
//    persona on its seat. lib/sampling.ts effectiveSampling: the order is
//    this chat's own value, the persona preset, the Settings page, the app
//    default.
//  - components/chat/SamplingControls.tsx + lib/speaker-sampling-lines.ts:
//    the Sampling popup lists each speaker as "<model>: Persona <name>" (or
//    "Chat settings") with the values that hold, and marks "(not sent)"
//    where the backend does not read a value (api/providers/sampler-fields.ts;
//    the bundled engine reads all of them, so nothing is marked here). In a
//    plain chat the sliders show the persona's value; moving one writes this
//    chat's own value, which then wins.
//  - CHANGELOG 3.0.7 Known limits: sampling values per persona have run in
//    automated tests only, so the film shows where they are set and which
//    one holds, and says nothing about how answers change.
//
// FIXTURES (said in the report too):
//  - Before the film, through the app's own controls: the Personas switch on,
//    an example persona "Example Storyteller" made with Custom and picked, and
//    the open chat with that persona picked and switched on in Plugins.
//  - The chat model is the rig's mocked bundled engine. No model runs. One
//    example question with a scripted example answer is sent before the
//    film, so the chat is not empty. No message is sent in the film.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

const NAME = 'Example Storyteller'
const STORY = 'Once upon a time, a small fox found a red kite in the grass.'

test('persona-sampling', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(150_000)
  const rec = await Rec.boot(page, 'persona-sampling', 'Sampling values per persona', {
    mode: 'local',
    tauri: { platform: 'windows', assistantReply: STORY },
  })

  const banner = page.getByRole('banner')
  const openAgentSettings = async () => {
    await banner.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Agent', exact: true }).first().click()
    // The Personas section folds; it opens through its own heading.
    const sw = page.getByRole('button', { name: 'Toggle personas master switch' })
    await page.waitForTimeout(400)
    if (!(await sw.isVisible())) await page.getByRole('button', { name: 'Personas', exact: true }).click()
    await expect(sw).toBeVisible({ timeout: 10_000 })
  }

  // Prep, before the film: the Personas switch on and the example persona.
  await expect(async () => {
    await page.getByRole('button', { name: /New Chat/i }).first().click()
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await openAgentSettings()
  const master = page.getByRole('button', { name: 'Toggle personas master switch' })
  if ((await master.getAttribute('aria-pressed')) !== 'true') await master.click()
  await page.getByRole('button', { name: 'Custom' }).click()
  await page.getByPlaceholder('Persona name...').fill(NAME)
  await page.getByPlaceholder('System prompt...').fill('You tell short example stories for children.')
  await page.getByRole('button', { name: 'Save Persona' }).click()
  const card = page.getByRole('button', { name: NAME })
  await card.click()

  // The chat takes the persona: Plugins, Persona switched on for this chat.
  await banner.getByRole('button', { name: 'Chat', exact: true }).click()
  await page.getByRole('button', { name: 'Plugins' }).click()
  await page.getByTitle('Enable persona for this chat').click()
  await expect(page.getByTitle('Disable persona for this chat')).toBeVisible()
  // The chat was opened before the persona existed: pick it for this chat.
  await page.getByRole('button', { name: /^Persona/ }).first().click()
  await page.getByRole('button', { name: NAME, exact: true }).click()
  await page.keyboard.press('Escape')
  await page.mouse.click(1000, 500)
  // One example turn, so the chat is not empty in the film.
  const composer = page.locator('textarea').first()
  await composer.fill('Tell me a very short example story')
  await composer.press('Enter')
  await expect(page.getByText(STORY)).toBeVisible({ timeout: 30_000 })
  await openAgentSettings()
  // The persona grid scrolls; the example persona sits last in it.
  await card.scrollIntoViewIfNeeded()
  await page.mouse.move(1380, 860)
  await page.waitForTimeout(800)

  await rec.key()
  rec.scene('A persona you made has its own sampling values, under Settings, Agent, Personas.')
  const tile = card.locator('xpath=ancestor::div[contains(@class,"group")][1]')
  await rec.cam(tile, 1.5, 0.9)
  rec.hold(0.8)
  await rec.move(tile, { dur: 0.6, at: { fy: 0.6 } })
  await rec.key(300)
  await rec.click(tile.getByTitle('Edit persona'), {
    dur: 0.4, after: 0.2,
    until: () => expect(page.getByTestId('persona-sampling')).toBeVisible(),
  })

  rec.scene('Fill in only what the persona needs. An empty field follows the chat.')
  const box = page.getByTestId('persona-sampling')
  // The editor opens under the grid: the page scrolls down to its buttons.
  await page.getByRole('button', { name: 'Update Persona' }).scrollIntoViewIfNeeded()
  await rec.key(300)
  await rec.cam(box, 1.4, 0.9)
  const temp = box.getByLabel('Temperature', { exact: true })
  await rec.click(temp, { dur: 0.6, after: 0.1 })
  await rec.type(temp, '1.1', { cps: 8, per: 3 })
  const rep = box.getByLabel('Repeat penalty', { exact: true })
  await rec.click(rep, { dur: 0.6, after: 0.1 })
  await rec.type(rep, '1.15', { cps: 8, per: 4 })
  const hint = box.getByText(/^Empty fields follow the chat\./)
  await rec.move(hint, { dur: 0.6, at: { fx: 0.3 }, real: false })
  rec.hold(0.6)
  await rec.click(page.getByRole('button', { name: 'Update Persona' }), { dur: 0.6, after: 0.3 })

  rec.scene('In the chat, the Sampling popup lists each speaker with the values that hold for it.')
  await rec.cam('full', 1, 0.8)
  await rec.click(banner.getByRole('button', { name: 'Chat', exact: true }), { dur: 0.7, after: 0.2 })
  const trigger = page.getByTestId('sampling-trigger')
  await expect(trigger).toHaveText(/1\.10/)
  await rec.click(trigger, {
    dur: 0.7, after: 0.2,
    until: () => expect(page.getByTestId('sampling-speaker')).toContainText(`Persona ${NAME}`),
  })
  const speaker = page.getByTestId('sampling-speaker')
  await expect(speaker).toContainText('Temperature 1.1')
  await expect(speaker).toContainText('Repeat penalty 1.15')
  const panel = page.getByTestId('sampling-panel')
  await rec.cam(panel, 1.6, 0.9)
  await rec.move(speaker, { dur: 0.7, at: { fx: 0.95, fy: 0.1 }, real: false })
  await rec.key(200)
  rec.hold(1.3)

  rec.scene('A value moved in this popup is the chat\'s own and wins over the persona.')
  const slider = panel.getByLabel('Temperature', { exact: true })
  await rec.click(slider, { dur: 0.6, at: { fx: 0.4 }, after: 0.2 })
  await expect(speaker).not.toContainText('Temperature 1.1')
  await rec.move(speaker, { dur: 0.6, at: { fx: 0.95, fy: 0.1 }, real: false })
  await rec.key(250)
  rec.hold(1.2)
  rec.finish(0.9)
})
