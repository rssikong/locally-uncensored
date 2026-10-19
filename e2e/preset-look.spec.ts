import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from './support/tauri-mock'
import { routeCloud, signInViaGate, cloudSwitch, type CloudScenario } from './support/cloud-mock'

/**
 * Wie die Preset-Oberflaeche AUSSIEHT, als Bilder auf dem Mac.
 *
 * Der Eigner hat die Popups der Presets als "komisches grau, komische edges"
 * beanstandet. Optik laesst sich nicht behaupten, sie muss gezeigt werden,
 * deshalb faehrt diese Datei die Schiene und die Werkstatt im echten Browser
 * an (gemocktes Tauri/Netz wie create-studio.spec.ts) und legt Bilder ab.
 * Derselbe Lauf nimmt zusaetzlich ein HAUS-Popup auf (das Was-ist-neu-Blatt),
 * damit der Vergleich "passt es zum Rest der App" ein Bild hat und keine
 * Erinnerung ist.
 *
 * `LU_PRESETLOOK_PHASE=vorher` nimmt denselben Satz vor dem Umbau auf.
 *
 * Geprueft wird dabei auch die Hausregel fuer Popups: ein echtes X mit
 * aria-label, und Escape schliesst (feedback-sampling-popup-mit-x.md).
 */

const PHASE = process.env.LU_PRESETLOOK_PHASE ?? 'nachher'
const SHOTS = process.env.LU_PRESETLOOK_DIR ?? resolve(process.cwd(), 'test-results/presetlook')

function shotPath(name: string): string {
  mkdirSync(SHOTS, { recursive: true })
  return resolve(SHOTS, `${PHASE}-${name}.png`)
}

const WINDOWS_OPTS: TauriMockOptions = {
  assistantReply: DEFAULT_ASSISTANT_REPLY,
  modelName: DEFAULT_MODEL_NAME,
  platform: 'windows',
}

const STUDIO: CloudScenario = { license: 'active', access: true, mediaLive: true, studioCatalog: true }

/**
 * Wie `seedOnboardingDone`, aber mit einer ALTEN gemerkten Notenversion:
 * damit geht das Was-ist-neu-Blatt beim Start auf und liefert das
 * Referenzbild eines gelungenen Haus-Popups aus demselben Lauf.
 */
async function seedWithReleaseNotes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'chat-settings',
      JSON.stringify({ state: { settings: { onboardingDone: true, appMode: 'local' }, _version: 10 }, version: 10 }),
    )
    window.localStorage.setItem(
      'lu_release_notes',
      JSON.stringify({ state: { lastNotesVersion: '0.0.0' }, version: 0 }),
    )
  })
}

const presetShelf = (page: Page) => page.locator('aside[aria-label="Presets"]')

/** Bis in den Create-Tab, mit dem Haus-Referenzbild unterwegs. */
async function bootIntoCloudCreate(page: Page, withReference: boolean): Promise<void> {
  await page.addInitScript(tauriMockInit, WINDOWS_OPTS)
  await seedWithReleaseNotes(page)
  await routeCloud(page, STUDIO)
  await page.goto('/')

  const notes = page.getByRole('dialog', { name: /What's new/ })
  await expect(notes).toBeVisible({ timeout: 20_000 })
  if (withReference) await notes.screenshot({ path: shotPath('referenz-hauspopup') })
  // exact: ein Eintrag der Notes enthaelt "closer", ohne exact traf der Name zwei Knoepfe.
  await notes.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(notes).toBeHidden()

  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await signInViaGate(page)
  await expect(cloudSwitch(page)).toBeChecked({ timeout: 20_000 })
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(presetShelf(page)).toBeVisible({ timeout: 15_000 })
}

test('die Preset-Schiene und die Werkstatt, fotografiert', async ({ page }) => {
  await bootIntoCloudCreate(page, true)

  await page.getByRole('button', { name: 'Expand presets' }).click()
  await expect(page.getByText('Song from Words')).toBeVisible()
  await page.screenshot({ path: shotPath('a-schiene') })
  await presetShelf(page).screenshot({ path: shotPath('b-schiene-nah') })

  // Die Werkstatt eines einstufigen Presets: Preis, Modellwahl, Startknopf.
  await page.getByRole('button', { name: /Song from Words/ }).click()
  const song = page.getByRole('dialog', { name: 'Song from Words' })
  await expect(song).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Preset prompt').fill('a bright acoustic tune about a summer road trip')
  await expect(page.getByText('1,500 credits')).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: shotPath('c-werkstatt') })
  await song.screenshot({ path: shotPath('d-werkstatt-nah') })

  // Hausregel Popup, beide Haelften: ein echtes X mit Beschriftung, und
  // Escape schliesst.
  const x = song.getByRole('button', { name: 'Close' })
  await expect(x).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(song).toBeHidden()

  // Ein mehrstufiges Preset mit Hochladefeld und erweiterten Einstellungen:
  // genau die Flaechen, die als "graue Kaesten" beanstandet waren.
  await page.getByRole('button', { name: /Product in a Scene/ }).click()
  const scene = page.getByRole('dialog', { name: 'Product in a Scene' })
  await expect(scene).toBeVisible({ timeout: 15_000 })
  await scene.screenshot({ path: shotPath('e-werkstatt-eingaben') })
  await scene.getByRole('button', { name: /Advanced settings/ }).click()
  await scene.screenshot({ path: shotPath('f-werkstatt-erweitert') })
  await scene.getByRole('button', { name: 'Close' }).click()
  await expect(scene).toBeHidden()
})

