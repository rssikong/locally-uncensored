import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'
import { appModules, openNewChat, type AppWindow } from './support/ui'

/**
 * Sent while dictating (David, 15.10.2026, Mac app): he pressed the
 * microphone, spoke, and sent. The take went on after the send, and the
 * microphone button was greyed out while the answer ran, so only a stop of
 * the answer gave it back.
 *
 * Now the send ends the take: the words in the field go out, nothing of the
 * take comes back into the emptied field, the microphone is free and its
 * button is there to press, also while the answer still streams.
 *
 * Chromium's fake capture device stands in for the microphone; whether
 * speech-to-text is installed is not the subject, so it is switched on
 * directly. The answer streams slowly, so the state during it can be seen.
 */
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
})

const VOICE_STORE = '/src/stores/voiceStore.ts'

async function boot(page: Page) {
  await page.addInitScript(tauriMockInit, {
    assistantReply: DEFAULT_ASSISTANT_REPLY,
    modelName: DEFAULT_MODEL_NAME,
    replyChunks: 12,
    replyChunkDelayMs: 400,
  })
  // Every track the page opened, to see that the take let go of the device.
  await page.addInitScript(() => {
    const tracks: MediaStreamTrack[] = []
    ;(window as unknown as { __TRACKS__: MediaStreamTrack[] }).__TRACKS__ = tracks
    const devices = navigator.mediaDevices
    const open = devices.getUserMedia.bind(devices)
    devices.getUserMedia = async (constraints) => {
      const stream = await open(constraints)
      tracks.push(...stream.getAudioTracks())
      return stream
    }
  })
  await seedOnboardingDone(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await appModules(page, [VOICE_STORE])
  await openNewChat(page)
  await page.evaluate((path) => {
    (window as unknown as AppWindow).__APP__[path].useVoiceStore.getState().setSttAvailable(true)
  }, VOICE_STORE)
}

const recording = (page: Page) => page.evaluate((path) =>
  (window as unknown as AppWindow).__APP__[path].useVoiceStore.getState().isRecording, VOICE_STORE)

const liveTracks = (page: Page) => page.evaluate(() =>
  (window as unknown as { __TRACKS__: MediaStreamTrack[] }).__TRACKS__.filter((t) => t.readyState === 'live').length)

async function startDictating(page: Page, words: string) {
  const field = page.locator('textarea').first()
  await field.fill(words)
  await page.getByRole('button', { name: 'Start voice input' }).click()
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible()
  expect(await recording(page)).toBe(true)
  expect(await liveTracks(page)).toBe(1)
}

async function expectTheTakeEnded(page: Page) {
  // The take is over and the device is let go.
  await expect.poll(() => recording(page)).toBe(false)
  await expect.poll(() => liveTracks(page)).toBe(0)
  // The answer still runs, and the microphone can be pressed again right
  // now, not only once the answer is through (a waiting check would pass
  // after the answer ended, so both are read in one go).
  const during = await page.evaluate(() => ({
    answering: !!document.querySelector('button[aria-label="Stop generation"]'),
    micFree: !(document.querySelector('[data-voice-button]') as HTMLButtonElement | null)?.disabled,
  }))
  expect(during).toEqual({ answering: true, micFree: true })
  // Nothing of the take fills the emptied field afterwards.
  await page.waitForTimeout(2_000)
  await expect(page.locator('textarea').first()).toHaveValue('')
}

test('the Send button ends the take, and the microphone stays free during the answer', async ({ page }) => {
  await boot(page)
  await startDictating(page, 'what is the capital of france')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('what is the capital of france')).toBeVisible()
  await expectTheTakeEnded(page)
})

test('Enter sends while dictating and ends the take the same way', async ({ page }) => {
  await boot(page)
  await startDictating(page, 'tell me a short joke')
  await page.locator('textarea').first().press('Enter')
  await expect(page.getByText('tell me a short joke')).toBeVisible()
  await expectTheTakeEnded(page)
})

test('a take started while the answer runs can be stopped again', async ({ page }) => {
  await boot(page)
  await page.locator('textarea').first().fill('count to ten')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible()
  // While the answer runs the microphone starts, as the field takes typing ...
  await page.getByRole('button', { name: 'Start voice input' }).click()
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeEnabled()
  expect(await recording(page)).toBe(true)
  await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible()
  // ... and stops again before the answer is through.
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect.poll(() => recording(page)).toBe(false)
  await expect.poll(() => liveTracks(page)).toBe(0)
  await expect(page.getByRole('button', { name: 'Start voice input' })).toBeEnabled()
})
