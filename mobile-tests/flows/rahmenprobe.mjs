// Probe des Schrittrahmens (flows/lib.mjs) an der Testseite fixture/index.html.
// Kein Fluss der App: Der Selbsttest ruft das auf, um zu zeigen, dass jede Art
// von Ausgang den richtigen Status bekommt und dass die Sperren halten.
// Laeuft mit jedem Treiber, die Testseite muss offen sein.

import { ablauf, tid, offen } from './lib.mjs'

// Schritt und der Status, den er haben MUSS.
export const ERWARTET = {
  'tap-harmlos': 'ok',
  'tap-gesperrt': 'fehler',
  'bezahlt-ohne-freigabe': 'uebersprungen',
  'bewusst-ohne-kostengrund': 'fehler',
  'selektor-offen': 'offen',
  'selektor-fehlt': 'fehler',
  'haken-fehlt': 'offen',
  'nicht-pruefbar': 'nicht pruefbar',
  'braucht-mensch': 'uebersprungen',
  tippen: 'ok',
}

export async function rahmenprobe({ d, config, laufDir }) {
  const f = await ablauf('rahmenprobe', { d, laufDir, config })
  await f.schritt('tap-harmlos', 'ein harmloser Knopf', async () => {
    await f.tap(tid('m-start-save'))
  })
  await f.schritt('tap-gesperrt', 'f.tap lehnt einen Bezahlknopf ab', async () => {
    await f.tap(tid('m-start-generate'))
  })
  await f.schritt('bezahlt-ohne-freigabe', 'tapBezahlt ohne ALLOW_PAID tippt nicht', async () => {
    await f.tapBezahlt(tid('m-start-generate'), 'bild', { modell: 'flux-schnell', zweck: 'Rahmenprobe, darf nie ausgeloest werden' })
  })
  await f.schritt('bewusst-ohne-kostengrund', 'tapBewusst lehnt data-m-risk="paid" ohne kostenlosWeil ab', async () => {
    await f.tapBewusst('#markiert', 'Rahmenprobe: Das darf nicht durchgehen')
  })
  await f.schritt('selektor-offen', 'eine offen(...)-Kennung, die es nicht gibt', async () => {
    await f.tap(offen('m-start-gibt-es-nicht'))
  })
  await f.schritt('selektor-fehlt', 'eine tid(...)-Kennung, die es nicht gibt', async () => {
    await f.tap(tid('m-start-gibt-es-nicht'))
  })
  await f.schritt('haken-fehlt', 'die Testseite hat keinen Testhaken', async () => {
    await f.haken('speicherVoll', true)
  })
  await f.schritt('nicht-pruefbar', 'eine fehlende Voraussetzung', async () => {
    f.nichtPruefbar('Rahmenprobe: Voraussetzung fehlt')
  })
  await f.schritt('braucht-mensch', 'ein Schritt, den nur ein Mensch tun darf', async () => {
    f.mensch('Rahmenprobe: Das macht David')
  })
  await f.schritt('tippen', 'Text in ein Feld', async () => {
    await f.tippe(tid('m-start-name'), 'Mara')
    const w = await f.wert(tid('m-start-name'))
    if (!w.includes('Mara')) throw new Error(`Im Feld steht "${w}"`)
  })
  return f.ende()
}
