import { test, expect } from '@playwright/test'
import { Rec, HOWTO_OUT } from './rec'

// Dictation in the chat box (3.0.7: sending while you dictate ends the
// recording). Recorded on 0a62b652d (integ/307). Facts, all from that head:
//  - components/chat/VoiceButton.tsx: the microphone button in the composer,
//    "Start voice input" / "Stop recording" (aria-pressed while recording).
//    Greyed out with micUnavailableHint when speech-to-text is missing:
//    "Speech-to-text is not installed. Install faster-whisper in Settings →
//    Voice & Remote." (Local mode).
//  - hooks/useVoice.ts startRecording: in Local mode the audio so far is
//    transcribed about every 1.4 s and written into the field while you talk;
//    stopRecording transcribes the whole take once more at the end.
//  - components/chat/ChatInput.tsx applyDictation: the transcript goes into
//    the field after what was there and is NEVER sent by itself.
//    handleSend + VoiceButton endOnSend: Send or Enter while recording sends
//    what the field shows and ends the take (cancelRecording, nothing comes
//    back into the emptied field). The VoiceButton has no `disabled` while an
//    answer runs, so a new take can start then (fix of 15.10.2026).
//  - api/voice.ts and public/whisper_server.py: local dictation is
//    faster-whisper on the CPU of this machine (WhisperModel "base"), reached
//    through the Tauri command `transcribe`. This is not the Voice engine
//    (Voice, beta, English, Whisper base.en in the voice loop): dictation has
//    its own Speech-to-Text row in Settings.
//  - components/settings/SpeechSettings.tsx: Settings, Voice & Remote, Speech
//    lists "Speech-to-Text faster-whisper" with Download & Install when it is
//    missing; MicrophoneSetting.tsx: "Microphone", "Used for dictation in chat
//    and for Voice."
//
// FIXTURES (said in the report too):
//  - Chromium's fake capture device stands in for the microphone (launch
//    flags, as e2e/dictation-ends-on-send.spec.ts does). No real audio.
//  - whisper_status answers available (faster-whisper installed and loaded).
//  - transcribe answers an example sentence per take ("Write a short packing
//    list for a weekend hike", then "Add a rain jacket"), a few more words
//    with every call, the way interim chunks grow while someone talks. No speech recognition
//    runs.
//  - The local model's answer is an example packing list in 14 slow frames
//    (the rig's mocked engine), so the answer is still running when the
//    microphone is pressed again. No model runs.
test.use({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
})

test('dictation', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(150_000)
  const rec = await Rec.boot(page, 'dictation', 'Dictate in the chat', {
    mode: 'local',
    tauri: { platform: 'windows', replyChunks: 14, replyChunkDelayMs: 600, assistantReply: 'A short list for a weekend hike: water, snacks, a map, a warm layer and a small first aid kit.' },
    initScript: () => {
      type Bridge = { invoke: (cmd: string, args: unknown) => Promise<unknown> }
      const w = window as unknown as { __TAURI_INTERNALS__: Bridge; __luTake?: number }
      const bridge = w.__TAURI_INTERNALS__
      const invoke = bridge.invoke
      const takes = ['Write a short packing list for a weekend hike', 'Add a rain jacket']
      let calls = 0
      let take = 0
      bridge.invoke = (cmd, args) => {
        if (cmd === 'whisper_status') return Promise.resolve({ available: true, backend: 'faster-whisper' })
        if (cmd === 'transcribe') {
          // The spec sets __luTake before the second take.
          if ((w.__luTake ?? 0) !== take) { take = w.__luTake ?? 0; calls = 0 }
          const words = takes[take].split(' ')
          calls += 1
          const n = Math.min(words.length, calls * 2 + (take === 0 ? 2 : 1))
          return Promise.resolve({ transcript: words.slice(0, n).join(' '), language: 'en' })
        }
        return invoke(cmd, args)
      }
    },
  })

  // A new chat, sidebar back on its rail. Done before the film starts.
  await expect(async () => {
    await page.getByRole('button', { name: /New Chat/i }).first().click()
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  const mic = page.getByRole('button', { name: 'Start voice input' })
  await expect(mic).toBeEnabled({ timeout: 20_000 })
  const field = page.locator('textarea').first()
  await page.mouse.move(1380, 860)
  await page.waitForTimeout(600)

  await rec.key()
  rec.scene('The microphone in the chat box writes what you say into the field while you talk.')
  await rec.cam(mic, 1.6)
  await rec.click(mic, { dur: 0.8, after: 0.2, until: () => expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible() })
  for (const words of ['Write a short packing', 'Write a short packing list for', 'Write a short packing list for a weekend']) {
    await expect(field).toHaveValue(words, { timeout: 10_000 })
    await rec.key(150)
    rec.hold(0.7)
  }
  await expect(field).toHaveValue('Write a short packing list for a weekend hike', { timeout: 10_000 })
  await rec.key(150)
  rec.hold(0.6)

  rec.scene('Send or Enter ends the recording first and sends what the field shows.')
  // The whole window: the sent message on top, the composer below.
  await rec.cam('full', 1, 1.0)
  await rec.click(page.getByRole('button', { name: 'Send message' }), {
    dur: 0.6, after: 0.3,
    until: () => expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible(),
  })
  await expect(field).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Start voice input' })).toBeEnabled()
  rec.hold(0.8)

  rec.scene('While the answer still runs, the microphone is free for the next take.')
  await page.evaluate(() => { (window as unknown as { __luTake: number }).__luTake = 1 })
  await rec.click(page.getByRole('button', { name: 'Start voice input' }), {
    dur: 0.6, after: 0.2,
    until: () => expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible(),
  })
  await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible()
  await expect(field).toHaveValue('Add a rain', { timeout: 10_000 })
  await rec.key(150)
  rec.hold(0.9)
  await rec.click(page.getByRole('button', { name: 'Stop recording' }), {
    dur: 0.4, after: 0.6,
    until: () => expect(field).toHaveValue('Add a rain jacket', { timeout: 10_000 }),
  })
  rec.hold(0.6)

  // Settings, Voice & Remote: Speech-to-Text and the microphone.
  rec.scene('Dictation runs on your computer with faster-whisper, set up under Settings, Voice & Remote.')
  await rec.click(page.getByRole('button', { name: 'Settings' }).first(), { dur: 0.7, after: 0.2 })
  await rec.click(page.getByRole('button', { name: 'Voice & Remote', exact: true }).first(), {
    dur: 0.7, after: 0.2,
    until: () => expect(page.getByTestId('settings-microphone')).toBeVisible(),
  })
  const sel = page.getByTestId('settings-microphone')
  const stt = page.getByText('Speech-to-Text', { exact: true })
  await expect(page.getByTestId('settings-microphone-hint')).toHaveText('Used for dictation in chat and for Voice.')
  await rec.cam({ x: 820, y: 210 }, 1.6, 0.9)
  await rec.move(stt, { dur: 0.6, at: { fx: 1, dx: 40 } })
  rec.hold(0.9)
  await rec.move(sel, { dur: 0.7, at: { fx: 0.5 } })
  await rec.key(300)
  rec.hold(1.6)
  rec.finish(1.0)
})
