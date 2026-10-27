// Altersabfrage je Store-Preset (mobile-docs/STORE-BAUSTEINE.md, Abschnitt 3.3):
//
//   open       keine Abfrage, die App beginnt mit dem Onboarding
//   play       "Are you 18 or older?" vor allem anderen
//   appstore   ebenso
//
// Beide Antworten werden gespielt, jede auf frischen App-Daten:
//   Nein  fragt ein zweites Mal ("You said you are under 18 ..."). "Go back" fuehrt zur Frage zurueck,
//         nichts ist gespeichert (ein Neustart fragt wieder). Erst "Yes, I am under 18" fuehrt auf
//         "LU is for adults" und bleibt dort, auch nach einem Neustart. Die Sperrseite hat keinen Knopf.
//   Ja    laesst herein, fuer immer: Nach einem Neustart fragt die App nicht wieder
//
// Der Fluss loescht dafuer zweimal die App-Daten. Er laeuft deshalb nur mit
// FRISCH=1 und nur auf einem Geraet, das einem allein gehoert. Welches Preset
// ein Bau traegt, legt der Bau fest (VITE_LU_STORE_PRESET): Am Geraet prueft ein
// Lauf genau ein Preset, fuer drei Presets braucht es drei Pakete. In der
// Vorschau schaltet der Schalter ?store= um, dort laufen alle drei.
//
// Aufruf:  PLATFORM=android FRISCH=1 STORE_PRESET=play node flows/alter.mjs

import { ablauf, starte, BrauchtMensch } from './lib.mjs'
import { S } from './selektoren.mjs'
import { istHauptmodul } from '../lib/lauf.mjs'

