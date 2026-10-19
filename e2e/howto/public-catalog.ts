import type { Page } from '@playwright/test'
import { readFileSync } from 'fs'
import { CLOUD_MODEL_SEED, type CloudModel } from '../../src/lib/render/cloud-models'
import { Rec, HOWTO_OUT } from './rec'

/**
 * The public price list as the Create catalog of a how-to.
 *
 * Rule of the films: no price and no credit figure on screen that is not on
 * the public site. The live catalog needs an account, so these fixtures answer
 * with the public figures instead: lu-howto-site docs/cloud-facts.json
 * (updated 2026-09-22), copied below. Image and Video models are exactly the
 * 7 image and 15 video models listed there, with their names and their
 * credits_per_run (video: one 5 s clip, so a public video model books 5 s
 * only). The flags that decide where a model shows (t2v, i2v, adult, tier,
 * weights, negative prompt) come from the app's own bundled list
 * (CLOUD_MODEL_SEED, src/lib/render/cloud-models.ts) and the app's own Studio
 * registry (src/lib/render/studio-models.json); nothing is invented.
 *
 * Studio models (z-image, nucleus-image, jib-mix-qwen, wan-2.2-realism,
 * open-video, open-video-lora, wan-3.0-spicy, wan-3.0-prime-spicy) are sent
 * the way the server sends them (`quote_required`, no `credits`). The app
 * prices their rows from its registry, which gives exactly the public figure
 * (studioBaseCredits: 1000, 1000, 2000, 2500, 10000, 15000, 25000, 37500),
 * and /api/jobs/studio-quote answers with the public figure too.
 *
 * Every public video model renders from a picture (image-to-video, t2v false
 * in the app's list), so the public list has nothing for the Video tab
 * (text-to-video). `withTextToVideo` adds the app's own text-to-video models
 * from CLOUD_MODEL_SEED with the 5 s price lu-labs.ai/pricing publishes for
 * them (TEXT_TO_VIDEO_PRICES). quota.costs stays 0, the meter's "price not
 * known" state for anything without a price (credits-meter.ts).
 *
 * The balance is the Hosted plan's monthly credits from the same file
 * (plans.hosted.monthly_credits = 900000), nothing used yet, plan "hosted".
 */

export const PUBLIC_FACTS_UPDATED = '2026-09-22'
export const HOSTED_MONTHLY_CREDITS = 900_000

/** docs/cloud-facts.json `models`: id, name, kind, credits_per_run, specialized. */
export const PUBLIC_MODELS: { id: string; name: string; kind: 'image' | 'video'; credits: number; specialized?: true }[] = [
  { id: 'chroma', name: 'Chroma Uncensored', kind: 'image', credits: 1500 },
  { id: 'prefect-pony', name: 'Prefect Pony XL Uncensored', kind: 'image', credits: 1500 },
  { id: 'neta-lumina', name: 'Neta Lumina (anime) Uncensored', kind: 'image', credits: 1000 },
  { id: 'z-image', name: 'Z-Image Base', kind: 'image', credits: 1000 },
  { id: 'nucleus-image', name: 'Nucleus', kind: 'image', credits: 1000 },
  { id: 'jib-mix-qwen', name: 'JibMix Qwen', kind: 'image', credits: 2000 },
  { id: 'wan-2.2-realism', name: 'Wan 2.2 Realism', kind: 'image', credits: 2500 },
  { id: 'wan-2.2-spicy', name: 'Wan 2.2 Uncensored', kind: 'video', credits: 15000 },
  { id: 'ltx-2.3-spicy', name: 'LTX 2.3 Uncensored', kind: 'video', credits: 10000 },
  { id: 'wan-2.6-spicy', name: 'Wan 2.6 Uncensored', kind: 'video', credits: 50000 },
  { id: 'wan-2.7-spicy', name: 'Wan 2.7 Uncensored', kind: 'video', credits: 50000 },
  { id: 'minimax-h3-spicy', name: 'MiniMax H3 Uncensored', kind: 'video', credits: 20000 },
  { id: 'seedance-1.5-pro-spicy', name: 'Seedance 1.5 Pro Uncensored', kind: 'video', credits: 26000 },
  { id: 'seedance-2.5-spicy', name: 'Seedance 2.5 Uncensored', kind: 'video', credits: 90000 },
  { id: 'seedance-2.0-spicy', name: 'Seedance 2.0 Uncensored', kind: 'video', credits: 60000 },
  { id: 'seedance-2.0-fast-spicy', name: 'Seedance 2.0 Fast Uncensored', kind: 'video', credits: 50000 },
  { id: 'vidu-q3-spicy', name: 'Vidu Q3 Uncensored', kind: 'video', credits: 35000 },
  { id: 'open-video', name: 'OpenVideo', kind: 'video', credits: 10000 },
  { id: 'open-video-lora', name: 'OpenVideo + Style LoRA', kind: 'video', credits: 15000 },
  { id: 'wan-3.0-spicy', name: 'Wan 3.0 Uncensored', kind: 'video', credits: 25000 },
  { id: 'wan-3.0-prime-spicy', name: 'Wan 3.0 Prime Uncensored', kind: 'video', credits: 37500 },
  { id: 'wan-2.2-spicy-extend', name: 'Wan 2.2 Uncensored Extend', kind: 'video', credits: 15000, specialized: true },
]

