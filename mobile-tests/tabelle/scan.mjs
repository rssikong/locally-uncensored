// Liest Routen, Blaetter und data-testid aus den Quellen der Mobile-Shell und
// schreibt tabelle/tabelle.json. Reiner Lesezugriff auf die anderen Worktrees.
//
// Aufruf:  node tabelle/scan.mjs
//   LU_WT=<ordner mit den Worktrees>   Standard: zwei Ebenen ueber mobile-tests
//   QUELLEN=shell,s-create             Reihenfolge = Vorrang. Standard siehe unten.
//
// Die Tabelle ist die Grundlage fuer TABELLE.md, ABWEICHUNGEN.md, die Routen in
// config.mjs und den statischen Teil des Trockenlaufs (trocken/statisch.mjs).
// Sie ist aus Quelltext geraten, nicht am Geraet gesehen: Was zur Laufzeit
// wirklich im DOM steht, zeigen erst die Schnappschuesse (trocken/vorschau.mjs).

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HIER = dirname(fileURLToPath(import.meta.url))
const WT = resolve(process.env.LU_WT ?? join(HIER, '..', '..', '..'))

// Wem welcher Ordner gehoert (src/mobile/STRAENGE.md, Abschnitt 2).
const RESILIENCE = {
  'StorageDialog.tsx': 'models', 'EngineNotices.tsx': 'models',
  'CreditsSheet.tsx': 'settings', 'SessionSheet.tsx': 'settings', 'LinkOfferSheet.tsx': 'settings',
  'OfflineBanner.tsx': 'remote', 'ResumeNotice.tsx': 'remote', 'StorageToast.tsx': 'remote', 'FatalScreen.tsx': 'remote', 'useOnline.ts': 'remote',
}

export function strangVon(rel) {
  const m = /^screens\/([a-z]+)\//.exec(rel)
  if (m) return m[1] === 'onboarding' ? 'models' : m[1]
  const r = /^resilience\/([^/]+)$/.exec(rel)
  if (r) return RESILIENCE[r[1]] ?? 'shell'
  return 'shell'
}

function dateien(dir, aus = []) {
  if (!existsSync(dir)) return aus
  for (const n of readdirSync(dir)) {
    if (n === '__tests__' || n === 'node_modules') continue
    const p = join(dir, n)
    const st = statSync(p)
    if (st.isDirectory()) dateien(p, aus)
    else if (/\.(tsx|ts)$/.test(n) && !/\.test\.tsx?$/.test(n)) aus.push(p)
  }
  return aus
}

const git = (wt, ...args) => {
  try {
    return execFileSync('git', ['-C', wt, ...args], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

// Ein Strang-Ordner gilt als "nur Platzhalter", wenn keine seiner Seiten mehr tut als ui/Placeholder zu zeigen.
function istPlatzhalter(ordner) {
  const ds = dateien(ordner).filter((d) => /(Page|Sheet)\.tsx$/.test(d))
  if (!ds.length) return true
  return ds.every((d) => /\b(Screen|Sheet)Placeholder\b/.test(readFileSync(d, 'utf8')))
}

function quellen() {
  const namen = (process.env.QUELLEN ?? 'shell').split(',').map((s) => s.trim()).filter(Boolean)
  const liste = []
  for (const n of namen) {
    const wurzel = join(WT, n, 'src', 'mobile')
    if (!existsSync(wurzel)) throw new Error(`Quelle fehlt: ${wurzel}`)
    liste.push({ name: n, wurzel, branch: git(join(WT, n), 'branch', '--show-current'), commit: git(join(WT, n), 'rev-parse', '--short', 'HEAD'), nur: null })
  }
  // Straenge, die in der ersten Quelle noch Platzhalter sind, kommen aus ihrem eigenen Worktree.
  if (!process.env.QUELLEN) {
    for (const strang of ['chat', 'agent', 'create', 'models', 'settings', 'remote']) {
      const inShell = join(liste[0].wurzel, 'screens', strang)
      const eigen = join(WT, `s-${strang}`, 'src', 'mobile')
      if (istPlatzhalter(inShell) && existsSync(eigen) && !istPlatzhalter(join(eigen, 'screens', strang))) {
        liste.push({ name: `s-${strang}`, wurzel: eigen, branch: git(join(WT, `s-${strang}`), 'branch', '--show-current'), commit: git(join(WT, `s-${strang}`), 'rev-parse', '--short', 'HEAD'), nur: strang })
      }
    }
  }
  return liste
}

// '/pfad': { code: 'A1', title: '...', kind: 'flow', tab: 'none', screen: 'x', owner: 'y' }
function tabellenZeilen(text) {
  const aus = []
  const re = /^\s*(?:'([^']+)'|([a-zA-Z][\w-]*))\s*:\s*\{([^{}\n]*)\}\s*,?\s*$/gm
  for (const m of text.matchAll(re)) {
    const felder = {}
    for (const f of m[3].matchAll(/(\w+)\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(true|false))/g)) felder[f[1]] = f[2] ?? f[3] ?? (f[4] === 'true')
    if (felder.code) aus.push({ id: m[1] ?? m[2], ...felder })
  }
  return aus
}

const MUSTER_RE = /\$\{[^}]*\}/g

