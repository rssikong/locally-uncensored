import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { Rec, HOWTO_OUT } from './rec'

// A trained character in the chat (3.0.7: in chat, the image and video tools
// take a character by name or trigger word). Recorded on 0a62b652d
// (integ/307). Facts, all from that head:
//  - lib/chat-tool-intent.ts CHAT_TOOLS and hooks/useChat.ts: in Local mode a
//    plain chat (Agent off) routes a message that asks for a picture or a clip
//    through image_generate / video_generate. In Cloud mode media requests
//    stay plain chat, so this film is Local mode.
//  - api/mcp/builtin-tools.ts: both tools have the argument `character`
//    (lib/character-chat.ts CHARACTER_ARG_SCHEMA: "Name or trigger word of a
//    trained character. LU sets its model, LoRA and trigger word.").
//  - lib/characters.ts resolveCharacter: name or trigger word, without regard
//    to case; an unknown name answers with the list of characters.
//    characterFromLora: a local character is a LoRA file char_<trigger>_...,
//    its name is the trigger word.
//  - lib/character-chat.ts characterImageArgs: the run gets the Z Image model
//    the character was trained for, its LoRA and the trigger word in the
//    prompt. characterVideoArgs: a video first makes an image of the
//    character and starts the clip from it.
//
// FIXTURES (said in the report too), the ComfyUI side the way
// character-everywhere.spec.ts builds it:
//  1. ComfyUI (port 8188, through the Tauri command proxy_localhost):
//     /object_info lists the Z Image Turbo model with its text encoder and VAE
//     and one LoRA, char_rustyfox_zimage.safetensors, the file a finished
//     local training run leaves. /prompt answers a prompt id, /history
//     reports one finished image. Not real: no ComfyUI runs, nothing is
//     rendered, no run trained the character.
//  2. The finished image is the example photo fox-1.jpg of the Cloud
//     character film, served for ComfyUI's /view (page.route, and the app's
//     own fetch of it sent to /__lu_fx/view on the page's origin).
//  3. The chat model is the rig's mocked engine with a scripted turn: it
//     calls image_generate with character "rustyfox", then answers one
//     line. No model runs.
//  4. detect_gpus: one 16 GB card; sniff_model_files: nothing to sniff;
//     comfyui_status: running.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

const FOX = `${HOWTO_OUT}/character/assets/fox-1.jpg`
const ASK = 'make an image of rustyfox standing in an autumn forest'

