// Geraete fuer die Abnahme starten und schliessen, mit der Geraetegrenze der
// Maschine (hoechstens 2 Emulatoren oder Simulatoren gleichzeitig, siehe
// lib/geraete.mjs). Jeder Start eines Emulators oder Simulators laeuft hierueber,
// nicht ueber einen nackten Aufruf von `emulator` oder `xcrun simctl boot`.
//
//   node geraet.mjs zaehlen                 zeigt, was laeuft
//   node geraet.mjs pruefen [--ohne <id>]   Endwert 0, wenn noch ein Geraet starten darf, sonst 1
//   node geraet.mjs android-anlegen <avd> <abbild> [geraet]   legt ein eigenes AVD an (setzt JAVA_HOME selbst)
//   node geraet.mjs android-start <avd> [--fenster] [-- weitere emulator-Optionen]
//   node geraet.mjs android-stop <avd>      beendet den selbst gestarteten Emulator ueber seine gemerkte Prozessnummer
//   node geraet.mjs android-loeschen <avd>  loescht das selbst gestartete AVD (vorher stoppen)
//   node geraet.mjs ios-start <name|udid>
//   node geraet.mjs ios-stop <name|udid>    faehrt den selbst gestarteten Simulator herunter
//   node geraet.mjs ios-loeschen <name|udid>
//
// Gestoppt und geloescht wird nur, was dieses Werkzeug in diesem Arbeitsverzeichnis
// selbst gestartet hat (Merkzettel in .werkzeug/geraete). LU_Phone, LU_Fresh und
// LU_Bauer gehoeren David: Sie zaehlen mit, werden aber nie gestartet, gestoppt
// oder geloescht.
//
// Umgebung: GERAET_START_MS (Frist fuer das Hochfahren, Standard 300000)

import { spawn, execFile } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, openSync, statSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { laufendeGeraete, pruefeGrenze, pruefeNichtGeschuetzt, beschreibe, adbPfad, sdkPfad, javaUmgebung, leseAdbGeraete, GeraeteGrenze, GeraetGeschuetzt, GRENZE } from './lib/geraete.mjs'
import { beendeBaum } from './lib/prozess.mjs'
import { istHauptmodul } from './lib/lauf.mjs'

const HIER = dirname(fileURLToPath(import.meta.url))
const MERK = join(HIER, '.werkzeug', 'geraete')
const FRIST = Number(process.env.GERAET_START_MS) || 300000
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

function lauf(cmd, args, { timeoutMs = 60000, env } = {}) {
  return new Promise((res, rej) => {
    execFile(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, ...(env ? { env } : {}) }, (err, out, stderr) => {
      if (err) {
        err.message = `${cmd} ${args.join(' ')}: ${err.message} ${stderr ?? ''}`.trim()
        rej(err)
      } else res(String(out))
    })
  })
}

const zettelPfad = (art, kennung) => join(MERK, `${art}-${String(kennung).replace(/[^\w.-]+/g, '_')}.json`)
const liesZettel = (art, kennung) => (existsSync(zettelPfad(art, kennung)) ? JSON.parse(readFileSync(zettelPfad(art, kennung), 'utf8')) : null)
function schreibeZettel(art, kennung, daten) {
  mkdirSync(MERK, { recursive: true })
  writeFileSync(zettelPfad(art, kennung), JSON.stringify({ art, ...daten }, null, 2) + '\n')
}

// Zwei Agenten duerfen nicht gleichzeitig zaehlen und dann beide starten. Ein Verzeichnis
// als Sperre (mkdir ist unteilbar) haelt Zaehlen und Starten zusammen. Eine Sperre, die
// aelter als zwei Minuten ist, stammt von einem abgebrochenen Lauf und wird uebernommen.
async function mitStartSperre(fn) {
  const sperre = join(tmpdir(), 'lu-geraetestart.sperre')
  const ende = Date.now() + 150000
  for (;;) {
    try {
      mkdirSync(sperre)
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      let alt = false
      try {
        alt = Date.now() - statSync(sperre).mtimeMs > 120000
      } catch {}
      if (alt) {
        try {
          rmdirSync(sperre)
        } catch {}
        continue
      }
      if (Date.now() > ende) throw new GeraeteGrenze('Geraetestart: Ein anderer Lauf startet seit ueber zwei Minuten ein Geraet. Spaeter noch einmal versuchen.')
      await warte(1000)
    }
  }
  try {
    return await fn()
  } finally {
    try {
      rmdirSync(sperre)
    } catch {}
  }
}

