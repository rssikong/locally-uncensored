// Store-Pruefung fuer das Preset appstore (Befunde IG-H4, IG-H5, IG-H6 der ersten Abnahme):
// geht alle Routen der Konfiguration durch und meldet, was im App Store nicht zu sehen sein darf.
//
//   IG-H4  eigene Anbieter, Remote und Hugging-Face-Token sind sichtbar (Kennungen und Texte)
//   IG-H5  Werbung mit "no refusals", "uncensored", Persona "No Filter"
//   IG-H6  Kaufwoerter und Links zu lu-labs.ai
//
// Runde 15 (Entscheidungen vom 10.10.2026): der lange Produktname in jeder Schreibweise ist in beiden Store-Paketen
// ein Fund (die App heisst dort nur "LU"), ebenso die geroutete Kennung eines Modells ("openai::...") und weitere
// Woerter des Kaufens (Apple 3.1.3(f)). Die Marke "Direct" eines Cloud-Modells ist kein Fund.
//
// Eine Nennung ist erlaubt (ERLAUBTE_NENNUNGEN): die Kontaktadresse hello@lu-labs.ai in der Kontaktzeile der
// Seite About, und nur dort.
//
// Die Liste ist ein Netz, kein Urteil: Jeder Fund kommt mit Route, Text und Bild, der
// Abnahme-Agent sieht ihn an. Kein Fund heisst nicht "sauber", solange Routen nicht
// herstellbar waren (sie stehen am Ende).
//
// Aufruf:  PLATFORM=ios IOS_SIM=<name> APP_PKG=<bundle-id> PRESET_SETZEN=appstore node checks/storeworte.mjs
//   PRESET_SETZEN=appstore   stellt das Preset ueber den Testhaken um (Abnahmebau mit Preset open).
//                            Ohne die Angabe muss der Bau selbst appstore tragen, sonst bricht der Lauf ab.
//   PRESET_ERWARTET=play     prueft einen Play-Bau: IG-H4 (Anbieter, Remote, Token) ist dort erlaubt und nur Hinweis
//   ROUTEN, STRANG           wie beim Sweep
//   BILDER=alle              ein Bild je Route, auch ohne Fund (fuer die Durchsicht von Hand)
//
// pruefeStoreTexte(texte) und pruefeStoreKennungen(kennungen) sind rein und laufen ohne Geraet.

import { join } from 'node:path'
import { sichtbareTexte } from '../lib/seite.mjs'
import { kennungen, raeumeStapel } from '../lib/shell.mjs'
import { haken, hakenHat } from '../lib/haken.mjs'
import { schreibeJson, dateiName, laufVerzeichnis, ladeConfig, istHauptmodul } from '../lib/lauf.mjs'

