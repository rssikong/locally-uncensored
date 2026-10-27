import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { routeCloud, seedOnboardingDone, signInViaGate, cloudSwitch } from './support/cloud-mock'

/**
 * Several source images, one edit (Discord): pick several images in
 * Remove Background on the cloud, see the sum before the run, watch the queue,
 * and get one result per image. One image fails on the server, the others
 * still land and the failed file is named. Every image is its own upload and
 * its own job, nothing real is rendered or charged.
 */

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
const json = (status: number, body: unknown) => ({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

interface Sent { uploads: number; jobs: { id: string; op: string; source: string }[] }

/** The job endpoints of a batch: every submit books its own job. `failNth`
 *  (1-based) fails on the server, `refuseFrom` answers "out of credits". */
async function routeJobs(page: Page, opts: { failNth?: number; refuseFrom?: number } = {}): Promise<Sent> {
  const sent: Sent = { uploads: 0, jobs: [] }
  await page.route('https://lu-labs.ai/api/jobs/upload**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    sent.uploads++
    return route.fulfill(json(200, { path: `e2e-user-1/source-${sent.uploads}.png` }))
  })
  await page.route('https://lu-labs.ai/api/jobs', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (req.method() !== 'POST') return route.fallback()
    const body = req.postDataJSON() as { params: { op: string; source_path: string } }
    const n = sent.jobs.length + 1
    if (opts.refuseFrom && n >= opts.refuseFrom) {
      return route.fulfill(json(429, { error: 'credits exhausted', code: 'credits_exhausted' }))
    }
    const id = `job-batch-${n}`
    sent.jobs.push({ id, op: body.params.op, source: body.params.source_path })
    return route.fulfill(json(202, { id, status: 'queued', created_at: new Date().toISOString(), quota: { kind: 'image', cost: 300 } }))
  })
  await page.route('https://lu-labs.ai/api/jobs/job-batch-*', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const id = new URL(route.request().url()).pathname.split('/').pop()!
    const failed = opts.failNth !== undefined && id === `job-batch-${opts.failNth}`
    return route.fulfill(json(200, {
      job: {
        id, kind: 'image', model: 'flux-schnell', provider: 'upstream',
        status: failed ? 'failed' : 'succeeded',
        result_url: failed ? null : `https://lu-labs.ai/e2e/${id}.png`,
        attestation: null, cost_units: 300, created_at: new Date().toISOString(), completed_at: new Date().toISOString(),
        error: failed ? 'The provider could not process this image.' : null,
      },
    }))
  })
  await page.route('https://lu-labs.ai/e2e/job-batch-*.png', (route) =>
    route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/png' }, body: PNG }))
  return sent
}

async function bootIntoCutout(page: Page) {
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME })
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await signInViaGate(page)
  await expect(cloudSwitch(page)).toBeChecked({ timeout: 20_000 })
  await page.getByRole('button', { name: /^Create$/ }).click()
  await page.getByRole('radio', { name: /Remove Background/i }).click()
  await expect(page.getByText(/Drop an image to cut out/i)).toBeVisible({ timeout: 15_000 })
}

const files = (names: string[]) => names.map((name) => ({ name, mimeType: 'image/png', buffer: PNG }))

test('four images, one run each: sum up front, queue, results, the failed file named', async ({ page }) => {
  await bootIntoCutout(page)
  const sent = await routeJobs(page, { failNth: 2 })

  // The multi-pick sits at the source surface, never at the prompt.
  await expect(page.getByText('Pick several to give them all the same run')).toBeVisible()
  await page.getByTestId('batch-files-input').setInputFiles(files(['d.png', 'a.png', 'c.png', 'b.png']))

  await expect(page.getByTestId('batch-count')).toContainText('4 images.')
  // The price is the honest sum: one image times four.
  const price = (await page.getByTestId('batch-price').textContent()) ?? ''
  const m = price.match(/^([\d,]+) credits per image, ([\d,]+) credits for all 4\./)
  expect(m, price).not.toBeNull()
  expect(Number(m![2].replace(/,/g, ''))).toBe(Number(m![1].replace(/,/g, '')) * 4)
  expect(price).not.toContain('Your credits cover')
  expect(sent.jobs).toHaveLength(0)

  await page.getByRole('button', { name: /^Create$/ }).last().click()

  // Three results land, each from its own job. The second image failed alone.
  await expect(page.getByText(/3 of 4 images are done\. 1 failed: b\.png\./)).toBeVisible({ timeout: 45_000 })
  await expect(page.getByText(/The provider could not process this image\./)).toBeVisible()
  expect(sent.jobs.map((j) => j.op)).toEqual(['removebg', 'removebg', 'removebg', 'removebg'])
  expect(sent.uploads).toBe(4)
  expect(new Set(sent.jobs.map((j) => j.source)).size).toBe(4)

  // The failed image is the one left on the Stage, ready for another try.
  await expect(page.getByTestId('batch-count')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Create$/ }).last()).toBeEnabled()

  // The gallery holds the three results, each tied to its file.
  await page.getByRole('button', { name: 'Open the gallery' }).click()
  for (const name of ['a.png', 'c.png', 'd.png']) {
    await expect(page.locator(`button[title="From ${name}"]`)).toHaveCount(1)
  }
  await expect(page.locator('button[title="From b.png"]')).toHaveCount(0)
})