/** Public models the app knows as Studio models (studio-models.json). */
const STUDIO_IDS = new Set(['z-image', 'nucleus-image', 'jib-mix-qwen', 'wan-2.2-realism', 'open-video', 'open-video-lora', 'wan-3.0-spicy', 'wan-3.0-prime-spicy'])
/** Not in CLOUD_MODEL_SEED. Sent without tier and weights (the app then files
 *  them as standard, without a mark); the two "Uncensored" ones carry the
 *  adult flag like every other "Uncensored" model in the app's list. */
const STUDIO_ADULT = new Set(['wan-3.0-spicy', 'wan-3.0-prime-spicy'])

/** The app's own text-to-video models (CLOUD_MODEL_SEED), for the Video tab.
 *  Their 5 s clip price as lu-labs.ai/pricing publishes it (calculatorModels,
 *  read 2026-10-14, videos/_template/lu-labs-pricing-models.json). Only the
 *  base price is public, so no `long` price is sent: an 8 s clip shows none. */
const TEXT_TO_VIDEO_PRICES: Record<string, number> = {
  'wan-2.2-720p': 40000, 'wan-2.2-fast': 15000, 'ltx-2': 8000, 'hunyuan-video': 20000, 'ltx-2.3': 15000,
}
const TEXT_TO_VIDEO_IDS = Object.keys(TEXT_TO_VIDEO_PRICES)

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }

const seed = (id: string) => CLOUD_MODEL_SEED.find((m) => m.id === id)

function entry(p: (typeof PUBLIC_MODELS)[number]): Record<string, unknown> {
  if (STUDIO_IDS.has(p.id)) {
    return {
      id: p.id, label: p.name, kind: p.kind, ops: ['studio'], quote_required: true,
      ...(STUDIO_ADULT.has(p.id) ? { adult: true } : {}),
    }
  }
  const s = seed(p.id)
  if (!s) throw new Error(`public model ${p.id} is not in CLOUD_MODEL_SEED`)
  const { credits: _seedPrice, clip: _seedClip, label: _seedLabel, ...flags } = s as CloudModel
  return {
    ...flags,
    label: p.name,
    // Video: the public price is one 5 s clip, so 5 s is the only length.
    ...(p.kind === 'video' && !p.specialized ? { clip: { short: 5 } } : {}),
    credits: { base: p.credits },
  }
}

export function publicCatalog(opts: { withTextToVideo?: boolean } = {}) {
  const models: Record<string, unknown>[] = PUBLIC_MODELS.map(entry)
  if (opts.withTextToVideo) {
    for (const id of TEXT_TO_VIDEO_IDS) {
      const s = seed(id)
      if (!s) throw new Error(`${id} is not in CLOUD_MODEL_SEED`)
      const { credits: _seedPrice, ...rest } = s
      models.push({ ...rest, credits: { base: TEXT_TO_VIDEO_PRICES[id] } })
    }
  }
  return { models, media_live: true, tier: 'hosted', monthly_credits: HOSTED_MONTHLY_CREDITS }
}

/** /api/jobs/quota of a Hosted account at the start of its month. `costs` is
 *  the fallback for a model without a price: 0 = not known, the meter then
 *  shows the balance alone. No video sub-budget (no plan caps video, see
 *  credits-meter.ts). */
export function publicQuota() {
  return {
    tier: 'hosted',
    period: '2026-10',
    limits: { credits: HOSTED_MONTHLY_CREDITS },
    costs: { image: 0, video: 0 },
    used: { credits_used: 0 },
    remaining: { credits: HOSTED_MONTHLY_CREDITS },
    topup: { credits: 0 },
  }
}

export const ASSETS = (id: string) => `${HOWTO_OUT}/${id}/assets`

export type PublicFx = {
  /** Add the app's own text-to-video models, without price (Video tab). */
  withTextToVideo?: boolean
  /** Gallery as a finished earlier session leaves it (localStorage, key create-store). */
  gallery?: Record<string, unknown>[]
  /** Files the cloud serves: path on lu-labs.ai -> local file + content type. */
  files?: Record<string, { file: string; type: string }>
  /** The job a submit starts stays "running" and its cancel answers 409, as
   *  the server does once a GPU took the job. */
  runningJob?: boolean
  /** A local ComfyUI that answers (idle, one checkpoint), so the rig's red
   *  "ComfyUI is not running" line does not take the bar a run's own message
   *  uses. Use with showAlerts(). */
  comfyUp?: boolean
}