function testidsAus(text, rel) {
  const funde = []
  const zeilen = text.split('\n')
  const merke = (id, art, zeile, extra = {}) => {
    if (!id || /\s/.test(id)) return
    const muster = id.includes('*')
    funde.push({ id, art, muster, datei: rel, zeile: zeile + 1, ...extra })
  }
  zeilen.forEach((z, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(z)) return
    const risiko = /(?:data-m-risk|\brisk)=["'](paid|destructive|leaves-app|sensor)["']/.exec(z)?.[1] ?? null
    // 1. Attribut mit festem Wert
    for (const m of z.matchAll(/(?:data-testid|testid|testId)\s*=\s*\{?\s*["']([^"']+)["']/g)) merke(m[1], 'attribut', i, { risiko })
    // 2. Attribut mit Vorlage
    for (const m of z.matchAll(/(?:data-testid|testid|testId)\s*=\s*\{\s*`([^`]+)`/g)) merke(m[1].replace(MUSTER_RE, '*'), 'attribut', i, { risiko })
    // 3. Toast oder Dialog: testid: 'name' in einem Objekt
    for (const m of z.matchAll(/\btestid\s*:\s*["']([a-z0-9-]+)["']/g)) {
      const davor = zeilen.slice(Math.max(0, i - 6), i + 1).join('\n')
      const toast = /toast\s*\(|Toast\(|notify\(/i.test(davor)
      const dialog = /confirm\s*\(|prompt\s*\(|dialog\s*\(|Dialog\(/i.test(davor)
      if (m[1].startsWith('m-')) merke(m[1], 'objekt', i)
      else if (toast && !dialog) merke(`m-toast-${m[1]}`, 'toast', i)
      else if (dialog && !toast) merke(`m-dialog-${m[1]}`, 'dialog', i)
      else {
        merke(`m-toast-${m[1]}`, 'toast-oder-dialog', i)
        merke(`m-dialog-${m[1]}`, 'toast-oder-dialog', i)
      }
    }
    // 4. Sonstige Literale, die wie eine testid aussehen (Hilfsfunktionen, Praefixe)
    if (!/className|class=/.test(z)) {
      for (const m of z.matchAll(/["'](m-[a-z0-9]+(?:-[a-z0-9]+)*)["']/g)) merke(m[1], 'literal', i, { risiko })
      for (const m of z.matchAll(/`(m-[a-z0-9-]*\$\{[^`]*)`/g)) merke(m[1].replace(MUSTER_RE, '*'), 'literal', i, { risiko })
    }
    // 5. Vorlage, die mit einer Variablen beginnt: `${idPrefix}-send`
    for (const m of z.matchAll(/(?:data-testid|testid)\s*=\s*\{\s*`(\$\{[^}]*\}[a-z0-9-]+)`/g)) merke(m[1].replace(MUSTER_RE, '*'), 'attribut', i, { risiko })
  })
  return funde
}

// Erkennt einen Praefix-Baustein und seine Endungen.
function bausteinAus(text, rel) {
  const komponenten = [...text.matchAll(/export (?:default )?function ([A-Z]\w*)/g)].map((m) => m[1])
  if (!komponenten.length) return null
  const endungen = new Set()
  let form = 'praefix-teil'
  let standard = null
  for (const m of text.matchAll(/(?:data-testid|testid)\s*=\s*\{\s*`\$\{[^}]*\}-([a-z0-9-]+)`/g)) endungen.add(m[1])
  if (/=>\s*`m-\$\{\w+\}-\$\{\w+\}`/.test(text)) {
    form = 'm-screen-teil'
    for (const m of text.matchAll(/\bt\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) for (const w of m[1].matchAll(/'([a-z0-9-]+)'/g)) endungen.add(w[1])
  }
  const st = /idPrefix\s*=\s*['"](m-[a-z0-9-]+)['"]/.exec(text)
  if (st) standard = st[1]
  if (!endungen.size) return null
  return { datei: rel, komponenten, endungen: [...endungen], form, standard }
}

export function scan() {
  const q = quellen()
  const routen = new Map()
  const blaetter = new Map()
  const ids = new Map()
  const bausteine = []
  for (const quelle of q) {
    const nimm = (rel) => !quelle.nur || strangVon(rel) === quelle.nur || (quelle.nur === 'models' && rel.startsWith('screens/onboarding/'))
    for (const p of dateien(quelle.wurzel)) {
      const rel = relative(quelle.wurzel, p)
      if (!nimm(rel)) continue
      if (rel.startsWith('dev/')) continue
      const text = readFileSync(p, 'utf8')
      const strang = strangVon(rel)
      if (/(^|\/)routes\.ts$/.test(rel)) for (const r of tabellenZeilen(text)) if (r.id.startsWith('/') && !routen.has(r.id)) routen.set(r.id, { route: r.id, code: r.code, titel: r.title, art: r.kind, tab: r.tab, screen: r.screen, strang: r.owner, dev: !!r.dev, screenTestid: `m-${r.screen}-screen`, quelle: quelle.name })
      if (/(^|\/)sheets\.ts$/.test(rel)) for (const s of tabellenZeilen(text)) if (!s.id.startsWith('/') && !blaetter.has(s.id)) blaetter.set(s.id, { blatt: s.id, code: s.code, titel: s.title, strang: s.owner, gesperrt: !!s.locked, testid: `m-sheet-${s.id}`, quelle: quelle.name })
      const b = bausteinAus(text, rel)
      if (b) bausteine.push(b)
      for (const f of testidsAus(text, rel)) {
        const alt = ids.get(f.id)
        const ort = `${quelle.name}:${f.datei}:${f.zeile}`
        if (alt) {
          if (!alt.orte.includes(ort)) alt.orte.push(ort)
          if (f.risiko && !alt.risiko) alt.risiko = f.risiko
          if (alt.art === 'literal' && f.art !== 'literal') alt.art = f.art
          if (!alt.straenge.includes(strang)) alt.straenge.push(strang)
        } else ids.set(f.id, { id: f.id, muster: f.muster, art: f.art, risiko: f.risiko ?? null, straenge: [strang], orte: [ort] })
      }
    }
  }
  // Bausteine, die ihre Kennungen aus einem Praefix zusammensetzen (ui/Composer
  // mit idPrefix, parts/Transfer mit screen, ConnectionNotice mit id). Aus dem
  // Baustein kommen die Endungen, aus den Aufrufern die Praefixe.
  for (const b of bausteine) {
    for (const quelle of q) {
      for (const p of dateien(quelle.wurzel)) {
        const rel = relative(quelle.wurzel, p)
        if (quelle.nur && strangVon(rel) !== quelle.nur) continue
        const text = readFileSync(p, 'utf8')
        for (const name of b.komponenten) {
          for (const m of text.matchAll(new RegExp(`<${name}\\b([^>]{0,400})`, 'g'))) {
            const werte = [...m[1].matchAll(/\b(\w+)=["']([a-z0-9-]+)["']/g)].filter((w) => !['el', 'variant', 'type', 'kind', 'tone', 'name', 'label', 'title'].includes(w[1])).map((w) => w[2])
            for (const w of werte) {
              for (const teil of b.endungen) {
                const id = b.form === 'm-screen-teil' ? `m-${w}-${teil}` : w.startsWith('m-') ? `${w}-${teil}` : null
                if (id && !id.startsWith('m-m-') && !ids.has(id)) ids.set(id, { id, muster: id.includes('*'), art: 'abgeleitet', risiko: null, straenge: [strangVon(rel)], orte: [`${quelle.name}:${rel} ueber ${b.datei}`] })
              }
            }
          }
        }
      }
    }
    if (b.standard) for (const teil of b.endungen) if (!ids.has(`${b.standard}-${teil}`)) ids.set(`${b.standard}-${teil}`, { id: `${b.standard}-${teil}`, muster: false, art: 'abgeleitet', risiko: null, straenge: ['chat'], orte: [`Standardwert in ${b.datei}`] })
  }
  // Seiten und Blaetter tragen ihre Kennung ueber ui/Page (screen=...) und ui/Sheet, nicht als Literal.
  for (const r of routen.values()) if (!ids.has(r.screenTestid)) ids.set(r.screenTestid, { id: r.screenTestid, muster: false, art: 'seite', risiko: null, straenge: [r.strang], orte: [`routen:${r.route}`] })
  for (const b of blaetter.values()) if (!ids.has(b.testid)) ids.set(b.testid, { id: b.testid, muster: false, art: 'blatt', risiko: null, straenge: [b.strang], orte: [`blaetter:${b.blatt}`] })
  for (const tab of ['chat', 'create', 'models', 'settings']) ids.set(`m-nav-${tab}`, { id: `m-nav-${tab}`, muster: false, art: 'reiter', risiko: null, straenge: ['shell'], orte: ['ui/TabBar.tsx'] })
  return {
    quellen: q.map(({ name, branch, commit, nur }) => ({ name, branch, commit, nur })),
    routen: [...routen.values()],
    blaetter: [...blaetter.values()],
    testids: [...ids.values()].sort((a, b) => a.id.localeCompare(b.id)),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t = scan()
  const ziel = join(HIER, 'tabelle.json')
  writeFileSync(ziel, JSON.stringify(t, null, 1) + '\n')
  console.log(`${t.routen.length} Routen, ${t.blaetter.length} Blaetter, ${t.testids.length} Kennungen (${t.testids.filter((x) => x.muster).length} Muster) aus ${t.quellen.map((x) => `${x.name}@${x.commit}`).join(', ')}`)
  console.log(ziel)
}

// Fingerabdruck dessen, was der Rahmen von der Shell benutzt: Routen, Blaetter, Kennungen.
// Aendert er sich, passen Tabelle und Schnappschuesse nicht mehr zusammen. Ein Commit der Shell,
// der nichts davon beruehrt, aendert ihn nicht.
export function fingerabdruck(t) {
  const teile = [t.routen.map((r) => `${r.route}=${r.screenTestid}`), t.blaetter.map((b) => b.blatt), t.testids.map((x) => `${x.id}:${x.risiko ?? ''}`)].map((l) => [...l].sort().join('|'))
  return createHash('sha1').update(teile.join('\n')).digest('hex').slice(0, 12)
}
