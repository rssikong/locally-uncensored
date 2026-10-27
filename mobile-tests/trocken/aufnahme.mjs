// Nimmt von jeder Seite und jedem Blatt der Shell einen DOM-Schnappschuss auf
// (Vite-Vorschau, kopfloser Browser) und legt ihn unter trocken/schnappschuesse/
// ab. Die Schnappschuesse stehen im Repo: Der statische Trockenlauf
// (trocken/statisch.mjs) prueft die Selektoren der Fluesse dagegen, ohne dass
// ein Browser oder ein Geraet laufen muss.
//
// Aufruf:  node trocken/aufnahme.mjs            alle Seiten und Blaetter
//          NUR=chat,settings node trocken/aufnahme.mjs
//
// Erreicht wird jede Seite ueber die Entwicklerseite /dev/routes der Shell, mit
// echten Touch-Ereignissen. Parameter-Routen bekommen dort Beispielwerte, die
// Seite zeigt dann ihren Leer- oder Fehlzustand. Zustaende mit Daten (laufender
// Chat, Download, angemeldet) gibt es in der Vorschau nicht: Was dort fehlt,
// fuehrt statisch.mjs als "nur in den Quellen gefunden".

import { scan, fingerabdruck } from '../tabelle/scan.mjs'
import { writeFileSync, mkdirSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ladeTreiber } from '../driver/index.mjs'
import { lage, kennungen, tid, warteRuhig, leseLage } from '../lib/shell.mjs'
import { dateiName, istHauptmodul } from '../lib/lauf.mjs'
import { VORSCHAU_WT } from './server.mjs'
import { basename } from 'node:path'

const HIER = dirname(fileURLToPath(import.meta.url))
export const SCHNAPP_DIR = join(HIER, 'schnappschuesse')

async function schnapp(d, name, art, extra = {}) {
  await warteRuhig(d)
  const l = await d.evalFn(lage)
  const k = await d.evalFn(kennungen)
  // Die Entwicklerseite liegt unter der aufgenommenen Seite im Stapel. Ihre Kennungen gehoeren nicht dazu.
  const eigene = k.filter((x) => !x.id.startsWith('m-dev-'))
  const s = { name, art, quelle: process.env.VORSCHAU_URL ? 'fremder Server' : basename(VORSCHAU_WT), ...extra, lage: { route: l.route, screen: l.screen, blaetter: l.blaetter, dialog: l.dialog, reiter: l.reiter, alter: l.alter }, kennungen: eigene }
  mkdirSync(SCHNAPP_DIR, { recursive: true })
  writeFileSync(join(SCHNAPP_DIR, `${dateiName(art + '-' + name)}.json`), JSON.stringify(s, null, 1) + '\n')
  return s
}