test('character-chat', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(150_000)
  const foxView = readFileSync(FOX)
  const rec = await Rec.boot(page, 'character-chat', 'A character in the chat', {
    mode: 'local',
    tauri: {
      platform: 'windows',
      agentTurns: [
        { toolCalls: [{ name: 'image_generate', args: { prompt: 'standing in an autumn forest', character: 'rustyfox' } }] },
        { text: 'Here is the picture of rustyfox.' },
      ],
    },
    initScript: () => {
      const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: { url?: string; method?: string }) => Promise<unknown> } }
      const bridge = w.__TAURI_INTERNALS__
      const invoke = bridge.invoke
      const combo = (v: string[]) => [v]
      // Fixture 1: what a running ComfyUI lists.
      const nodes: Record<string, unknown> = {
        UNETLoader: { input: { required: { unet_name: combo(['z_image_turbo_bf16.safetensors']) } } },
        CLIPLoader: { input: { required: { clip_name: combo(['qwen_3_4b.safetensors']) } } },
        LoraLoader: { input: { required: { lora_name: combo(['char_rustyfox_zimage.safetensors']) } } },
        VAELoader: { input: { required: { vae_name: combo(['ae.safetensors']) } } },
        KSampler: { input: { required: { sampler_name: combo(['euler']), scheduler: combo(['simple']) } } },
        LoadImage: { input: { required: { image: combo([]) } } },
        SaveImage: { input: { required: {} } },
      }
      // Fixture 2: the rig's fetch refuses foreign loopback ports.
      const rigFetch = window.fetch.bind(window)
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (/^http:\/\/(127\.0\.0\.1|localhost):8188\/view/.test(u)) return rigFetch(`${location.origin}/__lu_fx/view`, init)
        return rigFetch(input, init)
      }
      let prompts = 0
      bridge.invoke = (command, args) => {
        if (command === 'sniff_model_files') return Promise.resolve([])
        // Fixture 1: ComfyUI is running (the chat tools ask before a run).
        if (command === 'comfyui_status') return Promise.resolve({ running: true, starting: false, found: true })
        if (command === 'detect_gpus') return Promise.resolve([{ index: 0, vendor: 'nvidia', name: 'GPU', memory_mib: 16384, source: 'fixture' }])
        if (command !== 'proxy_localhost' || !args?.url?.includes(':8188')) return invoke(command, args)
        const url = args.url
        if (url.includes('/system_stats')) return Promise.resolve(JSON.stringify({ devices: [{ name: 'GPU', type: 'cuda', vram_total: 16 * 1024 ** 3 }] }))
        const one = /\/object_info\/([^/?]+)/.exec(url)
        if (one) return Promise.resolve(JSON.stringify(one[1] in nodes ? { [one[1]]: nodes[one[1]] } : {}))
        if (url.includes('/object_info')) return Promise.resolve(JSON.stringify(nodes))
        if (url.endsWith('/prompt') && args.method === 'POST') {
          prompts += 1
          return Promise.resolve(JSON.stringify({ prompt_id: `p${prompts}`, number: prompts, node_errors: {} }))
        }
        const hist = /\/history\/(p\d+)/.exec(url)
        if (hist) {
          return Promise.resolve(JSON.stringify({ [hist[1]]: {
            status: { completed: true, status_str: 'success', messages: [] },
            outputs: { 9: { images: [{ filename: 'rustyfox_00001_.png', subfolder: '', type: 'output' }] } },
          } }))
        }
        if (url.includes('/queue')) return Promise.resolve(JSON.stringify({ queue_running: [], queue_pending: [] }))
        return Promise.resolve('{}')
      }
    },
    fixtures: async (page) => {
      await page.route(/^http:\/\/(127\.0\.0\.1|localhost):8188\/view/, (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: foxView }))
      await page.route('**/__lu_fx/view', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: foxView }))
    },
  })

  await expect(async () => {
    await page.getByRole('button', { name: /New Chat/i }).first().click()
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  const composer = page.locator('textarea').first()
  const send = page.getByRole('button', { name: 'Send message' })
  await page.mouse.move(1380, 860)
  await page.waitForTimeout(600)

  await rec.key()
  rec.scene('In a local chat, Agent off, ask for a picture and name a character you trained.')
  await rec.cam({ x: 720, y: 760 }, 1.5)
  await rec.click(composer, { dur: 0.6, at: { fx: 0.3 }, after: 0.1 })
  await rec.move({ x: 1180, y: 812 }, { dur: 0.3, real: false })
  await rec.type(composer, ASK, { cps: 30 })
  await rec.cam('full', 1, 1.0)
  await rec.click(send, {
    dur: 0.5, after: 0.3,
    until: () => expect(page.getByText('Waiting for your approval')).toBeVisible({ timeout: 45_000 }),
  })
  rec.scene('The image tool takes the character by name. You approve the call first.')
  const call = page.getByRole('button', { name: 'image_generate' })
  await rec.cam(call, 1.6, 0.9)
  await rec.move(call, { dur: 0.7, at: { fx: 0, dx: 120, dy: 58 } })
  rec.hold(1.4)
  await rec.click(page.getByRole('button', { name: 'Approve' }).first(), {
    dur: 0.6, after: 0.3,
    until: () => expect(page.getByText('Here is the picture of rustyfox')).toBeVisible({ timeout: 45_000 }),
  })
  rec.scene('LU runs the character\'s model and LoRA, and its trigger word leads the prompt.')
  const line = page.getByText(/^Image generated: rustyfox_00001_\.png/)
  await rec.cam(line, 1.6, 1.0)
  await rec.move(line, { dur: 0.8, at: { fx: 0.62, dy: 14 }, real: false })
  rec.hold(2.2)
  rec.finish(1.2)
})
