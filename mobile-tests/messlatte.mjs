// Messlatte (MOBILE-ZIEL.md, Abschnitt 3, Punkt 7): fuehrt Typpruefung, Unit-Tests,
// Frontend-Bau und cargo check im Hauptprojekt aus und haelt die Zahlen fest.
// Ergebnis: mobile-tests/out/messlatte.json. report.mjs liest daraus Punkt 7.
//
// Schritte:
//   tsc     npm run typecheck          (tsc -b --force)
//   vitest  npx vitest run             (Zahlen aus dem JSON-Bericht)
//   build   npm run build              (vite build)
//   cargo   cargo check                (src-tauri/Cargo.toml, Desktop)
//   e2e     npm run test:e2e           (Playwright, nur mit MIT_E2E=1)
//
// Aufruf:  node messlatte.mjs
//   PROJEKT=<pfad>        Projektwurzel (Standard: die Wurzel dieses Repos)
//   NUR=tsc,vitest        nur diese Schritte. Die anderen stehen als "nicht gelaufen" im Ergebnis.
//   MIT_E2E=1             Playwright-Suiten mitlaufen lassen
// Nichts hier kostet Geld und nichts ruft die Cloud.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { WURZEL, schreibeJson, istHauptmodul } from './lib/lauf.mjs'

export const MESSLATTE_DATEI = join(WURZEL, 'out', 'messlatte.json')
export const PFLICHT_SCHRITTE = ['tsc', 'vitest', 'build', 'cargo']

function lauf(cmd, args, cwd, timeoutMs = 45 * 60 * 1000) {
  const t0 = Date.now()
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: timeoutMs, env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' } })
  const aus = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  return { exit: r.status, signal: r.signal ?? null, fehler: r.error?.message ?? null, dauerS: Math.round((Date.now() - t0) / 100) / 10, aus }
}

const ende = (aus, n = 25) => aus.trim().split('\n').slice(-n).join('\n').slice(-4000)
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' }).stdout?.trim() ?? ''