test('credits run out in the middle: the rest is never sent and stays in the list', async ({ page }) => {
  await bootIntoCutout(page)
  const sent = await routeJobs(page, { refuseFrom: 3 })

  await page.getByTestId('batch-files-input').setInputFiles(files(['a.png', 'b.png', 'c.png', 'd.png', 'e.png']))
  await expect(page.getByTestId('batch-count')).toContainText('5 images.')
  await page.getByRole('button', { name: /^Create$/ }).last().click()

  await expect(page.getByText(/2 of 5 images are done\. There were not enough credits to go on\. The other 3 were not started and nothing was charged for them\./)).toBeVisible({ timeout: 45_000 })
  // Two booked. The third was refused before any booking, four and five never left the app.
  expect(sent.jobs).toHaveLength(2)
  expect(sent.uploads).toBe(3)
  await expect(page.getByTestId('batch-count')).toContainText('3 images.')
})

test('the limit is 50 images, and a mask tab takes one image', async ({ page }) => {
  await bootIntoCutout(page)
  await routeJobs(page)

  const many = Array.from({ length: 52 }, (_, i) => `img-${String(i + 1).padStart(2, '0')}.png`)
  await page.getByTestId('batch-files-input').setInputFiles(files(many))
  await expect(page.getByTestId('batch-count')).toContainText('50 images.', { timeout: 20_000 })
  await expect(page.getByText('You can edit up to 50 images at once. 50 were added, 2 were left out.')).toBeVisible()

  // Erase Object paints a mask per image: no multi-pick there.
  await page.getByRole('radio', { name: /Erase Object/i }).click()
  await expect(page.getByTestId('batch-files-input')).toHaveCount(0)
  await expect(page.getByTestId('batch-strip')).toHaveCount(0)
})

// Discord, jazziinau 23.10.2026: after a batch the original image could not be
// picked again, only the last image of the list was left. The original here is
// 64 x 48 and the others 32 x 32, so the Stage shows which one it holds.
const ORIGINAL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAQ0lEQVR42u3PQQkAAAgEsMtpJnOawwp+hcEKLF3zWgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQErhZJeJE8uNDXWwAAAABJRU5ErkJggg==',
  'base64',
)
const OTHER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAJ0lEQVR42u3NMQ0AAAwDoCqu/7MqdiwBA6THIhAIBAKBQCAQCL4EA2EcKExM7yeFAAAAAElFTkSuQmCC',
  'base64',
)
const listWithOriginal = () => [
  { name: 'a original.png', mimeType: 'image/png', buffer: ORIGINAL },
  ...['b.png', 'c.png', 'd.png'].map((name) => ({ name, mimeType: 'image/png', buffer: OTHER })),
]
const shotDir = process.env.LU_SHOT_DIR
const sourceWidth = (page: Page) =>
  page.getByTestId('result-source-actions').locator('img[alt="source"]').evaluate((img) => (img as HTMLImageElement).naturalWidth)

test('after a finished batch the original is the image the next Create runs on', async ({ page }) => {
  await bootIntoCutout(page)
  await routeJobs(page)
  await page.getByTestId('batch-files-input').setInputFiles(listWithOriginal())
  await expect(page.getByTestId('batch-count')).toContainText('4 images.')
  await page.getByRole('button', { name: /^Create$/ }).last().click()

  await expect(page.getByTestId('batch-queue')).toHaveCount(0, { timeout: 45_000 })
  await expect(page.getByTestId('result-source-actions')).toBeVisible()
  await expect.poll(() => sourceWidth(page)).toBe(64)
  await expect(page.getByText('Use the original')).toHaveCount(0)
  if (shotDir) await page.screenshot({ path: `${shotDir}/batch-original-after-run.png` })
})

test('a batch that stopped on another image offers the original back', async ({ page }) => {
  await bootIntoCutout(page)
  await routeJobs(page, { failNth: 4 })
  await page.getByTestId('batch-files-input').setInputFiles(listWithOriginal())
  await page.getByRole('button', { name: /^Create$/ }).last().click()

  await expect(page.getByText(/3 of 4 images are done\. 1 failed: d\.png\./)).toBeVisible({ timeout: 45_000 })
  const back = page.getByRole('button', { name: /back as the image to work on/ })
  await expect(back).toBeVisible()
  // The Stage fades in; the picture is for a person, the checks do not wait on it.
  if (shotDir) { await page.waitForTimeout(500); await page.screenshot({ path: `${shotDir}/batch-original-offered.png` }) }
  await back.click()
  await expect(back).toHaveCount(0)
  await expect(page.locator('img[alt="source"]').first()).toBeVisible()
  await expect.poll(() => page.locator('img[alt="source"]').first().evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(64)
  if (shotDir) await page.screenshot({ path: `${shotDir}/batch-original-back.png` })

  // Without an image on the Stage the original stays pinned in front of the results.
  await page.getByTitle('Remove image').click()
  await expect(page.getByTestId('pick-original')).toBeVisible()
  if (shotDir) { await page.getByTestId('pick-original').scrollIntoViewIfNeeded(); await page.waitForTimeout(500); await page.screenshot({ path: `${shotDir}/batch-original-pinned.png` }) }
  await page.getByTestId('pick-original').click()
  await expect.poll(() => page.locator('img[alt="source"]').first().evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(64)
})
