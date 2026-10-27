// Sperrliste: Bedienelemente, die Geld kosten, etwas zerstoeren, die App verlassen
// oder Kamera bzw. Mediathek oeffnen. Der Sweep
// tippt sie nie an, es sei denn, flows/freigaben.mjs gibt sie ausdruecklich
// frei. Die Fluesse tippen sie nur ueber tapBezahlt bzw. tapBewusst.
//
// Drei Quellen, in dieser Reihenfolge:
//   1. data-m-risk="paid" | "destructive" | "leaves-app" | "sensor" am Element oder einem Vorfahren (TESTIDS.md)
//   2. die testid: ein Wort der Liste als ganzer Abschnitt zwischen Bindestrichen
//   3. der sichtbare Name (Wortliste), fuer Elemente ohne testid
//
// Die Liste ist mit Absicht weit: Stand 08.10.2026 traegt in der Shell nur ein
// Teil der gefaehrlichen Knoepfe data-m-risk (siehe ABWEICHUNGEN.md, Abschnitt
// Risiko). Lieber ein harmloser Knopf zu viel gesperrt (er steht dann unter
// "einzeln testen") als ein Kauf oder eine Loeschung im Sweep.

// Die Marken, die das UI-Kit schreibt (src/mobile/ui/common.ts, RISKS). Der Selbsttest haelt beide Listen gleich.
//   paid         kostet Guthaben oder Geld
//   destructive  loescht, meldet ab oder schickt etwas Unwiderrufliches ab
//   leaves-app   oeffnet Browser, Mail-App, Einstellungen des Systems oder das Teilen-Blatt
//   sensor       oeffnet Kamera oder Mediathek
export const RISIKO_MARKEN = ['paid', 'destructive', 'leaves-app', 'sensor']

const PAID_TEIL = 'generate|render|buy|send|download|transcribe|speak|speaking|train|enhance|improve|animate|extend|removebg|eraser|install|regenerate|mic|pay|invoice|plans|plan|run|test|preview'
const DESTRUCTIVE_TEIL = 'delete|signout|clear|reset|remove|forget|disconnect|wipe|withdraw'

// Abschnitte, die ein Element trotz eines Wortes oben harmlos machen (der Ausweg aus einer Rueckfrage).
const HARMLOS = /(^|-)(keep|cancel|explain|dismiss|later|close|back|text|hint|empty|state|error|failed|screen|open|notice|progress|none|gone|price)$/

// Einzelne Kennungen, die ein Wort der Liste tragen und trotzdem nichts kosten. Nur ganze Kennungen, mit Grund.
//   m-chat-code-preview   zeigt den HTML-Block einer Antwort auf dem Handy an (Seitenvorschau). Kein Aufruf
//                         nach draussen, nichts Bezahltes. "preview" steht in der Liste wegen der Vorschau
//                         in Create. Ohne die Ausnahme haette die Seitenvorschau keinen Tippweg.
export const FREI_TROTZ_WORT = new Set(['m-chat-code-preview'])

// Die Seitenvorschau selbst heisst als Seite "preview" (m-preview-reload, m-preview-phone,
// m-preview-wide). Dort ist das Wort der Name der Seite und keine Handlung: die Knoepfe laden
// das eingebettete Dokument neu oder stellen die Breite um, nichts geht nach draussen.
// Zweite Gegenpruefung Android 8 GB, H8: der Sweep sperrte alle drei als bezahlt. Geurteilt wird
// deshalb ueber den Rest der Kennung. Ein Wort der Liste dahinter (m-preview-send) sperrt weiter.
const SEITEN_VORSATZ = /^m-preview-(?=.)/
export function kennungOhneSeite(tid) {
  return tid ? tid.replace(SEITEN_VORSATZ, 'm-') : tid
}