export function messlatte({ projekt = resolve(process.env.PROJEKT ?? join(WURZEL, '..')), nur = process.env.NUR ? process.env.NUR.split(',') : null, mitE2e = process.env.MIT_E2E === '1', log = console.log } = {}) {
  const schritte = []
  const will = (id) => !nur || nur.includes(id)
  const habeModule = existsSync(join(projekt, 'node_modules'))
  const eintrag = (id, befehl, fn) => {
    const e = { id, befehl }
    if (!will(id)) Object.assign(e, { status: 'nicht gelaufen', grund: 'nicht in NUR' })
    else {
      log(`[messlatte] ${id}: ${befehl}`)
      try {
        Object.assign(e, fn())
      } catch (err) {
        Object.assign(e, { status: 'rot', grund: err.message })
      }
      log(`[messlatte] ${id}: ${e.status}${e.dauerS !== undefined ? ` nach ${e.dauerS} s` : ''}${e.grund ? ` (${e.grund})` : ''}`)
    }
    schritte.push(e)
  }
  const ohneModule = { status: 'nicht gelaufen', grund: `node_modules fehlt in ${projekt} (npm ci)` }

  eintrag('tsc', 'npm run typecheck', () => {
    if (!habeModule) return ohneModule
    const r = lauf('npm', ['run', 'typecheck'], projekt)
    const fehler = (r.aus.match(/error TS\d+/g) ?? []).length
    return { status: r.exit === 0 ? 'gruen' : 'rot', exit: r.exit, dauerS: r.dauerS, zahlen: { fehler }, auszug: r.exit === 0 ? undefined : ende(r.aus) }
  })

  eintrag('vitest', 'npx vitest run --reporter=json', () => {
    if (!habeModule) return ohneModule
    const dir = join(tmpdir(), `lu-messlatte-${process.pid}`)
    mkdirSync(dir, { recursive: true })
    const datei = join(dir, 'vitest.json')
    const r = lauf('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${datei}`], projekt)
    let zahlen = null
    try {
      const j = JSON.parse(readFileSync(datei, 'utf8'))
      zahlen = { dateien: j.numTotalTestSuites, tests: j.numTotalTests, bestanden: j.numPassedTests, fehlgeschlagen: j.numFailedTests, uebersprungen: (j.numPendingTests ?? 0) + (j.numTodoTests ?? 0) }
    } catch {}
    rmSync(dir, { recursive: true, force: true })
    const gruen = r.exit === 0 && !!zahlen && zahlen.fehlgeschlagen === 0 && zahlen.tests > 0
    return { status: gruen ? 'gruen' : 'rot', exit: r.exit, dauerS: r.dauerS, zahlen, auszug: gruen ? undefined : ende(r.aus), grund: zahlen ? undefined : 'kein JSON-Bericht von vitest' }
  })

  eintrag('build', 'npm run build', () => {
    if (!habeModule) return ohneModule
    const r = lauf('npm', ['run', 'build'], projekt)
    const module = Number(r.aus.match(/(\d+) modules transformed/)?.[1] ?? NaN)
    return { status: r.exit === 0 ? 'gruen' : 'rot', exit: r.exit, dauerS: r.dauerS, zahlen: { module: Number.isFinite(module) ? module : null }, auszug: r.exit === 0 ? undefined : ende(r.aus) }
  })

  eintrag('cargo', 'cargo check --manifest-path src-tauri/Cargo.toml', () => {
    if (!existsSync(join(projekt, 'src-tauri', 'Cargo.toml'))) return { status: 'nicht gelaufen', grund: 'src-tauri/Cargo.toml fehlt' }
    const r = lauf('cargo', ['check', '--manifest-path', join('src-tauri', 'Cargo.toml')], projekt)
    if (r.fehler && r.exit === null) return { status: 'nicht gelaufen', grund: `cargo nicht startbar: ${r.fehler}` }
    const warnungen = Number(r.aus.match(/generated (\d+) warnings?/)?.[1] ?? 0)
    const fehler = (r.aus.match(/^error(\[E\d+\])?:/gm) ?? []).length
    // Haeufigster Grund in einem frischen Arbeitsbaum: Ein mitgeliefertes Programm (Sidecar) liegt nicht im Repo.
    const fehlt = r.aus.match(/resource path `([^`]+)` doesn't exist/)?.[1]
    return { status: r.exit === 0 ? 'gruen' : 'rot', exit: r.exit, dauerS: r.dauerS, zahlen: { fehler, warnungen }, grund: r.exit !== 0 && fehlt ? `Datei fehlt im Arbeitsbaum: src-tauri/${fehlt} (wird nicht versioniert)` : undefined, auszug: r.exit === 0 ? undefined : ende(r.aus) }
  })

  eintrag('e2e', 'npm run test:e2e', () => {
    if (!mitE2e) return { status: 'nicht gelaufen', grund: 'nur mit MIT_E2E=1' }
    if (!habeModule) return ohneModule
    const r = lauf('npm', ['run', 'test:e2e'], projekt)
    const z = (re) => Number(r.aus.match(re)?.[1] ?? 0)
    return { status: r.exit === 0 ? 'gruen' : 'rot', exit: r.exit, dauerS: r.dauerS, zahlen: { bestanden: z(/(\d+) passed/), fehlgeschlagen: z(/(\d+) failed/), uebersprungen: z(/(\d+) skipped/) }, auszug: r.exit === 0 ? undefined : ende(r.aus) }
  })

  const ergebnis = {
    zeit: new Date().toISOString(),
    projekt,
    git: { zweig: git(projekt, 'branch', '--show-current'), commit: git(projekt, 'rev-parse', '--short', 'HEAD'), geaendert: git(projekt, 'status', '--porcelain').split('\n').filter(Boolean).length },
    gruen: PFLICHT_SCHRITTE.every((id) => schritte.find((s) => s.id === id)?.status === 'gruen'),
    schritte,
  }
  return ergebnis
}

// Zeile fuer den Bericht.
export function punkt7(datei = MESSLATTE_DATEI, projekt = join(WURZEL, '..')) {
  if (!existsSync(datei)) return { status: 'offen', text: 'keine Messlatte gelaufen (node messlatte.mjs schreibt out/messlatte.json)', pfade: [] }
  let j
  try {
    j = JSON.parse(readFileSync(datei, 'utf8'))
  } catch {
    return { status: 'offen', text: 'out/messlatte.json ist nicht lesbar', pfade: [datei] }
  }
  const teil = (s) => {
    const z = s.zahlen ?? {}
    const zahl = s.id === 'vitest' && z.tests != null ? ` ${z.bestanden} von ${z.tests} Tests` : s.id === 'tsc' && z.fehler != null ? ` ${z.fehler} Fehler` : s.id === 'cargo' && z.fehler != null ? ` ${z.fehler} Fehler, ${z.warnungen} Warnungen` : s.id === 'e2e' && z.bestanden != null ? ` ${z.bestanden} bestanden, ${z.fehlgeschlagen} fehlgeschlagen` : ''
    return `${s.id} ${s.status}${zahl}${s.status !== 'gruen' && s.grund ? ` (${s.grund})` : ''}`
  }
  const status = (id) => j.schritte.find((s) => s.id === id)?.status
  const pflichtGruen = PFLICHT_SCHRITTE.every((id) => status(id) === 'gruen')
  const rot = j.schritte.some((s) => s.status === 'rot')
  const kopf = git(projekt, 'rev-parse', '--short', 'HEAD')
  const veraltet = !!kopf && !!j.git?.commit && kopf !== j.git.commit
  let text = `Stand ${j.zeit}, Commit ${j.git?.commit ?? '?'}${j.git?.geaendert ? ` mit ${j.git.geaendert} ungespeicherten Aenderungen` : ''}: ${j.schritte.map(teil).join('; ')}.`
  if (veraltet) text += ` VERALTET: Der Arbeitsbaum steht inzwischen auf ${kopf}.`
  text += ' Nicht gemessen: ob jeder behobene Fehler einen Waechtertest hat.'
  const alles = pflichtGruen && status('e2e') === 'gruen' && !veraltet
  return { status: alles ? 'belegt' : rot || pflichtGruen || j.schritte.some((s) => s.status === 'gruen') ? 'in Arbeit' : 'offen', text, pfade: [datei], daten: j }
}

if (istHauptmodul(import.meta.url)) {
  const e = messlatte()
  const p = schreibeJson(join(WURZEL, 'out'), 'messlatte.json', e)
  for (const s of e.schritte) console.log(s.status.padEnd(15), s.id.padEnd(7), JSON.stringify(s.zahlen ?? s.grund ?? ''))
  console.log(p)
  process.exit(e.schritte.some((s) => s.status === 'rot') ? 1 : 0)
}
