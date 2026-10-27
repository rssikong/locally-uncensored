// Baut aus den Quellen der Shell und den Schnappschuessen die Tabellen des Rahmens:
//
//   tabelle/tabelle.json   Routen, Blaetter, Kennungen (Maschine)
//   TABELLE.md             dasselbe zum Lesen: Routen, Blaetter, Tippwege, Kennungen je Strang
//   ABWEICHUNGEN.md        der gemessene Teil (zwischen den Marken), der Rest der Datei ist von Hand
//
// Aufruf:  node tabelle/bauen.mjs      danach: node trocken/statisch.mjs

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scan, fingerabdruck } from './scan.mjs'
import { WEGE, BLATT_WEGE, OHNE_WEG, kennungenVon, istWahlfrei, istBewusst } from './wege.mjs'
import { sperrGrund } from '../lib/sperre.mjs'

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HIER, '..')
const SCHNAPP = join(WURZEL, 'trocken', 'schnappschuesse')

// Die Screen-Woerter aus TESTIDS.md, Abschnitt "Die Regel".
const ERLAUBTE_SCREENS = ['onboarding', 'chat', 'models', 'create', 'remote', 'settings', 'account', 'nav', 'app']
// Was das Geruest selbst vorgibt (src/mobile/STRAENGE.md, Abschnitt 7) und TESTIDS.md nicht kennt.
const GERUEST_WOERTER = ['sheet', 'dialog', 'toast', 'page', 'stack', 'overlays', 'viewer', 'placeholder', 'fatal']

function schnappschuesse() {
  if (!existsSync(SCHNAPP)) return []
  return readdirSync(SCHNAPP).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => JSON.parse(readFileSync(join(SCHNAPP, f), 'utf8')))
}

const t = scan()
const snaps = schnappschuesse()

// Die echte Kennung eines Blatts steht am Element mit role="dialog" im Schnappschuss.
for (const b of t.blaetter) {
  const s = snaps.find((x) => x.art === 'blatt' && x.blatt === b.blatt)
  const wurzel = s?.kennungen.find((k) => k.rolle === 'dialog')
  if (wurzel && wurzel.id !== b.testid) b.echteKennung = wurzel.id
}
t.fingerabdruck = fingerabdruck(t)
writeFileSync(join(HIER, 'tabelle.json'), JSON.stringify(t, null, 1) + '\n')

// ---------- TABELLE.md ----------

