// Geraetegrenze der Maschine: hoechstens 2 Emulatoren oder Simulatoren
// gleichzeitig, ueber alle Agenten hinweg (mobile-docs/regeln/AGENTEN-REGELN.md).
//
// Vor JEDEM Geraetestart wird gezaehlt:
//   Android   laufende Emulatoren aus `adb devices`, dazu Emulatorprozesse aus `ps`
//             (ein Emulator, der gerade hochfaehrt, steht noch nicht in adb)
//   iOS       gebootete Simulatoren aus `xcrun simctl list devices`
// Laufen schon 2 oder mehr, bricht der Start mit GeraeteGrenze ab.
//
// Die Emulatoren LU_Phone, LU_Fresh, LU_Bauer und Fernblick gehoeren David. Sie werden
// mitgezaehlt, aber nie gestartet, gestoppt oder geloescht, und die Treiber
// waehlen sie nicht als Testgeraet.
//
// Die Funktionen zum Lesen der Kommandoausgaben sind rein (Text hinein, Liste
// heraus), damit der Selbsttest sie mit gespielten Ausgaben pruefen kann.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'

export const GRENZE = 2
export const GESCHUETZT = ['LU_Phone', 'LU_Fresh', 'LU_Bauer', 'Fernblick']

export class GeraeteGrenze extends Error {
  constructor(text) {
    super(text)
    this.name = 'GeraeteGrenze'
    this.code = 'geraetegrenze'
  }
}

export class GeraetGeschuetzt extends Error {
  constructor(name, was) {
    super(`"${name}" gehoert David und wird nicht ${was} (geschuetzt: ${GESCHUETZT.join(', ')}). Ein eigenes Geraet anlegen und dieses nehmen.`)
    this.name = 'GeraetGeschuetzt'
    this.code = 'geraet-geschuetzt'
  }
}

export const istGeschuetzt = (name) => GESCHUETZT.some((g) => g.toLowerCase() === String(name ?? '').trim().toLowerCase())

export function pruefeNichtGeschuetzt(name, was = 'angefasst') {
  if (istGeschuetzt(name)) throw new GeraetGeschuetzt(name, was)
}

// ---------- Welches Geraet (rein) ----------

// Ein Skript des Rahmens fasst nur ein Geraet an, das ihm genannt wurde. Bis Runde 11 nahmen die Treiber
// ohne Angabe "das einzige angeschlossene Geraet": Ein Aufruf von checks/storeworte.mjs ohne Umgebung
// verband sich so mit dem Emulator einer anderen Pruefung und startete dort die App. Genannt heisst:
//   Android   ANDROID_SERIAL (Seriennummer aus `adb devices`) oder ANDROID_AVD (Name des eigenen Emulators)
//   iOS       IOS_UDID oder IOS_SIM (Name des eigenen Simulators)
// Ohne Angabe wird abgebrochen, bevor adb oder simctl gerufen ist. Es gibt keinen Schalter, der das aufhebt.
export class KeinGeraetGenannt extends Error {
  constructor(plattform) {
    const [a, b, start] = plattform === 'ios' ? ['IOS_UDID', 'IOS_SIM', 'ios-start <name>'] : ['ANDROID_SERIAL', 'ANDROID_AVD', 'android-start <avd>']
    super(`Kein Geraet genannt. Dieses Skript fasst ein Geraet an und waehlt nie von selbst eines aus: ${a} oder ${b} in der Umgebung setzen (mobile-tests/NACHABNAHME.md). Ein eigenes Geraet starten: node mobile-tests/geraet.mjs ${start}`)
    this.name = 'KeinGeraetGenannt'
    this.code = 'kein-geraet-genannt'
  }
}

// Gibt zurueck, was genannt wurde: { art: 'serial' | 'avd' | 'udid' | 'sim', wert }. Leer oder nur Leerraum zaehlt nicht.
export function genanntesGeraet(plattform, env = process.env) {
  const lies = (name) => String(env[name] ?? '').trim()
  const wahl = plattform === 'ios' ? [['udid', 'IOS_UDID'], ['sim', 'IOS_SIM']] : [['serial', 'ANDROID_SERIAL'], ['avd', 'ANDROID_AVD']]
  for (const [art, name] of wahl) if (lies(name)) return { art, wert: lies(name) }
  throw new KeinGeraetGenannt(plattform)
}

// ---------- Kommandoausgaben lesen (rein) ----------

