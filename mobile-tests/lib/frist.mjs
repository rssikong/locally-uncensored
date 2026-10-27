#!/usr/bin/env node
// Eine Zeitgrenze fuer einen Befehl, ohne das Programm `timeout`: macOS hat keins (Gegenpruefung Android 4 GB,
// Funde am Pruefrahmen). Wo eine Anleitung "timeout 600 ..." sagen wuerde, steht:
//
//   node mobile-tests/lib/frist.mjs 600 -- node selbsttest.mjs
//
// Der Befehl laeuft mit derselben Ein- und Ausgabe. Ist die Zeit um, bekommt er SIGTERM und nach 5 s SIGKILL,
// und dieses Programm endet mit 124, wie `timeout` es tut. Sonst mit dem Ende des Befehls.
// Als Funktion: import { mitFrist } from './lib/frist.mjs'; const { code, abgelaufen } = await mitFrist(600, 'node', ['x.mjs'])
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** Zerlegt die Aufrufzeile: [sekunden, '--', befehl, ...argumente]. Wirft mit einem Satz, was fehlt. */
export function leseAufruf(argv) {
  const sekunden = Number(argv[0])
  if (!Number.isFinite(sekunden) || sekunden <= 0) throw new Error('frist: die erste Angabe ist die Zeit in Sekunden, groesser als 0')
  const rest = argv[1] === '--' ? argv.slice(2) : argv.slice(1)
  if (rest.length === 0) throw new Error('frist: nach der Zeit steht der Befehl, z.B. frist.mjs 600 -- node selbsttest.mjs')
  return { sekunden, befehl: rest[0], argumente: rest.slice(1) }
}

/** Startet den Befehl und beendet ihn nach `sekunden`. Antwort: { code, abgelaufen }. */
export function mitFrist(sekunden, befehl, argumente = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const kind = spawn(befehl, argumente, { stdio: 'inherit', ...opts })
    let abgelaufen = false
    let hart = null
    const uhr = setTimeout(() => {
      abgelaufen = true
      kind.kill('SIGTERM')
      hart = setTimeout(() => kind.kill('SIGKILL'), opts.nachfristMs ?? 5000)
    }, sekunden * 1000)
    kind.on('error', (e) => {
      clearTimeout(uhr)
      if (hart) clearTimeout(hart)
      reject(e)
    })
    kind.on('exit', (code, signal) => {
      clearTimeout(uhr)
      if (hart) clearTimeout(hart)
      resolve({ code: abgelaufen ? 124 : code ?? (signal ? 1 : 0), abgelaufen })
    })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { sekunden, befehl, argumente } = leseAufruf(process.argv.slice(2))
    const { code, abgelaufen } = await mitFrist(sekunden, befehl, argumente)
    if (abgelaufen) console.error(`frist: nach ${sekunden} s beendet: ${befehl} ${argumente.join(' ')}`)
    process.exit(code)
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
}