// ---------- Android ----------

async function serialVon(avd) {
  const aus = await lauf(adbPfad(), ['devices'], { timeoutMs: 15000 }).catch(() => '')
  for (const g of leseAdbGeraete(aus)) {
    if (g.zustand !== 'device') continue
    const name = await lauf(adbPfad(), ['-s', g.serial, 'emu', 'avd', 'name'], { timeoutMs: 8000 }).catch(() => '')
    if (name.replace(/\r/g, '').split('\n')[0].trim() === avd) return g.serial
  }
  return null
}

const lebt = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Legt ein eigenes AVD an. abbild: ein installiertes Systemabbild, zum Beispiel
// "system-images;android-34;google_apis;arm64-v8a". avdmanager ist ein Java-Programm, JAVA_HOME setzt
// dieser Aufruf selbst (Nachabnahme Android 8 GB, HB7). Die Meldung "Could not load devices from
// .../devices.xml" auf stderr ist harmlos, das AVD entsteht trotzdem. Der Merkzettel macht das AVD zu
// einem eigenen: Nur dann laesst android-loeschen es spaeter los.
export async function androidAnlegen(avd, abbild, geraet = 'pixel_6') {
  pruefeNichtGeschuetzt(avd, 'angelegt')
  if (!/^[\w.-]+$/.test(avd)) throw new Error(`android-anlegen: unerwarteter Name "${avd}"`)
  if (!abbild) throw new Error('android-anlegen: Systemabbild fehlt, zum Beispiel "system-images;android-34;google_apis;arm64-v8a"')
  const avdmanager = sdkPfad('cmdline-tools/latest/bin/avdmanager')
  if (!avdmanager) throw new Error('android-anlegen: avdmanager nicht gefunden (cmdline-tools fehlen)')
  const emulator = sdkPfad('emulator/emulator')
  const liste = async () => (emulator ? (await lauf(emulator, ['-list-avds'], { timeoutMs: 20000 })).split('\n').map((z) => z.trim()).filter(Boolean) : [])
  if ((await liste()).includes(avd)) throw new Error(`android-anlegen: Ein AVD "${avd}" gibt es schon. Es wird nicht ueberschrieben.`)
  await lauf(avdmanager, ['create', 'avd', '-n', avd, '-k', abbild, '-d', geraet], { timeoutMs: 120000, env: javaUmgebung() })
  if (emulator && !(await liste()).includes(avd)) throw new Error(`android-anlegen: avdmanager meldet keinen Fehler, aber "${avd}" steht nicht in der Liste`)
  schreibeZettel('android', avd, { avd, pid: null, angelegt: new Date().toISOString(), abbild, geraet })
  return { avd, angelegt: true, abbild, geraet }
}

