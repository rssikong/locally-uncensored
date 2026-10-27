/**
 * The oldest web view the phone app is built for (src/dev/webview-target.ts),
 * in a real browser.
 *
 * Acceptance on Android 8 GB, find B5: on Android System WebView 113 a PDF
 * ended in "Promise.withResolvers is not a function". pdf.js parses in a
 * worker, and a worker has globals of its own, so the missing functions have
 * to be installed there as well. This file takes the functions away from the
 * page and reads a PDF through the path of the app: the worker that starts is
 * the one that installs them first (src/lib/pdf-worker-compat.ts), and the
 * text comes out. What the functions themselves do on a runtime without them
 * is measured in src/api/__tests__/rag-pdf-old-webview.test.ts. The same for
 * walking a stream with `for await` (re-check, A-04), which pdf.js does on the
 * page: src/api/__tests__/rag-pdf-stream-iteration.test.ts.
 *
 * Second half: a web view below the floor shows "Update Android System
 * WebView" before the app loads (public/webview-check.js), and the app does
 * not start under it.
 */
import { expect, test, type Page } from '@playwright/test'
import { openShell, shellUrl, watchErrors } from './support'

const PAGES = ['The Harrowgate logbook opens in March.', 'The keeper of the light is called Imre Vantongeren.']

/** Read a small PDF with two pages through api/rag.ts, inside the page. */
async function readPdf(page: Page): Promise<string> {
  return page.evaluate(async (pages) => {
    let out = '%PDF-1.7\n'
    const offsets: number[] = []
    const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')
    const objects = ['<</Type/Catalog/Pages 2 0 R>>', `<</Type/Pages/Kids[${kids}]/Count ${pages.length}>>`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>']
    pages.forEach((text, i) => {
      const body = `BT /F1 12 Tf 20 200 Td (${text}) Tj ET`
      objects.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Contents ${5 + i * 2} 0 R/Resources<</Font<</F1 3 0 R>>>>>>`)
      objects.push(`<</Length ${body.length}>>\nstream\n${body}\nendstream`)
    })
    objects.forEach((body, i) => {
      offsets.push(out.length)
      out += `${i + 1} 0 obj\n${body}\nendobj\n`
    })
    const xref = out.length
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
    out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
    const { extractText } = await import('/src/api/rag.ts' as string)
    return (await extractText(new File([out], 'harrowgate-logbook.pdf', { type: 'application/pdf' }))) as string
  }, PAGES)
}

function watchWorkers(page: Page): string[] {
  const urls: string[] = []
  page.on('worker', (worker) => urls.push(worker.url()))
  return urls
}

test.describe('reading a PDF', () => {
  test('where Promise.withResolvers is missing, the worker that installs it reads the file (B5)', async ({ page }) => {
    const errors = watchErrors(page)
    const workers = watchWorkers(page)
    await page.addInitScript(() => {
      delete (Promise as unknown as Record<string, unknown>).withResolvers
      delete (AbortSignal as unknown as Record<string, unknown>).any
    })
    await openShell(page)
    // The start of the phone app installs what is missing (boot/index.tsx), so the page has it by now.
    // What was missing is remembered, and the reader of a PDF still picks its worker by that.
    expect(await page.evaluate(() => typeof (Promise as unknown as Record<string, unknown>).withResolvers)).toBe('function')
    expect(await page.evaluate(() => typeof (AbortSignal as unknown as Record<string, unknown>).any)).toBe('function')
    const text = await readPdf(page)
    for (const line of PAGES) expect(text).toContain(line)
    expect(workers.some((url) => url.includes('pdf-worker-compat'))).toBe(true)
    expect(workers.some((url) => url.includes('pdf.worker.min'))).toBe(false)
    // The page has its functions now, and the worker was ended after the read.
    expect(await page.evaluate(() => typeof (Promise as unknown as Record<string, unknown>).withResolvers)).toBe('function')
    await expect.poll(() => page.workers().length).toBe(0)
    expect(errors().filter((line) => /withResolvers|pdf/i.test(line))).toEqual([])
  })

  test('where nothing is missing, pdf.js starts its own worker file as before', async ({ page }) => {
    const workers = watchWorkers(page)
    await openShell(page)
    const text = await readPdf(page)
    for (const line of PAGES) expect(text).toContain(line)
    expect(workers.some((url) => url.includes('pdf.worker.min'))).toBe(true)
    expect(workers.some((url) => url.includes('pdf-worker-compat'))).toBe(false)
  })

  test('where a stream cannot be walked with for await, the text still comes out (A-04, web view 113)', async ({ page }) => {
    // Re-check on Android 8 GB: "t is not async iterable". pdf.js collects the
    // text of a page with `for await` over a ReadableStream, on the page and
    // not in the worker, and a stream can be walked that way from Chromium 124 on.
    const errors = watchErrors(page)
    await page.addInitScript(() => {
      const proto = ReadableStream.prototype as unknown as Record<string | symbol, unknown>
      delete proto[Symbol.asyncIterator]
      delete proto.values
      delete (Promise as unknown as Record<string, unknown>).withResolvers
      delete (AbortSignal as unknown as Record<string, unknown>).any
    })
    await openShell(page)
    // Installed by the first step of the start, and it is ours: the browser's own was taken away before any script ran.
    expect(await page.evaluate(() => (ReadableStream.prototype as unknown as Record<symbol, { name?: string }>)[Symbol.asyncIterator]?.name)).toBe('values')
    const text = await readPdf(page)
    for (const line of PAGES) expect(text).toContain(line)
    await expect.poll(() => page.workers().length).toBe(0)
    expect(errors().filter((line) => /async iterable|withResolvers|pdf/i.test(line))).toEqual([])
  })
})

const ANDROID = (chrome: number) => `Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UE1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/${chrome}.0.0.0 Mobile Safari/537.36`

test.describe('a web view that is too old', () => {
  test('Android System WebView 98: the notice with the way to the update, and no app under it', async ({ browser }) => {
    const context = await browser.newContext({ userAgent: ANDROID(98), viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await context.newPage()
    await page.goto(shellUrl())
    const notice = page.getByTestId('m-webview-too-old')
    await expect(notice).toBeVisible()
    await expect(notice.getByRole('heading')).toHaveText('Update Android System WebView')
    await expect(notice).toContainText('This phone has version 98. LU needs version 111 or newer.')
    await expect(notice).toContainText('Search for Android System WebView.')
    // Nothing sticks out sideways on a phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    // The app was loaded and did not start.
    await page.waitForTimeout(1500)
    await expect(page.getByTestId('m-app')).toHaveCount(0)
    await expect(page.locator('#root')).toBeHidden()
    await context.close()
  })

  test('Android System WebView 113, the one of the acceptance: the app starts', async ({ browser }) => {
    const context = await browser.newContext({ userAgent: ANDROID(113), viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await context.newPage()
    await page.goto(shellUrl())
    await page.getByTestId('m-app').waitFor()
    await expect(page.getByTestId('m-webview-too-old')).toHaveCount(0)
    await context.close()
  })
})
