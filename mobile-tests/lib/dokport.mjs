// Pruefung iOS Paket 17, F-R9: der Port des Dokumentenmodells vor jeder Dokumentpruefung.
//
// Der iOS-Simulator teilt die Netzwerkschnittstelle des Macs. Lief die Desktop-App auf demselben Mac, hielt
// ihr eigenes Dokumentenmodell 127.0.0.1:8128, und im Simulator scheiterte drei Stunden lang jede
// Dokumentpruefung. Die App meldete das bis Runde 46 als Speichermangel (N-1), der Rahmen als Fehlfund.
// Auf einem echten iPhone und im Android-Emulator (eigenes Netz) gibt es diesen Konflikt nicht.
//
// dokPortBelegt fragt lsof, wer auf dem Port lauscht, und ps, welches Programm das ist. Ein Prozess aus
// einem Simulator (Pfad unter CoreSimulator/Devices) ist die App selbst und kein Konflikt. Alles andere
// ist fremd: Der Schritt nennt es, und scheitert er, heisst er "nicht pruefbar" mit diesem Grund statt
// "fehler". Seit Runde 46 weicht die App auf einen freien Port aus; dann laeuft der Schritt trotzdem gruen,
// und die Notiz sagt, dass er es bei belegtem Port war.

import { execFile } from 'node:child_process'

export const DOK_PORT = 8128

/** Ausgabe von `lsof -nP -iTCP:<port> -sTCP:LISTEN -Fpc`: Zeilen "p<pid>" und "c<name>". */
export function leseLauscher(text) {
  const nachPid = new Map()
  let aktuell = null
  for (const zeile of String(text ?? '').split('\n')) {
    if (zeile.startsWith('p')) {
      const pid = Number(zeile.slice(1))
      aktuell = null
      if (Number.isInteger(pid) && pid > 0) {
        if (!nachPid.has(pid)) nachPid.set(pid, { pid, name: '' })
        aktuell = nachPid.get(pid)
      }
    } else if (zeile.startsWith('c') && aktuell && !aktuell.name) {
      aktuell.name = zeile.slice(1).trim()
    }
  }
  return [...nachPid.values()]
}

/** Ein Programm aus einem Simulator: die App unter Pruefung, kein fremder Halter. */
export function istSimulatorProzess(pfad) {
  return /\/CoreSimulator\/Devices\//.test(String(pfad ?? ''))
}

/** Fuehrt ein Kommando aus und gibt stdout zurueck. Ein Ende mit Code 1 (lsof ohne Treffer) ist kein Fehler. */
export function lese(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10000 }, (_err, stdout) => resolve(String(stdout ?? '')))
  })
}

/**
 * null, wenn der Port frei ist, nur die App selbst ihn haelt oder die Plattform ihn nicht mit dem Mac teilt.
 * Sonst { port, fremde: [{ pid, name, pfad }] }.
 */
export async function dokPortBelegt({ plattform, port = DOK_PORT, lauf = lese } = {}) {
  if (plattform !== 'ios') return null
  const lauscher = leseLauscher(await lauf('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']))
  const fremde = []
  for (const l of lauscher) {
    const pfad = (await lauf('ps', ['-o', 'comm=', '-p', String(l.pid)])).trim()
    if (!istSimulatorProzess(pfad)) fremde.push({ ...l, pfad })
  }
  return fremde.length ? { port, fremde } : null
}

/** Der Satz fuer Notiz und Bericht. Ohne Maschinenpfad: nur der Programmname. */
export function dokPortSatz(befund) {
  if (!befund) return ''
  const wer = befund.fremde.map((f) => `${f.pfad.split('/').pop() || f.name || 'unbekannt'} (pid ${f.pid})`).join(', ')
  return `Port ${befund.port} auf dem Mac ist belegt von ${wer}. Der Simulator teilt das Netz des Macs; das Dokumentenmodell der App kann ${befund.port} dann nicht oeffnen (F-R9, Umgebung, kein App-Fund). Laeuft die Desktop-App von LU, beendet sie ein Mensch fuer die Dokumentpruefungen; der Rahmen fasst sie nicht an.`
}