test('dieselben Flaechen schmal bei 900 Pixel', async ({ page }) => {
  // Erst in den Create-Tab, dann schmal stellen: unter 900 Pixel raeumt die
  // Kopfzeile die Reiter in ein Menue, und der Lauf suchte einen Knopf, den
  // es dort nicht mehr gibt.
  await bootIntoCloudCreate(page, false)
  await page.setViewportSize({ width: 900, height: 780 })

  await page.getByRole('button', { name: 'Expand presets' }).click()
  await expect(page.getByText('Song from Words')).toBeVisible()
  await page.screenshot({ path: shotPath('g-schmal-schiene') })

  await page.getByRole('button', { name: /Song from Words/ }).click()
  const song = page.getByRole('dialog', { name: 'Song from Words' })
  await expect(song).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Preset prompt').fill('a bright acoustic tune about a summer road trip')
  await expect(page.getByText('1,500 credits')).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: shotPath('h-schmal-werkstatt') })

  await expect(song.getByRole('button', { name: 'Close' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(song).toBeHidden()
})

/**
 * Kein lila Balken um ein Promptfeld, nirgends (Eigner, 21.09.2026).
 *
 * Der Ring kam aus EINER globalen Regel in index.css
 * (`:focus-visible:not([tabindex='-1']):not(.lu-primary):not([data-lu-quiet-focus])`,
 * `outline: 2px solid var(--color-lu-accent)`), die ungeschichtet ist und
 * damit jedes `focus:outline-none` an den Feldern selbst schlaegt. Die
 * Ausfahrt dafuer gibt es im Haus schon; sie hing bis hierher an einem
 * einzigen Feld. Dieser Fall misst das Ergebnis am laufenden Fenster.
 *
 * Negativkontrolle: derselbe Lauf liest den Ring eines KNOPFES aus, der ihn
 * behalten soll. Faende die Messung dort auch nichts, waere die Regel
 * insgesamt tot und der gruene Befund oben wertlos.
 */
/**
 * Die Akzentfarbe so, wie der Browser sie ausrechnet (Tailwind v4 kann sie
 * als `oklch(...)` ausgeben, das Token in index.css ist `#a094f8`). Ein
 * fester Erwartungsstring waere hier eine zweite Wahrheit.
 */
async function akzentfarbe(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-lu-accent)'
    document.body.appendChild(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
  })
}

interface Ring { style: string; color: string; shadow: string; width: string }

async function ringOf(locator: ReturnType<Page['locator']>): Promise<Ring> {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el)
    return { style: s.outlineStyle, color: s.outlineColor, shadow: s.boxShadow, width: s.outlineWidth }
  })
}

/** Derselbe Messpunkt am Element, das gerade wirklich den Tastaturfokus hat. */
async function ringOfActive(page: Page): Promise<Ring & { tag: string; primary: boolean; quiet: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const s = getComputedStyle(el)
    return {
      tag: el.tagName,
      primary: el.classList.contains('lu-primary'),
      quiet: el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT'
        && ['text', 'search', 'url', 'email', 'password', 'tel', 'number', ''].includes((el as HTMLInputElement).type)),
      style: s.outlineStyle,
      color: s.outlineColor,
      shadow: s.boxShadow,
      width: s.outlineWidth,
    }
  })
}

