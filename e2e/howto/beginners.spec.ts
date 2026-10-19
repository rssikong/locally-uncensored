import { test, expect } from '@playwright/test'
import { Rec, HOWTO_OUT } from './rec'

// The setup wizard, from the first start to the first answer. Captions are the
// wizard's own statements:
//  - BackendsStep.tsx: "Ready to chat", the LU Engine card preselected,
//    "Runs on your machine · nothing to install".
//  - ComfyStep.tsx: "Image & Video Generation" with "Skip for now"; Settings,
//    AI Backends, ComfyUI keeps "Install ComfyUI" for later (SettingsPage.tsx).
//  - ModelsStep.tsx + lib/constants.ts recommendedOnboardingModelName: the
//    "Recommended" badge sits on the strongest starter the card can carry.
//  - ModelsStep.tsx installSelected + wait-for-download.ts: the built-in path
//    awaits the finished file before the engine starts on it.
//  - Onboarding.tsx welcome: "Your chats stay on your machine."
//
// FIXTURES (said in the report too):
//  - detect_gpus answers one graphics card with 12 GB (initScript wraps
//    __TAURI_INTERNALS__.invoke). The rig answers null, which leaves the badge
//    on the static starter; with a card the hardware pick is shown. The card is
//    an example, not a measured machine.
//  - holdDownloads (rig option): the mocked download stays at 40 % until the
//    spec sets window.__E2E_DL_RELEASE__, so the wizard's waiting state can be
//    seen. No byte is downloaded; the rig reports the file finished.
//  - modelName: the rig's engine lists the file the wizard downloads, so the
//    activation after the download finds it, as the real folder scan would.
//  - assistantReply: the mocked engine's answer text, example wording.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

test('beginners', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const rec = await Rec.boot(page, 'beginners', 'First start: setup wizard', {
    onboarding: true,
    mode: 'local',
    tauri: {
      holdDownloads: true,
      modelName: 'Qwen3.5-9B-abliterated.Q4_K_M',
      assistantReply: 'Hello! I am running on this computer. What would you like to talk about?',
    },
    initScript: () => {
      const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__
      const invoke = bridge.invoke
      bridge.invoke = (cmd, args) => cmd === 'detect_gpus'
        ? Promise.resolve([{ name: 'Example GPU', vendor: 'nvidia', memory_mib: 12 * 1024 }])
        : invoke(cmd, args)
    },
  })

  const getStarted = page.getByRole('button', { name: /Get Started/i })
  await expect(getStarted).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(600)

  // Welcome, then the engine step once its short scan is over.
  await rec.key()
  rec.hold(0.4)
  await rec.click(getStarted, {
    dur: 0.7, after: 0.1,
    until: () => expect(page.getByText('Ready to chat')).toBeVisible({ timeout: 20_000 }),
  })
  const engineCard = page.getByRole('button', { name: /LU Engine/ })
  rec.scene('LU Engine is already selected. It runs on your machine, nothing to install.')
  await rec.cam(engineCard, 1.5)
  await rec.move(engineCard, { dur: 0.6, at: { fx: 0.85 } })
  rec.hold(1.6)
  await rec.cam('full', 1, 0.7)
  await rec.click(page.getByRole('button', { name: /^Continue/ }), {
    dur: 0.5, after: 0.2,
    until: () => expect(page.getByText('Image & Video Generation')).toBeVisible(),
  })

  rec.scene('Image and video are not needed for chat. Skip them now, install them later in Settings.')
  const skip = page.getByRole('button', { name: /Skip for now/i })
  await expect(skip).toBeVisible({ timeout: 20_000 })
  await rec.cam({ x: 720, y: 520 }, 1.4, 0.8)
  await rec.key(300)
  rec.hold(1.2)
  await rec.click(skip, {
    dur: 0.6, after: 0.2,
    until: () => expect(page.getByRole('heading', { name: /Pick a starter model/i })).toBeVisible(),
  })

  rec.scene('Recommended marks the strongest starter your graphics card can carry.')
  const card = page.getByRole('button', { name: /Qwen 3\.5 9B/ })
  await expect(card).toContainText('Recommended')
  await rec.cam(card, 1.45)
  await rec.click(card, { dur: 0.7, at: { fx: 0.3 }, after: 0.5 })
  const install = page.getByRole('button', { name: /Install 1 model/ })
  await rec.click(install, {
    dur: 0.6, after: 0.1,
    until: () => expect(page.getByText(/Downloading/)).toBeVisible(),
  })

  rec.scene('Install waits until the file is complete, then starts the engine on it.')
  await rec.cam(page.getByText(/Downloading/), 1.45, 0.7)
  await rec.key(400)
  rec.hold(1.7)
  await page.evaluate(() => { (window as unknown as { __E2E_DL_RELEASE__: boolean }).__E2E_DL_RELEASE__ = true })
  // The optional documents step and the closing "Get Started" are passed off
  // camera: they are not what this how-to is about.
  await expect(page.getByRole('button', { name: /Skip for now/i })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: /Skip for now/i }).click()
  await expect(getStarted).toBeVisible()
  await getStarted.click()
  await expect(async () => {
    const back = page.getByRole('button', { name: /Back to chat/i })
    if (await back.isVisible().catch(() => false)) await back.click()
    await page.getByRole('button', { name: /New Chat/i }).click()
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await page.mouse.move(1200, 812)
  await rec.cam('full', 1, 0.4)
  await rec.key(700)

  rec.scene('Then type your first message. Your chats stay on your machine.')
  const composer = page.locator('textarea').first()
  await rec.click(composer, { dur: 0.6, at: { fx: 0.3 }, after: 0.05 })
  await rec.move({ x: 1200, y: 812 }, { dur: 0.3, real: false })
  await rec.type(composer, 'What can you help me with?', { cps: 30 })
  await rec.click(page.getByRole('button', { name: /Send message/i }), {
    dur: 0.45, after: 0.2, settle: 900,
    until: () => expect(page.getByText(/I am running on this computer/)).toBeVisible({ timeout: 20_000 }),
  })
  rec.finish(1.6)
})
