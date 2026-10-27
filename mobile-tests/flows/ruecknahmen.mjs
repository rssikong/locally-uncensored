// Ruecknahmen: Was der Sweep nur tippen darf, wenn er es danach wieder zuruecknimmt.
//
// Ein Eintrag in flows/freigaben.mjs mit modus 'mit-ruecknahme' nennt hier einen Namen. Der Sweep
//   1. liest VOR dem Tipp den Stand (stand): 'offen' heisst, der Tipp verstellt etwas, das sich zuruecknehmen laesst.
//      Jeder andere Stand sperrt den Knopf fuer diesen Lauf, mit dem Grund, der dabei steht.
//   2. tippt den Knopf wie jeden anderen,
//   3. nimmt die Wirkung zurueck (nimmZurueck), mit echten Tipps auf dem Weg, den ein Kunde hat,
//   4. und schreibt, was sich nicht zuruecknehmen liess, je Seite unter "verstellt".
//
// Gegenpruefung Android 4 GB, Teil 2: Der Sweep tippte im Blatt "ai-consent" auf "Agree" und liess die
// Einwilligung fuer LU Cloud stehen. Der Sweep am naechsten Paket fand in Settings, Privacy den Knopf zum
// Widerrufen statt "Allow", unter "verstellt" stand nichts.

import { tid, sichtbarDa, attributVon, warteBisStill, warteRuhig, schliesseUeberlagerungen, zuReiter } from '../lib/shell.mjs'

const STAND = tid('m-settings-privacy-ai-state')
const WIDERRUF = tid('m-settings-privacy-ai-withdraw-reset')
const RUECKFRAGE = tid('m-dialog-ai-consent-withdraw')
const JA = tid('m-dialog-confirm')

async function zuPrivacy(d) {
  await schliesseUeberlagerungen(d).catch(() => {})
  await zuReiter(d, 'settings')
  await warteBisStill(d, tid('m-settings-privacy'))
  await d.tap(tid('m-settings-privacy'))
  await warteRuhig(d, 4000)
}

// Der Stand der Einwilligung, abgelesen wo der Kunde ihn sieht: Settings, Privacy.
//   'offen'           die App fragt in diesem Paket und es ist nicht eingewilligt
//   'erteilt'         es ist schon eingewilligt (der Sweep nimmt keine Einwilligung zurueck, die er nicht gegeben hat)
//   'ohne-rueckweg'   dieses Paket zeigt in Settings, Privacy keinen Knopf dafuer (es fragt nicht): kein Weg zurueck
async function standEinwilligung(d) {
  await zuPrivacy(d)
  const da = await d.evalFn(sichtbarDa, STAND).catch(() => null)
  if (!da?.sichtbar) return { stand: 'ohne-rueckweg', grund: 'Settings, Privacy zeigt in diesem Paket keinen Knopf fuer die Einwilligung, es gaebe keinen Weg zurueck' }
  const erlaubt = await d.evalFn(attributVon, STAND, 'data-allowed').catch(() => null)
  if (erlaubt === 'yes') return { stand: 'erteilt', grund: 'die Einwilligung war vor dem Sweep schon erteilt, der Sweep nimmt sie nicht zurueck' }
  if (erlaubt === 'no') return { stand: 'offen' }
  return { stand: 'unbekannt', grund: `der Stand der Einwilligung ist nicht abzulesen (data-allowed="${erlaubt}")` }
}

async function nimmEinwilligungZurueck(d) {
  await zuPrivacy(d)
  const erlaubt = await d.evalFn(attributVon, STAND, 'data-allowed').catch(() => null)
  // Der Tipp hat nichts erteilt (das Blatt wurde ohne wartende Frage geoeffnet): nichts zurueckzunehmen.
  if (erlaubt === 'no') return { ok: true, war: 'nicht erteilt' }
  if (erlaubt !== 'yes') return { ok: false, grund: 'nicht zurueckgenommen: Settings, Privacy zeigt den Stand der Einwilligung nicht' }
  await warteBisStill(d, WIDERRUF)
  await d.tap(WIDERRUF)
  await d.sleep(500)
  if (!(await d.evalFn(sichtbarDa, RUECKFRAGE).catch(() => null))?.sichtbar) {
    await schliesseUeberlagerungen(d).catch(() => {})
    return { ok: false, grund: 'nicht zurueckgenommen: Nach dem Tipp auf den Widerruf kam die Rueckfrage m-dialog-ai-consent-withdraw nicht' }
  }
  await d.tap(JA)
  await d.sleep(600)
  const danach = await d.evalFn(attributVon, STAND, 'data-allowed').catch(() => null)
  if (danach === 'no') return { ok: true, war: 'erteilt' }
  return { ok: false, grund: `nicht zurueckgenommen: Nach dem Widerruf steht die Einwilligung auf data-allowed="${danach}"` }
}

export const RUECKNAHMEN = {
  einwilligung: {
    was: 'Einwilligung fuer LU Cloud (Blatt ai-consent, "Agree")',
    stand: standEinwilligung,
    nimmZurueck: nimmEinwilligungZurueck,
  },
}

// Rein: Darf der Sweep einen Knopf mit dieser Freigabe tippen? Gibt null (ja) oder den Grund der Sperre zurueck.
//   ruecknahme   der Eintrag aus RUECKNAHMEN oder undefined
//   stand        die Antwort von ruecknahme.stand(d), oder ein Fehler als {stand: 'unbekannt', grund}
export function ruecknahmeSperre(frei, ruecknahme, stand) {
  if (!ruecknahme) return `gesperrt (destructive): Die Freigabe nennt die Ruecknahme "${frei?.ruecknahme}", die es in flows/ruecknahmen.mjs nicht gibt`
  if (stand?.stand === 'offen') return null
  return `gesperrt (destructive): ${ruecknahme.was} wird nur getippt, wenn es sich zuruecknehmen laesst: ${stand?.grund ?? 'der Stand ist unbekannt'}`
}