test('um kein Promptfeld liegt ein Akzentring, um einen Knopf schon', async ({ page }) => {
  await bootIntoCloudCreate(page, false)
  const akzent = await akzentfarbe(page)

  // (1) Das Promptfeld des Create-Composers.
  const createPrompt = page.locator('textarea.lu-fokus-am-kasten').first()
  await createPrompt.click()
  await createPrompt.fill('a lighthouse at dusk')
  const createRing = await ringOf(createPrompt)
  // 21.09.2026: die Antwort ist nicht mehr „gar kein Umriss ueberall", sondern
  // „kein AKZENTumriss an einer Texteingabe". Dieses Feld sitzt in einem
  // Kasten mit `focus-within:border-*`, der den Fokus schon zeichnet, also
  // bleibt es bei null Breite (`lu-fokus-am-kasten`).
  expect(createRing.width, `Create-Composer traegt einen Umriss: ${JSON.stringify(createRing)}`).toBe('0px')
  expect(createRing.color).not.toBe(akzent)
  expect(createRing.shadow).toBe('none')
  await page.screenshot({ path: shotPath('fokus-create') })

  // (1b) Negativkontrolle im selben Lauf: der Hausring lebt. Taste statt
  //      `.focus()`, denn ein programmatisch gesetzter Fokus ist kein
  //      `:focus-visible`. Gesucht wird EIN Halt mit genau der
  //      Akzentfarbe; faende sich keiner, waere die Regel insgesamt tot
  //      und der gruene Befund darueber wertlos. Nicht jeder Halt taugt
  //      dafuer: der Primaerknopf hat per Hausregel seinen eigenen hellen
  //      Ring, und mehrere Knoepfe der Kopfzeile setzen ihre eigene
  //      Ringfarbe.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const haelt: string[] = []
  let akzentRingGesehen = false
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab')
    const r = await ringOfActive(page)
    haelt.push(`${r.tag} ${r.style} ${r.color}`)
    if (r.style !== 'none' && r.color === akzent) akzentRingGesehen = true
    // Und kein Promptfeld faengt sich unterwegs doch einen.
    // Kein Textfeld faengt sich unterwegs einen AKZENTring ein, und keines
    // traegt mehr als die eine Haarlinie.
    if (r.quiet) {
      expect(r.color, `eine Texteingabe traegt den Akzentring: ${JSON.stringify(r)}`).not.toBe(akzent)
      expect(parseFloat(r.width), `eine Texteingabe traegt einen dicken Umriss: ${JSON.stringify(r)}`).toBeLessThanOrEqual(1.1)
    }
  }
  expect(akzentRingGesehen, `der Hausring ist weg: ${haelt.join(' | ')}`).toBe(true)

  // (2) Das Promptfeld der Preset-Werkstatt.
  await page.getByRole('button', { name: 'Expand presets' }).click()
  await page.getByRole('button', { name: /Song from Words/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Song from Words' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  const workshopPrompt = page.getByLabel('Preset prompt')
  await workshopPrompt.click()
  await workshopPrompt.fill('a bright acoustic tune about a summer road trip')
  const workshopRing = await ringOf(workshopPrompt)
  // Die Werkstatt hat keinen eigenen Kasten mit `focus-within`, ihr Feld
  // traegt also die ruhige Haarlinie. Was es NICHT traegt, ist der Akzent:
  // „der lila balken um das prompt fenster geht garnicht" (Eigner, 21.09.).
  expect(workshopRing.color, `Werkstatt traegt den Akzentring: ${JSON.stringify(workshopRing)}`).not.toBe(akzent)
  expect(parseFloat(workshopRing.width), `Werkstatt traegt einen dicken Umriss: ${JSON.stringify(workshopRing)}`).toBeLessThanOrEqual(1.1)
  expect(workshopRing.shadow).toBe('none')
  await dialog.screenshot({ path: shotPath('fokus-werkstatt') })

  // (3) Negativkontrolle im selben Lauf. Tab statt `.focus()`: ein
  //     programmatisch gesetzter Fokus ist kein `:focus-visible`, die
  //     Messung faende dann auch an einem Knopf nichts und der gruene
  //     Befund oben waere wertlos.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('auch das Chat-Promptfeld traegt keinen Akzentring', async ({ page }) => {
  await bootIntoCloudCreate(page, false)
  await page.getByRole('button', { name: /^Chat$/ }).click()

  const chatPrompt = page.locator('textarea.lu-fokus-am-kasten').first()
  await chatPrompt.click()
  await chatPrompt.fill('hello')
  const ring = await ringOf(chatPrompt)
  expect(ring.width, `Chat-Composer traegt einen Umriss: ${JSON.stringify(ring)}`).toBe('0px')
  expect(ring.shadow).toBe('none')
  await page.screenshot({ path: shotPath('fokus-chat') })
})

test('das Was-ist-neu-Blatt geht ohne Fokusrechteck im Fliesstext auf', async ({ page }) => {
  await page.addInitScript(tauriMockInit, WINDOWS_OPTS)
  await seedWithReleaseNotes(page)
  await routeCloud(page, STUDIO)
  await page.goto('/')

  const notes = page.getByRole('dialog', { name: /What's new/ })
  await expect(notes).toBeVisible({ timeout: 20_000 })
  // Der Anfangsfokus sitzt auf der Hauptaktion, nicht auf dem kleinen
  // Textknopf mitten im Text.
  await expect(notes.getByRole('button', { name: 'Got it' })).toBeFocused()
  await notes.screenshot({ path: shotPath('whatsnew-fokus') })
  await page.keyboard.press('Escape')
  await expect(notes).toBeHidden()
})
