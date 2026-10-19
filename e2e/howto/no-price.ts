import type { Page } from '@playwright/test'
import { readFileSync } from 'fs'
import { CLOUD_MODEL_SEED } from '../../src/lib/render/cloud-models'
import { PUBLIC_MODELS, publicQuota } from './public-catalog'
import { Rec } from './rec'

/**
 * The Create catalog of a how-to that shows no price the public does not know.
 *
 * Rule of these films: a credit figure is on screen only where it is public
 * and only as the app itself computes it. Public are the balance of the Hosted
 * plan (900000, lu-howto-site docs/cloud-facts.json, plans.hosted) and the
 * per-image prices of the image models on the live price page
 * (lu-labs.ai/pricing, read 2026-10-14, LU-HowTo/videos/_template/
 * lu-labs-pricing-models.json) and in cloud-facts.json. Nothing else is: not
 * Cutout, Erase, Enhance, Lipsync, voice, Music, Motion or a character
 * training.
 *
 * FIXTURE: /api/jobs/catalog answers with the app's own bundled model list
 * (CLOUD_MODEL_SEED, src/lib/render/cloud-models.ts), names and flags
 * unchanged, and
 *  - `credits` only on the publicly priced image models, with the public
 *    figure (a model row then reads e.g. "1,200 cr", the meter "≈750 images":
 *    floor(900000 / 1200), credits-meter.ts). Every other model carries no
 *    `credits`: its row shows no figure (modelCostHint), and the meter falls
 *    back to quota.costs, which is 0 here, the meter's "price not known"
 *    state: the balance alone, no "≈ N". Video models stay unpriced too: the
 *    public figure is one 5 s clip, and the bundled entries also book 8 s.
 *  - no `ops` and no `voice` table: Cutout, Erase and Enhance then price at
 *    the same 0 fallback (runCredits), so neither the meter nor the Enhance
 *    button names a figure.
 *  - no Studio entry (`quote_required`): the app lists a Studio model only
 *    when the catalog carries it (preset-models.ts studioKnown), and a Studio
 *    row prices itself from the bundled registry, a figure that is not public.
 * /api/jobs/quota is the Hosted account at the start of its month
 * (public-catalog.ts publicQuota: 900000 left, costs 0, no video budget, no
 * training count).
 */

/** lu-labs.ai/pricing calculatorModels, kind image: credits per image. */
export const PRICE_PAGE_IMAGE: Record<string, number> = {
  'flux-schnell': 300,
  'flux-dev': 1200,
  'flux-2-dev': 1200,
  'qwen-image': 2000,
  'hidream': 2000,
  'hunyuan-image': 2500,
  'z-image-turbo': 500,
}

/** The public price of an image model of the bundled list, or undefined. */
export function publicImagePrice(id: string): number | undefined {
  if (id in PRICE_PAGE_IMAGE) return PRICE_PAGE_IMAGE[id]
  return PUBLIC_MODELS.find((p) => p.id === id && p.kind === 'image')?.credits
}

export function noPriceCatalog() {
  const models = CLOUD_MODEL_SEED.map((m) => {
    const { credits: _notPublic, ...rest } = m
    const price = m.kind === 'image' && !m.ops && !m.lora ? publicImagePrice(m.id) : undefined
    return price === undefined ? rest : { ...rest, credits: { base: price } }
  })
  return { models, media_live: true, tier: 'hosted', monthly_credits: publicQuota().limits.credits }
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }
const json = (body: unknown) => ({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) })

export type NoPriceFx = {
  /** Trained cloud characters /api/loras answers with. */
  loras?: { id: string; name: string; trigger_word: string; base_family: string; created_at: string }[]
  /** Files the cloud serves: path on lu-labs.ai -> local file + content type. */
  files?: Record<string, { file: string; type: string }>
  /** The film's own routes, registered after these (so they answer first). */
  own?: (page: Page) => Promise<void>
}

/** The network fixtures, for the `fixtures` option of Rec.boot. */
export function noPriceFixtures(fx: NoPriceFx = {}) {
  return async (page: Page) => {
    await page.route('https://lu-labs.ai/api/jobs/catalog*', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
      return route.fulfill(json(noPriceCatalog()))
    })
    await page.route('https://lu-labs.ai/api/jobs/quota*', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
      return route.fulfill(json(publicQuota()))
    })
    await page.route('https://lu-labs.ai/api/loras', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
      return route.fulfill(json({ loras: fx.loras ?? [] }))
    })
    for (const [path, f] of Object.entries(fx.files ?? {})) {
      const body = readFileSync(f.file)
      await page.route(`https://lu-labs.ai${path}`, (route) => route.fulfill({ status: 200, headers: { ...CORS, 'content-type': f.type }, body }))
    }
    if (fx.own) await fx.own(page)
  }
}

/** Rec.boot on a Hosted account with the catalog above. */
export async function bootNoPrice(page: Page, id: string, title: string, fx: NoPriceFx = {}): Promise<Rec> {
  return Rec.boot(page, id, title, { scenario: { tier: 'hosted' }, fixtures: noPriceFixtures(fx) })
}