export async function androidStart(avd, { fenster = false, extra = [] } = {}) {
  pruefeNichtGeschuetzt(avd, 'gestartet')
  const emulator = sdkPfad('emulator/emulator')
  if (!emulator) throw new Error('android-start: emulator nicht gefunden (ANDROID_HOME setzen)')
  const avds = (await lauf(emulator, ['-list-avds'], { timeoutMs: 20000 })).split('\n').map((z) => z.trim()).filter(Boolean)
  if (!avds.includes(avd)) throw new Error(`android-start: kein AVD "${avd}". Vorhanden: ${avds.join(', ') || 'keines'}`)
  const schon = await serialVon(avd)
  if (schon) return { avd, serial: schon, gestartet: false, hinweis: 'laeuft schon' }
  mkdirSync(MERK, { recursive: true })
  const logPfad = join(MERK, `android-${avd}.log`)
  const pid = await mitStartSperre(async () => {
    pruefeGrenze(await laufendeGeraete(), `Der Emulator ${avd}`)
    const log = openSync(logPfad, 'w')
    const kind = spawn(emulator, ['-avd', avd, '-no-snapshot-save', '-no-boot-anim', ...(fenster ? [] : ['-no-window']), ...extra], { detached: true, stdio: ['ignore', log, log] })
    kind.unref()
    schreibeZettel('android', avd, { name: avd, pid: kind.pid, start: new Date().toISOString(), log: logPfad })
    // Kurz halten, bis der Prozess in ps steht: Erst dann zaehlt der naechste Starter ihn mit.
    await warte(2000)
    return kind.pid
  })
  const ende = Date.now() + FRIST
  while (Date.now() < ende) {
    if (!lebt(pid)) throw new Error(`android-start: Der Emulator ${avd} hat sich beendet. Protokoll: ${logPfad}\n${readFileSync(logPfad, 'utf8').slice(-600)}`)
    const serial = await serialVon(avd)
    if (serial) {
      const fertig = (await lauf(adbPfad(), ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], { timeoutMs: 10000 }).catch(() => '')).trim()
      if (fertig === '1') {
        schreibeZettel('android', avd, { name: avd, pid, serial, start: new Date().toISOString(), log: logPfad })
        return { avd, serial, pid, gestartet: true }
      }
    }
    await warte(2000)
  }
  throw new Error(`android-start: ${avd} ist nach ${Math.round(FRIST / 1000)} s nicht hochgefahren (pid ${pid}, Protokoll ${logPfad}). Schliessen: node geraet.mjs android-stop ${avd}`)
}

export async function androidStop(avd) {
  pruefeNichtGeschuetzt(avd, 'gestoppt')
  const z = liesZettel('android', avd)
  if (!z?.pid) throw new Error(`android-stop: ${avd} wurde nicht von hier gestartet (kein Merkzettel in ${MERK}). Fremde Emulatoren werden nicht beendet.`)
  const r = await beendeBaum(z.pid, { erwartet: avd, warteMs: 40000 })
  if (r.beendet) schreibeZettel('android', avd, { ...z, pid: null, gestoppt: new Date().toISOString() })
  return { avd, ...r }
}

export async function androidLoeschen(avd) {
  pruefeNichtGeschuetzt(avd, 'geloescht')
  const z = liesZettel('android', avd)
  if (!z) throw new Error(`android-loeschen: ${avd} wurde nicht von hier gestartet (kein Merkzettel). Fremde AVDs werden nicht geloescht.`)
  if (z.pid && lebt(z.pid)) throw new Error(`android-loeschen: ${avd} laeuft noch. Erst: node geraet.mjs android-stop ${avd}`)
  const avdmanager = sdkPfad('cmdline-tools/latest/bin/avdmanager')
  if (!avdmanager) throw new Error('android-loeschen: avdmanager nicht gefunden (cmdline-tools fehlen)')
  // avdmanager ist ein Java-Programm: JAVA_HOME setzt dieser Aufruf selbst (HB7).
  await lauf(avdmanager, ['delete', 'avd', '-n', avd], { timeoutMs: 60000, env: javaUmgebung() })
  rmSync(zettelPfad('android', avd), { force: true })
  return { avd, geloescht: true }
}

// ---------- iOS ----------

async function simulator(wunsch) {
  const j = JSON.parse(await lauf('xcrun', ['simctl', 'list', 'devices', '-j']))
  const alle = Object.values(j.devices).flat().filter((g) => g.isAvailable !== false)
  const treffer = alle.filter((g) => g.udid.toLowerCase() === String(wunsch).toLowerCase())
  const nachName = treffer.length ? treffer : alle.filter((g) => g.name === wunsch)
  if (!nachName.length) throw new Error(`kein Simulator "${wunsch}". Anlegen: siehe README.md, Abschnitt iOS`)
  if (nachName.length > 1) throw new Error(`mehrere Simulatoren heissen "${wunsch}" (${nachName.map((g) => g.udid).join(', ')}): die UDID angeben`)
  return nachName[0]
}