// `adb devices`: nur Emulatoren, in jedem Zustand (auch offline und unauthorized laufen sie).
// Echte Geraete am Kabel zaehlen nicht zur Grenze.
export function leseAdbGeraete(text) {
  const aus = []
  for (const zeile of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const m = /^(emulator-\d+)\s+(\S+)/.exec(zeile.trim())
    if (m) aus.push({ serial: m[1], zustand: m[2] })
  }
  return aus
}

// `ps -axo pid=,ppid=,command=`: Emulatorprozesse mit ihrem AVD-Namen. Der Starter
// (emulator) und der eigentliche Prozess (qemu-system-*) tragen denselben Namen
// und zaehlen als ein Geraet.
export function leseEmulatorProzesse(psText) {
  const nachAvd = new Map()
  for (const zeile of String(psText ?? '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(zeile)
    if (!m) continue
    const kommando = m[3]
    const programm = basename(kommando.split(/\s+-|\s+@/)[0].trim())
    if (!/^qemu-system-[\w-]+$/.test(programm) && !/^emulator(64-[\w-]+)?$/.test(programm)) continue
    const avd = /\s-avd\s+(\S+)/.exec(kommando)?.[1] ?? /\s@(\S+)/.exec(kommando)?.[1]
    if (!avd) continue
    if (!nachAvd.has(avd)) nachAvd.set(avd, { avd, pids: [] })
    nachAvd.get(avd).pids.push(Number(m[1]))
  }
  return [...nachAvd.values()]
}

// `xcrun simctl list devices`: Simulatoren, die laufen oder gerade hochfahren.
export function leseSimulatoren(text) {
  const aus = []
  for (const zeile of String(text ?? '').split('\n')) {
    const m = /^\s+(.+?) \(([0-9A-Fa-f-]{36})\) \((Booted|Booting)\)/.exec(zeile)
    if (m) aus.push({ name: m[1].trim(), udid: m[2].toUpperCase(), zustand: m[3] })
  }
  return aus
}

// Fasst die drei Quellen zusammen. ohne: Namen, UDIDs oder Serials, die nicht
// mitzaehlen (das eigene Geraet bei einem Neustart desselben Geraets).
export function zaehleGeraete({ adb = '', ps = '', simctl = '', avdNamen = {} } = {}, { ohne = [] } = {}) {
  const raus = new Set(ohne.filter(Boolean).map((x) => String(x).toLowerCase()))
  const drin = (...kennungen) => !kennungen.some((k) => k && raus.has(String(k).toLowerCase()))
  const emus = leseAdbGeraete(adb).map((g) => ({ ...g, avd: avdNamen[g.serial] ?? null })).filter((g) => drin(g.serial, g.avd))
  const prozesse = leseEmulatorProzesse(ps).filter((p) => drin(p.avd))
  // Ein Emulator steht in der Regel in beiden Listen. Ohne sichere Zuordnung
  // (adb nennt die Serial, ps den AVD-Namen) zaehlt die groessere der beiden.
  const benannt = new Set(emus.map((g) => g.avd).filter(Boolean))
  const nurProzess = prozesse.filter((p) => !benannt.has(p.avd))
  const unbenannt = emus.filter((g) => !g.avd)
  const android = [
    ...emus.filter((g) => g.avd).map((g) => ({ art: 'android', name: g.avd, kennung: g.serial, zustand: g.zustand })),
    ...nurProzess.map((p) => ({ art: 'android', name: p.avd, kennung: `pid ${p.pids[0]}`, zustand: 'prozess' })),
  ]
  // Unbenannte Serials nur so weit dazuzaehlen, wie sie nicht schon ueber ihren Prozess gezaehlt sind.
  for (const g of unbenannt.slice(0, Math.max(0, unbenannt.length - nurProzess.length))) android.push({ art: 'android', name: g.serial, kennung: g.serial, zustand: g.zustand })
  const ios = leseSimulatoren(simctl).filter((s) => drin(s.udid, s.name)).map((s) => ({ art: 'ios', name: s.name, kennung: s.udid, zustand: s.zustand }))
  const alle = [...android, ...ios].map((g) => ({ ...g, david: istGeschuetzt(g.name) }))
  return { anzahl: alle.length, android: android.length, ios: ios.length, geraete: alle }
}

export const beschreibe = (z) => (z.geraete.length ? z.geraete.map((g) => `${g.name} (${g.art}, ${g.kennung}${g.david ? ', gehoert David' : ''})`).join(', ') : 'keines')

// Wirft GeraeteGrenze, wenn mit einem weiteren Start die Grenze ueberschritten waere.
export function pruefeGrenze(z, was = 'ein Geraet', grenze = GRENZE) {
  if (z.anzahl >= grenze) {
    throw new GeraeteGrenze(
      `Geraetegrenze: Es laufen schon ${z.anzahl} Emulatoren oder Simulatoren (${beschreibe(z)}), erlaubt sind hoechstens ${grenze} auf der ganzen Maschine. ` +
        `${was} wird nicht gestartet. Warten, bis ein anderer Lauf sein Geraet schliesst, oder das eigene zuerst schliessen. Fremde Geraete nicht beenden.`,
    )
  }
  return z
}

// ---------- Kommandos ausfuehren ----------

export function sdkPfad(unter) {
  const wurzeln = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, process.env.HOME && `${process.env.HOME}/Library/Android/sdk`].filter(Boolean)
  for (const w of wurzeln) if (existsSync(`${w}/${unter}`)) return `${w}/${unter}`
  return null
}