export async function aufnahme({ nur = null } = {}) {
  const tabelle = JSON.parse(readFileSync(join(HIER, '..', 'tabelle', 'tabelle.json'), 'utf8'))
  const d = await ladeTreiber('vorschau')
  const protokoll = []
  const merke = (name, art, ok, grund) => protokoll.push({ name, art, ok, grund: grund ?? undefined })
  const will = (strang) => !nur || nur.includes(strang)
  try {
    await d.connect()
    if (!nur && existsSync(SCHNAPP_DIR)) for (const f of readdirSync(SCHNAPP_DIR)) if (f.endsWith('.json')) rmSync(join(SCHNAPP_DIR, f))
    const dev = async () => {
      await d.launch({ schalter: { route: '/dev/routes' } })
      await d.waitFor(`!!document.querySelector('${tid('m-dev-routes-screen')}')`, 15000)
    }
    for (const r of tabelle.routen) {
      if (r.dev || !will(r.strang)) continue
      const name = r.route
      try {
        await dev()
        const knopf = r.art === 'root' ? tid(`m-dev-root-${r.tab}`) : tid(`m-dev-route-${r.screen}`)
        await d.tap(knopf)
        await d.waitFor(`[...document.querySelectorAll('${tid(r.screenTestid)}')].some((e) => !e.closest('[data-m-hidden]'))`, 8000)
        const s = await schnapp(d, name, 'seite', { route: r.route, strang: r.strang, code: r.code })
        merke(name, 'seite', true, `${s.kennungen.length} Kennungen`)
      } catch (e) {
        const l = await leseLage(d).catch(() => ({}))
        await schnapp(d, name, 'seite', { route: r.route, strang: r.strang, code: r.code, fehler: e.message.slice(0, 200) }).catch(() => {})
        merke(name, 'seite', false, `${e.message.slice(0, 160)} (steht auf ${l.route}, ${l.screen})`)
      }
    }
    for (const b of tabelle.blaetter) {
      if (b.blatt.startsWith('dev-') || !will(b.strang)) continue
      try {
        await dev()
        await d.tap(tid(`m-dev-sheet-open-${b.blatt}`))
        await d.waitFor(`!!document.querySelector('${tid(b.testid)}')`, 8000)
        const s = await schnapp(d, b.blatt, 'blatt', { blatt: b.blatt, strang: b.strang, code: b.code })
        merke(b.blatt, 'blatt', true, `${s.kennungen.length} Kennungen`)
      } catch (e) {
        merke(b.blatt, 'blatt', false, e.message.slice(0, 160))
      }
    }
    if (!nur) {
      // Zustaende ausserhalb der Routenliste: frische Installation je Store-Preset.
      for (const preset of ['open', 'play', 'appstore']) {
        try {
          await d.clearData()
          await d.launch({ schalter: { onboarding: null, store: preset === 'open' ? null : preset } })
          const s = await schnapp(d, `frisch-${preset}`, 'zustand', { preset })
          merke(`frisch-${preset}`, 'zustand', true, `Altersabfrage ${s.lage.alter ?? 'keine'}, Route ${s.lage.route}`)
          if (s.lage.alter === 'ask') {
            await d.tap(tid('m-age-no'))
            await d.sleep(500)
            await schnapp(d, `alter-rueckfrage-${preset}`, 'zustand', { preset })
            merke(`alter-rueckfrage-${preset}`, 'zustand', true)
            await d.tap(tid('m-age-confirm-minor'))
            await d.sleep(500)
            await schnapp(d, `alter-nein-${preset}`, 'zustand', { preset })
            merke(`alter-nein-${preset}`, 'zustand', true)
            await d.clearData()
            await d.launch({ schalter: { onboarding: null, store: preset } })
            await d.tap(tid('m-age-yes'))
            await d.sleep(800)
            const nach = await schnapp(d, `alter-ja-${preset}`, 'zustand', { preset })
            merke(`alter-ja-${preset}`, 'zustand', true, `danach Route ${nach.lage.route}`)
          }
        } catch (e) {
          merke(`frisch-${preset}`, 'zustand', false, e.message.slice(0, 160))
        }
      }
      await d.clearData()
    }
    const gesperrt = d.gesperrteAnfragen()
    const jetzt = scan()
    const stand = { zeit: new Date().toISOString(), quellen: jetzt.quellen, fingerabdruck: fingerabdruck(jetzt), groesse: d.info().groesse, zahlen: { aufgenommen: protokoll.filter((p) => p.ok).length, gescheitert: protokoll.filter((p) => !p.ok).length }, gesperrteAnfragen: [...new Set(gesperrt.map((g) => new URL(g.url).origin))], protokoll }
    if (!nur) writeFileSync(join(SCHNAPP_DIR, '_aufnahme.json'), JSON.stringify(stand, null, 1) + '\n')
    return stand
  } finally {
    await d.disconnect()
  }
}

if (istHauptmodul(import.meta.url)) {
  const nur = process.env.NUR ? process.env.NUR.split(',') : null
  const s = await aufnahme({ nur })
  for (const p of s.protokoll) if (!p.ok) console.log('GESCHEITERT', p.art, p.name, p.grund)
  console.log(JSON.stringify(s.zahlen), 'gesperrt:', s.gesperrteAnfragen.join(', ') || 'nichts')
}
