#!/usr/bin/env node
// Erster Start eines frisch installierten Abnahmebaus, mit echten Touches
// ueber die Treiber aus mobile-tests/driver:
//   Onboarding, kleinstes Modell laden (echter Download), eine lokale Antwort,
//   Teilen-Dialog aus dem Chat-Export, Deep Link warm und kalt, Hintergrund und
//   zurueck, Abschuss und Neustart.
//
//   PLATFORM=android ANDROID_SERIAL=emulator-5572 APP_PKG=com.purpledoubled.locallyuncensored \
//     node scripts/mobile/erster-start.mjs merge-android-klein
//   PLATFORM=ios IOS_SIM=<name> APP_PKG=com.purpledoubled.lu \
//     node scripts/mobile/erster-start.mjs merge-ios-klein
//
// Voraussetzung: die App ist frisch installiert (keine Daten) und laeuft noch
// nicht. Bilder landen in mobile-docs/belege/<praefix>-NN-<name>.png. Am Ende
// steht ein JSON mit dem Ergebnis je Schritt, Exit 1 bei einem Fehlschlag.
// Der Deep Link traegt eine Adresse, die es nicht gibt. Das Angebot wird nur
// gezeigt und abgelehnt, nie angenommen.
import { ladeTreiber } from '../../mobile-tests/driver/index.mjs'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PRAEFIX = process.argv[2] ?? `merge-${process.env.PLATFORM}`
const BELEGE = resolve(WURZEL, 'mobile-docs/belege')
mkdirSync(BELEGE, { recursive: true })
const LINK = 'lu://remote?url=https%3A%2F%2F192.168.77.5%3A8443&code=123456'
const MODELL = process.env.LU_MODELL ?? 'SmolLM2 360M'
const tid = (id) => `[data-testid="${id}"]`
const da = (id) => `!!document.querySelector('[data-testid="${id}"]')?.offsetParent`

const d = await ladeTreiber()
const schritte = []
let nr = 0
const bild = async (name) => {
  nr += 1
  const pfad = resolve(BELEGE, `${PRAEFIX}-${String(nr).padStart(2, '0')}-${name}.png`)
  await d.screenshot(pfad)
  return pfad.replace(WURZEL + '/', '')
}
const schritt = async (name, fn) => {
  const start = Date.now()
  const marke = d.marke?.() ?? { konsole: 0, netz: 0 }
  try {
    const wert = await fn()
    schritte.push({ schritt: name, ok: true, sek: +((Date.now() - start) / 1000).toFixed(1), ...wert })
    return true
  } catch (e) {
    let konsole = []
    try { konsole = d.consoleLog(marke.konsole).slice(-12).map((c) => `${c.typ}: ${String(c.text).slice(0, 300)}`) } catch { /* nicht verbunden */ }
    let foto = null
    try { foto = await bild(`FEHLER-${name}`) } catch { /* kein Bild */ }
    schritte.push({ schritt: name, ok: false, sek: +((Date.now() - start) / 1000).toFixed(1), fehler: String(e?.message ?? e), konsole, bild: foto })
    return false
  }
}
// Blaetter und Seiten fahren herein. Ein Tipp waehrend der Fahrt trifft den
// Nachbarn (gesehen: Compare statt Export), also erst zur Ruhe kommen lassen.
const ruhe = () => d.sleep(900)
const angebot = () => d.evalJs(`(document.querySelector('[data-testid="m-sheet-link-offer"]')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 120)`)
const antwort = () => d.evalJs(`(document.querySelector('[data-testid="m-chat-answer"]')?.innerText || '').trim().slice(0, 200)`)