const weg = (w) => (w ? w.map((s, i) => (i === 0 ? `Reiter ${s}` : '`' + kennungenVon(s).join('` oder `') + '`' + (istWahlfrei(s) ? ' (falls da)' : istBewusst(s) ? ` (bewusst: ${s.grund})` : ''))).join(', dann ') : null)
const z = []
z.push('# Routen- und Selektortabelle der Mobile-Shell', '')
z.push('Erzeugt von `tabelle/bauen.mjs`. Nicht von Hand aendern, sondern neu erzeugen: `npm run tabelle`.', '')
z.push(`Stand der Quellen: ${t.quellen.map((q) => `\`${q.name}\` (${q.branch}, ${q.commit}${q.nur ? `, nur Strang ${q.nur}` : ''})`).join(', ')}.`)
z.push(`Schnappschuesse: ${snaps.length} (aus der Vite-Vorschau, \`trocken/schnappschuesse/\`).`, '')
z.push('Die Kennungen sind aus dem Quelltext gelesen (`tabelle/scan.mjs`), nicht am Geraet gesehen. Was im DOM der Vorschau wirklich stand, zeigen die Schnappschuesse. Die Fluesse benutzen nur, was in `flows/selektoren.mjs` steht, und `npm run trocken` prueft jede Kennung dort gegen diese Tabelle.', '')
z.push('Die Shell hat einen eigenen Router: Die Adresse der Seite aendert sich nicht. Die Route steht am Seitenrahmen (`.m-page[data-route]`), die Seite darunter bleibt eingehaengt und unsichtbar (`data-m-hidden`, `inert`). Dieselbe Kennung kann darum zweimal im Dokument stehen, es zaehlt die sichtbare.', '')
z.push('## Reiter', '', '| Reiter | Kennung | Wurzelseite |', '|---|---|---|')
for (const [tab, route] of [['Chat', '/chats'], ['Create', '/create'], ['Models', '/models'], ['Settings', '/settings']]) z.push(`| ${tab} | \`m-nav-${route === '/chats' ? 'chat' : route.slice(1)}\` | \`${route}\` |`)
z.push('', 'Die Reiterleiste (`m-nav`) ist nur auf den vier Wurzelseiten zu sehen. Agent und Remote haben keinen eigenen Reiter: Agent liegt in den Chat-Optionen und in den Einstellungen, Remote ist ein Segment der Chatliste.', '')
z.push('## Seiten', '', '| Route | Code | Seite (`data-testid`) | Strang | Tippweg ohne Testhaken |', '|---|---|---|---|---|')
for (const r of t.routen.filter((x) => !x.dev)) z.push(`| \`${r.route}\` | ${r.code} | \`${r.screenTestid}\` | ${r.strang} | ${weg(WEGE[r.route]) ?? `keiner: ${OHNE_WEG[r.route] ?? 'FEHLT'}`} |`)
z.push('', '## Blaetter', '', '| Blatt | Code | Kennung im DOM | Strang | Tippweg ohne Testhaken |', '|---|---|---|---|---|')
for (const b of t.blaetter.filter((x) => !x.blatt.startsWith('dev-'))) z.push(`| \`${b.blatt}\` | ${b.code} | \`${b.echteKennung ?? b.testid}\`${b.echteKennung ? ' (nicht `' + b.testid + '`)' : ''} | ${b.strang} | ${weg(BLATT_WEGE[b.blatt]) ?? `keiner: ${OHNE_WEG[b.blatt] ?? 'FEHLT'}`} |`)
z.push('', 'Rueckfragen heissen `m-dialog-<name>` mit `m-dialog-confirm`, `m-dialog-cancel`, bei Bedarf `m-dialog-field` und `m-dialog-gate`. Toasts heissen `m-toast-<name>`.', '')
z.push('## Kennungen je Strang', '')
z.push('`*` steht fuer einen Teil, der erst zur Laufzeit feststeht (Kennung eines Eintrags). `!paid`, `!destructive`, `!leaves-app` und `!sensor`: im Quelltext auf derselben Zeile mit `data-m-risk` markiert. `(dom)`: in einem Schnappschuss gesehen.', '')
const imDom = new Set(snaps.flatMap((s) => s.kennungen.map((k) => k.id)))
const strangNamen = { chat: 'Strang 1 Chat', agent: 'Strang 2 Agent und Wissen', create: 'Strang 3 Create', models: 'Strang 4 Models und Onboarding', settings: 'Strang 5 Settings, Konto, Cloud', remote: 'Strang 6 Remote', shell: 'Geruest (nav, ui, policy, resilience)' }
for (const [strang, titel] of Object.entries(strangNamen)) {
  const ids = t.testids.filter((x) => x.straenge[0] === strang && !/^(\*|\$)/.test(x.id) && !['m-*-*', 'm-*'].includes(x.id))
  const gruppen = new Map()
  for (const x of ids) {
    const art = x.id.startsWith('m-toast-') ? 'Toasts' : x.id.startsWith('m-dialog-') ? 'Rueckfragen' : x.id.split('-').slice(0, 2).join('-')
    if (!gruppen.has(art)) gruppen.set(art, [])
    gruppen.get(art).push(x)
  }
  z.push(`### ${titel}`, '', `${ids.length} Kennungen, ${ids.filter((x) => imDom.has(x.id)).length} davon in einem Schnappschuss gesehen.`, '')
  for (const [g, liste] of [...gruppen].sort((a, b) => a[0].localeCompare(b[0]))) {
    z.push(`- **${g}** (${liste.length}): ${liste.map((x) => '`' + x.id + '`' + (x.risiko ? ' !' + x.risiko : '') + (x.art === 'toast-oder-dialog' ? ' ?' : '')).join(', ')}`)
  }
  z.push('')
}
z.push('`?` hinter einer Rueckfrage oder einem Toast: Der Quelltext nennt nur den Namen, ob daraus `m-toast-` oder `m-dialog-` wird, hat der Leser nicht sicher erkannt. Beide Formen stehen in der Tabelle.', '')
writeFileSync(join(WURZEL, 'TABELLE.md'), z.join('\n'))