export async function iosStart(wunsch) {
  pruefeNichtGeschuetzt(wunsch, 'gestartet')
  const g = await simulator(wunsch)
  if (g.state === 'Booted') return { name: g.name, udid: g.udid, gestartet: false, hinweis: 'laeuft schon' }
  await mitStartSperre(async () => {
    pruefeGrenze(await laufendeGeraete({ ohne: [g.udid] }), `Der Simulator ${g.name}`)
    await lauf('xcrun', ['simctl', 'boot', g.udid], { timeoutMs: 120000 })
    schreibeZettel('ios', g.udid, { name: g.name, udid: g.udid, start: new Date().toISOString() })
  })
  await lauf('xcrun', ['simctl', 'bootstatus', g.udid], { timeoutMs: FRIST })
  return { name: g.name, udid: g.udid, gestartet: true }
}

export async function iosStop(wunsch) {
  pruefeNichtGeschuetzt(wunsch, 'gestoppt')
  const g = await simulator(wunsch)
  if (!liesZettel('ios', g.udid)) throw new Error(`ios-stop: ${g.name} wurde nicht von hier gestartet (kein Merkzettel in ${MERK}). Fremde Simulatoren werden nicht heruntergefahren.`)
  if (g.state !== 'Shutdown') await lauf('xcrun', ['simctl', 'shutdown', g.udid], { timeoutMs: 120000 })
  return { name: g.name, udid: g.udid, gestoppt: true }
}

export async function iosLoeschen(wunsch) {
  pruefeNichtGeschuetzt(wunsch, 'geloescht')
  const g = await simulator(wunsch)
  if (!liesZettel('ios', g.udid)) throw new Error(`ios-loeschen: ${g.name} wurde nicht von hier gestartet (kein Merkzettel). Fremde Simulatoren werden nicht geloescht.`)
  if (g.state !== 'Shutdown') await lauf('xcrun', ['simctl', 'shutdown', g.udid], { timeoutMs: 120000 }).catch(() => {})
  await lauf('xcrun', ['simctl', 'delete', g.udid], { timeoutMs: 120000 })
  rmSync(zettelPfad('ios', g.udid), { force: true })
  return { name: g.name, udid: g.udid, geloescht: true }
}

if (istHauptmodul(import.meta.url)) {
  const [was, ziel, ...rest] = process.argv.slice(2)
  const braucht = () => {
    if (!ziel) throw new Error(`${was}: Name des Geraets fehlt`)
    return ziel
  }
  try {
    if (was === 'zaehlen') {
      const z = await laufendeGeraete()
      console.log(`${z.anzahl} von ${GRENZE}: ${beschreibe(z)}`)
    } else if (was === 'pruefen') {
      const args = [ziel, ...rest]
      const ohne = args.flatMap((a, i) => (a === '--ohne' && args[i + 1] ? [args[i + 1]] : []))
      const z = pruefeGrenze(await laufendeGeraete({ ohne }), 'Ein weiteres Geraet')
      console.log(`frei: ${z.anzahl} von ${GRENZE} laufen (${beschreibe(z)})`)
    } else if (was === 'android-start') {
      const trenner = rest.indexOf('--')
      console.log(JSON.stringify(await androidStart(braucht(), { fenster: rest.includes('--fenster'), extra: trenner >= 0 ? rest.slice(trenner + 1) : [] })))
    } else if (was === 'android-anlegen') console.log(JSON.stringify(await androidAnlegen(braucht(), rest[0], rest[1])))
    else if (was === 'android-stop') console.log(JSON.stringify(await androidStop(braucht())))
    else if (was === 'android-loeschen') console.log(JSON.stringify(await androidLoeschen(braucht())))
    else if (was === 'ios-start') console.log(JSON.stringify(await iosStart(braucht())))
    else if (was === 'ios-stop') console.log(JSON.stringify(await iosStop(braucht())))
    else if (was === 'ios-loeschen') console.log(JSON.stringify(await iosLoeschen(braucht())))
    else {
      console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 21).map((z) => z.replace(/^\/\/ ?/, '')).join('\n'))
      process.exit(2)
    }
  } catch (e) {
    console.error(e instanceof GeraeteGrenze || e instanceof GeraetGeschuetzt ? e.message : `Fehler: ${e.message}`)
    process.exit(1)
  }
}