let weiter = await schritt('frischer-start-onboarding', async () => {
  // connect statt launch: erst connect uebernimmt die Paketkennung aus APP_PKG.
  await d.connect({ pkg: process.env.APP_PKG, start: true, timeoutMs: 60000 })
  await d.waitFor(da('m-onboarding-screen'), 30000)
  const v = await d.viewport()
  return { viewport: `${v.w}x${v.h}@${v.dpr}`, testhaken: await d.evalJs('typeof window.__LU_TEST__'), bild: await bild('onboarding') }
})
weiter = weiter && await schritt('modell-laden', async () => {
  await d.tap(tid('m-onboarding-next'))
  await d.waitFor(da('m-onboarding-model-screen'), 15000)
  await ruhe()
  const geraet = await d.evalJs(`document.querySelector('[data-testid="m-onboarding-model-device"]')?.innerText`)
  await d.tap(MODELL)
  await d.sleep(600)
  const knopf = await d.evalJs(`document.querySelector('[data-testid="m-onboarding-download"]').innerText`)
  const b1 = await bild('modellwahl')
  await d.tap(tid('m-onboarding-download'))
  await d.waitFor(da('m-onboarding-progress'), 30000)
  await d.sleep(3000)
  const fortschritt = await d.evalJs(`document.querySelector('[data-testid="m-onboarding-progress"]')?.innerText.replace(/\\s+/g, ' ')`)
  const b2 = await bild('download-laeuft')
  await d.waitFor(da('m-onboarding-model-ready'), 900000)
  const fertig = await d.evalJs(`document.querySelector('[data-testid="m-onboarding-model-ready"]').innerText`)
  return { geraet, knopf, fortschritt, fertig, bilder: [b1, b2, await bild('modell-bereit')] }
})
weiter = weiter && await schritt('onboarding-abschliessen', async () => {
  await d.tap('Continue')
  await d.waitFor(da('m-onboarding-documents-screen'), 15000)
  await ruhe()
  await d.tap(tid('m-onboarding-skip'))
  await d.waitFor(da('m-onboarding-done-screen'), 15000)
  await ruhe()
  await d.tap(tid('m-onboarding-done'))
  await d.waitFor(da('m-chat-input'), 20000)
  return { bild: await bild('chat-leer') }
})
weiter = weiter && await schritt('lokale-antwort', async () => {
  // Nach dem Onboarding liegt kurz eine Meldung ueber dem Eingabefeld. Ein
  // Mensch wartet, bis sie weg ist. Wie lange das dauert, steht im Ergebnis.
  const t0 = Date.now()
  let treffer = await d.tap(tid('m-chat-input'), { nurWennFrei: true }).catch((e) => ({ verdeckt: true, verdecktVon: String(e?.message ?? e) }))
  let verdecktVon = null
  while (treffer.verdeckt && Date.now() - t0 < 15000) {
    verdecktVon = verdecktVon ?? treffer.verdecktVon ?? 'unbekannt'
    await d.sleep(500)
    treffer = await d.tap(tid('m-chat-input'), { nurWennFrei: true }).catch((e) => ({ verdeckt: true, verdecktVon: String(e?.message ?? e) }))
  }
  if (treffer.verdeckt) throw new Error(`das Eingabefeld bleibt verdeckt von ${verdecktVon}`)
  const feldVerdecktMs = verdecktVon ? Date.now() - t0 : 0
  await d.sleep(600)
  await d.type('Say hello in five words.')
  await d.sleep(400)
  await d.tap(tid('m-chat-send'))
  await d.waitFor(`!document.querySelector('[data-testid="m-chat-stop"]') && (document.querySelector('[data-testid="m-chat-answer"]')?.innerText || '').trim().length > 3`, 300000)
  await d.sleep(800)
  if (typeof d.hideKeyboard === 'function') await d.hideKeyboard().catch(() => {})
  await d.sleep(600)
  return { antwort: await antwort(), feldVerdecktMs, verdecktVon, bild: await bild('lokale-antwort') }
})
weiter = weiter && await schritt('teilen-aus-export', async () => {
  await d.tap(tid('m-chat-menu'))
  await d.waitFor(da('m-chat-menu-export'), 10000)
  await ruhe()
  await d.tap(tid('m-chat-menu-export'))
  await d.waitFor(da('m-chat-menu-export-markdown'), 10000)
  await ruhe()
  await d.tap(tid('m-chat-menu-export-markdown'))
  await d.sleep(3500)
  const vorn = typeof d.foreground === 'function' ? await d.foreground() : null
  const b = await bild('teilen-dialog')
  if (typeof d.dismissNative === 'function') await d.dismissNative()
  else await d.back()
  await d.sleep(1500)
  // iOS: der Tipp des Treibers in die Statusleiste schliesst das Teilen-Blatt
  // auf dem iPhone SE nicht (gesehen am 08.10.2026). Dann daneben tippen, in
  // den abgedunkelten Bereich ueber dem Blatt.
  let schliessVersuche = 0
  while (typeof d.tapPunkt === 'function' && (await d.foreground()).nativ && schliessVersuche < 3) {
    schliessVersuche += 1
    const v = await d.viewport()
    await d.tapPunkt(Math.round(v.w * 0.5), 110)
    await d.sleep(1500)
  }
  if (typeof d.foreground === 'function') {
    const danach = await d.foreground()
    if (!danach.istApp || danach.nativ) throw new Error(`das Teilen-Blatt liess sich nicht schliessen: ${JSON.stringify(danach)}`)
  }
  if (vorn && vorn.istApp && !vorn.nativ) throw new Error(`kein natives Fenster vorn: ${JSON.stringify(vorn)}`)
  return { fenster: vorn?.fenster ?? null, schliessVersuche, bild: b }
})
weiter = weiter && await schritt('deeplink-warm', async () => {
  const r = await d.openUrl(LINK)
  await d.waitFor(da('m-link-offer-dismiss'), 20000)
  await ruhe()
  const text = await angebot()
  const b = await bild('deeplink-warm')
  await d.tap(tid('m-link-offer-dismiss'))
  await d.sleep(800)
  return { dialog: r?.dialog ?? null, angebot: text, bild: b }
})
weiter = weiter && await schritt('hintergrund-und-zurueck', async () => {
  const pid = (await d.info()).pid
  await d.evalJs(`(window.__ev = [], document.addEventListener('visibilitychange', () => window.__ev.push(document.visibilityState)), 1)`)
  await d.background()
  await d.sleep(4000)
  const b1 = await bild('hintergrund')
  await d.activate()
  await d.sleep(2500)
  const nach = { ereignisse: await d.evalJs('window.__ev'), antwort: await antwort(), pidGleich: (await d.info()).pid === pid }
  if (!nach.antwort) throw new Error('der Chat ist nach der Rueckkehr leer')
  if (!nach.pidGleich) throw new Error('der Prozess wurde im Hintergrund ersetzt')
  return { ...nach, bilder: [b1, await bild('zurueck')] }
})
weiter = weiter && await schritt('abschuss-und-neustart', async () => {
  await d.kill()
  await d.sleep(1500)
  await d.launch({ verbinden: true })
  await d.waitFor(`${da('m-chat-screen')} || ${da('m-chats-screen')} || ${da('m-onboarding-screen')}`, 30000)
  await d.sleep(2500)
  const stand = await d.evalJs(`({ onboarding: ${da('m-onboarding-screen')}, chats: document.querySelectorAll('[data-testid="m-chats-item"]').length })`)
  if (stand.onboarding) throw new Error('nach dem Neustart steht wieder das Onboarding')
  if (stand.chats < 1) throw new Error('der Chat ist nach dem Neustart weg')
  return { ...stand, antwort: await antwort(), bild: await bild('neustart') }
})
if (weiter) await schritt('deeplink-kalt', async () => {
  await d.kill()
  await d.sleep(1500)
  const r = await d.openUrl(LINK)
  await d.sleep(1500)
  await d.connect({ pkg: process.env.APP_PKG, start: false, timeoutMs: 30000 })
  await d.waitFor(da('m-link-offer-dismiss'), 30000)
  await ruhe()
  const text = await angebot()
  const b = await bild('deeplink-kalt')
  await d.tap(tid('m-link-offer-dismiss'))
  return { dialog: r?.dialog ?? null, angebot: text, bild: b }
})

let konsole = []
try { konsole = d.consoleLog().filter((c) => /error|exception/.test(c.typ)).map((c) => `${c.typ}: ${String(c.url ?? '')} ${String(c.text).slice(0, 200)}`) } catch { /* nicht verbunden */ }
try { await d.disconnect() } catch { /* war nie verbunden */ }
const ok = schritte.length === 9 && schritte.every((s) => s.ok)
console.log(JSON.stringify({ praefix: PRAEFIX, plattform: d.plattform, ok, schritte, konsoleFehler: [...new Set(konsole)] }, null, 1))
process.exit(ok ? 0 : 1)