// ---------- ABWEICHUNGEN.md, gemessener Teil ----------

const a = []
const statisch = t.testids.filter((x) => !x.muster && x.id.startsWith('m-') && !x.id.includes('$'))
// 1. Screen-Wort ausserhalb der Liste
const nachWort = new Map()
for (const x of statisch) {
  const wort = x.id.split('-')[1]
  if (ERLAUBTE_SCREENS.includes(wort)) continue
  if (!nachWort.has(wort)) nachWort.set(wort, { n: 0, straenge: new Set(), beispiel: x.id })
  const e = nachWort.get(wort)
  e.n++
  x.straenge.forEach((s) => e.straenge.add(s))
}
a.push('### 1. Screen-Wort ausserhalb der Liste', '', `TESTIDS.md erlaubt als \`<screen>\`: ${ERLAUBTE_SCREENS.map((s) => '`' + s + '`').join(', ')}. In den Quellen stehen ${[...nachWort.values()].reduce((s, e) => s + e.n, 0)} Kennungen mit einem anderen Wort an dieser Stelle.`, '', '| Wort | Kennungen | Strang | Beispiel | Einordnung |', '|---|---|---|---|---|')
for (const [wort, e] of [...nachWort].sort((x, y) => y[1].n - x[1].n)) a.push(`| \`${wort}\` | ${e.n} | ${[...e.straenge].join(', ')} | \`${e.beispiel}\` | ${GERUEST_WOERTER.includes(wort) ? 'Vorgabe des Geruests (STRAENGE.md), fehlt in TESTIDS.md' : 'eigenes Wort des Strangs'} |`)
// 2. Blaetter mit eigener Kennung
const eigene = t.blaetter.filter((b) => b.echteKennung)
a.push('', '### 2. Blaetter, die nicht `m-sheet-<id>` heissen', '', '| Blatt | erwartet | im DOM |', '|---|---|---|')
for (const b of eigene) a.push(`| \`${b.blatt}\` | \`${b.testid}\` | \`${b.echteKennung}\` |`)
if (!eigene.length) a.push('| keine | | |')
a.push('', 'Solange ein Blatt noch laedt, traegt der Platzhalter des Geruests `m-sheet-<id>`. Erst das fertige Blatt hat die eigene Kennung. Wer auf `m-sheet-<id>` wartet, findet in diesen drei Faellen nur den Ladezustand.')
// 3. Seiten: Screen-Wort mit Bindestrich
const mitStrich = t.routen.filter((r) => !r.dev && r.screen.includes('-'))
a.push('', '### 3. Seiten mit zusammengesetztem Screen-Wort', '', `TESTIDS.md: "\`<screen>\` ist ein Wort ohne Bindestrich". ${mitStrich.length} von ${t.routen.filter((r) => !r.dev).length} Seiten haengen den Namen der Unterseite an: ${mitStrich.slice(0, 8).map((r) => '`' + r.screenTestid + '`').join(', ')} und so weiter. Die ganze Liste steht in TABELLE.md.`)
// 4. Zeichen
const zeichen = [...imDom].filter((id) => /[^a-z0-9-]/.test(id))
a.push('', '### 4. Andere Zeichen als Kleinbuchstaben, Ziffern und Bindestrich', '', zeichen.length ? `${zeichen.length} Kennungen im DOM: ${zeichen.slice(0, 6).map((x) => '`' + x + '`').join(', ')}${zeichen.length > 6 ? ' und so weiter' : ''}. Der veraenderliche Teil ist die Kennung der Stimme, wie der Dienst sie liefert.` : 'keine im DOM der Vorschau.')
// 5. Risiko
const dom = new Map()
for (const s of snaps) for (const k of s.kennungen) if (k.bedienbar && !dom.has(k.id)) dom.set(k.id, k)
const mitRisk = [...dom.values()].filter((k) => k.risiko)
// Die Anmeldeknoepfe sperrt der Rahmen aus eigenem Grund (Anmeldung macht nur David), sie brauchen keine Markierung.
const ohneRisk = [...dom.values()].filter((k) => !k.risiko && sperrGrund({ testid: k.id }) && !/^m-sheet-/.test(k.id) && !/^m-account-(signin|google|github)$/.test(k.id))
const quelleRisk = t.testids.filter((x) => x.risiko)
a.push('', '### 5. Risiko-Markierung `data-m-risk`', '', `Im DOM der Vorschau tragen ${mitRisk.length} bedienbare Elemente \`data-m-risk\`: ${mitRisk.map((k) => '`' + k.id + '` (' + k.risiko + ')').join(', ') || 'keines'}. In den Quellen sind es ${quelleRisk.length} Kennungen, alle in den Straengen ${[...new Set(quelleRisk.flatMap((x) => x.straenge))].join(', ')}.`, '', `${ohneRisk.length} bedienbare Elemente im DOM der Vorschau haben KEIN \`data-m-risk\`, obwohl ihre Kennung nach der Sperrliste (\`lib/sperre.mjs\`) Geld kostet oder etwas loescht. Der Sweep sperrt sie ueber die Kennung, die Markierung fehlt:`, '')
// Strang einer Kennung aus dem DOM: genauer Treffer, sonst das Muster mit dem laengsten festen Anfang.
function strangVon(id) {
  const genau = t.testids.find((x) => x.id === id)
  if (genau) return genau.straenge[0]
  const fest = (x) => x.id.split('*')[0].length
  const muster = t.testids.filter((x) => x.muster && x.id.startsWith('m-') && new RegExp('^' + x.id.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.+') + '$').test(id)).sort((a, b) => fest(b) - fest(a))
  return muster[0]?.straenge[0] ?? 'unbekannt'
}
const nachStrang = new Map()
for (const k of ohneRisk) {
  const s = strangVon(k.id)
  if (!nachStrang.has(s)) nachStrang.set(s, [])
  nachStrang.get(s).push(k)
}
for (const [s, liste] of nachStrang) a.push(`- **${s}** (${liste.length}): ${liste.map((k) => '`' + k.id + '` ' + sperrGrund({ testid: k.id }).art).join(', ')}`)
a.push('', 'Die Sperrliste ist mit Absicht weit gefasst. Nicht jede Kennung hier braucht die Markierung (ein Link zur Preisseite kostet noch nichts), aber jede sollte einmal angesehen werden.')
a.push('', 'Die Vorschau zeigt nur, was ohne Anmeldung, ohne Modell und ohne Daten zu sehen ist. Knoepfe wie `m-account-signout`, `m-account-delete`, `m-chat-send`, `m-create-generate` oder `m-chat-menu-delete` erscheinen dort nicht. Was die Quellen dazu sagen, steht in TABELLE.md (`!paid`, `!destructive`, `!leaves-app`, `!sensor`).')

const datei = join(WURZEL, 'ABWEICHUNGEN.md')
const AN = '<!-- GEMESSEN:ANFANG (tabelle/bauen.mjs schreibt diesen Abschnitt) -->'
const AUS = '<!-- GEMESSEN:ENDE -->'
const block = `${AN}\n\nStand: ${t.quellen.map((q) => `${q.name}@${q.commit}`).join(', ')}, ${snaps.length} Schnappschuesse.\n\n${a.join('\n')}\n\n${AUS}`
if (existsSync(datei)) {
  const alt = readFileSync(datei, 'utf8')
  if (alt.includes(AN) && alt.includes(AUS)) writeFileSync(datei, alt.slice(0, alt.indexOf(AN)) + block + alt.slice(alt.indexOf(AUS) + AUS.length))
  else writeFileSync(datei, alt.trimEnd() + '\n\n' + block + '\n')
} else writeFileSync(datei, `# Abweichungen von der Konvention m-<screen>-<element>\n\n${block}\n`)

console.log(`${t.routen.length} Routen, ${t.blaetter.length} Blaetter (${eigene.length} mit eigener Kennung), ${t.testids.length} Kennungen, ${snaps.length} Schnappschuesse`)
console.log(`Abweichungen: ${nachWort.size} fremde Screen-Woerter, ${mitStrich.length} zusammengesetzte Seiten, ${zeichen.length} mit anderen Zeichen, ${ohneRisk.length} ohne data-m-risk`)