export const adbPfad = () => process.env.ADB ?? sdkPfad('platform-tools/adb') ?? 'adb'

// Die Werkzeuge der cmdline-tools (avdmanager, sdkmanager) sind Java-Programme und brechen ohne
// JAVA_HOME ab (Nachabnahme Android, H1 und HB7). Wer sie ruft, soll das nicht selbst wissen muessen:
// Ist JAVA_HOME gesetzt, gilt es. Sonst das erste JDK an den ueblichen Orten, in derselben
// Reihenfolge wie scripts/mobile/android-bauen.sh. Gibt die Umgebung fuer den Aufruf zurueck.
export const JAVA_ORTE = [
  '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
  '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
  '/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
  '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  '/usr/lib/jvm/java-17-openjdk-amd64',
  '/usr/lib/jvm/default-java',
]
export function javaUmgebung(env = process.env, gibtEs = existsSync) {
  if (env.JAVA_HOME) return { ...env }
  const ort = JAVA_ORTE.find((p) => gibtEs(`${p}/bin/java`))
  if (!ort) return { ...env }
  return { ...env, JAVA_HOME: ort, PATH: `${ort}/bin:${env.PATH ?? ''}` }
}

function standardLauf(cmd, args, { timeoutMs = 20000 } = {}) {
  return new Promise((res, rej) => {
    execFile(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs }, (err, out, stderr) => {
      if (err) {
        err.message = `${cmd} ${args.join(' ')}: ${err.message} ${stderr ?? ''}`.trim()
        rej(err)
      } else res(String(out))
    })
  })
}

// Liest den Stand der Maschine. Fehlt ein Werkzeug ganz (kein adb, kein Xcode),
// gibt es auf dieser Seite keine Geraete. Scheitert ein vorhandenes Werkzeug,
// ist die Zaehlung unsicher: Dann wird nicht gestartet.
export async function laufendeGeraete({ lauf = standardLauf, ohne = [] } = {}) {
  const lies = async (name, cmd, args) => {
    try {
      return await lauf(cmd, args)
    } catch (e) {
      if (e.code === 'ENOENT') return ''
      throw new GeraeteGrenze(`Geraetegrenze: ${name} laesst sich nicht lesen (${e.message.slice(0, 200)}). Ohne sichere Zaehlung wird kein Geraet gestartet.`)
    }
  }
  const adb = await lies('adb devices', adbPfad(), ['devices'])
  const ps = await lies('ps', '/bin/ps', ['-axo', 'pid=,ppid=,command='])
  const simctl = await lies('xcrun simctl list devices', 'xcrun', ['simctl', 'list', 'devices'])
  // AVD-Namen der Emulatoren in adb: nur lesen (Konsolenkommando "avd name"), nichts am Geraet aendern.
  const avdNamen = {}
  for (const g of leseAdbGeraete(adb)) {
    if (g.zustand !== 'device') continue
    const name = await lauf(adbPfad(), ['-s', g.serial, 'emu', 'avd', 'name'], { timeoutMs: 8000 }).catch(() => '')
    const erste = String(name).replace(/\r/g, '').split('\n')[0].trim()
    if (erste && erste !== 'OK') avdNamen[g.serial] = erste
  }
  return zaehleGeraete({ adb, ps, simctl, avdNamen }, { ohne })
}

// Die Pruefung vor jedem Geraetestart. was: Name fuer die Meldung. ohne: das eigene Geraet,
// wenn es schon laeuft und nur neu gestartet wird.
export async function vorGeraetestart(was, { lauf, ohne = [], grenze = GRENZE } = {}) {
  return pruefeGrenze(await laufendeGeraete({ lauf, ohne }), was, grenze)
}
