/**
 * Touch targets (acceptance row 5.2): on every page and every sheet of the
 * route list, every control that carries a data-testid takes a tap on at
 * least 44 by 44 CSS px on iOS and on 48 by 48 on Android (one CSS px is one
 * dp in a WebView). The shell is opened once as each system (?os=), because
 * the kit takes its minimum from a token that differs between the two.
 *
 * What counts is the area that takes the tap, not the area one sees: the box
 * of the control with its padding, the label around a switch or a checkbox,
 * and a ::before or ::after that reaches over the edge. The measuring itself
 * is the one the device run uses (mobile-tests/lib/seite.mjs, touchZiele), so
 * browser and device follow one rule.
 *
 * The only exception is a link inside running text. Every exception a run
 * meets is printed with its reason. Controls without a test id are counted
 * and measured too, but they do not fail the test: they are listed in the
 * file LU_TOUCH_OUT names.
 *
 * Run:  LU_E2E_PORT=<own port> LU_E2E_ONLY=touchziele npx playwright test --project=mobile
 *       LU_TOUCH_OUT=<file.json> writes the full list of what was measured.
 */
import { writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { openShell, screensLoaded, SIZES, watchErrors } from './support'

interface Target {
  testid: string | null
  pfad: string
  name: string
  klasse: string
  box: [number, number]
  ziel: [number, number]
  erweitertDurch?: string[]
  grund?: string
}
interface Measured {
  min: number
  gemessen: number
  ohneKennung: number
  ohneKennungZuKlein: Target[]
  zuKlein: Target[]
  ausnahmen: Target[]
}
interface Found extends Target {
  wo: string
}

/** The four tab roots. Every other page is opened from the index of all screens (/dev/routes). */
const ROOTS = ['/chats', '/create', '/models', '/settings'] as const

/** The pages of the developer catalogue that show the kit itself. A control that is too small there is too small everywhere. */
const KIT_PAGES = ['/dev/ui', '/dev/composer'] as const

/** The measure of each system. On Android the kit sizes its controls from a larger token (styles/tokens.css). */
const SYSTEMS = [
  { os: 'ios', min: 44 },
  { os: 'android', min: 48 },
] as const

async function settle(page: Page): Promise<void> {
  await screensLoaded(page)
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity))
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
}

for (const size of SIZES) {
  for (const system of SYSTEMS) {
    test.describe(`touch targets ${size.name} ${system.os}`, () => {
      test.use({ viewport: { width: size.width, height: size.height } })

      test(`every control with a test id is at least ${system.min} by ${system.min} px`, async ({ page }, testInfo) => {
        test.setTimeout(420_000)
        const errors = watchErrors(page)
        // The measuring lives with the device harness. It is plain JavaScript that runs inside the page.
        const lib = (await import(/* @vite-ignore */ new URL('../../mobile-tests/lib/seite.mjs', import.meta.url).href)) as {
          seitenAufruf: (fn: unknown, ...args: unknown[]) => string
          touchZiele: unknown
        }
        const expression = lib.seitenAufruf(lib.touchZiele, {
          min: system.min,
        })

        const small = new Map<string, Found>()
        const exceptions = new Map<string, Found>()
        const noId = new Map<string, Found>()
        let measured = 0
        let withoutId = 0
        let withoutIdSmall = 0
        const places: string[] = []
        const measure = async (where: string) => {
          await settle(page)
          const m = (await page.evaluate(expression)) as Measured
          places.push(where)
          measured += m.gemessen
          withoutId += m.ohneKennung
          withoutIdSmall += m.ohneKennungZuKlein.length
          for (const t of m.ohneKennungZuKlein) if (!noId.has(t.pfad)) noId.set(t.pfad, { ...t, wo: where })
          for (const t of m.zuKlein) {
            const key = `${t.testid}|${t.ziel.join('x')}`
            if (!small.has(key)) small.set(key, { ...t, wo: where })
          }
          for (const t of m.ausnahmen) if (!exceptions.has(String(t.testid))) exceptions.set(String(t.testid), { ...t, wo: where })
        }

        for (const route of [...ROOTS, ...KIT_PAGES]) {
          await openShell(page, { route, os: system.os })
          await measure(route)
        }
        await openShell(page, { skipOnboarding: false, os: system.os })
        await measure('/welcome')

        await openShell(page, { route: '/dev/routes', os: system.os })
        const index = page.getByTestId('m-dev-routes-screen')
        await expect(index).toBeVisible()
        const pages = await page.locator('[data-testid^="m-dev-route-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''))
        expect(pages.length).toBeGreaterThan(50)
        for (const id of pages) {
          if (id === 'm-dev-route-dev-routes') continue
          const screen = `m-${id.replace('m-dev-route-', '')}-screen`
          await page.getByTestId(id).tap()
          await expect(page.getByTestId(screen), screen).toBeVisible()
          await measure(screen)
          await page.goBack()
          await expect(index, `back from ${screen}`).toBeVisible()
        }
        const sheets = await page.locator('[data-testid^="m-dev-sheet-open-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''))
        expect(sheets.length).toBeGreaterThan(10)
        for (const id of sheets) {
          const sheet = `m-sheet-${id.replace('m-dev-sheet-open-', '')}`
          await page.getByTestId(id).tap()
          await expect(page.getByTestId(sheet), sheet).toBeVisible()
          await measure(sheet)
          await page.goBack()
          await expect(page.getByTestId(sheet), `back from ${sheet}`).toHaveCount(0)
        }

        const line = (t: Found) => `${t.testid} ${t.ziel.join('x')} (.${t.klasse}) on ${t.wo}`
        const tooSmall = [...small.values()].map(line)
        const summary = {
          size: size.name,
          os: system.os,
          min: system.min,
          places: places.length,
          measured,
          tooSmall: tooSmall.length,
          withoutTestId: withoutId,
          withoutTestIdTooSmall: withoutIdSmall,
          exceptions: [...exceptions.values()].map((t) => `${t.testid}: ${t.grund} (${t.wo})`),
        }
        console.log(`[touch] ${JSON.stringify(summary)}`)
        await testInfo.attach('touch-targets', {
          body: JSON.stringify({ summary, small: [...small.values()] }, null, 2),
          contentType: 'application/json',
        })
        if (process.env.LU_TOUCH_OUT)
          writeFileSync(
            process.env.LU_TOUCH_OUT.replace(/\.json$/, `-${size.name}-${system.os}.json`),
            JSON.stringify(
              {
                summary,
                small: [...small.values()],
                exceptions: [...exceptions.values()],
                withoutId: [...noId.values()],
              },
              null,
              2,
            ),
          )

        expect(measured, 'controls measured').toBeGreaterThan(300)
        expect(tooSmall, `targets under ${system.min} by ${system.min} px`).toEqual([])
        expect(errors()).toEqual([])
      })
    })
  }
}
