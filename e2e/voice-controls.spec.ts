import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_MODEL_NAME, DEFAULT_ASSISTANT_REPLY } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'
import { appModules, type AppWindow } from './support/ui'

/**
 * The switches at the top of the Voice surface, without a voice loop behind
 * them: Agent, Where it may work, Thinking, and the light switch that
 * unloads Voice. What a session does with them against the real voice loop
 * is voice-session-live.spec.ts.
 */

const SHOTS = process.env.LU_VOICE_SHOTS

type Calls = Array<{ cmd: string; on?: boolean }>

async function boot(page: Page, voiceLoop: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.addInitScript(() => {
    MediaDevices.prototype.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream
  })
  await page.addInitScript(tauriMockInit, {
    assistantReply: DEFAULT_ASSISTANT_REPLY,
    modelName: DEFAULT_MODEL_NAME,
    platform: 'mac' as const,
    voiceLoop: { installed: true, session: { port: 9, token: 'e2e-launch-token'.padEnd(64, '0') }, ...voiceLoop },
  })
  await seedOnboardingDone(page)
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Voice', exact: true }).click()
  await expect(page.getByTestId('voice-view')).toBeVisible()
}

const calls = (page: Page) => page.evaluate(() => ((window as unknown as { __E2E_VOICE_LOOP_CALLS__?: Calls }).__E2E_VOICE_LOOP_CALLS__ ?? []))
const stored = (page: Page) => appModules(page, ['/src/stores/voiceStore.ts']).then(() => page.evaluate(() => {
  const { useVoiceStore } = (window as unknown as AppWindow).__APP__['/src/stores/voiceStore.ts']
  const { loopAgent, loopScope, loopComputerConfirmed, loopThinking, loopThinkingBudget } = useVoiceStore.getState()
  return { loopAgent, loopScope, loopComputerConfirmed, loopThinking, loopThinkingBudget }
}))

