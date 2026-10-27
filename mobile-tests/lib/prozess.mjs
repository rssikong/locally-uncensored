// Eigene Prozesse beenden, immer ueber die gemerkte Prozessnummer, nie ueber
// ein Namensmuster. Ein Namensmuster (pkill -f, killall) trifft auch die Laeufe
// anderer Agenten auf derselben Maschine (so geschehen mit pkill -f "node sweep.mjs").
//
// beendeBaum(pid, {erwartet}) beendet den Prozess mit dieser Nummer samt seinen
// Nachkommen. "erwartet" ist ein Teilstring oder RegExp, der in der Kommandozeile
// des Prozesses stehen muss: Ist die Nummer inzwischen an einen fremden Prozess
// vergeben, wird nichts beendet.
//
// Als Kommando fuer Shell-Skripte:
//   node lib/prozess.mjs beende <pid> [erwarteter Teilstring]
//   node lib/prozess.mjs baum <pid>

import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

function psLauf() {
  return new Promise((res, rej) => {
    execFile('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 15000 }, (err, out) => (err ? rej(err) : res(String(out))))
  })
}

// Ausgabe von `ps -axo pid=,ppid=,command=` in [{pid, ppid, kommando}].
export function leseProzesse(psText) {
  const aus = []
  for (const zeile of String(psText).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(zeile)
    if (m) aus.push({ pid: Number(m[1]), ppid: Number(m[2]), kommando: m[3] })
  }
  return aus
}

// Alle Nachkommen von pid, die tiefsten zuerst. Ohne pid selbst.
export function nachkommen(prozesse, pid) {
  const kinder = new Map()
  for (const p of prozesse) {
    if (!kinder.has(p.ppid)) kinder.set(p.ppid, [])
    kinder.get(p.ppid).push(p.pid)
  }
  const aus = []
  const gesehen = new Set([pid])
  const geh = (n) => {
    for (const k of kinder.get(n) ?? []) {
      if (gesehen.has(k)) continue
      gesehen.add(k)
      geh(k)
      aus.push(k)
    }
  }
  geh(pid)
  return aus
}

const passt = (kommando, erwartet) => !erwartet || (erwartet instanceof RegExp ? erwartet.test(kommando) : kommando.includes(String(erwartet)))

// Beendet pid und alle Nachkommen. Gibt {beendet, pids, grund} zurueck.
//   erwartet   Teilstring oder RegExp fuer die Kommandozeile von pid (Schutz gegen neu vergebene Nummern)
//   warteMs    so lange auf das Ende warten, danach SIGKILL an die Reste des eigenen Baums
//   ps, kill   zum Testen austauschbar
export async function beendeBaum(pid, { erwartet = null, warteMs = 10000, ps = psLauf, kill = (p, s) => process.kill(p, s) } = {}) {
  pid = Number(pid)
  if (!Number.isInteger(pid) || pid <= 1) return { beendet: false, pids: [], grund: `keine gueltige Prozessnummer: ${pid}` }
  if (pid === process.pid) return { beendet: false, pids: [], grund: 'das waere der eigene Prozess' }
  const alle = leseProzesse(await ps())
  const wurzel = alle.find((p) => p.pid === pid)
  if (!wurzel) return { beendet: true, pids: [], grund: 'Prozess laeuft nicht mehr' }
  if (!passt(wurzel.kommando, erwartet)) return { beendet: false, pids: [], grund: `Prozess ${pid} ist nicht der gemerkte (Kommandozeile passt nicht auf ${erwartet}): ${wurzel.kommando.slice(0, 120)}` }
  // Die Nachkommen vor dem Beenden einsammeln: Stirbt der Elternprozess zuerst, haengen sie an launchd und sind nicht mehr zuzuordnen.
  const pids = [...nachkommen(alle, pid), pid]
  const sende = (signal, liste) => {
    for (const p of liste) {
      try {
        kill(p, signal)
      } catch {}
    }
  }
  sende('SIGTERM', pids)
  const ende = Date.now() + warteMs
  let rest = pids
  while (Date.now() < ende) {
    const lebend = new Set(leseProzesse(await ps()).map((p) => p.pid))
    rest = pids.filter((p) => lebend.has(p))
    if (!rest.length) return { beendet: true, pids, grund: 'beendet' }
    await warte(Math.min(300, Math.max(0, warteMs)))
  }
  if (rest.length) sende('SIGKILL', rest)
  return { beendet: true, pids, grund: rest.length ? `beendet, ${rest.length} davon erst mit SIGKILL` : 'beendet' }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [was, pid, erwartet] = process.argv.slice(2)
  if (was === 'baum' && pid) {
    console.log([...nachkommen(leseProzesse(await psLauf()), Number(pid)), Number(pid)].join(' '))
  } else if (was === 'beende' && pid) {
    const r = await beendeBaum(pid, { erwartet: erwartet || null })
    console.log(`[prozess] ${pid}: ${r.grund}${r.pids.length ? ` (${r.pids.join(', ')})` : ''}`)
    process.exit(r.beendet ? 0 : 1)
  } else {
    console.error('Aufruf: node lib/prozess.mjs beende <pid> [erwarteter Teilstring] | baum <pid>')
    process.exit(2)
  }
}