export async function alter({ d, config, laufDir }, env = process.env) {
  const f = await ablauf('alter', { d, laufDir, config })
  const presets = d.plattform === 'vorschau' ? (env.STORE_PRESET ? [env.STORE_PRESET] : ['open', 'play', 'appstore']) : [null]

  async function frisch(preset) {
    if (env.FRISCH !== '1') throw new BrauchtMensch('Dieser Fluss loescht die App-Daten. Nur mit FRISCH=1.')
    await d.clearData()
    if (d.plattform === 'vorschau') {
      d.schalter.onboarding = null
      d.schalter.store = preset === 'open' ? null : preset
    }
    await d.launch()
    await d.sleep(800)
  }

  async function presetDesBaus(vorgabe) {
    if (vorgabe) return vorgabe
    if (await f.hakenHat('zustand')) {
      const z = await f.haken('zustand').catch(() => null)
      if (z?.storePreset) return z.storePreset
      if (z?.preset) return z.preset
    }
    return config.storePreset
  }

  for (const vorgabe of presets) {
    const name = vorgabe ?? 'bau'

    await f.schritt(`erster-start-${name}`, `Erster Start, Preset ${vorgabe ?? 'des Baus'}`, async () => {
      await frisch(vorgabe)
      const preset = await presetDesBaus(vorgabe)
      const l = await f.lage()
      const gesehen = l.alter === 'ask' ? 'frage' : l.alter ? `gesperrt (${l.alter})` : 'keine'
      f.notiz(`Preset ${preset ?? 'unbekannt'}, Altersabfrage: ${gesehen}`)
      if (!preset) throw new Error('Welches Preset der Bau traegt, sagt weder der Testhaken noch STORE_PRESET')
      const soll = preset === 'open' ? 'keine' : 'frage'
      if (gesehen !== soll) throw new Error(`Preset ${preset} verlangt ${soll === 'frage' ? 'die Altersabfrage' : 'keine Altersabfrage'}, gesehen: ${gesehen}`)
      if (soll === 'keine') await f.sieht(S.onboarding.willkommen)
      else {
        await f.sieht(S.alter.frage)
        await f.sieht(S.alter.ja)
        await f.sieht(S.alter.nein)
        // Vor der Antwort darf nichts anderes erreichbar sein: kein Onboarding, keine Reiter.
        if ((await f.istDa(S.onboarding.willkommen)) || (await f.istDa(S.nav.leiste))) throw new Error('Hinter der Altersabfrage ist die App schon zu sehen')
      }
    })

    const preset = vorgabe ?? config.storePreset
    if (preset === 'open') continue

    await f.schritt(`nein-${name}`, `Antwort Nein: "LU is for adults", auch nach einem Neustart (${name})`, async () => {
      if (!(await f.istDa(S.alter.frage))) await frisch(vorgabe)
      // Runde 10: das erste Nein speichert nichts. Zurueck, Neustart, und die Frage steht wieder da.
      await f.tap(S.alter.nein)
      await f.sieht(S.alter.rueckfrage)
      await f.sieht(S.alter.unter18)
      await f.tap(S.alter.zurueck)
      await f.sieht(S.alter.frage)
      await f.tap(S.alter.nein)
      await f.sieht(S.alter.rueckfrage)
      await d.kill()
      await d.launch()
      await f.sieht(S.alter.frage, 20000)
      if (await f.istDa(S.alter.gesperrt)) throw new Error('Das erste Nein wurde schon gespeichert: nach dem Neustart steht die Sperrseite da')
      await f.tap(S.alter.nein)
      await f.sieht(S.alter.rueckfrage)
      await f.tapBewusst(S.alter.unter18, 'die zweite Antwort der Altersfrage: der Fluss laeuft auf frischen App-Daten eines eigenen Geraets und loescht sie danach wieder')
      await f.sieht(S.alter.gesperrt)
      const text = await f.text(S.alter.gesperrt)
      if (text.length < 12) throw new Error(`Die Seite sagt nichts: "${text}"`)
      if ((await f.istDa(S.alter.ja)) || (await f.istDa(S.alter.zurueck))) throw new Error('Auf der Sperrseite steht noch ein Knopf')
      await d.kill()
      await d.launch()
      await f.sieht(S.alter.gesperrt, 20000)
      if ((await f.istDa(S.alter.frage)) || (await f.istDa(S.onboarding.willkommen))) throw new Error('Nach dem Neustart fragt die App neu oder laesst herein')
      f.notiz(`Sperrseite: "${text.slice(0, 120)}"`)
    })

    await f.schritt(`ja-${name}`, `Antwort Ja: herein, und nach einem Neustart keine Frage mehr (${name})`, async () => {
      await frisch(vorgabe)
      await f.sieht(S.alter.frage, 20000)
      // Der erste Tipp gleich nach clearData und Start kam am grossen iPhone nicht an (Nachabnahme, Abschnitt 5):
      // warten, bis der Knopf steht, tippen, und wenn die Frage bleibt, noch einmal. Ein zweites "Yes" richtet nichts an.
      await f.tapBis(S.alter.ja, async () => !(await f.lage()).alter)
      await f.sieht(S.onboarding.willkommen)
      await d.kill()
      await d.launch()
      await d.sleep(800)
      const l = await f.lage()
      if (l.alter) throw new Error(`Nach dem Neustart steht die Altersabfrage wieder da (data-age="${l.alter}")`)
      await f.sieht(S.onboarding.willkommen)
    })
  }

  return f.ende()
}

if (istHauptmodul(import.meta.url)) {
  const k = await starte('alter')
  let e
  try {
    await k.d.connect(k.d.plattform === 'vorschau' ? {} : { pkg: k.config.pkg, urlFilter: k.config.urlFilter, start: true })
    e = await alter(k)
  } finally {
    await k.d.disconnect()
  }
  console.log(JSON.stringify(e.zahlen), '\n' + k.laufDir)
  for (const s of e.schritte) console.log(String(s.nr).padStart(2), s.status.padEnd(14), s.id.padEnd(24), (s.grund ?? '').slice(0, 150))
}