test('the switches sit in one row next to the title, all the same size, and nothing is added to the lower part', async ({ page }) => {
  await boot(page)
  const view = page.getByTestId('voice-view')
  const bar = view.getByRole('toolbar', { name: 'Voice controls' })
  const buttons = [
    bar.getByRole('button', { name: 'Voice settings' }),
    bar.getByRole('button', { name: 'Agent' }),
    bar.getByTestId('voice-scope'),
    bar.getByRole('button', { name: 'Thinking' }),
  ]
  const title = (await view.getByRole('heading', { name: 'Voice' }).boundingBox())!
  const boxes = []
  for (const button of buttons) {
    await expect(button).toBeVisible()
    await expect(button).toHaveAttribute('title', /.+/)
    boxes.push((await button.boundingBox())!)
  }
  for (const box of boxes) {
    expect(Math.round(box.width)).toBe(Math.round(boxes[0].width))
    expect(Math.round(box.height)).toBe(Math.round(boxes[0].height))
    expect(Math.round(box.y)).toBe(Math.round(boxes[0].y))
    // Top left: in the row of the title, in the left third of the surface.
    expect(box.x).toBeGreaterThan(title.x + title.width)
    expect(box.x).toBeLessThan(430)
    expect(Math.abs(box.y + box.height / 2 - (title.y + title.height / 2))).toBeLessThan(6)
  }
  // Left to right without gaps or overlap.
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width)
  // Nothing is loaded yet: no light switch.
  await expect(view.getByTestId('voice-unload')).toHaveCount(0)
  // The part with Start has no new control.
  await expect(view.getByTestId('voice-session').getByRole('button')).toHaveCount(1)
  if (SHOTS) await page.waitForTimeout(500)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/n4-switches-next-to-title.png` })
})

test('Agent and Thinking switch with one click, by mouse and by keyboard, and stay after a reload', async ({ page }) => {
  await boot(page)
  const bar = page.getByRole('toolbar', { name: 'Voice controls' })
  const agent = bar.getByRole('button', { name: 'Agent' })
  await expect(agent).toHaveAttribute('aria-pressed', 'true')
  await agent.click()
  await expect(agent).toHaveAttribute('aria-pressed', 'false')
  await expect(agent).toHaveAttribute('title', /Conversation with web search/)
  await expect(bar.getByTestId('voice-scope')).toBeDisabled()
  // The keyboard reaches it and Space moves it.
  await agent.focus()
  await page.keyboard.press('Space')
  await expect(agent).toHaveAttribute('aria-pressed', 'true')
  await expect(bar.getByTestId('voice-scope')).toBeEnabled()

  const thinking = bar.getByRole('button', { name: 'Thinking' })
  if (await thinking.isEnabled()) {
    await expect(thinking).toHaveAttribute('aria-pressed', 'false')
    await thinking.focus()
    await page.keyboard.press('Enter')
    await expect(thinking).toHaveAttribute('aria-pressed', 'true')
    expect((await stored(page)).loopThinking).toBe(true)
  } else {
    // A model that cannot be switched says why instead.
    await expect(thinking).toHaveAttribute('title', /always on for this model|does not support thinking/)
  }
  await agent.click()
  expect((await stored(page)).loopAgent).toBe(false)
  await page.reload()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Voice', exact: true }).click()
  await expect(page.getByRole('toolbar', { name: 'Voice controls' }).getByRole('button', { name: 'Agent' })).toHaveAttribute('aria-pressed', 'false')
})

test('Where it may work: the narrowest level first, the sandbox locked with its reason, the whole computer only after a clear yes', async ({ page }) => {
  await boot(page)
  const view = page.getByTestId('voice-view')
  const scope = view.getByTestId('voice-scope')
  await expect(scope).toHaveAttribute('data-scope', 'workspace')
  await scope.click()
  const menu = view.getByRole('menu', { name: 'Where it may work' })
  await expect(menu.getByRole('menuitemradio', { name: /Workspace only/ })).toHaveAttribute('aria-checked', 'true')
  const sandbox = menu.getByTestId('voice-scope-sandbox')
  await expect(sandbox).toHaveAttribute('aria-disabled', 'true')
  await expect(sandbox).toContainText('LU cannot run commands in an isolated environment')
  if (SHOTS) await page.waitForTimeout(500)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/n2-where-it-may-work.png` })
  await sandbox.click({ force: true })
  expect((await stored(page)).loopScope).toBe('workspace')

  // Escape closes the menu and gives the focus back.
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  // By keyboard: open, down to the whole computer (the locked one is skipped), Enter.
  await scope.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Whole computer' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('never types into a password field')
  expect((await stored(page)).loopScope).toBe('workspace')
  if (SHOTS) await page.waitForTimeout(500)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/n2-whole-computer-question.png` })

  // No: nothing changes. Escape is a no as well.
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(await stored(page)).toMatchObject({ loopScope: 'workspace', loopComputerConfirmed: false })

  // Yes.
  await scope.click()
  await view.getByRole('menuitemradio', { name: /Whole computer/ }).click()
  await page.getByRole('button', { name: 'Allow the whole computer' }).click()
  await expect(scope).toHaveAttribute('data-scope', 'computer')
  await expect(scope).toHaveAttribute('aria-label', 'Where it may work: Whole computer')
  expect(await stored(page)).toMatchObject({ loopScope: 'computer', loopComputerConfirmed: true })
  await appModules(page, ['/src/stores/computerStore.ts'])
  expect(await page.evaluate(() => (window as unknown as AppWindow).__APP__['/src/stores/computerStore.ts'].useComputerStore.getState().enabled)).toBe(true)

  // Back to the folder takes the grant away on the Rust side.
  await expect(dialog).toHaveCount(0)
  await scope.click()
  await view.getByRole('menuitemradio', { name: /Workspace only/ }).click()
  await expect(scope).toHaveAttribute('data-scope', 'workspace')
  expect((await calls(page)).some((call) => call.cmd === 'fs_whole_computer_forget')).toBe(true)
})

test('the light switch is there while Voice is loaded, names what a click frees, and one click unloads', async ({ page }) => {
  await boot(page, { running: true, memoryBytes: 1_181_000_000 })
  const view = page.getByTestId('voice-view')
  const light = view.getByTestId('voice-unload')
  await expect(light).toBeVisible()
  await expect(light).toHaveAttribute('role', 'switch')
  await expect(light).toHaveAttribute('aria-checked', 'true')
  await expect(light).toHaveText('1.1 GB')
  await expect(light).toHaveAttribute('title', /^Unload Voice and free about 1\.1 GB\. One click ends the session, stops the voice engine/)
  // Right of the title, left of the switches.
  const title = (await view.getByRole('heading', { name: 'Voice' }).boundingBox())!
  const box = (await light.boundingBox())!
  const gear = (await view.getByRole('button', { name: 'Voice settings' }).boundingBox())!
  expect(box.x).toBeGreaterThan(title.x + title.width)
  expect(box.x + box.width).toBeLessThanOrEqual(gear.x)
  if (SHOTS) await page.waitForTimeout(500)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/n6-light-switch-loaded.png`, clip: { x: 0, y: 80, width: 700, height: 80 } })

  await light.click()
  await expect(view.getByTestId('voice-unloaded')).toHaveText('Voice is unloaded. 1.1 GB freed.')
  await expect(light).toHaveCount(0)
  expect((await calls(page)).filter((call) => call.cmd === 'voice_loop_stop')).toHaveLength(1)
  if (SHOTS) await page.waitForTimeout(500)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/n7-unloaded.png`, clip: { x: 0, y: 80, width: 700, height: 80 } })
})

test('a thought is the folded Thinking block of the chat, and its length is a slider in the settings popup', async ({ page }) => {
  await boot(page)
  const view = page.getByTestId('voice-view')
  await appModules(page, ['/src/stores/voiceSessionStore.ts'])
  await page.evaluate(() => {
    const { useVoiceSessionStore } = (window as unknown as AppWindow).__APP__['/src/stores/voiceSessionStore.ts']
    const send = useVoiceSessionStore.getState().dispatch
    send({ type: 'start', at: Date.now(), muted: false })
    send({ type: 'brain', modelLabel: 'Qwen3 4B', notice: null })
    send({ type: 'ready' })
    send({ type: 'user-text', text: 'Why is the sky blue?', final: true })
    send({ type: 'thought-text', text: 'Okay, the user asks why the sky is blue. Rayleigh scattering: short wavelengths scatter more. Keep it short.' })
    send({ type: 'thought-end', secs: 3.2 })
    send({ type: 'bot-text', text: 'Because air scatters the blue part of sunlight the most.' })
    send({ type: 'bot-silent' })
  })
  const thought = view.locator('[data-role="thought"]')
  const header = thought.getByRole('button', { name: 'Toggle thinking details' })
  await expect(header).toHaveText('Thought for 3 s')
  await expect(thought).not.toContainText('Rayleigh')
  await expect(view).not.toContainText('<think>')
  await expect(view).not.toContainText('(Think)')
  if (SHOTS) await page.waitForTimeout(500)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f2-thought-folded.png` })
  await header.click()
  await expect(thought).toContainText('Rayleigh scattering')
  if (SHOTS) await page.waitForTimeout(500)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f2-thought-open.png` })

  // The length: a slider in the popup, which closes by its X and by Escape.
  await view.getByRole('button', { name: 'Voice settings' }).click()
  const popup = page.getByRole('dialog', { name: 'Voice settings' })
  const slider = popup.getByRole('slider', { name: 'Thinking length' })
  await expect(popup.getByRole('region', { name: 'Thinking' })).toContainText('up to 512 tokens')
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await expect(popup.getByRole('region', { name: 'Thinking' })).toContainText('up to 1024 tokens')
  expect((await stored(page)).loopThinkingBudget).toBe(1024)
  if (SHOTS) await page.waitForTimeout(500)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/f3-thinking-length.png` })
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
  await view.getByRole('button', { name: 'Voice settings' }).click()
  await page.getByRole('dialog', { name: 'Voice settings' }).getByRole('button', { name: /close/i }).click()
  await expect(page.getByRole('dialog', { name: 'Voice settings' })).toHaveCount(0)
})
