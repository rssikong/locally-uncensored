// Copy-Pruefung: sucht in allen sichtbaren Texten (Text, aria-label, placeholder,
// title, alt, Knopfbeschriftung) nach Desktop-Resten und nach Gedankenstrichen.
//
// Aufruf:  PLATFORM=android MT_CONFIG=<config.mjs> node checks/copy.mjs
// pruefeTexte(texte) ist rein und laesst sich ohne Geraet benutzen.

import { sichtbareTexte } from '../lib/seite.mjs'
import { schreibeJson, dateiName, laufVerzeichnis, ladeConfig, istHauptmodul } from '../lib/lauf.mjs'

// Pflichtmuster aus dem Auftrag. zusatz: true sind Ergaenzungen aus
// mobile-docs/INVENTUR-UEBERNAHME.md, Lektion 35.
export const MUSTER = [
  { id: 'right-click', re: /\bright[\s-]?click(s|ed|ing)?\b/gi },
  { id: 'click', re: /(?<!right[\s-]?)\b(double[\s-]?)?click(s|ed|ing|able)?\b/gi },
  { id: 'Ollama', re: /\bollama\b/gi },
  { id: 'LM Studio', re: /\bLM[\s-]?Studio\b/gi },
  { id: 'ComfyUI', re: /\bcomfy[\s-]?ui\b/gi },
  { id: 'hover', re: /\bhover(s|ed|ing)?\b/gi },
  { id: 'drag and drop', re: /\bdrag(ging)?\s*(and|&|n)\s*drop(ping)?\b|\bdrag[\s-]and[\s-]drop\b|\bdrag(ged|ging)?\b|\bdrop\s+(a\s+|your\s+|the\s+)?(files?|images?)\b/gi },
  { id: 'Tastenkuerzel', re: /\b(Ctrl|Control|Cmd|Command|Strg|Alt|Shift|Option)\s*\+\s*\S+|[\u2318\u2325\u2303\u21E7]\s*\S?|\b(Ctrl|Cmd)\b/g },
  { id: 'folder', re: /\bfolders?\b/gi },
  { id: 'terminal', re: /\bterminal\b/gi },
  { id: 'Gedankenstrich', re: /[\u2014\u2013]/g },
  { id: 'Tastenhinweis', zusatz: true, re: /\b(press|hit)\s+(the\s+)?(Enter|Return|Esc|Escape|Tab|F\d+)\b/gi },
  { id: 'Desktop-Begriff', zusatz: true, re: /%APPDATA%|\bVRAM\b|\byour (machine|computer|pc|desktop)\b|\b(mouse|cursor|keyboard shortcut|taskbar|system tray|window(s)? title)\b/gi },
  { id: 'Desktop-Begriff (deutsch)', zusatz: true, re: /\b(rechts)?klick(e|en|st|t)?\b|\bordner\b|\bmaus(zeiger)?\b/gi },
]

// texte: [{text, quelle, wo}]. ausnahmen: [{muster, text: RegExp, grund}]
export function pruefeTexte(texte, { muster = MUSTER, ausnahmen = [] } = {}) {
  const funde = []
  for (const t of texte) {
    for (const m of muster) {
      m.re.lastIndex = 0
      const treffer = [...t.text.matchAll(m.re)].map((x) => x[0])
      if (!treffer.length) continue
      const ausnahme = ausnahmen.find((a) => a.muster === m.id && a.text.test(t.text))
      funde.push({ muster: m.id, zusatz: !!m.zusatz, treffer: [...new Set(treffer)], text: t.text.slice(0, 200), quelle: t.quelle, wo: t.wo, ausnahme: ausnahme?.grund })
    }
  }
  // Zeilenfunde streichen, die schon als Textknoten mit Ort gemeldet sind.
  const knoten = funde.filter((f) => f.quelle !== 'zeile')
  const aus = funde.filter(
    (f) => f.quelle !== 'zeile' || !knoten.some((k) => k.muster === f.muster && f.treffer.every((tr) => k.treffer.includes(tr)) && f.text.includes(k.text.slice(0, 40))),
  )
  // Gleiche Meldung nur einmal.
  const gesehen = new Set()
  return aus.filter((f) => {
    const k = `${f.muster}|${f.text}|${f.quelle}|${f.wo}`
    if (gesehen.has(k)) return false
    gesehen.add(k)
    return true
  })
}

// opts: name, laufDir, ausnahmen
export async function copy(d, opts = {}) {
  const name = dateiName(opts.name ?? 'aktuell')
  const s = await d.evalFn(sichtbareTexte)
  const funde = pruefeTexte(s.texte, { ausnahmen: opts.ausnahmen })
  const offen = funde.filter((f) => !f.ausnahme)
  const jeMuster = {}
  for (const f of offen) jeMuster[f.muster] = (jeMuster[f.muster] ?? 0) + 1
  const ergebnis = {
    name,
    url: s.url,
    zeit: new Date().toISOString(),
    geprueft: s.texte.length,
    funde: offen.length,
    fundePflicht: offen.filter((f) => !f.zusatz).length,
    jeMuster,
    liste: funde,
  }
  if (opts.laufDir) schreibeJson(opts.laufDir, `copy/${name}.json`, ergebnis)
  return ergebnis
}

if (istHauptmodul(import.meta.url)) {
  const { ladeTreiber } = await import('../driver/index.mjs')
  const cfg = await ladeConfig()
  const d = await ladeTreiber()
  const laufDir = laufVerzeichnis(d.plattform)
  await d.connect({ pkg: cfg.pkg, urlFilter: cfg.urlFilter })
  // Eine Route, die sich nicht oeffnen laesst (kein Tippweg, kein Haken, haengender Screen), bricht
  // den Lauf nicht mehr ab: Sie wird als ungeprueft genannt und die naechste kommt dran.
  const offen = []
  for (const route of cfg.routen) {
    try {
      if (route.oeffne) await route.oeffne(d)
    } catch (err) {
      offen.push(route.name)
      console.log(route.name, `nicht herstellbar, ungeprueft: ${String(err.message).slice(0, 160)}`)
      continue
    }
    const e = await copy(d, { name: route.name, laufDir, ausnahmen: cfg.copyAusnahmen })
    console.log(route.name, `${e.geprueft} Texte, ${e.funde} Funde`, JSON.stringify(e.jeMuster))
  }
  if (offen.length) schreibeJson(laufDir, 'copy/_nicht-herstellbar.json', { routen: offen })
  await d.disconnect()
  console.log(laufDir)
}