export const STORE_MUSTER = [
  { id: 'no refusals', befund: 'IG-H5', re: /\bno[\s-]refusals?\b|\bnever refuses?\b|\bwon'?t refuse\b/gi },
  { id: 'uncensored', befund: 'IG-H5', re: /\buncensored\b|\bunfiltered\b|\babliterated\b/gi },
  { id: 'No Filter', befund: 'IG-H5', re: /\bno[\s-]filters?\b/gi },
  // Der lange Produktname, in jeder Schreibweise: "Locally Uncensored", "LocallyUncensored", "locally-uncensored", "locally_uncensored".
  { id: 'Produktname', befund: 'IG-H5', re: /locally[\s_.-]*uncensored/gi },
  // Die geroutete Kennung eines Modells. Ein Mensch liest den Namen, nie das hier.
  { id: 'Modellkennung', befund: 'IG-H5', re: /\b[a-z][\w-]*::[\w.\/-]+/gi },
  // Schreibweisen, unter denen ein Modell ohne Ablehnungen im Namen gefuehrt wird (Gegenpruefung 2 Android, F10:
  // "lorablated" stand in den Suchtreffern des Play-Pakets, und keine Regel kannte das Wort). Die Liste der App ist
  // src/mobile/policy/unfiltered-names.ts; der Selbsttest ohne Geraet haelt dieses Muster gegen deren Beispiele.
  { id: 'Schreibweise', befund: 'IG-H5', re: /\b\w*ablat(ed|ion)\b|\babl\b|\bobliterat\w*|\borthogonal\w*|\bortho\b|\bheretic\w*|\bde-?restrict\w*|\b(de|un)-censor\w*|\bdecensor\w*|\bun-filter\w*|\bno-?refus\w*|\bnofilter\b|\brefusal[\s-]?(free|removed)\b|\b(zero|non)[\s-]?refus\w*|\bunrefus\w*|\bjail-?br(oken|eak\w*)\b|\bnsfw\b|\berp\b|\berotic\w*|\blewd\w*|\bsmut\b|\bhentai\b|\bporn\w*|\bxxx\b/gi },
  { id: 'Kaufwort', befund: 'IG-H6', re: /\b(buy|purchase[sd]?|subscribe|subscription|upgrade|top[\s-]?up|checkout|pricing|price[sd]?|get credits|more credits|add credits|premium|free trial|monthly|per month|refund(ed|s)?|charged?|renew\w*|invoice|billing|billed|paid|payment)\b|[$\u20ac]\s?\d/gi },
  { id: 'Tarif', befund: 'IG-H6', zusatz: true, re: /\bplans?\b/gi },
  { id: 'lu-labs.ai', befund: 'IG-H6', re: /\blu-labs\.ai\b/gi },
  { id: 'eigener Anbieter', befund: 'IG-H4', re: /\b(custom (endpoint|provider|model url)|own provider|add provider|api key|base url)\b/gi },
  { id: 'Hugging-Face-Token', befund: 'IG-H4', re: /\b(hugging ?face|hf)[\s-]?token\b/gi },
  { id: 'Remote', befund: 'IG-H4', zusatz: true, re: /\bremote\b/gi },
]

// Kennungen, die im Preset appstore nicht sichtbar sein duerfen (ein Abschnitt zwischen Bindestrichen).
const KENNUNG = /(^|-)(provider|providers|remote|endpoint|hf|huggingface|token|plans|buy|upgrade|topup)(-|$)/

// Erlaubte Nennungen: ein Wort, das ein Muster trifft, an GENAU einer Stelle der App.
// Kein Freibrief fuer das Muster: dieselbe Adresse in einem anderen Element, auf einer anderen Seite oder
// in einem Link bleibt ein Fund, und jede andere Nennung von lu-labs.ai sowieso.
//
//   hello@lu-labs.ai   Kontaktadresse der App, Seite About, Kontaktzeile (m-settings-about-contact).
//                      Entschieden am 10.10.2026 (mobile-docs/FUER-DAVID.md, "Entschieden"): beide Stores verlangen
//                      eine Kontaktangabe, und diese Adresse ist die gewollte. Zuruecknehmen: den Eintrag loeschen.
export const ERLAUBTE_NENNUNGEN = [{ muster: 'lu-labs.ai', wort: 'hello@lu-labs.ai', kennung: 'm-settings-about-contact', grund: 'Kontaktadresse der App auf der Seite About, entschieden 10.10.2026' }]

// Erlaubte Saetze: ein ganzer Satz, der Muster trifft, auf GENAU diesen Seiten und Blaettern eines Presets.
//
//   "Plans and credits are available on lu-labs.ai."   der EINE Satz ueber den Kauf, den ein Play-Bau ohne Link zeigt
//                      (Schalter purchase: 'text-only'). Entschieden am 10.10.2026, umkehrbar
//                      (mobile-docs/FUER-DAVID.md, "Entschieden (umkehrbar)"): der Satz BLEIBT im Play-Paket.
//                      Zuruecknehmen: `purchase: 'none'` im Preset play, dann diesen Eintrag loeschen.
//
// Derselbe Satz und dieselben Stellen wie im Waechter ueber die Seiten (e2e/mobile/store-rules.ts, PLAY_SENTENCE und
// PLAY_SENTENCE_PLACES): Der Selbsttest ohne Geraet haelt beide Listen gegeneinander. Die ersten drei Stellen erreicht
// ein Lauf am Geraet (ohne Anmeldung), die drei weiteren sagen den Satz erst mit einem Konto ohne Tarif oder Guthaben.
// Kein Freibrief: Der Satz auf einer anderen Seite, im Preset appstore, eine zweite Nennung von lu-labs.ai neben dem
// Satz und jeder Link dorthin bleiben ein Fund.
export const PLAY_SATZ = 'Plans and credits are available on lu-labs.ai.'
export const ERLAUBTE_SAETZE = [{ satz: PLAY_SATZ, preset: 'play', orte: ['/cloud', '/create/showcase', 'blatt:credits', '/create', '/settings/account', 'blatt:model'], grund: 'der eine Satz ueber den Kauf im Play-Bau, entschieden 10.10.2026, umkehrbar' }]

// Rein: die Saetze, die auf dieser Seite (Name der Route oder "blatt:<name>") in diesem Preset stehen duerfen.
export function erlaubteSaetze(preset, ort, liste = ERLAUBTE_SAETZE) {
  return liste.filter((e) => e.preset === preset && e.orte.includes(ort)).map((e) => e.satz)
}

const anStelle = (t, e) => t.quelle !== 'zeile' && typeof t.wo === 'string' && t.wo.includes(`[data-testid="${e.kennung}"]`)
const ohneWort = (text, wort) => text.split(wort).join(' ')

// Der Text, wie ihn das Muster `muster` lesen soll: ohne das erlaubte Wort, wo es an seiner Stelle steht.
// Eine ganze Zeile (quelle "zeile") hat keine Stelle. Sie zaehlt als die Zeile der erlaubten Stelle, solange es
// nicht mehr Zeilen mit dem Wort gibt als Texte an der Stelle: jede weitere ist eine zweite Nennung und ein Fund.
function leseErlaubt(texte, erlaubt) {
  const guthaben = new Map(erlaubt.map((e) => [e, texte.filter((t) => anStelle(t, e) && String(t.text).includes(e.wort)).length]))
  return (t, musterId) => {
    let text = String(t.text)
    for (const e of erlaubt) {
      if (e.muster !== musterId || !text.includes(e.wort)) continue
      if (anStelle(t, e)) text = ohneWort(text, e.wort)
      else if (t.quelle === 'zeile' && guthaben.get(e) > 0) {
        guthaben.set(e, guthaben.get(e) - 1)
        text = ohneWort(text, e.wort)
      }
    }
    return text
  }
}

// texte: [{text, quelle, wo}], links: [{href, text}]
// saetze: ganze Saetze, die auf dieser Seite stehen duerfen (erlaubteSaetze). Sie werden vor dem Lesen aus jedem
// Text genommen. Der Fund nennt weiter den ganzen Text.
export function pruefeStoreTexte(texte, links = [], muster = STORE_MUSTER, erlaubt = ERLAUBTE_NENNUNGEN, saetze = []) {
  const funde = []
  const gesehen = new Set()
  const melde = (f) => {
    const k = `${f.muster}|${f.text}`
    if (gesehen.has(k)) return
    gesehen.add(k)
    funde.push(f)
  }
  const liesNennung = leseErlaubt(texte, erlaubt)
  const lies = (t, musterId) => saetze.reduce((text, satz) => text.split(satz).join(' '), liesNennung(t, musterId))
  for (const t of texte) {
    for (const m of muster) {
      m.re.lastIndex = 0
      const treffer = [...lies(t, m.id).matchAll(m.re)].map((x) => x[0])
      if (treffer.length) melde({ muster: m.id, befund: m.befund, zusatz: !!m.zusatz, treffer: [...new Set(treffer)], text: String(t.text).slice(0, 200), quelle: t.quelle, wo: t.wo })
    }
  }
  for (const l of links) if (/lu-labs\.ai/i.test(l.href)) melde({ muster: 'lu-labs.ai', befund: 'IG-H6', zusatz: false, treffer: [l.href], text: `Link "${String(l.text).slice(0, 80)}" nach ${l.href}`, quelle: 'href' })
  return funde
}

// kennungen: [{id, sichtbar}] aus lib/shell.mjs
export function pruefeStoreKennungen(liste) {
  return liste.filter((k) => k.sichtbar && KENNUNG.test(k.id) && !/(-screen|-none|-hint|-text)$/.test(k.id)).map((k) => ({ muster: 'Kennung sichtbar', befund: /plans|buy|upgrade|topup/.test(k.id) ? 'IG-H6' : 'IG-H4', zusatz: false, treffer: [k.id], text: `${k.id}${k.name ? ` ("${k.name}")` : ''}`, quelle: 'testid' }))
}

function linksDerSeite() {
  return [...document.querySelectorAll('a[href]')].filter((a) => a.getClientRects().length > 0).map((a) => ({ href: a.href, text: (a.innerText || a.getAttribute('aria-label') || '').trim() }))
}

// preset: das Preset, das die App zeigt. Mit ihm und dem Namen der Seite gelten die erlaubten Saetze.
export async function storeworte(d, { name, laufDir, bildImmer = false, nurHinweis = null, preset = null } = {}) {
  const n = dateiName(name ?? 'aktuell')
  const s = await d.evalFn(sichtbareTexte)
  const links = await d.evalJs(`(${linksDerSeite})()`).catch(() => [])
  const ids = await d.evalFn(kennungen).catch(() => [])
  const funde = [...pruefeStoreTexte(s.texte, links, STORE_MUSTER, ERLAUBTE_NENNUNGEN, erlaubteSaetze(preset, name)), ...pruefeStoreKennungen(ids)].map((f) => (nurHinweis && f.befund === nurHinweis ? { ...f, zusatz: true } : f))
  const ergebnis = { name: n, zeit: new Date().toISOString(), geprueft: s.texte.length, funde: funde.filter((f) => !f.zusatz).length, hinweise: funde.filter((f) => f.zusatz).length, liste: funde }
  if ((funde.length || bildImmer) && laufDir) {
    ergebnis.screenshot = `storeworte/${n}.png`
    await d.screenshot(join(laufDir, ergebnis.screenshot)).catch(() => {})
  }
  if (laufDir) schreibeJson(laufDir, `storeworte/${n}.json`, ergebnis)
  return ergebnis
}

if (istHauptmodul(import.meta.url)) {
  const { ladeTreiber } = await import('../driver/index.mjs')
  const { waehleRouten } = await import('../sweep.mjs')
  const cfg = await ladeConfig()
  const d = await ladeTreiber()
  const laufDir = laufVerzeichnis(d.plattform)
  // start: true, weil `simctl privacy grant` (vorab erteilte Berechtigungen, NACHABNAHME.md 2.4) die App beendet.
  await d.connect({ pkg: cfg.pkg, urlFilter: cfg.urlFilter, start: true })
  let code = 0
  try {
    if (process.env.PRESET_SETZEN) await haken(d, 'preset', process.env.PRESET_SETZEN)
    const stand = (await hakenHat(d, 'zustand')) ? await haken(d, 'zustand') : null
    const preset = stand?.storePreset ?? cfg.storePreset
    // PRESET_ERWARTET=play prueft einen Play-Bau. Dort sind eigene Anbieter, Remote und der
    // Hugging-Face-Token erlaubt (storePolicy.ts): Die Treffer zu IG-H4 zaehlen dann als Hinweis.
    const erwartet = process.env.PRESET_ERWARTET || 'appstore'
    if (erwartet !== 'appstore' && erwartet !== 'play') throw new Error(`PRESET_ERWARTET muss appstore oder play sein, nicht "${erwartet}"`)
    if (preset !== erwartet) throw new Error(`Die App zeigt das Preset "${preset ?? 'unbekannt'}", geprueft wird ${erwartet}. PRESET_SETZEN=${erwartet} (Abnahmebau) oder ein Bau mit diesem Preset.`)
    const nurHinweis = erwartet === 'play' ? 'IG-H4' : null
    const offen = []
    let summe = 0
    for (const route of waehleRouten(cfg)) {
      try {
        if (route.oeffne) await route.oeffne(d)
      } catch (e) {
        offen.push(`${route.name}: ${String(e.message).slice(0, 120)}`)
        continue
      }
      const e = await storeworte(d, { name: route.name, laufDir, bildImmer: process.env.BILDER === 'alle', nurHinweis, preset })
      summe += e.funde
      console.log(route.name, `${e.geprueft} Texte, ${e.funde} Funde, ${e.hinweise} Hinweise`, e.liste.filter((f) => !f.zusatz).map((f) => `${f.befund} ${f.muster}: ${f.treffer.join(', ')}`).join(' | '))
    }
    schreibeJson(laufDir, 'storeworte/_gesamt.json', { preset, funde: summe, nichtHerstellbar: offen })
    console.log(`\nPreset ${preset}: ${summe} Funde. Nicht herstellbar (ungeprueft): ${offen.length ? '\n  ' + offen.join('\n  ') : 'keine'}`)
    code = summe ? 1 : 0
  } catch (e) {
    console.error('FEHLER:', e.message)
    code = 2
  } finally {
    // HB4: Der Lauf oeffnet jede Seite ueber den Testhaken und hinterliesse in jedem Reiter einen Stapel.
    const geraeumt = await raeumeStapel(d).catch((e) => ({ offen: [String(e?.message ?? e)] }))
    if (geraeumt.offen.length) console.error('Seitenstapel nicht geraeumt:', geraeumt.offen.join(' | '))
    await d.disconnect().catch(() => {})
  }
  console.log(laufDir)
  process.exit(code)
}