export const SPERRLISTE = [
  // testids nach Konvention: ein Wort der Liste als Abschnitt, egal an welcher Stelle
  { art: 'destructive', re: new RegExp(`(^|-)(${DESTRUCTIVE_TEIL})(-|$)`, 'i'), nurTestid: true },
  { art: 'paid', re: new RegExp(`(^|-)(${PAID_TEIL})(-|$)`, 'i'), nurTestid: true },
  // Die Bestaetigung einer Rueckfrage fuehrt aus, was davor gefragt wurde. Im Sweep nie.
  { art: 'destructive', re: /^m-dialog-confirm$/, nurTestid: true, immer: true },
  { art: 'destructive', re: /^m-fatal-reset/, nurTestid: true, immer: true },
  // "Agree" im Blatt ai-consent erteilt die Einwilligung fuer LU Cloud. Sie bleibt ueber den Lauf hinaus stehen
  // und aendert, was Settings, Privacy zeigt (Gegenpruefung Android 4 GB, Teil 2). Im Sweep nur als bewusster
  // Schritt mit Ruecknahme (flows/freigaben.mjs, modus 'mit-ruecknahme'), in einem Fluss nur ueber tapBewusst.
  { art: 'destructive', re: /^m-consent-agree$/, nurTestid: true, immer: true },
  // Anmeldung macht nur David (MOBILE-ZIEL.md, Abschnitt 7). Der Sweep loest sie nicht aus,
  // auch nicht mit leeren Feldern, nicht den Weg ueber den Browser und nicht das Blatt von Apple (Runde 15).
  { art: 'destructive', re: /^m-account-(signin|google|github|apple)$/, nurTestid: true, immer: true },
  // kostenpflichtig, nach Namen
  { art: 'paid', re: /\bgenerat(e|ing|ion)\b/i },
  { art: 'paid', re: /\brender\b/i },
  { art: 'paid', re: /\b(buy|purchase|checkout|subscribe|upgrade|top[ -]?up|pay)\b/i },
  { art: 'paid', re: /\b(transcribe|speak|read aloud|voice)\b/i },
  { art: 'paid', re: /\bsend\b/i },
  { art: 'paid', re: /\bdownload\b/i },
  // zerstoerend, nach Namen
  { art: 'destructive', re: /\bdelete\b/i },
  { art: 'destructive', re: /\b(sign|log)[ -]?out\b/i },
  { art: 'destructive', re: /\b(remove|clear|reset|wipe|erase|uninstall|revoke|forget|disconnect)\b/i },
]

// Ein Abbruch-Knopf: "Cancel" als Abschnitt der testid oder als Wort im Namen.
const ABBRUCH_TID = /(^|-)(cancel|abort)(-|$)/i
const ABBRUCH_NAME = /\b(cancel|abort)\b/i

// Bricht dieses Element etwas ab, das gerade laeuft? `laeuft` kommt aus dem Inventar der Seite
// (lib/seite.mjs, nebenLaufendem): ein Fortschritt oder die Zeile eines Downloads direkt daneben.
// Nachabnahme Android 8 GB, HB6: "cancel" galt immer als harmloser Ausweg. Ein Sweep waehrend eines
// Downloads haette "m-models-download-cancel" getippt und den Download verworfen.
export function brichtLaufendesAb(element) {
  if (!element.laeuft) return false
  return (!!element.testid && ABBRUCH_TID.test(element.testid)) || ABBRUCH_NAME.test(element.name ?? '') || ABBRUCH_NAME.test(element.axName ?? '')
}

// Gibt null zurueck oder {art, grund}.
export function sperrGrund(element, liste = SPERRLISTE) {
  // Eine Marke, die der Rahmen nicht kennt, sperrt trotzdem und gilt als die schwerste.
  if (element.risiko) return { art: RISIKO_MARKEN.includes(element.risiko) ? element.risiko : 'destructive', grund: `data-m-risk="${element.risiko}"` }
  if (brichtLaufendesAb(element)) return { art: 'destructive', grund: 'bricht einen laufenden Vorgang ab (Fortschritt direkt daneben)' }
  const tid = kennungOhneSeite(element.testid)
  // Der Rahmen eines Blatts (m-sheet-<id>) ist kein Knopf, auch wenn seine Kennung ein Wort der Liste traegt.
  const harmlos = !!tid && (HARMLOS.test(tid) || /^m-sheet-/.test(tid))
  for (const s of liste) {
    if (tid && s.re.test(tid) && s.nurTestid && (s.immer || (!harmlos && !FREI_TROTZ_WORT.has(element.testid)))) return { art: s.art, grund: `testid passt auf ${s.re}` }
    if (s.nurTestid) continue
    if (element.name && s.re.test(element.name)) return { art: s.art, grund: `Name passt auf ${s.re}` }
    if (element.axName && s.re.test(element.axName)) return { art: s.art, grund: `Name passt auf ${s.re}` }
  }
  return null
}

// Die Art eines Eintrags aus "einzelnTesten" des Sweeps. Aeltere Laeufe tragen nur den Grund
// ("gesperrt (paid): ..."), die zweite Pruefung nennt keine Art.
export function artDesGesperrten(eintrag) {
  return eintrag.art ?? /^gesperrt \(([a-z-]+)\):/.exec(eintrag.grund ?? '')?.[1] ?? 'ohne Angabe'
}

// Fuer den Bericht: die gesperrten Elemente einer Seite nach Art, in der Reihenfolge der Marken.
// Gibt [[art, [schluessel, ...]], ...] zurueck, leere Arten fehlen.
export function gesperrteNachArt(einzelnTesten) {
  const nach = new Map()
  for (const x of einzelnTesten ?? []) {
    const art = artDesGesperrten(x)
    nach.set(art, [...(nach.get(art) ?? []), x.schluessel])
  }
  const rang = (art) => (RISIKO_MARKEN.includes(art) ? RISIKO_MARKEN.indexOf(art) : RISIKO_MARKEN.length)
  return [...nach.entries()].sort((a, b) => rang(a[0]) - rang(b[0]))
}