const json = (body: unknown) => ({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) })

/** The network fixtures, for the `fixtures` option of Rec.boot. */
export function publicFixtures(fx: PublicFx = {}) {
  return async (page: Page) => {
    if (fx.gallery) {
      await page.addInitScript((gallery) => {
        if (!window.localStorage.getItem('create-store')) {
          window.localStorage.setItem('create-store', JSON.stringify({ state: { gallery }, version: 2 }))
        }
      }, fx.gallery)
    }
    if (fx.comfyUp) {
      await page.addInitScript(() => {
        const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: { url?: string }) => Promise<unknown> } }
        const bridge = w.__TAURI_INTERNALS__
        const invoke = bridge.invoke
        bridge.invoke = (command, args) => {
          if (command === 'sniff_model_files') return Promise.resolve([])
          if (command !== 'proxy_localhost' || !args?.url?.includes(':8188')) return invoke(command, args)
          const url = args.url
          if (url.includes('/system_stats')) return Promise.resolve(JSON.stringify({ devices: [{ name: 'GPU', type: 'cuda', vram_total: 12 * 1024 ** 3 }] }))
          const combo = (v: string[]) => [v]
          const nodes: Record<string, unknown> = {
            CheckpointLoaderSimple: { input: { required: { ckpt_name: combo(['sd_xl_base_1.0.safetensors']) } } },
            LoraLoader: { input: { required: { lora_name: combo([]) } } },
            VAELoader: { input: { required: { vae_name: combo(['ae.safetensors']) } } },
            KSampler: { input: { required: { sampler_name: combo(['euler']), scheduler: combo(['simple']) } } },
          }
          const one = /\/object_info\/([^/?]+)/.exec(url)
          if (one) return Promise.resolve(JSON.stringify(one[1] in nodes ? { [one[1]]: nodes[one[1]] } : {}))
          if (url.includes('/object_info')) return Promise.resolve(JSON.stringify(nodes))
          return Promise.resolve('{}')
        }
      })
    }
    await page.route('https://lu-labs.ai/api/jobs/catalog*', (route) => route.fulfill(json(publicCatalog({ withTextToVideo: fx.withTextToVideo }))))
    await page.route('https://lu-labs.ai/api/jobs/quota*', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
      return route.fulfill(json(publicQuota()))
    })
    // The confirmed price of a Studio run: the public figure of that model.
    await page.route('https://lu-labs.ai/api/jobs/studio-quote', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
      const model = (route.request().postDataJSON() as { model?: string } | null)?.model
      const p = PUBLIC_MODELS.find((m) => m.id === model)
      if (!p) return route.fulfill({ status: 404, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) })
      return route.fulfill(json({ credits: p.credits }))
    })
    await page.route('https://lu-labs.ai/api/loras', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
      return route.fulfill(json({ loras: [] }))
    })
    for (const [path, f] of Object.entries(fx.files ?? {})) {
      const body = readFileSync(f.file)
      await page.route(`https://lu-labs.ai${path}`, (route) => route.fulfill({ status: 200, headers: { ...CORS, 'content-type': f.type }, body }))
    }
    if (fx.runningJob) {
      await page.route('https://lu-labs.ai/api/jobs/job-e2e-1', (route) => route.fulfill(json({
        job: { id: 'job-e2e-1', kind: 'video', model: 'ltx-2', provider: 'upstream', status: 'running', result_url: null, attestation: null, cost_units: 0, created_at: new Date().toISOString(), completed_at: null, error: null },
      })))
      await page.route('https://lu-labs.ai/api/jobs/job-e2e-1/cancel', (route) => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
        return route.fulfill({ status: 409, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: 'job already running' }) })
      })
    }
  }
}

/** Rec.boot on a Hosted account with the public catalog. */
export async function bootPublic(page: Page, id: string, title: string, fx: PublicFx = {}): Promise<Rec> {
  return Rec.boot(page, id, title, { scenario: { tier: 'hosted' }, fixtures: publicFixtures(fx) })
}

/** Undoes Rec.boot's standing hide of `main [role="alert"]`, for a film whose
 *  subject is a message in that bar (with comfyUp, so the rig's ComfyUI line
 *  is not there). Removes only the style Rec.boot added. */
export async function showAlerts(page: Page) {
  await page.evaluate(() => {
    for (const s of Array.from(document.querySelectorAll('style'))) {
      if (s.textContent?.startsWith('main [role="alert"]') && s.textContent.includes('{display:none !important}')) s.remove()
    }
  })
}
