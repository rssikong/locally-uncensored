// Teil 0 des Selbsttests: alles, was ohne Geraet pruefbar ist. Die Ausgaben von
// adb, simctl und ps sind gespielt, es wird kein Kommando ausgefuehrt, kein
// Geraet gestartet und kein Prozess beendet.
//
//   Geraetegrenze   lib/geraete.mjs: zaehlen, Grenze, Schutz der Geraete von David
//   Aufraeumen      lib/prozess.mjs: beenden nur ueber die gemerkte Prozessnummer
//   Erholung        sweep.mjs erhole und mitFrist, lib/haken.mjs (Warten auf den Haken, Neuladen nach
//                   storePreset), lib/nativ.mjs (Berechtigungsfrage), je mit gespieltem Treiber
//   Sweep-Urteil    sweep.mjs belegeAus, schonGewaehlt, warteStill, lib/seite.mjs ausweichPunkte, flows/lib.mjs
//                   tippeBis: die drei Fehlurteile und der Ja-Schritt der Nachabnahme auf dem grossen iPhone
//   Quelltext       kein pkill, killall, kill -9 mit Namensmuster und kein Geraetestart
//                   an der Grenze vorbei in mobile-tests/ und scripts/mobile/

import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { generateKeyPairSync } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { leseAdbGeraete, leseSimulatoren, leseEmulatorProzesse, zaehleGeraete, pruefeGrenze, vorGeraetestart, laufendeGeraete, pruefeNichtGeschuetzt, istGeschuetzt, GeraeteGrenze, GeraetGeschuetzt, GRENZE, GESCHUETZT, javaUmgebung, JAVA_ORTE, genanntesGeraet, KeinGeraetGenannt } from './geraete.mjs'
import { leseProzesse, nachkommen, beendeBaum } from './prozess.mjs'
import { erhole, mitFrist, Zeitgrenze, belegeAus, schonGewaehlt, warteStill, standGeaendert, nurWasSchonDaWar, stelleZurueck, stelleWahlUeberKennung, pruefeFrischNachNeuoeffnen, WAHL_RUNDEN, wahlIstWeg, wahlSelektor } from '../sweep.mjs'
import { seitenLib, touchZiele } from './seite.mjs'
import { mitFrist as befehlMitFrist, leseAufruf } from './frist.mjs'
import { touchSumme, touchMin, zaehleProbleme } from '../checks/layout.mjs'
import { tippeBis, warteBisSteht } from '../flows/lib.mjs'
import { haken, hakenHat, warteAufHaken, HakenFehlt } from './haken.mjs'
import { leseAndroidKnoten, beantworteBerechtigung, androidDateiKnoten, entferneDatei, legeDateiAb, MEDIEN_SCAN, leseAndroidGroesse, blaettereZurAndroidDatei, sucheAndroidDatei, waehleDatei, NativFehlt } from './nativ.mjs'
import { sperrGrund, brichtLaufendesAb, RISIKO_MARKEN, artDesGesperrten, gesperrteNachArt } from './sperre.mjs'
import { memoryEintrag, schrittMemory, schrittModellwechsel, testdateiName, mitDokPort } from '../flows/kundenfluss.mjs'
import { n1Plan, n1Urteil } from '../flows/n1.mjs'
import { leseLauscher, dokPortBelegt, dokPortSatz, istSimulatorProzess, DOK_PORT } from './dokport.mjs'
import { NichtPruefbar } from '../flows/lib.mjs'
import { geraetAttrappe, laufAttrappe } from './kundenfluss-attrappe.mjs'
import { raeumeStapel, REITER, seitenUrteil, zaehleSeiten, seitenSatz, oeffneRoute, oeffneBlatt } from './shell.mjs'
import { tippVerbot, rollGeste, findeMitRollen, bisRuhig } from './tipp.mjs'
import { FREIGABEN, freigabeFuer } from '../flows/freigaben.mjs'
import { RUECKNAHMEN, ruecknahmeSperre } from '../flows/ruecknahmen.mjs'
import { geheVorbereitetenWeg } from '../config.mjs'
import { WEGE, BLATT_WEGE, VORBEREITUNG, OHNE_WEG, DATEN_PARAMS, BLATT_DATEN, istWahlfrei, istBewusst, wegSperrFehler } from '../tabelle/wege.mjs'
import { S as SELEKTOREN } from '../flows/selektoren.mjs'
import { pruefeStoreTexte, pruefeStoreKennungen, ERLAUBTE_NENNUNGEN, ERLAUBTE_SAETZE, PLAY_SATZ, erlaubteSaetze } from '../checks/storeworte.mjs'
import { persistenz } from '../checks/persistenz.mjs'
import { zurueckUrteil } from '../checks/zurueck.mjs'
import { zeileTraegtGeheimnis, pemMaterial, pruefeSecrets, PEM_MINDEST_ZEICHEN } from '../checks/release.mjs'
import { schalterNaht, schalterStand, schreibeProbe, liesProbe } from './persistenz-naht.mjs'

const HIER = dirname(fileURLToPath(import.meta.url))
const RAHMEN = resolve(HIER, '..')
const REPO = resolve(RAHMEN, '..')

// ---------- gespielte Kommandoausgaben ----------

const ADB_LEER = 'List of devices attached\n\n'
const ADB_EINER = 'List of devices attached\nemulator-5554\tdevice\n\n'
const ADB_ZWEI = 'List of devices attached\nemulator-5554\tdevice\nemulator-5556\toffline\nR58M123ABC\tdevice\n\n'

const SIM_KOPF = '== Devices ==\n-- iOS 26.5 --\n'
const SIM_AUS = '    iPhone SE (3rd generation) (0A1B2C3D-0000-4000-8000-000000000001) (Shutdown) \n    iPhone 17 Pro Max (0A1B2C3D-0000-4000-8000-000000000002) (Shutdown) \n'
const SIM_KLEIN = '    LU-Harness-klein (0A1B2C3D-0000-4000-8000-00000000000A) (Booted) \n'
const SIM_GROSS = '    LU-Harness-gross (0A1B2C3D-0000-4000-8000-00000000000B) (Booting) \n'
const SIM_KEINE = SIM_KOPF + SIM_AUS
const SIM_EINER = SIM_KOPF + SIM_AUS + SIM_KLEIN
const SIM_ZWEI = SIM_KOPF + SIM_AUS + SIM_KLEIN + SIM_GROSS + '-- Unavailable: com.apple.CoreSimulator.SimRuntime.iOS-18-0 --\n    iPhone 15 (0A1B2C3D-0000-4000-8000-00000000000C) (Shutdown) (unavailable, runtime profile not found)\n'

const PS_FREMD =
  '  501     1 /sbin/launchd\n' +
  ' 1863  1518 /Applications/Claude.app/Contents/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer) --type=renderer --standard-schemes=cowork-artifact,claude-simulator,app\n' +
  ' 2001     1 /usr/bin/some-emulator-helper --avd-list\n'
const PS_PHONE = ' 4100     1 /sdk/emulator/qemu/darwin-aarch64/qemu-system-aarch64 -avd LU_Phone -no-window -no-snapshot-save\n'
const PS_FRESH = ' 4200     1 /sdk/emulator/emulator @LU_Fresh -no-boot-anim\n 4201  4200 /sdk/emulator/qemu/darwin-aarch64/qemu-system-aarch64-headless @LU_Fresh -no-boot-anim\n'
const PS_EIGEN = ' 4300     1 /sdk/emulator/qemu/darwin-aarch64/qemu-system-aarch64 -avd LU-Abnahme-A -no-window\n'

// Gespielter Kommandolaeufer: antwortet je Kommando mit dem hinterlegten Text und merkt sich die Aufrufe.
function gespielt({ adb = ADB_LEER, ps = PS_FREMD, simctl = SIM_KEINE, namen = {}, fehler = {} } = {}) {
  const aufrufe = []
  const lauf = async (cmd, args) => {
    aufrufe.push([cmd, ...args].join(' '))
    const wirf = (art) => {
      if (!fehler[art]) return
      const e = new Error(fehler[art] === 'ENOENT' ? `spawn ${cmd} ENOENT` : fehler[art])
      if (fehler[art] === 'ENOENT') e.code = 'ENOENT'
      throw e
    }
    if (args[0] === 'devices') return wirf('adb'), adb
    if (args.includes('emu')) return (namen[args[1]] ?? '') + '\nOK\n'
    if (cmd.endsWith('ps')) return wirf('ps'), ps
    if (cmd === 'xcrun') return wirf('simctl'), simctl
    throw new Error(`unerwartetes Kommando im Test: ${cmd} ${args.join(' ')}`)
  }
  return { lauf, aufrufe }
}

const wirft = async (fn, Klasse) => {
  try {
    await fn()
    return null
  } catch (e) {
    return e instanceof Klasse ? e : null
  }
}

function quelldateien(dir, aus = []) {
  if (!existsSync(dir)) return aus
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'out' || n.startsWith('.')) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) quelldateien(p, aus)
    else if (/\.(mjs|js|sh|ts)$/.test(n)) aus.push(p)
  }
  return aus
}

export async function selbsttestOhneGeraet(ok) {
  const G = 'geraetegrenze'

  // Lesen der Ausgaben
  ok(G, 'adb devices: nur Emulatoren zaehlen, in jedem Zustand, ein Geraet am Kabel nicht', JSON.stringify(leseAdbGeraete(ADB_ZWEI).map((g) => g.serial)) === '["emulator-5554","emulator-5556"]' && leseAdbGeraete(ADB_LEER).length === 0, leseAdbGeraete(ADB_ZWEI))
  ok(G, 'simctl list devices: Booted und Booting zaehlen, Shutdown und nicht verfuegbare nicht', JSON.stringify(leseSimulatoren(SIM_ZWEI).map((s) => s.name)) === '["LU-Harness-klein","LU-Harness-gross"]' && leseSimulatoren(SIM_KEINE).length === 0, leseSimulatoren(SIM_ZWEI))
  ok(G, 'ps: Starter und qemu desselben AVD sind ein Geraet, fremde Prozesse mit "emulator" im Namen keines', JSON.stringify(leseEmulatorProzesse(PS_FREMD + PS_PHONE + PS_FRESH).map((p) => p.avd)) === '["LU_Phone","LU_Fresh"]' && leseEmulatorProzesse(PS_FREMD).length === 0, leseEmulatorProzesse(PS_FREMD + PS_PHONE + PS_FRESH))

  // Zaehlen
  const z0 = zaehleGeraete({ adb: ADB_LEER, ps: PS_FREMD, simctl: SIM_KEINE })
  ok(G, 'nichts laeuft: 0, Start erlaubt', z0.anzahl === 0 && pruefeGrenze(z0) === z0, z0)
  const z1 = zaehleGeraete({ adb: ADB_EINER, ps: PS_FREMD + PS_PHONE, simctl: SIM_KEINE, avdNamen: { 'emulator-5554': 'LU_Phone' } })
  ok(G, 'derselbe Emulator in adb und in ps zaehlt einmal, Start erlaubt', z1.anzahl === 1 && z1.geraete[0].david === true && pruefeGrenze(z1) === z1, z1)
  const z1b = zaehleGeraete({ adb: ADB_EINER, ps: PS_FREMD + PS_PHONE, simctl: SIM_KEINE })
  ok(G, 'derselbe Emulator zaehlt auch dann einmal, wenn adb seinen Namen nicht verraet', z1b.anzahl === 1, z1b)
  const zBoot = zaehleGeraete({ adb: ADB_LEER, ps: PS_FREMD + PS_EIGEN, simctl: SIM_EINER })
  ok(G, 'ein Emulator, der hochfaehrt (nur in ps), zaehlt schon mit: 1 Emulator und 1 Simulator sind 2', zBoot.anzahl === 2 && zBoot.android === 1 && zBoot.ios === 1, zBoot)
  const eGemischt = await wirft(() => pruefeGrenze(zBoot, 'Der Simulator LU-Harness-gross'), GeraeteGrenze)
  ok(G, '1 Emulator und 1 Simulator: Start bricht ab und nennt beide Geraete und die Grenze', !!eGemischt && /LU-Abnahme-A/.test(eGemischt.message) && /LU-Harness-klein/.test(eGemischt.message) && /hoechstens 2/.test(eGemischt.message) && /wird nicht gestartet/.test(eGemischt.message), eGemischt?.message)
  const zDavid = zaehleGeraete({ adb: ADB_ZWEI, ps: PS_FREMD + PS_PHONE + PS_FRESH, simctl: SIM_KEINE, avdNamen: { 'emulator-5554': 'LU_Phone' } })
  const eDavid = await wirft(() => pruefeGrenze(zDavid), GeraeteGrenze)
  ok(G, 'die Emulatoren von David zaehlen mit: LU_Phone und LU_Fresh fuellen die Grenze', zDavid.anzahl === 2 && !!eDavid && /gehoert David/.test(eDavid.message) && /Fremde Geraete nicht beenden/.test(eDavid.message), [zDavid, eDavid?.message])
  const zSims = zaehleGeraete({ adb: ADB_LEER, ps: PS_FREMD, simctl: SIM_ZWEI })
  ok(G, '2 Simulatoren (einer davon Booting): Start bricht ab', zSims.anzahl === 2 && !!(await wirft(() => pruefeGrenze(zSims), GeraeteGrenze)), zSims)
  const zOhne = zaehleGeraete({ adb: ADB_LEER, ps: PS_FREMD, simctl: SIM_ZWEI }, { ohne: ['0a1b2c3d-0000-4000-8000-00000000000a'] })
  ok(G, 'Neustart des eigenen Simulators: Er selbst zaehlt nicht mit (ohne)', zOhne.anzahl === 1 && zOhne.geraete[0].name === 'LU-Harness-gross', zOhne)
  const zDrei = zaehleGeraete({ adb: ADB_ZWEI, ps: PS_FREMD, simctl: SIM_EINER })
  ok(G, '3 laufende Geraete (2 Emulatoren ohne Namen, 1 Simulator) brechen ebenfalls ab', zDrei.anzahl === 3 && !!(await wirft(() => pruefeGrenze(zDrei), GeraeteGrenze)), zDrei)

  // Die Pruefung vor dem Start, mit gespielten Kommandos
  const frei = gespielt({ adb: ADB_EINER, ps: PS_FREMD + PS_EIGEN, namen: { 'emulator-5554': 'LU-Abnahme-A' } })
  const zFrei = await vorGeraetestart('Der Simulator X', { lauf: frei.lauf })
  ok(G, 'vorGeraetestart liest adb devices, ps und simctl list devices und laesst bei 1 Geraet starten', zFrei.anzahl === 1 && frei.aufrufe.some((a) => a.endsWith('adb devices') || / devices$/.test(a)) && frei.aufrufe.some((a) => a.includes('simctl list devices')) && frei.aufrufe.some((a) => a.includes('ps ')), [zFrei, frei.aufrufe])
  const voll = gespielt({ adb: ADB_EINER, ps: PS_FREMD + PS_PHONE, simctl: SIM_EINER, namen: { 'emulator-5554': 'LU_Phone' } })
  const eVoll = await wirft(() => vorGeraetestart('Der Emulator LU-Abnahme-B', { lauf: voll.lauf }), GeraeteGrenze)
  ok(G, 'vorGeraetestart bricht bei 2 ab, mit dem Namen des Geraets, das nicht startet', !!eVoll && /Der Emulator LU-Abnahme-B wird nicht gestartet/.test(eVoll.message) && eVoll.code === 'geraetegrenze', eVoll?.message)
  ok(G, 'die Zaehlung selbst fasst kein Geraet an (nur devices, emu avd name, ps, simctl list)', voll.aufrufe.every((a) => / devices$| emu avd name$|ps -axo|simctl list devices$/.test(a)), voll.aufrufe)
  const ohneAdb = gespielt({ simctl: SIM_EINER, fehler: { adb: 'ENOENT' } })
  ok(G, 'fehlt adb ganz, zaehlen nur ps und die Simulatoren', (await laufendeGeraete({ lauf: ohneAdb.lauf })).anzahl === 1)
  const kaputt = gespielt({ fehler: { simctl: 'xcrun: error: unable to find utility "simctl"' } })
  const eKaputt = await wirft(() => vorGeraetestart('X', { lauf: kaputt.lauf }), GeraeteGrenze)
  ok(G, 'laesst sich nicht sicher zaehlen (simctl scheitert), wird nicht gestartet', !!eKaputt && /Ohne sichere Zaehlung/.test(eKaputt.message), eKaputt?.message)

  // Schutz der Geraete von David
  ok(G, `geschuetzt sind genau ${GESCHUETZT.join(', ')} (Schreibweise egal), die Grenze ist ${GRENZE}`, GRENZE === 2 && ['LU_Phone', 'LU_Fresh', 'LU_Bauer', 'Fernblick', 'fernblick', 'lu_phone'].every(istGeschuetzt) && !istGeschuetzt('LU-Abnahme-A') && !istGeschuetzt('LU_Phone_2') && !istGeschuetzt(null))
  const { androidStart, androidStop, androidLoeschen, iosStart } = await import('../geraet.mjs')
  const schutz = []
  for (const [name, fn] of [['android-start', () => androidStart('LU_Phone')], ['android-stop', () => androidStop('LU_Fresh')], ['android-loeschen', () => androidLoeschen('LU_Bauer')], ['ios-start', () => iosStart('LU_Phone')]]) schutz.push([name, !!(await wirft(fn, GeraetGeschuetzt))])
  ok(G, 'geraet.mjs startet, stoppt und loescht kein Geraet von David (bricht vor jedem Kommando ab)', schutz.every((s) => s[1]), schutz)
  ok(G, 'pruefeNichtGeschuetzt nennt in der Meldung, was zu tun ist', /eigenes Geraet anlegen/.test((await wirft(() => pruefeNichtGeschuetzt('LU_Bauer', 'gestoppt'), GeraetGeschuetzt))?.message ?? ''))
  const fremd = await wirft(() => androidStop('LU-Gibt-Es-Nicht-Selbsttest'), Error)
  ok(G, 'android-stop ohne Merkzettel beendet nichts (fremder Emulator)', !!fremd && /nicht von hier gestartet/.test(fremd.message), fremd?.message)

  // Kein Skript waehlt von selbst ein Geraet (Runde 11: storeworte.mjs ohne Umgebung startete die App auf dem Emulator einer anderen Pruefung)
  const ohneAndroid = [{}, { ANDROID_SERIAL: '', ANDROID_AVD: '   ' }, { IOS_SIM: 'X', IOS_UDID: 'Y' }]
  ok(G, 'ohne ANDROID_SERIAL oder ANDROID_AVD gibt es kein Android-Geraet (auch nicht mit einer iOS-Angabe, auch nicht mit leeren Werten)', ohneAndroid.every((env) => { try { genanntesGeraet('android', env); return false } catch (e) { return e instanceof KeinGeraetGenannt && /ANDROID_SERIAL oder ANDROID_AVD/.test(e.message) && /geraet\.mjs android-start/.test(e.message) } }))
  ok(G, 'ohne IOS_UDID oder IOS_SIM gibt es keinen Simulator', [{}, { ANDROID_SERIAL: 'emulator-5554' }, { IOS_SIM: ' ' }].every((env) => { try { genanntesGeraet('ios', env); return false } catch (e) { return e instanceof KeinGeraetGenannt && /IOS_UDID oder IOS_SIM/.test(e.message) } }))
  ok(G, 'genannt ist genannt: Seriennummer vor AVD, UDID vor Name', JSON.stringify([genanntesGeraet('android', { ANDROID_SERIAL: 'emulator-5560', ANDROID_AVD: 'A' }), genanntesGeraet('android', { ANDROID_AVD: 'LU-Nach-A' }), genanntesGeraet('ios', { IOS_UDID: 'U-1', IOS_SIM: 'S' }), genanntesGeraet('ios', { IOS_SIM: 'LU-Nach-klein' })]) === JSON.stringify([{ art: 'serial', wert: 'emulator-5560' }, { art: 'avd', wert: 'LU-Nach-A' }, { art: 'udid', wert: 'U-1' }, { art: 'sim', wert: 'LU-Nach-klein' }]))
  const { ladeTreiber } = await import('../driver/index.mjs')
  const ohne = []
  for (const p of ['android', 'ios']) ohne.push([p, !!(await wirft(() => ladeTreiber(p, { env: {} }), KeinGeraetGenannt))])
  ok(G, 'ladeTreiber gibt ohne genanntes Geraet keinen Treiber heraus (android und ios), die Vorschau braucht keines', ohne.every((o) => o[1]) && typeof (await ladeTreiber('vorschau', { env: {} })).connect === 'function', ohne)
  // Der Treiber selbst, ohne Umgebung und mit einem adb bzw. xcrun, das es nicht gibt: Er bricht ab, bevor er es ruft.
  const gemerkt = Object.fromEntries(['ANDROID_SERIAL', 'ANDROID_AVD', 'IOS_UDID', 'IOS_SIM', 'ADB', 'PATH'].map((k) => [k, process.env[k]]))
  const stumm = []
  try {
    for (const k of ['ANDROID_SERIAL', 'ANDROID_AVD', 'IOS_UDID', 'IOS_SIM']) delete process.env[k]
    process.env.ADB = '/gibt/es/nicht/adb'
    process.env.PATH = '/gibt/es/nicht'
    const a = (await import('../driver/android.mjs')).createDriver()
    stumm.push(['android connect', (await wirft(() => a.connect({ start: false }), Error))?.name])
    stumm.push(['android kill', (await wirft(() => a.kill(), Error))?.name])
    const i = (await import('../driver/ios.mjs')).createDriver()
    stumm.push(['ios launch', (await wirft(() => i.launch(), Error))?.name])
    stumm.push(['ios kill', (await wirft(() => i.kill(), Error))?.name])
  } finally {
    for (const [k, v] of Object.entries(gemerkt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
  ok(G, 'beide Treiber brechen ohne genanntes Geraet mit KeinGeraetGenannt ab, bevor adb oder simctl gerufen ist (connect, launch, kill)', stumm.every((x) => x[1] === 'KeinGeraetGenannt'), stumm)
  // Pruefung iOS Paket 11, F-R2: nach FRISCH=1 lief die App, vorn stand der Home-Bildschirm. Der Treiber liest den
  // Zustand bei WebDriverAgent und holt eine App, die nur im Hintergrund laeuft, nach vorn. Eine App, die nicht laeuft,
  // startet er dabei nicht, und ohne Antwort bleibt alles wie bisher.
  {
    const { createDriver: iosTreiber } = await import('../driver/ios.mjs')
    const spiel = async (staende, { wirft = false } = {}) => {
      const i = iosTreiber()
      const z = { geholt: 0, gefragt: 0 }
      i.mobil = async (name) => {
        if (wirft) throw new Error('kein WebDriverAgent')
        if (name === 'activateApp') { z.geholt++; return null }
        return staende[Math.min(z.gefragt++, staende.length - 1)]
      }
      let fehler = null
      const stand = await i.vorn({ pauseMs: 0 }).catch((e) => { fehler = e.message; return 'fehler' })
      return { stand, fehler, ...z }
    }
    const fr = { hinten: await spiel([3, 4]), angehalten: await spiel([2, 4]), vorn: await spiel([4]), aus: await spiel([1]), stumm: await spiel([], { wirft: true }), bleibt: await spiel([3]) }
    const quelleIos = readFileSync(join(RAHMEN, 'driver', 'ios.mjs'), 'utf8')
    const launchText = quelleIos.slice(quelleIos.indexOf('  async launch('), quelleIos.indexOf('  async vorn('))
    const sitzung = quelleIos.slice(quelleIos.indexOf('  async #wdaSitzung()'), quelleIos.indexOf('  async wda('))
    ok(G, 'F-R2 (iOS): eine App im Hintergrund wird nach vorn geholt und nachgelesen, eine vordere und eine, die nicht laeuft, bleiben, ohne WebDriverAgent bleibt es wie bisher, haengt sie fest, gibt es einen Fehler',
      fr.hinten.stand === 4 && fr.hinten.geholt === 1 && fr.angehalten.geholt === 1 && fr.vorn.stand === 4 && fr.vorn.geholt === 0 && fr.aus.stand === 1 && fr.aus.geholt === 0 && fr.stumm.stand === null && fr.stumm.geholt === 0 && fr.bleibt.stand === 'fehler' && /kommt nicht nach vorn/.test(fr.bleibt.fehler) && fr.bleibt.geholt === 3, fr)
    ok(G, 'F-R2 (iOS): launch prueft nach simctl launch, und eine neue Sitzung von WebDriverAgent holt die App danach nach vorn',
      /simctl\(\['launch'[^]*await this\.vorn\(\)/.test(launchText) && /this\.#wdaSid = s\.sessionId[^]*await this\.vorn\(\)/.test(sitzung), { launchText: launchText.length, sitzung: sitzung.length })
  }
  const quellen = ['driver/android.mjs', 'driver/ios.mjs'].map((f) => readFileSync(join(RAHMEN, f), 'utf8'))
  ok(G, 'kein Treiber waehlt "das einzige Geraet": keine Wahl ueber die Anzahl der laufenden Geraete', quellen.every((q) => !/\.length === 1\) return (await )?(this\.#)?nimm/.test(q) && /genanntesGeraet\('(android|ios)'\)/.test(q)))

  // Aufraeumen ueber die Prozessnummer
  const A = 'aufraeumen'
  const PS_BAUM = '  100     1 node /x/appium/index.js --port 4741\n  101   100 xcodebuild test-without-building -project WebDriverAgent.xcodeproj\n  102   101 /usr/bin/xctest\n  200     1 node /y/appium/index.js --port 4741\n  201   200 xcodebuild test-without-building -project WebDriverAgent.xcodeproj\n  300     1 node sweep.mjs\n'
  ok(A, 'nachkommen: nur der eigene Baum, die tiefsten zuerst', JSON.stringify(nachkommen(leseProzesse(PS_BAUM), 100)) === '[102,101]', nachkommen(leseProzesse(PS_BAUM), 100))
  const spiel = (text) => {
    let jetzt = text
    const signale = []
    return {
      signale,
      ps: async () => jetzt,
      kill: (pid, signal) => {
        signale.push(`${signal} ${pid}`)
        jetzt = jetzt.split('\n').filter((z) => !new RegExp(`^\\s*${pid}\\s`).test(z)).join('\n')
      },
    }
  }
  const s1 = spiel(PS_BAUM)
  const r1 = await beendeBaum(100, { erwartet: 'appium', ps: s1.ps, kill: s1.kill, warteMs: 50 })
  ok(A, 'beendeBaum beendet den gemerkten Prozess samt Nachkommen und sonst nichts (der fremde Appium, sein xcodebuild und der fremde Sweep bleiben)', r1.beendet && JSON.stringify(s1.signale) === '["SIGTERM 102","SIGTERM 101","SIGTERM 100"]', [r1, s1.signale])
  const s2 = spiel(PS_BAUM)
  const r2 = await beendeBaum(300, { erwartet: 'appium', ps: s2.ps, kill: s2.kill, warteMs: 50 })
  ok(A, 'ist die gemerkte Nummer inzwischen ein anderer Prozess (hier ein fremder Sweep), wird nichts beendet', !r2.beendet && s2.signale.length === 0 && /nicht der gemerkte/.test(r2.grund), [r2, s2.signale])
  const s3 = spiel(PS_BAUM)
  const r3 = await beendeBaum(999, { erwartet: 'appium', ps: s3.ps, kill: s3.kill, warteMs: 50 })
  const r4 = await beendeBaum(process.pid, { ps: s3.ps, kill: s3.kill, warteMs: 50 })
  const r5 = await beendeBaum(1, { ps: s3.ps, kill: s3.kill, warteMs: 50 })
  ok(A, 'laeuft der Prozess nicht mehr, passiert nichts. Der eigene Prozess und pid 1 werden nie beendet', r3.beendet && !r4.beendet && !r5.beendet && s3.signale.length === 0, [r3, r4, r5])
  // Ein Prozess, der SIGTERM uebergeht, bekommt nach der Frist SIGKILL, aber nur er.
  let zaeh = PS_BAUM
  const sig = []
  const r6 = await beendeBaum(200, { erwartet: 'appium', ps: async () => zaeh, kill: (pid, s) => { sig.push(`${s} ${pid}`); if (s === 'SIGKILL' || pid !== 201) zaeh = zaeh.split('\n').filter((z) => !new RegExp(`^\\s*${pid}\\s`).test(z)).join('\n') }, warteMs: 60 })
  ok(A, 'ein Nachkomme, der SIGTERM uebergeht, bekommt nach der Frist SIGKILL ueber seine Nummer', r6.beendet && JSON.stringify(sig) === '["SIGTERM 201","SIGTERM 200","SIGKILL 201"]', [r6, sig])

  // Erholung: gespielter Treiber, der nur zaehlt, was der Rahmen von ihm will
  const E = 'erholung'
  const spielTreiber = ({ vorn = [{ istApp: true, nativ: false }], antwortet = true, plattform = 'ios' } = {}) => {
    const rufe = []
    let i = 0
    const t = {
      plattform,
      rufe,
      sleep: async () => {},
      foreground: async () => vorn[Math.min(i++, vorn.length - 1)],
      dismissNative: async () => void rufe.push('dismissNative'),
      back: async () => void rufe.push('back'),
      activate: async () => void rufe.push('activate'),
      kill: async () => void rufe.push('kill'),
      launch: async () => void rufe.push('launch'),
      hideKeyboard: async () => true,
      evalJs: async () => {
        if (!antwortet) throw new Error('Inspector Runtime.evaluate: keine Antwort nach 6 s')
        return 1
      },
      evalFn: async () => ({ dialog: [], blaetter: [] }),
    }
    return t
  }
  const t1 = spielTreiber({ vorn: [{ istApp: true, nativ: true }, { istApp: true, nativ: false }] })
  const e1 = await erhole(t1)
  ok(E, 'erhole: natives Fenster ueber der App wird geschlossen, die App bleibt am Leben', JSON.stringify(t1.rufe) === '["dismissNative"]' && e1.includes('natives Fenster geschlossen'), [t1.rufe, e1])
  const t2 = spielTreiber({ vorn: [{ istApp: false, nativ: false, pkg: 'com.apple.mobilesafari' }] })
  const e2 = await erhole(t2)
  ok(E, 'erhole: fremde App vorn (iOS), die App wird nach vorn geholt statt dreimal ins Leere zu tippen', JSON.stringify(t2.rufe) === '["activate"]' && e2.includes('App nach vorn geholt'), [t2.rufe, e2])
  const t3 = spielTreiber({ vorn: [{ istApp: false, pkg: 'com.android.permissioncontroller' }, { istApp: true }], plattform: 'android' })
  delete t3.dismissNative
  await erhole(t3)
  ok(E, 'erhole: Android ohne dismissNative nimmt Zurueck und holt die App nicht unnoetig neu nach vorn', JSON.stringify(t3.rufe) === '["back"]', t3.rufe)
  const t4 = spielTreiber({ antwortet: false })
  const e4 = await erhole(t4)
  ok(E, 'erhole: antwortet die Seite nicht, wird die App beendet und neu gestartet', JSON.stringify(t4.rufe) === '["kill","launch"]' && e4.some((x) => /Seite antwortete nicht/.test(x)), [t4.rufe, e4])
  const t5 = spielTreiber()
  await erhole(t5, { hart: true })
  const t6 = spielTreiber()
  await erhole(t6)
  ok(E, 'erhole: hart startet die App neu, ohne Anlass passiert nichts', JSON.stringify(t5.rufe) === '["kill","launch"]' && t6.rufe.length === 0, [t5.rufe, t6.rufe])
  const schnell = await mitFrist(Promise.resolve(7), 50, 'x')
  const langsam = await wirft(() => mitFrist(new Promise((r) => setTimeout(r, 200)), 30, 'Element m-test'), Zeitgrenze)
  ok(E, 'mitFrist: laesst Fertiges durch und wirft nach der Frist Zeitgrenze mit dem Namen des Elements', schnell === 7 && !!langsam && /Element m-test/.test(langsam.message), langsam?.message)

  // Testhaken: Seite als Folge von Zustaenden, jede Auswertung nimmt den naechsten
  const seite = (folge) => {
    let i = 0
    const gesehen = []
    return {
      gesehen,
      sleep: async () => {},
      waitFor: async (js) => void gesehen.push(`waitFor ${js}`),
      evalJs: async (src) => {
        const st = folge[Math.min(i, folge.length - 1)]
        gesehen.push(src.slice(0, 40))
        if (st === 'wechselt') {
          i++
          throw new Error('Inspector: Seite hat navigiert')
        }
        if (src.includes('performance.now()')) {
          i++
          return { da: st.da, alt: st.alt, fertig: true }
        }
        if (src.includes('for (const n of')) return st.da ? 'storePreset' : null
        if (src.includes('window.__LU_TEST__[')) return { ok: true, preset: 'play' }
        return st.da
      },
    }
  }
  const jung = seite(['wechselt', { da: false, alt: 300 }, { da: true, alt: 900 }])
  ok(E, 'Testhaken: Auf einer Seite, die gerade wechselt oder jung ist, wird auf den Haken gewartet', (await warteAufHaken(jung)) === true)
  const alt = seite([{ da: false, alt: 60000 }])
  const vorAlt = Date.now()
  ok(E, 'Testhaken: Eine alte Seite ohne Haken (kein Abnahmebau) kostet keine Wartezeit', (await warteAufHaken(alt)) === false && Date.now() - vorAlt < 500 && alt.gesehen.length === 1, alt.gesehen)
  const keinNetz = seite([{ da: true, alt: 60000 }])
  ok(E, 'Testhaken: Eine Aufgabe, die der Haken nicht vorsieht (netz), ist ohne Rueckfrage "fehlt"', (await hakenHat(keinNetz, 'netz')) === null && keinNetz.gesehen.length === 0 && !!(await wirft(() => haken(keinNetz, 'netz', false), HakenFehlt)))
  const mitNeuladen = seite([{ da: true, alt: 60000 }])
  await haken(mitNeuladen, 'preset', 'play')
  const ohneNeuladen = seite([{ da: true, alt: 60000 }])
  await haken(ohneNeuladen, 'preset', 'play', { reload: false })
  ok(E, 'Testhaken: Nach storePreset wird auf das neu geladene Dokument gewartet, mit {reload: false} nicht', mitNeuladen.gesehen.some((g) => /^waitFor window.__luVorNeuladen !== 1/.test(g)) && !ohneNeuladen.gesehen.some((g) => g.startsWith('waitFor')), [mitNeuladen.gesehen, ohneNeuladen.gesehen])

  // Berechtigungsfrage von Android aus einem gespielten Abzug der Oberflaeche
  const UI_FRAGE =
    '<?xml version="1.0"?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.android.permissioncontroller" content-desc="" clickable="false" bounds="[0,0][1080,2400]">' +
    '<node index="0" text="Allow LU to record audio?" resource-id="com.android.permissioncontroller:id/permission_message" class="android.widget.TextView" package="com.android.permissioncontroller" content-desc="" clickable="false" bounds="[100,900][980,1000]" />' +
    '<node index="1" text="While using the app" resource-id="com.android.permissioncontroller:id/permission_allow_foreground_only_button" class="android.widget.Button" package="com.android.permissioncontroller" content-desc="" clickable="true" bounds="[100,1100][980,1200]" />' +
    '<node index="2" text="Only this time" resource-id="com.android.permissioncontroller:id/permission_allow_one_time_button" class="android.widget.Button" package="com.android.permissioncontroller" content-desc="" clickable="true" bounds="[100,1220][980,1320]" />' +
    '<node index="3" text="Don\u2019t allow" resource-id="com.android.permissioncontroller:id/permission_deny_button" class="android.widget.Button" package="com.android.permissioncontroller" content-desc="" clickable="true" bounds="[100,1340][980,1440]" /></node></hierarchy>'
  ok(E, 'nativ: der Abzug der Oberflaeche liefert Text, Kennung und Mitte je Knoten', leseAndroidKnoten(UI_FRAGE).length === 5 && leseAndroidKnoten(UI_FRAGE)[2].y === 1150 && leseAndroidKnoten('').length === 0 && leseAndroidKnoten(null).length === 0)
  const androidSpiel = (xml) => {
    const befehle = []
    return { plattform: 'android', befehle, sleep: async () => {}, shell: async (c) => (befehle.push(c), c.startsWith('input tap') ? '' : xml) }
  }
  const a1 = androidSpiel(UI_FRAGE)
  const b1 = await beantworteBerechtigung(a1)
  const a2 = androidSpiel(UI_FRAGE)
  const b2 = await beantworteBerechtigung(a2, { erlauben: false })
  const a3 = androidSpiel('')
  const b3 = await beantworteBerechtigung(a3, { timeoutMs: 0 })
  ok(E, 'nativ: die Berechtigungsfrage wird ueber die Kennung des Knopfs beantwortet (erlauben, ablehnen), ohne Frage passiert nichts', b1?.knopf === 'While using the app' && /record audio/.test(b1.text) && a1.befehle.includes('input tap 540 1150') && a2.befehle.includes('input tap 540 1390') && b2?.knopf && b3 === null && !a3.befehle.some((c) => c.startsWith('input tap')), [b1, a1.befehle, b2, a2.befehle, b3])
  ok(E, 'nativ: der Abzug loescht vorher die alte Datei, damit ein gescheiterter Abzug nicht den Stand von davor liefert', a1.befehle[0].startsWith('rm -f /sdcard/lu-ui.xml; uiautomator dump'), a1.befehle[0])

  // Store-Pruefung appstore (IG-H4 bis IG-H6), reine Funktionen
  const S = 'storeworte'
  const sf = pruefeStoreTexte(
    [{ text: 'No refusals. Fully uncensored models.' }, { text: 'No Filter' }, { text: 'Upgrade your plan' }, { text: 'Chat with a local model' }, { text: 'Hugging Face token' }, { text: 'Add a custom endpoint' }],
    [{ href: 'https://lu-labs.ai/pricing', text: 'See more' }, { href: 'https://example.org/', text: 'x' }],
  )
  const hat = (befund, muster) => sf.some((f) => f.befund === befund && f.muster === muster && !f.zusatz)
  ok(S, 'appstore: Werbewoerter (IG-H5), Kaufwoerter und Links zu lu-labs.ai (IG-H6), eigene Anbieter und HF-Token (IG-H4) werden gemeldet, harmloser Text nicht', hat('IG-H5', 'no refusals') && hat('IG-H5', 'uncensored') && hat('IG-H5', 'No Filter') && hat('IG-H6', 'Kaufwort') && hat('IG-H6', 'lu-labs.ai') && hat('IG-H4', 'Hugging-Face-Token') && hat('IG-H4', 'eigener Anbieter') && !sf.some((f) => /local model/.test(f.text)), sf.map((f) => `${f.befund} ${f.muster}`))
  // F10: jede Schreibweise der einen Liste der App wird in einem Suchtreffer gefunden, ausser den dort als Alltagswort
  // oder Eigenname gefuehrten. Gelesen aus der Quelle, weil der Rahmen kein TypeScript laedt.
  const schreibweisen = [...readFileSync(join(REPO, 'src', 'mobile', 'policy', 'unfiltered-names.ts'), 'utf8').matchAll(/^\s*\{ what: .*sample: '([^']+)'(.*)\},$/gm)].map((m) => ({ name: m[1], alltag: /everyday: true/.test(m[2]) }))
  const nichtGefunden = schreibweisen.filter((w) => !w.alltag && !pruefeStoreTexte([{ text: w.name.split('/').pop().replace(/[-_]?GGUF$/i, '') }]).some((f) => f.befund === 'IG-H5' && !f.zusatz)).map((w) => w.name)
  const lorablated = pruefeStoreTexte([{ text: 'Hermes-3-Llama-3.1-8B-lorablated' }, { text: 'Hermes-3-Llama-3.1-8B' }, { text: 'Serpent 7B, a tablet model for collaboration' }])
  ok(S, 'F10: "lorablated" und jede weitere Schreibweise der Liste der App ist in einem Modellnamen ein Fund, ein Name ohne sie nicht', schreibweisen.length >= 30 && schreibweisen.some((w) => /lorablated/.test(w.name)) && nichtGefunden.length === 0 && lorablated.length === 1 && lorablated[0].muster === 'Schreibweise', { gelesen: schreibweisen.length, nichtGefunden, lorablated })
  // Runde 15, entschieden am 10.10.2026: die App heisst in beiden Stores nur "LU". Der lange Name ist in jeder
  // Schreibweise ein Fund, die geroutete Kennung eines Modells auch, und die Marke "Direct" samt ihrem Satz keiner.
  const nameSchreibweisen = ['Locally Uncensored', 'LocallyUncensored', 'locally uncensored', 'locally-uncensored', 'locallyuncensored', 'locally_uncensored', 'LocallyUncensored/2.0', 'locally-uncensored-chats-3.json']
  const nameNichtGefunden = nameSchreibweisen.filter((t) => !pruefeStoreTexte([{ text: t }]).some((f) => f.muster === 'Produktname'))
  const kennung = pruefeStoreTexte([{ text: 'Model: openai::Qwen3.5-0.8B-Q4_K_M' }, { text: 'Model: Qwen 3.5 0.8B' }]).filter((f) => f.muster === 'Modellkennung')
  const direct = pruefeStoreTexte([{ text: 'Direct' }, { text: 'D' }, { text: 'Direct models follow instructions closely and add fewer refusals of their own. Your content settings still apply.' }, { text: 'LU Cloud model' }, { text: 'Welcome to LU' }])
  const kauf = ['Nothing was charged.', 'A failed run is refunded.', 'Chat with the monthly credit budget.', 'Only $9 to go on.', 'Add credits'].filter((t) => !pruefeStoreTexte([{ text: t }]).some((f) => f.muster === 'Kaufwort'))
  const kaufFrei = pruefeStoreTexte([{ text: '1,240 credits left this period.' }, { text: 'This run uses 12 credits.' }, { text: 'This account has no credits left.' }, { text: 'No credits were used.' }]).filter((f) => !f.zusatz)
  ok(S, 'Runde 15: der lange Produktname ist in jeder Schreibweise ein Fund, die geroutete Modellkennung auch; "Direct" mit seinem Satz, der Kontostand und der Verbrauch sind keiner', nameNichtGefunden.length === 0 && kennung.length === 1 && direct.length === 0 && kauf.length === 0 && kaufFrei.length === 0, { nameNichtGefunden, kennung, direct, kauf, kaufFrei })
  // Entschieden am 10.10.2026: hello@lu-labs.ai ist die Kontaktadresse der App. Erlaubt an GENAU einer Stelle,
  // der Kontaktzeile der Seite About, so wie die Seite sie liefert: Textknoten in der Zeile, dazu dieselbe Zeile
  // noch einmal als ganze Zeile ohne Stelle.
  const KONTAKT = '[data-testid="m-settings-about-contact"] > span.m-row-text > span.m-row-sub'
  const about = [{ text: 'Contact support', quelle: 'text', wo: '[data-testid="m-settings-about-contact"] > span.m-row-text > span.m-row-title' }, { text: 'hello@lu-labs.ai', quelle: 'text', wo: KONTAKT }, { text: 'Contact support', quelle: 'zeile', wo: null }, { text: 'hello@lu-labs.ai', quelle: 'zeile', wo: null }]
  // Gegenpruefung 4 Android, F10 (entschieden, umkehrbar): Der eine Satz ueber den Kauf bleibt im Play-Paket.
  // Der Waechter am Geraet laesst ihn an denselben Stellen zu wie der Waechter ueber die Seiten, und nur dort.
  const regelnE2e = readFileSync(join(RAHMEN, '..', 'e2e', 'mobile', 'store-rules.ts'), 'utf8')
  const satzE2e = /export const PLAY_SENTENCE = '([^']+)'/.exec(regelnE2e)?.[1]
  const listeE2e = (n) => [...(new RegExp(`export const ${n}: readonly string\\[\\] = \\[([^\\]]*)\\]`).exec(regelnE2e)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  const orteE2e = [...listeE2e("PLAY_SENTENCE_PLACES_SIGNED_OUT"), ...listeE2e("PLAY_SENTENCE_PLACES")].map((w) => w.replace(/^route /, '').replace(/^sheet /, 'blatt:'))
  const satzFunde = (preset, ort, texte, links = []) => pruefeStoreTexte(texte, links, undefined, undefined, erlaubteSaetze(preset, ort)).filter((f) => !f.zusatz)
  const satzOrte = ERLAUBTE_SAETZE[0].orte
  ok(S, 'F10: derselbe Satz und dieselben Stellen wie im Waechter ueber die Seiten (e2e/mobile/store-rules.ts)', satzE2e === PLAY_SATZ && ERLAUBTE_SAETZE.length === 1 && orteE2e.length === 6 && [...orteE2e].sort().join() === [...satzOrte].sort().join() && ['/cloud', '/create/showcase', 'blatt:credits'].every((o) => satzOrte.includes(o)), [satzE2e, orteE2e, satzOrte])
  ok(S, 'F10: im Play-Bau ist der Satz an seinen Stellen kein Fund, als Element und als ganze Zeile', satzOrte.every((o) => satzFunde('play', o, [{ text: PLAY_SATZ, quelle: 'element', wo: '[data-testid="m-x"]' }, { text: `LU Cloud is not active on this account. ${PLAY_SATZ}`, quelle: 'zeile' }]).length === 0))
  ok(S, 'F10: auf jeder anderen Seite, im Preset appstore und ohne Preset bleibt der Satz ein Fund', ['/chats', '/settings', 'blatt:model-more', '/create/batch'].every((o) => satzFunde('play', o, [{ text: PLAY_SATZ }]).some((f) => f.muster === 'lu-labs.ai')) && satzFunde('appstore', '/cloud', [{ text: PLAY_SATZ }]).some((f) => f.muster === 'lu-labs.ai') && satzFunde(null, '/cloud', [{ text: PLAY_SATZ }]).length > 0 && pruefeStoreTexte([{ text: PLAY_SATZ }]).some((f) => f.muster === 'lu-labs.ai'))
  ok(S, 'F10: neben dem Satz bleibt jede andere Nennung der Domain ein Fund: ein zweiter Satz, ein Link, ein Kaufwort', satzFunde('play', '/cloud', [{ text: `${PLAY_SATZ} More on lu-labs.ai.` }]).some((f) => f.muster === 'lu-labs.ai') && satzFunde('play', '/cloud', [{ text: PLAY_SATZ }], [{ href: 'https://lu-labs.ai/pricing', text: 'lu-labs.ai' }]).some((f) => f.quelle === 'href') && satzFunde('play', '/cloud', [{ text: `${PLAY_SATZ} Upgrade now.` }]).some((f) => f.muster === 'Kaufwort') && satzFunde('play', '/cloud', [{ text: 'Plans and credits are available on lu-labs.ai/pricing.' }]).some((f) => f.muster === 'lu-labs.ai'))
  const kontaktFunde = (texte, links = []) => pruefeStoreTexte(texte, links).filter((f) => f.muster === 'lu-labs.ai')
  const kErlaubt = kontaktFunde(about)
  const kEinzeilig = kontaktFunde([about[1], { text: 'Contact support hello@lu-labs.ai', quelle: 'zeile', wo: null }, { text: 'Contact support hello@lu-labs.ai', quelle: 'aria-label', wo: '[data-testid="m-settings-about-contact"]' }])
  const kAndereStelle = kontaktFunde([{ text: 'hello@lu-labs.ai', quelle: 'text', wo: '[data-testid="m-account-delete-error"]' }, { text: 'hello@lu-labs.ai', quelle: 'zeile', wo: null }])
  const kZweimal = kontaktFunde([...about, { text: 'Write to hello@lu-labs.ai for help.', quelle: 'text', wo: '[data-testid="m-settings-about-screen"] > p' }, { text: 'Write to hello@lu-labs.ai for help.', quelle: 'zeile', wo: null }])
  const kDomain = kontaktFunde([{ text: 'hello@lu-labs.ai or lu-labs.ai/pricing', quelle: 'text', wo: KONTAKT }, { text: 'sales@lu-labs.ai', quelle: 'text', wo: KONTAKT }])
  const kLink = kontaktFunde(about, [{ href: 'mailto:hello@lu-labs.ai', text: 'Contact support' }])
  const kOhneListe = pruefeStoreTexte(about, [], undefined, []).filter((f) => f.muster === 'lu-labs.ai')
  ok(S, 'Kontaktadresse: hello@lu-labs.ai ist in der Kontaktzeile der Seite About kein Fund (0), an jeder anderen Stelle, ein zweites Mal, als Link und jede andere Nennung der Domain bleiben Funde', kErlaubt.length === 0 && kEinzeilig.length === 0 && kAndereStelle.length === 1 && kZweimal.length === 1 && /Write to/.test(kZweimal[0].text) && kDomain.length === 2 && kLink.length === 1 && kLink[0].quelle === 'href' && kOhneListe.length === 1 && ERLAUBTE_NENNUNGEN.length === 1 && ERLAUBTE_NENNUNGEN[0].kennung === 'm-settings-about-contact', { kErlaubt, kEinzeilig, kAndereStelle, kZweimal, kDomain, kLink, kOhneListe })
  // Entschieden am 10.10.2026: das App-Store-Paket hat keine Schluesselfelder der Websuche. Die Seite sagt dort einen
  // Satz, und der ist kein Fund; die Felder des Play-Pakets waeren einer (im Play-Lauf nur Hinweis, IG-H4).
  const freiOhneFund = pruefeStoreTexte([{ text: readFileSync(join(REPO, 'src', 'mobile', 'strings', 'agent.ts'), 'utf8').match(/freeOnly: '([^']+)'/)?.[1] ?? 'api key' }, { text: 'Web search' }, { text: 'Test search' }])
  const mitFeldern = pruefeStoreTexte([{ text: 'Brave API key' }, { text: 'Add a Tavily API key below first.' }]).filter((f) => f.muster === 'eigener Anbieter')
  ok(S, 'Websuche: der Satz der Seite ohne Schluesselfelder ist kein Fund, "API key" bleibt einer', freiOhneFund.length === 0 && mitFeldern.length === 2, { freiOhneFund, mitFeldern })
  const sk = pruefeStoreKennungen([{ id: 'm-settings-providers', sichtbar: true }, { id: 'm-settings-remote', sichtbar: false }, { id: 'm-remote-screen', sichtbar: true }, { id: 'm-cloud-plans', sichtbar: true }, { id: 'm-chat-send', sichtbar: true }])
  ok(S, 'appstore: sichtbare Kennungen fuer Anbieter und Tarife werden gemeldet, unsichtbare und der Seitenrahmen nicht', JSON.stringify(sk.map((f) => f.treffer[0])) === '["m-settings-providers","m-cloud-plans"]', sk)

  // Persistenz mit einem echten Schalter der App (schalterNaht), an einem gespielten Treiber.
  // Der gespielte Schalter laesst sich so einstellen, dass ein Abschuss ihn zurueckwirft:
  // Genau das muss die Pruefung dann melden.
  const PN = 'persistenz-naht'
  const spielSchalter = ({ verliert = false, taub = false } = {}) => {
    const z = { an: true, gesichert: true, aufSeite: false, chats: [], tipps: 0, wege: 0, lebt: true }
    const d = {
      plattform: 'gespielt',
      z,
      sleep: async () => {},
      launch: async () => { z.lebt = true; z.aufSeite = false },
      waitFor: async () => true,
      screenshot: async () => {},
      kill: async () => { z.lebt = false; if (verliert) z.an = z.gesichert },
      tap: async () => { z.tipps += 1; if (!taub) z.an = !z.an; if (!verliert) z.gesichert = z.an },
      evalJs: async () => null,
      evalFn: async (fn, ...args) => {
        if (fn === schalterStand) return z.aufSeite ? { da: true, an: z.an, gesperrt: false } : { da: false, an: null, gesperrt: false }
        if (fn === schreibeProbe) { z.chats.push({ id: 'chat-' + args[0], marke: args[0], fertig: true, nachrichten: 2, zeichen: 100, teile: 0, letzterTeil: null }); return { marke: args[0], zeichen: 100, nurChat: args[1] } }
        if (fn === liesProbe) return { einstellung: null, chats: z.chats }
        throw new Error('gespielter Treiber: unbekannte Seitenfunktion')
      },
    }
    const naht = schalterNaht({ oeffne: async () => { z.wege += 1; z.aufSeite = true }, schalter: '[data-testid="schalter"]', name: 'schalter', wartenMs: 5 })
    return { d, z, naht }
  }
  const pGut = spielSchalter()
  const pg = await persistenz(pGut.d, { naht: pGut.naht, varianten: ['abschuss'] })
  const vg = pg.varianten[0]
  ok(PN, 'der Schalter wird ueber seine Seite erreicht, einmal umgestellt, nach dem Abschuss wieder aufgesucht und abgelesen: ok', vg.status === 'ok' && vg.geschrieben?.schalter?.vor === true && vg.geschrieben.schalter.soll === false && pGut.z.wege >= 2, vg)
  ok(PN, 'danach steht der Schalter wieder wie vorher (zurueckgestellt), mit genau zwei Tipps', pGut.z.an === true && pGut.z.tipps === 2 && vg.aufgeraeumt?.zurueckAuf === true, { z: pGut.z, aufgeraeumt: vg.aufgeraeumt })
  ok(PN, 'das Ergebnis nennt die Naht und dass der Chat roh geschrieben ist (der Bericht meldet damit nie "belegt")', pg.naht === 'schalter' && pg.chatRoh === true, { naht: pg.naht, chatRoh: pg.chatRoh })
  const pSchlecht = spielSchalter({ verliert: true })
  const vs = (await persistenz(pSchlecht.d, { naht: pSchlecht.naht, varianten: ['abschuss'] })).varianten[0]
  ok(PN, 'eine App, die den Schalter beim Abschuss verliert, wird als "verloren: Einstellung" gemeldet', vs.status === 'fehler' && /verloren: Einstellung/.test(vs.grund ?? ''), vs)
  const pTaub = spielSchalter({ taub: true })
  const vt = (await persistenz(pTaub.d, { naht: pTaub.naht, varianten: ['abschuss'] })).varianten[0]
  ok(PN, 'ein Schalter, der den Tipp nicht annimmt, ist ein Fehler und kein stilles ok', vt.status === 'fehler' && /nicht angenommen/.test(vt.grund ?? ''), vt)
  const rohErg = await persistenz({ ...spielSchalter().d, evalFn: async (fn, ...args) => (fn === schreibeProbe ? { marke: args[0], nurChat: args[1] } : { einstellung: null, chats: [] }) }, { varianten: ['abschuss'] })
  ok(PN, 'ohne Naht bleibt es die rohe (Testbett): geschrieben wird mit Einstellung, das Ergebnis heisst "roh"', rohErg.naht === 'roh' && rohErg.chatRoh === true && rohErg.varianten[0].status === 'fehler' && /Schreiben hat nicht geklappt/.test(rohErg.varianten[0].grund ?? ''), rohErg)

  // Sweep-Urteil: die drei Fehlurteile der Nachabnahme auf dem grossen iPhone (BERICHT.md, Abschnitt 5)
  const U = 'sweep-urteil'
  const L = seitenLib()
  // 1. Der Schleier hinter einem Blatt: iPhone 17 Pro Max hoch, 440 x 956, Statusleiste 62, Home-Strich 34.
  const schleier = { left: 0, top: 0, right: 440, bottom: 956 }
  const punkte = L.ausweichPunkte(schleier, 440, 956, { oben: 62, rechts: 0, unten: 34, links: 0 })
  ok(U, 'ausweichPunkte: kein Punkt in der Statusleiste oder im Home-Strich, der erste liegt im freien Streifen ueber einem Blatt von 88 %', punkte.length > 0 && punkte.every((q) => q.y >= 62 && q.y <= 956 - 34 && q.x >= 0 && q.x <= 440) && punkte[0].y > 62 && punkte[0].y < 956 * 0.12, punkte.slice(0, 3))
  // Gegenpruefung Android 4 GB: Senden bei 300 bis 344, sichtbar bis 317 (die Seite ist 640 hoch).
  ok(U, 'unterTastatur: der Punkt von Senden (y 322) liegt unter der Tastatur, das Feld darueber (y 265) nicht', L.unterTastatur(322, { offsetTop: 0, height: 317 }, 640) === true && L.unterTastatur(265, { offsetTop: 0, height: 317 }, 640) === false)
  ok(U, 'unterTastatur: ohne Tastatur (Ausschnitt so hoch wie die Seite, oder kein visualViewport) liegt nichts darunter', L.unterTastatur(630, { offsetTop: 0, height: 640 }, 640) === false && L.unterTastatur(630, null, 640) === false && L.unterTastatur(630, { offsetTop: 0, height: 600 }, 640) === false)
  ok(U, 'unterTastatur: ein verschobener Ausschnitt zaehlt mit (offsetTop)', L.unterTastatur(400, { offsetTop: 100, height: 317 }, 640) === false && L.unterTastatur(420, { offsetTop: 100, height: 317 }, 640) === true)
  ok(U, 'freierTreffer: von zwei Treffern derselben Kennung gewinnt der, der frei im Bild liegt, nicht der erste im Dokument', L.freierTreffer([{ imBild: true, frei: false }, { imBild: true, frei: true }]) === 1 && L.freierTreffer([{ imBild: false, frei: false }, { imBild: true, frei: false }]) === -1 && L.freierTreffer([]) === -1)
  {
    const quelle = (datei) => readFileSync(new URL(datei, import.meta.url), 'utf8')
    // Die Regel steht seit Runde 16 an einer Stelle (lib/tipp.mjs, tippVerbot), die Treiber werfen, was sie nennt.
    const wirft = (datei) => /const (verbot|danach) = tippVerbot\(p, ziel, opts\)\n\s+if \((verbot|danach)\) throw new Error\(/.test(quelle(datei))
    ok(U, 'tap: beide Treiber werfen, wenn der Punkt unter der Tastatur liegt', wirft('../driver/android.mjs') && wirft('../driver/ios.mjs') && /unter der Tastatur/.test(tippVerbot({ gefunden: true, unterTastatur: true }, 'm-x') ?? ''))
    const seite = quelle('./seite.mjs')
    ok(U, 'findeZiel: fragt beide Regeln und meldet sie dem Treiber', seite.includes('L.freierTreffer(lagen)') && seite.includes('L.unterTastatur(y,') && seite.includes('unterTastatur: tastatur,') && seite.includes('ersatzFrei,'))
    ok(U, 'tap (iOS): die Tastatur wird erst geschlossen, geworfen wird nur, wenn der Punkt danach noch darunter liegt', quelle('../driver/ios.mjs').indexOf('await this.hideKeyboard()') > 0 && quelle('../driver/ios.mjs').indexOf('await this.hideKeyboard()') < quelle('../driver/ios.mjs').indexOf('const danach = tippVerbot(p, ziel, opts)') && quelle('../driver/ios.mjs').includes('tippVerbot(p, ziel, { ...opts, auchUnterTastatur: true })'))
  }
  // macOS hat kein `timeout`: der Rahmen bringt seine Zeitgrenze mit (lib/frist.mjs).
  {
    const kurz = await befehlMitFrist(0.3, process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore', nachfristMs: 500 })
    const fertig = await befehlMitFrist(20, process.execPath, ['-e', 'process.exit(3)'], { stdio: 'ignore' })
    ok(U, 'frist: ein Befehl, der zu lange laeuft, wird beendet und meldet 124, ein fertiger behaelt sein Ende', kurz.abgelaufen === true && kurz.code === 124 && fertig.abgelaufen === false && fertig.code === 3, { kurz, fertig })
    let ohneBefehl = ''
    try { leseAufruf(['600']) } catch (e) { ohneBefehl = e.message }
    const gelesen = leseAufruf(['600', '--', 'node', 'selbsttest.mjs'])
    ok(U, 'frist: die Aufrufzeile "600 -- node selbsttest.mjs" wird gelesen, eine ohne Befehl abgelehnt', gelesen.sekunden === 600 && gelesen.befehl === 'node' && gelesen.argumente[0] === 'selbsttest.mjs' && ohneBefehl.includes('Befehl'))
  }
  const quer = L.ausweichPunkte({ left: 0, top: 0, right: 956, bottom: 440 }, 956, 440, { oben: 0, rechts: 62, unten: 21, links: 62 })
  ok(U, 'ausweichPunkte: quer bleiben die Punkte neben der Notch, ohne Safe Area gilt der alte Abstand von 24 px', quer.every((q) => q.x >= 62 && q.x <= 956 - 62 && q.y <= 440 - 21) && L.ausweichPunkte(schleier, 440, 956, null)[0].y === 24, quer.slice(0, 3))
  ok(U, 'ausweichPunkte: ein Element, das ganz im Rand des Systems liegt, hat keinen Punkt', L.ausweichPunkte({ left: 0, top: 0, right: 440, bottom: 50 }, 440, 956, { oben: 62, rechts: 0, unten: 34, links: 0 }).length === 0)

  // Touch-Ziele (Abnahme 5.2): das Mass je Plattform und die Zahl fuer den Bericht.
  const TZ = 'touch-ziele'
  const kleinA = { testid: 'm-a', pfad: 'a', ziel: [44, 44], klasse: 'm-btn' }
  const kleinB = { testid: 'm-a', pfad: 'a', ziel: [40, 44], klasse: 'm-btn' }
  const tz = touchSumme(
    [
      { route: '/chats', name: 'chats__hoch', touchZiele: { gemessen: 10, ohneKennung: 2, zuKlein: [kleinA], ausnahmen: [{ testid: 'm-md-link', grund: 'Link im Fliesstext' }] } },
      { route: '/chats', name: 'chats__quer', touchZiele: { gemessen: 10, ohneKennung: 2, zuKlein: [kleinB], ausnahmen: [{ testid: 'm-md-link', grund: 'Link im Fliesstext' }] } },
      { route: '/models', name: 'models__hoch', fehler: 'nicht herstellbar' },
    ],
    touchMin('android'),
  )
  ok(TZ, 'touchMin: iOS 44, Android 48, unbekannt 44', touchMin('ios') === 44 && touchMin('android') === 48 && touchMin('x') === 44)
  ok(TZ, 'touchSumme: dasselbe Ziel auf zwei Varianten zaehlt einmal, mit der kleinsten Flaeche; eine Messung ohne Ergebnis zaehlt nicht', tz.min === 48 && tz.gemessen === 20 && tz.zuKlein === 1 && tz.liste[0].ziel[0] === 40 && tz.liste[0].variante === 'chats__quer' && tz.ausnahmen.length === 1 && tz.ohneKennung === 4, tz)
  ok(TZ, 'zaehleProbleme: zu kleine Ziele sind Probleme der Messung, eine alte Messung ohne Touch-Ziele zaehlt 0', zaehleProbleme({ touchZiele: { zuKlein: [kleinA, kleinB] } }).touchZiele === 2 && zaehleProbleme({}).touchZiele === 0)
  ok(TZ, 'touchZiele laeuft in der Seite: in sich geschlossen, nur L und Argumente', !/\b(import|require)\b/.test(touchZiele.toString()) && /^function touchZiele\(L, opts\)/.test(touchZiele.toString()))

  // 2. Schalter und Wahl: Das Blatt bewegte sich noch (dom unruhig), der Wechsel stand nur im DOM.
  const an = { art: 'schalter', selbst: true }
  const aus = { art: 'schalter', selbst: false }
  ok(U, 'belegeAus: ein Schalter, der kippt, ist Wirkung, auch wenn dom unruhig ist (Thinking, Small model mode)', JSON.stringify(belegeAus({ geaendert: ['dom', 'fokus'], unruhig: ['dom'], schaltVor: aus, schaltNach: an, zaehlt: ['dom'] })) === '["schaltzustand"]')
  ok(U, 'belegeAus: eine Wahl, die wechselt, ist Wirkung, auch wenn dom unruhig ist (Laenge 8 s)', belegeAus({ geaendert: ['dom'], unruhig: ['dom'], schaltVor: { art: 'wahl', selbst: false, gewaehlt: '4' }, schaltNach: { art: 'wahl', selbst: true, gewaehlt: '5' }, zaehlt: ['dom'] }).includes('schaltzustand'))
  ok(U, 'belegeAus: ein Schalter, der nicht kippt, bleibt ohne Beleg, und Unruhe allein belegt nichts', belegeAus({ geaendert: ['dom'], unruhig: ['dom'], schaltVor: aus, schaltNach: aus, zaehlt: ['dom'] }).length === 0 && belegeAus({ geaendert: ['dom'], unruhig: ['dom'], zaehlt: ['dom'] }).length === 0)
  ok(U, 'belegeAus: was vorher zaehlte, zaehlt weiter (dom auf stiller Seite), was nicht zaehlt (fokus), nicht', JSON.stringify(belegeAus({ geaendert: ['dom', 'fokus'], unruhig: [], zaehlt: ['dom', 'text'] })) === '["dom"]')

  // 3. Eine Meldung, die kuerzer steht als die Messung, und ein Zustand, der kommt und geht.
  ok(U, 'belegeAus: eine Meldung, die zwischen den Messungen kam und ging, ist Wirkung ("Engine restarted")', JSON.stringify(belegeAus({ geaendert: ['fokus'], zaehlt: ['dom'], ruhe: { n: 0, meldungen: [] }, zeuge: { n: 6, meldungen: ['Engine restarted'] } })) === '["meldung"]')
  ok(U, 'belegeAus: kam und ging etwas ohne Meldung, heisst es fluechtig, aber nur auf einer Seite, die vorher still war', JSON.stringify(belegeAus({ geaendert: [], zaehlt: ['dom'], ruhe: { n: 0, meldungen: [] }, zeuge: { n: 3, meldungen: [] } })) === '["fluechtig"]' && belegeAus({ geaendert: [], zaehlt: ['dom'], ruhe: { n: 4, meldungen: [] }, zeuge: { n: 9, meldungen: [] } }).length === 0)
  ok(U, 'belegeAus: ein toter Knopf bleibt tot (nichts geaendert, Zeuge sah nichts), eine Meldung von vorher zaehlt nicht', belegeAus({ geaendert: ['fokus'], zaehlt: ['dom'], ruhe: { n: 0, meldungen: [] }, zeuge: { n: 0, meldungen: [] } }).length === 0 && belegeAus({ geaendert: [], zaehlt: ['dom'], ruhe: { n: 2, meldungen: ['Saving'] }, zeuge: { n: 2, meldungen: ['Saving'] } }).length === 0)

  // Schon gewaehlt: Reiter und Radioknopf wie bisher, dazu der einzige gedrueckte Filter einer Reihe.
  ok(U, 'schonGewaehlt: Radioknopf, der schon steht, und der einzige gedrueckte Filter einer Reihe ("All" in der Galerie)', schonGewaehlt({ rolle: 'radio', zustand: { angehakt: 'true' } }, null) && schonGewaehlt({ rolle: 'button', zustand: {} }, { art: 'schalter', selbst: true, inReihe: true, einzigerAn: true }))
  ok(U, 'schonGewaehlt: ein gewoehnlicher Knopf und ein Filter, der nicht der einzige ist, gelten nicht als gewaehlt', !schonGewaehlt({ rolle: 'button', zustand: {} }, null) && !schonGewaehlt({ rolle: 'button', zustand: {} }, { art: 'schalter', selbst: true, inReihe: true, einzigerAn: false }))

  // Erst messen, wenn die Seite steht.
  const folgeVon = (liste) => {
    let i = 0
    return async () => liste[Math.min(i++, liste.length - 1)]
  }
  const still = await warteStill({ sleep: async () => {} }, folgeVon([{ dom: 1 }, { dom: 2 }, { dom: 3 }, { dom: 3 }]))
  const nie = await warteStill({ sleep: async () => {} }, (() => { let i = 0; return async () => ({ dom: i++ }) })(), { maxMs: 900 })
  ok(U, 'warteStill: wartet, bis zwei Messungen gleich sind, und gibt bei einer Seite, die nie steht, nach der Frist die letzten beiden zurueck', still[0].dom === 3 && still[1].dom === 3 && nie[0].dom !== nie[1].dom, [still, nie])

  // Der Ja-Schritt: Der erste Tipp nach dem Start wirkt nicht, der zweite schon.
  const tipper = (wirktAb) => {
    const z = { tipps: 0 }
    return { z, d: { sleep: async () => {} }, tippe: async () => void z.tipps++, fertig: async () => z.tipps >= wirktAb, daNoch: async () => true }
  }
  const t1x = tipper(1)
  const t2x = tipper(2)
  const tNie = tipper(99)
  const n1 = await tippeBis(t1x.d, { ...t1x, warteMs: 20, schrittMs: 10 })
  const n2 = await tippeBis(t2x.d, { ...t2x, warteMs: 20, schrittMs: 10 })
  const fNie = await wirft(() => tippeBis(tNie.d, { ...tNie, warteMs: 20, schrittMs: 10, was: '"m-age-yes"' }), Error)
  ok(U, 'tippeBis: ein Tipp, wenn er wirkt, ein zweiter, wenn der erste nichts bewirkt hat, nach drei ohne Wirkung ein Fehler mit dem Namen', n1 === 1 && t1x.z.tipps === 1 && n2 === 2 && tNie.z.tipps === 3 && /3 Tipps auf "m-age-yes" ohne Wirkung/.test(fNie?.message ?? ''), [n1, n2, tNie.z, fNie?.message])
  const tWeg = tipper(99)
  const nWeg = await tippeBis(tWeg.d, { ...tWeg, daNoch: async () => false, warteMs: 20, schrittMs: 10 })
  ok(U, 'tippeBis: ist das Ziel nach dem Tipp weg, wird nicht noch einmal getippt', nWeg === 1 && tWeg.z.tipps === 1)
  const steht = await warteBisSteht({ sleep: async () => {} }, folgeVon([{ x: 1, y: 300 }, { x: 1, y: 120 }, { x: 1, y: 100 }, { x: 1, y: 100 }]))
  const stehtNie = await warteBisSteht({ sleep: async () => {} }, folgeVon([null]), { maxMs: 500 })
  ok(U, 'warteBisSteht: wahr, sobald das Ziel zweimal an derselben Stelle steht, falsch, wenn es nie da ist', steht === true && stehtNie === false)
  const alterQuelle = readFileSync(join(RAHMEN, 'flows', 'alter.mjs'), 'utf8')
  ok(U, 'flows/alter.mjs: der Schritt Ja tippt ueber tapBis und prueft die Wirkung an data-age', /f\.tapBis\(S\.alter\.ja, async \(\) => !\(await f\.lage\(\)\)\.alter\)/.test(alterQuelle))

  // Harness-Funde der Nachabnahme Android 8 GB (HB2 bis HB7)
  const H = 'nachabnahme-android'
  const kachel = [
    { text: '', id: 'com.google.android.documentsui:id/icon_thumb', beschreibung: 'Preview the file zweite.pdf', x: 800, y: 500 },
    { text: 'zweite.pdf', id: 'com.google.android.documentsui:id/preview_icon', beschreibung: 'Preview the file zweite.pdf', x: 820, y: 520 },
    { text: 'erste.pdf', id: 'android:id/title', beschreibung: '', x: 300, y: 700 },
    { text: 'zweite.pdf', id: 'android:id/title', beschreibung: '', x: 800, y: 700 },
  ]
  const kn = androidDateiKnoten(kachel, 'zweite.pdf')
  ok(H, 'HB2: in der Dateiauswahl trifft der Tipp den Titel der Datei, nie die Flaeche der Vorschau', kn?.y === 700 && kn.x === 800 && androidDateiKnoten(kachel.slice(0, 1), 'zweite.pdf') === null && androidDateiKnoten([], 'x.pdf') === null, kn)
  const befehle = []
  const dAndroid = { plattform: 'android', shell: async (c) => (befehle.push(c), ''), sleep: async () => {} }
  await entferneDatei(dAndroid, 'probe.pdf')
  const fName = await wirft(() => entferneDatei(dAndroid, 'a";reboot'), Error)
  ok(H, 'HB3: nach dem Loeschen einer abgelegten Datei laeuft der Medienscan, ein fremder Dateiname wird abgelehnt', befehle.length === 2 && befehle[0] === 'rm -f "/sdcard/Download/probe.pdf"' && befehle[1].startsWith(MEDIEN_SCAN) && !!fName, [befehle, fName?.message])
  const besucht = []
  const rs = await raeumeStapel({}, { zu: async (_d, tab) => { besucht.push(tab); if (tab === 'create') throw new Error('keine Reiterleiste') } })
  ok(H, 'HB4: nach einem Lauf wird jeder Reiter zur Wurzel geraeumt, Chat zuletzt, ein Fehler haelt die anderen nicht auf', besucht.length === REITER.length && besucht.at(-1) === 'chat' && rs.geraeumt.length === REITER.length - 1 && rs.offen.length === 1 && /^create: /.test(rs.offen[0]), [besucht, rs])
  const sweepQuelle = readFileSync(join(RAHMEN, 'sweep.mjs'), 'utf8')
  const worteQuelle = readFileSync(join(RAHMEN, 'checks', 'storeworte.mjs'), 'utf8')
  const vorTrennen = (q) => q.lastIndexOf('raeumeStapel(d)') > 0 && q.lastIndexOf('raeumeStapel(d)') < q.lastIndexOf('d.disconnect()')
  ok(H, 'HB4: sweep.mjs und checks/storeworte.mjs raeumen die Stapel, bevor sie die Verbindung trennen', vorTrennen(sweepQuelle) && vorTrennen(worteQuelle))
  ok(H, 'HB5: der Selektor fuer Werkzeugaufrufe trifft die einzelne Zeile und die Zeile in den Schritten', /"m-chat-tool"\]/.test(SELEKTOREN.agent.werkzeugAufruf.sel) && /"m-chat-tool-nested"\]/.test(SELEKTOREN.agent.werkzeugAufruf.sel) && /m-chat-steps/.test(SELEKTOREN.agent.werkzeugSchritte.sel), SELEKTOREN.agent.werkzeugAufruf)
  const abbruch = { testid: 'm-models-download-cancel', name: 'Cancel', laeuft: true }
  const gLauf = sperrGrund(abbruch)
  ok(H, 'HB6: "cancel" neben einem laufenden Vorgang ist zerstoerend, ohne laufenden Vorgang bleibt es frei', gLauf?.art === 'destructive' && brichtLaufendesAb(abbruch) && sperrGrund({ ...abbruch, laeuft: false }) === null && sperrGrund({ testid: 'm-dialog-cancel', name: 'Cancel', laeuft: false }) === null && !brichtLaufendesAb({ testid: 'm-models-open', name: 'Open', laeuft: true }), gLauf)
  const jGesetzt = javaUmgebung({ JAVA_HOME: '/eigenes/jdk', PATH: '/bin' }, () => true)
  const jGefunden = javaUmgebung({ PATH: '/bin' }, (p) => p === `${JAVA_ORTE[1]}/bin/java`)
  const jOhne = javaUmgebung({ PATH: '/bin' }, () => false)
  ok(H, 'HB7: JAVA_HOME wird selbst gesetzt, ein gesetztes bleibt, ohne Java bleibt die Umgebung wie sie ist', jGesetzt.JAVA_HOME === '/eigenes/jdk' && jGesetzt.PATH === '/bin' && jGefunden.JAVA_HOME === JAVA_ORTE[1] && jGefunden.PATH === `${JAVA_ORTE[1]}/bin:/bin` && jOhne.JAVA_HOME === undefined, [jGesetzt, jGefunden, jOhne])
  const geraetQuelle = readFileSync(join(RAHMEN, 'geraet.mjs'), 'utf8')
  ok(H, 'HB7: jeder Aufruf von avdmanager in geraet.mjs laeuft mit javaUmgebung()', (geraetQuelle.match(/lauf\(avdmanager,/g) ?? []).length === (geraetQuelle.match(/lauf\(avdmanager,[^\n]*env: javaUmgebung\(\)/g) ?? []).length && (geraetQuelle.match(/lauf\(avdmanager,/g) ?? []).length >= 2)

  // Seitenvorschau: der Weg, vor dem der Testhaken einen Chat mit HTML-Block ablegt
  const VR = '/chat/:id/preview/:blockId'
  const gegangen = []
  const spielWeg = (mitHaken, daJa) => ({ hat: async () => mitHaken, rufe: async () => ({ ok: true, id: 'c-7' }), gehe: async (_d, weg, o) => void gegangen.push([weg, o?.ersatz ?? null]), da: async () => daJa })
  const tipps = []
  const dWeg = { tap: async (s) => void tipps.push(s), evalJs: async () => ({ ruhig: true }), sleep: async () => {}, waitFor: async () => true }
  await geheVorbereitetenWeg(dWeg, WEGE[VR], VORBEREITUNG[VR], { ...spielWeg(true, true), kennungen: async () => [] })
  const mitHaken = gegangen.pop()
  const tippVorschau = tipps.splice(0)
  const fOhne = await wirft(() => geheVorbereitetenWeg(dWeg, WEGE[VR], VORBEREITUNG[VR], { ...spielWeg(false, false), kennungen: async () => [] }), HakenFehlt)
  const ohneWeg = gegangen.pop()
  ok(H, 'Seitenvorschau: mit Testhaken wird genau der abgelegte Chat getippt, danach "Preview" getippt', mitHaken[0].join() === WEGE[VR].slice(0, -1).join() && mitHaken[1]?.['m-chats-item'] === '[data-testid="m-chats-item"][data-m-id="c-7"]' && WEGE[VR].at(-1) === 'm-chat-code-preview' && tippVorschau.length === 1 && /m-chat-code-preview/.test(tippVorschau[0]) && !OHNE_WEG[VR], [mitHaken, tippVorschau])
  ok(H, 'Seitenvorschau: ohne Testhaken und ohne HTML-Block ist die Seite "nicht herstellbar" (HakenFehlt), kein Tipp ins Leere', !!fOhne && /Antwort mit HTML-Block/.test(fOhne.message) && ohneWeg[0].at(-1) === 'm-chats-item' && tipps.length === 0, [fOhne?.message, ohneWeg, tipps])
  // Pruefung iOS Paket 17, F-R11: der oberste Chat hat keinen Codeblock. Der Weg sucht in der Liste weiter.
  const fr11 = []
  const fr11Weg = (mitHakenId, mitBlock) => ({
    hat: async () => !!mitHakenId,
    rufe: async () => ({ ok: true, id: mitHakenId }),
    gehe: async (_d, weg, o) => void fr11.push([weg.at(-1) ?? null, /data-m-id="([^"]+)"/.exec(o?.ersatz?.['m-chats-item'] ?? '')?.[1] ?? null]),
    da: async () => mitBlock.includes(fr11.at(-1)?.[1]),
    kennungen: async () => ['c-1', 'c-2', 'c-3', 'c-2'],
  })
  await geheVorbereitetenWeg(dWeg, WEGE[VR], VORBEREITUNG[VR], fr11Weg(null, ['c-3']))
  const fr11Ohne = fr11.splice(0)
  const fr11Tipps = tipps.splice(0)
  ok('f-r11', 'ohne Testhaken: c-1 und c-2 ohne Codeblock, c-3 mit, dort wird "Preview" getippt', JSON.stringify(fr11Ohne.map((g) => g[1])) === JSON.stringify([null, 'c-1', 'c-2', 'c-3']) && fr11Tipps.length === 1 && /m-chat-code-preview/.test(fr11Tipps[0]), [fr11Ohne, fr11Tipps])
  await geheVorbereitetenWeg(dWeg, WEGE[VR], VORBEREITUNG[VR], fr11Weg('c-7', ['c-2']))
  const fr11Mit = fr11.splice(0)
  tipps.splice(0)
  ok('f-r11', 'mit Testhaken: der abgelegte Chat zuerst; zeigt er keinen Codeblock, geht die Suche in der Liste weiter', JSON.stringify(fr11Mit.map((g) => g[1])) === JSON.stringify([null, 'c-7', 'c-1', 'c-2']), fr11Mit)
  const fr11Keiner = await wirft(() => geheVorbereitetenWeg(dWeg, WEGE[VR], VORBEREITUNG[VR], fr11Weg(null, [])), HakenFehlt)
  const fr11KeinerWege = fr11.splice(0)
  ok('f-r11', 'keiner der Chats hat einen Codeblock: nicht herstellbar mit Zahl der angesehenen Chats, kein Tipp ins Leere, keine Kennung doppelt', !!fr11Keiner && /3 Eintrag/.test(fr11Keiner.message) && tipps.length === 0 && fr11KeinerWege.length === 4, [fr11Keiner?.message, fr11KeinerWege])
  ok('f-r11', 'die Seitenvorschau sucht, die anderen Chat-Unterseiten bleiben beim abgelegten Chat', VORBEREITUNG[VR].suche > 1 && Object.entries(VORBEREITUNG).every(([r, v]) => r === VR || !v.suche))
  await geheVorbereitetenWeg(dWeg, WEGE['/chat/:id/compare'], VORBEREITUNG['/chat/:id/compare'], spielWeg(false, false))
  const ohneHakenGanz = gegangen.pop()
  await geheVorbereitetenWeg(dWeg, WEGE['/chat/:id/compare'], VORBEREITUNG['/chat/:id/compare'], spielWeg(true, false))
  const mitHakenGanz = gegangen.pop()
  ok(H, 'Chat-Unterseiten: mit Testhaken ueber den abgelegten Chat, ohne Haken der alte Weg ueber den obersten Chat', ohneHakenGanz[0] === WEGE['/chat/:id/compare'] && ohneHakenGanz[1] === null && /c-7/.test(mitHakenGanz[1]?.['m-chats-item'] ?? ''), [ohneHakenGanz, mitHakenGanz])
  ok(H, 'Sperrliste: "Preview" am HTML-Block ist frei, die Vorschau in Create bleibt bezahlt, data-m-risk geht immer vor', sperrGrund({ testid: 'm-chat-code-preview', name: 'Preview' }) === null && sperrGrund({ testid: 'm-create-preview', name: 'Preview' })?.art === 'paid' && sperrGrund({ testid: 'm-chat-code-preview', risiko: 'paid' })?.art === 'paid')
  // H8 der zweiten Gegenpruefung: auf der Seitenvorschau ist "preview" der Name der Seite
  ok(H, 'Sperrliste H8: Reload, Phone und Wide der Seitenvorschau sind frei, ein Wort der Liste dahinter sperrt weiter, die Marke geht vor', ['m-preview-reload', 'm-preview-phone', 'm-preview-wide', 'm-preview-close'].every((testid) => sperrGrund({ testid, name: 'x' }) === null) && sperrGrund({ testid: 'm-preview-send', name: 'x' })?.art === 'paid' && sperrGrund({ testid: 'm-preview-delete', name: 'x' })?.art === 'destructive' && sperrGrund({ testid: 'm-preview-reload', name: 'Reload', risiko: 'paid' })?.art === 'paid' && sperrGrund({ testid: 'm-settings-voice-preview-anna', name: 'x' })?.art === 'paid' && sperrGrund({ testid: 'm-preview', name: 'x' })?.art === 'paid')
  // Risikomarken (Runde 6, reste.md Punkt 3): leaves-app und sensor sperren und heissen im Bericht wie am Element
  const gLink = sperrGrund({ testid: 'm-settings-about-website', name: 'Website', risiko: 'leaves-app' })
  const gKamera = sperrGrund({ testid: 'm-chat-attach-photo', name: 'Take a photo', risiko: 'sensor' })
  const gFremd = sperrGrund({ testid: 'm-settings-about-website', name: 'Website', risiko: 'etwas-neues' })
  ok(H, 'Risikomarke: leaves-app und sensor sperren unter ihrem eigenen Namen, paid und destructive wie bisher, eine unbekannte Marke sperrt als destructive', gLink?.art === 'leaves-app' && gLink.grund === 'data-m-risk="leaves-app"' && gKamera?.art === 'sensor' && sperrGrund({ testid: 'm-x', risiko: 'paid' })?.art === 'paid' && sperrGrund({ testid: 'm-x', risiko: 'destructive' })?.art === 'destructive' && gFremd?.art === 'destructive' && sperrGrund({ testid: 'm-settings-about-website', name: 'Website' }) === null, [gLink, gKamera, gFremd])
  const kitQuelle = readFileSync(join(REPO, 'src', 'mobile', 'ui', 'common.ts'), 'utf8')
  const kitMarken = [.../RISKS\s*=\s*\[([^\]]*)\]/.exec(kitQuelle)?.[1].matchAll(/'([a-z-]+)'/g) ?? []].map((m) => m[1])
  ok(H, 'Risikomarke: der Rahmen kennt genau die Marken des UI-Kits (src/mobile/ui/common.ts, RISKS)', kitMarken.length > 0 && JSON.stringify([...kitMarken].sort()) === JSON.stringify([...RISIKO_MARKEN].sort()), [kitMarken, RISIKO_MARKEN])
  const scanQuelle = readFileSync(join(RAHMEN, 'tabelle', 'scan.mjs'), 'utf8')
  const scanMarken = /risk\)=\["'\]\(([a-z|-]+)\)/.exec(scanQuelle)?.[1].split('|') ?? []
  ok(H, 'Risikomarke: der Scan der Tabelle liest jede Marke aus den Quellen', JSON.stringify([...scanMarken].sort()) === JSON.stringify([...RISIKO_MARKEN].sort()), [scanMarken, RISIKO_MARKEN])
  const uebersprungen = [
    { schluessel: 'm-settings-about-website', klasse: 'uebersprungen', grund: `gesperrt (${gLink.art}): ${gLink.grund}` },
    { schluessel: 'm-chat-attach-photo', klasse: 'uebersprungen', grund: `gesperrt (${gKamera.art}): ${gKamera.grund}` },
    { schluessel: 'm-account-buy', klasse: 'uebersprungen', grund: 'gesperrt (paid): data-m-risk="paid"' },
    { schluessel: 'm-settings-about-source', klasse: 'uebersprungen', grund: `gesperrt (${gLink.art}): ${gLink.grund}` },
    { schluessel: 'm-irgendwas', klasse: 'uebersprungen', grund: 'gesperrt (zweite Pruefung)' },
  ]
  const nachArt = gesperrteNachArt(uebersprungen)
  ok(H, 'Risikomarke: der Bericht fuehrt die gesperrten Elemente je Marke, kein Link und keine Kamera steht unter destructive', JSON.stringify(nachArt) === JSON.stringify([['paid', ['m-account-buy']], ['leaves-app', ['m-settings-about-website', 'm-settings-about-source']], ['sensor', ['m-chat-attach-photo']], ['ohne Angabe', ['m-irgendwas']]]) && artDesGesperrten({ art: 'sensor', grund: 'gesperrt (paid): x' }) === 'sensor', nachArt)
  const berichtQuelle = readFileSync(join(RAHMEN, 'report.mjs'), 'utf8')
  ok(H, 'Risikomarke: sweep.mjs schreibt die Art in einzelnTesten, report.mjs liest sie ueber gesperrteNachArt', /einzelnTesten:[^\n]*art: artDesGesperrten\(x\)/.test(sweepQuelle) && /gesperrteNachArt\(j\.einzelnTesten\)/.test(berichtQuelle))
  // H2 der Gegenpruefung am grossen iPhone: eine kopierte Appium-Einrichtung zeigt auf den Arbeitsbaum, aus dem sie kam
  const { richteInstallPfade, richteVerzeichnis, VERZEICHNIS } = await import('./appium-pfad.mjs')
  const HOME_NEU = '/wt/neu/mobile-tests/.werkzeug/appium/.appium'
  const apYaml = (pfad) => `drivers:\n  xcuitest:\n    pkgName: appium-xcuitest-driver\n    version: 12.16.0\n    installType: npm\n    installPath: ${pfad}\n    automationName: XCUITest\nplugins: {}\n`
  const apFremd = apYaml('/wt/alt/mobile-tests/.werkzeug/appium/.appium/node_modules/appium-xcuitest-driver')
  const apGerichtet = richteInstallPfade(apFremd, HOME_NEU, () => true)
  ok(H, 'H2: der Treiberpfad einer kopierten Appium-Einrichtung wird auf den eigenen Ordner gestellt, alles andere bleibt Zeichen fuer Zeichen', apGerichtet.text === apYaml(`${HOME_NEU}/node_modules/appium-xcuitest-driver`) && apGerichtet.umgestellt.length === 1 && apGerichtet.fehlt.length === 0, apGerichtet)
  const apEigen = richteInstallPfade(apGerichtet.text, HOME_NEU, () => true)
  ok(H, 'H2: ein Pfad im eigenen Ordner bleibt, auch beim zweiten Lauf, und ein Nachbarordner mit gleichem Anfang gilt nicht als der eigene', apEigen.text === apGerichtet.text && apEigen.umgestellt.length === 0 && richteInstallPfade(apYaml(`${HOME_NEU}-alt/node_modules/appium-xcuitest-driver`), HOME_NEU, () => true).umgestellt.length === 1)
  const apOhneTreiber = richteInstallPfade(apFremd, HOME_NEU, () => false)
  ok(H, 'H2: liegt der Treiber im eigenen Ordner nicht, wird nichts umgestellt und der Treiber als fehlend gemeldet', apOhneTreiber.text === apFremd && apOhneTreiber.fehlt[0]?.name === 'appium-xcuitest-driver' && apOhneTreiber.umgestellt.length === 0, apOhneTreiber)
  const apGeschrieben = []
  const apRDatei = richteVerzeichnis(HOME_NEU, { lies: () => apFremd, schreib: (d, t) => void apGeschrieben.push([d, t]), gibtEs: () => true })
  const apROhne = richteVerzeichnis(HOME_NEU, { lies: () => { throw new Error('nicht lesen') }, schreib: () => { throw new Error('nicht schreiben') }, gibtEs: () => false })
  ok(H, 'H2: geschrieben wird genau das Verzeichnis der Erweiterungen, und nur wenn sich etwas aendert. Ohne Verzeichnis passiert nichts', apGeschrieben.length === 1 && apGeschrieben[0][0] === join(HOME_NEU, VERZEICHNIS) && apRDatei.umgestellt.length === 1 && apROhne.da === false)
  const appiumSh = readFileSync(join(RAHMEN, 'ios', 'appium.sh'), 'utf8')
  ok(H, 'H2: appium.sh stellt die Pfade vor der Frage nach dem installierten Treiber', appiumSh.indexOf('richte_pfade\n  npx appium driver list') > 0 && /appium-pfad\.mjs" richte "\$APPIUM_HOME"/.test(appiumSh))

  // H1 der Gegenpruefung am grossen iPhone: am App-Store-Paket gibt es den Umschalter der Chatliste nicht
  const { geheWeg } = await import('../config.mjs')
  const CHATWEGE = ['/chats', '/chat/:id', '/chat/:id/compare', '/chat/:id/tasks', '/chat/:id/documents', '/chat/:id/group', VR]
  const gang = async (route, umschalterDa) => {
    const tipps2 = []
    await geheWeg({}, WEGE[route], { zu: async () => {}, tippe: async (_d, sel) => void tipps2.push(sel), da: async (_d, sel) => (/m-chats-segment-phone/.test(sel) ? umschalterDa : true) })
    return tipps2
  }
  const ohneUmschalter = Object.fromEntries(await Promise.all(CHATWEGE.map(async (r) => [r, await gang(r, false)])))
  const mitUmschalter = Object.fromEntries(await Promise.all(CHATWEGE.map(async (r) => [r, await gang(r, true)])))
  ok(H, 'H1: ohne den Umschalter der Chatliste (App-Store-Paket) gehen die Chat-Wege ohne ihn weiter, kein Tipp auf eine Kennung, die es nicht gibt', CHATWEGE.every((r) => !ohneUmschalter[r].some((s) => /m-chats-segment/.test(s)) && ohneUmschalter[r].length === WEGE[r].length - 2) && /m-chat-menu-documents/.test(ohneUmschalter['/chat/:id/documents'].at(-1)), ohneUmschalter)
  ok(H, 'H1: mit dem Umschalter (offenes Paket) wird er als Erstes getippt, der Rest des Wegs ist derselbe', CHATWEGE.every((r) => /m-chats-segment-phone/.test(mitUmschalter[r][0]) && JSON.stringify(mitUmschalter[r].slice(1)) === JSON.stringify(ohneUmschalter[r])), mitUmschalter)
  ok(H, 'H1: wahlfrei ist nur der Umschalter zum Handy (und die Katalogkarte am Ende von /models/:id). Die Wege nach /remote/* tippen ihren Umschalter fest', Object.values(WEGE).flatMap((w) => w.slice(1)).filter((s) => s && typeof s === 'object' && !Array.isArray(s)).every((s) => istBewusst(s) || (istWahlfrei(s) && (s.fallsDa === 'm-chats-segment-phone' || s.fallsDa === 'm-models-item-open'))) && Object.values(WEGE).flatMap((w) => w.slice(1)).filter(istWahlfrei).length > 0 && WEGE['/remote/connect'][1] === 'm-chats-segment-remote')

  // Gesperrte Knoepfe in Tippwegen: nur als bewusster Schritt mit Grund (tabelle/wege.mjs, wegSperrFehler)
  const SPERRE = (id) => (id === 'm-x-kamera' ? 'data-m-risk="sensor"' : null)
  const GRUND = 'einziger Eingang der Seite, es wird nichts aufgenommen'
  const regel = (weg) => wegSperrFehler({ '/x': weg }, SPERRE)
  ok(H, 'Tippweg: ein gesperrter Knopf als gewoehnlicher Schritt ist ein Fehler, auch in einer Liste und als wahlfreier Schritt', regel(['chat', 'm-x-kamera']).length === 1 && regel(['chat', ['m-x-frei', 'm-x-kamera']]).length === 1 && regel(['chat', { fallsDa: 'm-x-kamera' }]).length === 1, [regel(['chat', 'm-x-kamera'])])
  ok(H, 'Tippweg: derselbe Knopf als bewusster Schritt mit Grund ist kein Fehler, ein freier Weg auch nicht', regel(['chat', 'm-x-frei', { bewusst: 'm-x-kamera', grund: GRUND }]).length === 0 && regel(['chat', 'm-x-frei']).length === 0)
  ok(H, 'Tippweg: bewusst ohne Grund ist ein Fehler, bewusst auf einem Knopf ohne Sperre auch', regel(['chat', { bewusst: 'm-x-kamera' }]).length === 1 && regel(['chat', { bewusst: 'm-x-kamera', grund: 'kurz' }]).length === 1 && regel(['chat', { bewusst: 'm-x-frei', grund: GRUND }]).length === 1)
  const bewusste = [...Object.entries(WEGE), ...Object.entries(BLATT_WEGE)].flatMap(([ziel, w]) => w.slice(1).filter(istBewusst).map((s) => [ziel, s.bewusst]))
  ok(H, 'Tippweg: bewusst getippt wird genau ein Knopf, der Sucher der Kopplung auf dem Weg nach /remote/scan', JSON.stringify(bewusste) === JSON.stringify([['/remote/scan', 'm-remote-connect-scan']]), bewusste)
  const scanTipps = []
  await geheWeg({}, WEGE['/remote/scan'], { zu: async () => {}, tippe: async (_d, sel) => void scanTipps.push(sel), da: async () => true })
  ok(H, 'Tippweg: der bewusste Schritt wird als letzter getippt, mit seiner Kennung', scanTipps.length === 3 && /"m-remote-connect-scan"/.test(scanTipps.at(-1)), scanTipps)
  // Zweite Gegenpruefung Android 8 GB: /models/:id war am Play-Paket nicht herstellbar ("nichts gefunden")
  const gangModell = async (zeigt) => {
    const t = []
    await geheWeg({}, WEGE['/models/:id'], { zu: async () => {}, tippe: async (_d, sel) => void t.push(sel), da: async () => zeigt })
    return t
  }
  const mitInstalliertem = await gangModell(false)
  const ohneInstalliertes = await gangModell(true)
  ok(H, '/models/:id: der Weg geht ueber "Installed" (kein Netz, kein Suchtext, kein Filter) und tippt die Katalogkarte nur nach dem Leerzustand', /m-models-segment-installed/.test(mitInstalliertem[0]) && /m-models-item-open.*m-models-empty-getnew/.test(mitInstalliertem[1]) && mitInstalliertem.length === 2 && ohneInstalliertes.length === 3 && /m-models-item-open/.test(ohneInstalliertes[2]), [mitInstalliertem, ohneInstalliertes])
  const { tippeStill, sichtbareKennungen } = await import('../config.mjs')
  const dLeer = { tap: async () => { throw new Error('tap: nichts gefunden') }, sleep: async () => {}, evalJs: async () => null, evalFn: async (fn) => (fn === sichtbareKennungen ? ['m-screen-models', 'm-models-search', 'm-models-search-empty'] : { da: 0, sichtbar: 0 }) }
  const fWeg = await wirft(() => tippeStill(dLeer, '[data-testid="m-models-item-open"]', { geduldMs: 800 }), Error)
  let getippt = 0
  await tippeStill({ tap: async () => void getippt++, sleep: async () => {}, evalJs: async () => '1,2,3,4', evalFn: async () => ({ ruhig: true }), waitFor: async () => true }, '[data-testid="m-x"]')
  ok(H, 'Tippweg: fehlt das Ziel, nennt der Fehler, was die Seite stattdessen zeigt. Steht es da, wird getippt', /nicht zu sehen/.test(fWeg?.message ?? '') && /m-models-search-empty/.test(fWeg?.message ?? '') && getippt === 1, fWeg?.message)
  ok(H, 'die vier Chat-Unterseiten der Nachabnahme haben einen Tippweg', ['/chat/:id/compare', '/chat/:id/tasks', '/chat/:id/group', VR].every((r) => Array.isArray(WEGE[r]) && !OHNE_WEG[r]))

  // Quelltext: keine Namensmuster zum Beenden, kein Geraetestart an der Grenze vorbei
  // Release-Pruefung, Repo: ein Testwert hinter der Kopfzeile ist kein Schluessel, ein echter Schluessel bleibt ein Fund.
  // Die Kopfzeile steht hier in zwei Teilen und die Schluessel entstehen zur Laufzeit, damit diese Datei selbst kein Fund ist.
  // ---------- Nachpruefung Android 8 GB (Runde 9), Funde am Rahmen H1 bis H7 ----------
  const N = 'nachpruefung-android'
  // H1: Zaehler, Regler und Schalter im Blatt. Der echte Lauf an einer Seite steht in trocken/rahmen.mjs.
  ok(N, 'H1: ein Zaehler, der nach dem Tipp anders steht, gilt als verstellt und als Wirkung', standGeaendert({ art: 'zahl', selbst: '4' }, { art: 'zahl', selbst: '3' }) && !standGeaendert({ art: 'zahl', selbst: '4' }, { art: 'zahl', selbst: '4' }) && !standGeaendert(null, { selbst: '1' }) && belegeAus({ schaltVor: { art: 'zahl', selbst: '4' }, schaltNach: { art: 'zahl', selbst: '3' } }).includes('schaltzustand'))
  ok(N, 'H1: liegt nach dem Tipp nur, was schon davor da lag (das Blatt des Elements), wird vor dem Schliessen zurueckgestellt', nurWasSchonDaWar({ route: '/chat/:id', blaetter: ['chat-options'], rueckfrage: [] }, { route: '/chat/:id', blaetter: ['chat-options'], rueckfrage: [] }) && !nurWasSchonDaWar({ route: '/a', blaetter: [], rueckfrage: [] }, { route: '/a', blaetter: [], rueckfrage: ['m-dialog-x'] }) && !nurWasSchonDaWar({ route: '/a', blaetter: [] }, { route: '/b', blaetter: [] }))
  const zahlTreiber = (nachSetzen) => {
    const z = { stand: '1', gesetzt: [], tipps: 0 }
    return { z, d: { sleep: async () => {}, tap: async () => void z.tipps++, evalFn: async (fn, arg) => (fn.name === 'stelleZahl' ? (z.gesetzt.push(arg), (z.stand = nachSetzen(arg.wert))) : { art: 'zahl', selbst: z.stand, wert: z.stand }) } }
  }
  // Zweite Gegenpruefung Android 8 GB: der Reiter "Remote desktop" und das zuletzt getippte Chatmodell blieben stehen.
  // Gespielte Seite: eine Wahl ueber Kennung (und data-m-id), die Marke des Inventars ist nach dem Tipp weg.
  const wahlSeite = ({ gewaehlt, blatt = false, taub = false }) => {
    const z = { gewaehlt, offen: !blatt, tipps: [], geoeffnet: 0, geschlossen: 0 }
    const d = {
      sleep: async () => {},
      evalJs: async () => '1,2,3,4',
      tap: async (sel) => {
        if (!z.offen) throw new Error(`tap: nichts gefunden fuer "${sel}"`)
        z.tipps.push(sel)
        if (!taub) z.gewaehlt = sel
        if (blatt) z.offen = false
      },
      // schaltZustand ueber die Marke: das Element ist weg. wahlStand: was die gespielte Seite zeigt.
      evalFn: async (fn, arg) => (fn.name === 'wahlStand' ? { sichtbar: z.offen, an: z.offen && z.gewaehlt === arg } : fn.name === 'schaltZustand' ? null : { dialog: [], blaetter: [] }),
    }
    return { z, d, oeffne: async () => void ((z.offen = true), z.geoeffnet++) }
  }
  const vorReiter = { art: 'wahl', selbst: false, gewaehlt: '3', gewaehltKennung: 'm-chats-segment-phone', gewaehltId: null }
  const selReiter = wahlSelektor(vorReiter)
  const reiter = wahlSeite({ gewaehlt: '[data-testid="m-chats-segment-remote"]' })
  const rReiter = await stelleZurueck(reiter.d, { idx: 9 }, vorReiter, {})
  const vorModell = { art: 'wahl', selbst: false, gewaehlt: '4', gewaehltKennung: 'm-chat-model-local', gewaehltId: 'Qwen3.5-2B-Q4_K_M.gguf' }
  const selModell = wahlSelektor(vorModell)
  const modell = wahlSeite({ gewaehlt: '[data-testid="m-chat-model-local"][data-m-id="gemma-3-1b-it-Q4_K_M.gguf"]', blatt: true })
  const rModell = await stelleZurueck(modell.d, { idx: 9 }, vorModell, { oeffne: modell.oeffne })
  const wahlOhneWeg = wahlSeite({ gewaehlt: 'x', blatt: true })
  const rOhneWeg = await stelleZurueck(wahlOhneWeg.d, { idx: 9 }, vorModell, {})
  const taub = wahlSeite({ gewaehlt: 'x', taub: true })
  const rTaub = await stelleWahlUeberKennung(taub.d, vorReiter, {})
  const rGesperrt = await stelleWahlUeberKennung(wahlSeite({ gewaehlt: 'x' }).d, { art: 'wahl', selbst: false, gewaehltKennung: 'm-x-delete' }, {})
  ok(N, 'Sweep stellt zurueck: der Umschalter der Chatliste, dessen Marke nach dem Tipp weg ist, wird ueber seine Kennung zurueckgetippt', rReiter.ok === true && reiter.z.tipps.length === 1 && reiter.z.tipps[0] === selReiter && selReiter === '[data-testid="m-chats-segment-phone"]', [rReiter, reiter.z])
  ok(N, 'Sweep stellt zurueck: das Chatmodell, dessen Blatt sich mit der Wahl schliesst, wird nach dem Neuoeffnen ueber Kennung und data-m-id zurueckgetippt und nachgelesen', rModell.ok === true && modell.z.geoeffnet === 2 && modell.z.tipps.length === 1 && modell.z.tipps[0] === selModell && /\[data-m-id="Qwen3\.5-2B-Q4_K_M\.gguf"\]$/.test(selModell), [rModell, modell.z, selModell])
  ok(N, 'Sweep stellt zurueck: ohne Weg zum Neuoeffnen, bei einem tauben Tipp und ueber ein gesperrtes Ziel bleibt es ehrlich "nicht zurueckgestellt"', rOhneWeg.ok === false && /nicht mehr auf der Seite/.test(rOhneWeg.grund) && wahlOhneWeg.z.tipps.length === 0 && rTaub.ok === false && /nicht wiederhergestellt/.test(rTaub.grund) && rGesperrt.ok === false && /gesperrt/.test(rGesperrt.grund), [rOhneWeg, rTaub, rGesperrt])
  ok(N, 'Sweep stellt zurueck: eine Wahl, die nach dem Tipp weg ist, gilt als verstellt. Ein Schalter, eine schon gewaehlte Wahl und eine Wahl ohne Vorgaenger nicht', wahlIstWeg(vorReiter, null) && !wahlIstWeg(vorReiter, { selbst: true }) && !wahlIstWeg({ art: 'schalter', selbst: false }, null) && !wahlIstWeg({ ...vorReiter, selbst: true }, null) && !wahlIstWeg({ art: 'wahl', selbst: false, gewaehltKennung: null }, null) && wahlSelektor({ gewaehltKennung: 'm-a', gewaehltId: 'a"b' }) === '[data-testid="m-a"][data-m-id="a\\"b"]')
  // Gegenpruefung 4 Android, A 23: drei Arten, die unter "verstellt" stehen blieben.
  // 1 Das Chatmodell steht erst nach einigen Sekunden an (die Engine nimmt es an).
  const spaet = { tipps: [], gelesen: 0 }
  const dSpaet = { sleep: async () => {}, tap: async (sel) => void spaet.tipps.push(sel), evalFn: async (fn) => (fn.name === 'wahlStand' ? { sichtbar: true, an: spaet.tipps.length > 0 && ++spaet.gelesen > 4 } : null) }
  const rSpaet = await stelleWahlUeberKennung(dSpaet, vorModell, {})
  ok(N, 'A 23: eine Wahl, die erst nach Sekunden ansteht (Chatmodell), wird nachgelesen statt "nicht wiederhergestellt" gemeldet', rSpaet.ok === true && spaet.tipps.length === 1 && WAHL_RUNDEN >= 10, [rSpaet, spaet])
  // 2 Ein Filter einer Reihe, in der vorher "All" anstand: Der Rueckweg ist der Tipp auf "All".
  const reihe = { an: 'bild', tipps: [] }
  const dReihe = { sleep: async () => {}, tap: async (sel) => { reihe.tipps.push(sel); if (sel === '[data-lu-inv="2"]') reihe.an = 'alle' }, evalFn: async (fn, idx) => (fn.name === 'schaltZustand' ? { art: 'schalter', selbst: String(idx) === '2' ? reihe.an === 'alle' : reihe.an === 'bild' } : { dialog: [], blaetter: [] }) }
  const rReihe = await stelleZurueck(dReihe, { idx: 5, testid: 'm-create-gallery-filter-image' }, { art: 'schalter', selbst: false, inReihe: true, reiheAn: { idx: '2', testid: 'm-create-gallery-filter-all' } }, {})
  ok(N, 'A 23: ein Filter der Galerie wird ueber den zurueckgestellt, der vorher anstand, nicht ueber einen zweiten Tipp auf sich selbst', rReihe.ok === true && reihe.tipps.join() === '[data-lu-inv="2"]', [rReihe, reihe])
  // Pruefung iOS Paket 11, F-R3: unabhaengige Filter (Models). "Fits this phone" stand an, der Tipp schaltet "Mainstream"
  // dazu. Zurueck ist ein zweiter Tipp auf "Mainstream", nicht der Tipp auf "Fits this phone".
  const filter = { an: new Set(['1']), tipps: [] }
  const dFilter = { sleep: async () => {}, tap: async (sel) => { filter.tipps.push(sel); const i = /"(\d+)"/.exec(sel)[1]; if (filter.an.has(i)) filter.an.delete(i); else filter.an.add(i) }, evalFn: async (fn, idx) => (fn.name === 'schaltZustand' ? { art: 'schalter', selbst: filter.an.has(String(idx)) } : { dialog: [], blaetter: [] }) }
  filter.an.add('4')
  const rFilter = await stelleZurueck(dFilter, { idx: 4, testid: 'm-models-filter-mainstream' }, { art: 'schalter', selbst: false, inReihe: true, reiheAn: { idx: '1', testid: 'm-models-filter-fits' } }, {})
  ok(N, 'F-R3: ein unabhaengiger Filter (Models) wird ueber einen zweiten Tipp auf sich selbst zurueckgestellt, der Filter, der vorher anstand, bleibt an', rFilter.ok === true && filter.tipps.join() === '[data-lu-inv="4"]' && filter.an.has('1') && !filter.an.has('4'), [rFilter, filter.tipps, [...filter.an]])
  // 3 Eine Wahl ohne Vorgaenger in einem Blatt: nach dem Neuoeffnen steht nichts an, also ist nichts verstellt.
  const frisch = { geoeffnet: 0 }
  const dFrisch = (bleibt) => ({ sleep: async () => {}, evalJs: async () => '1', evalFn: async (fn) => (fn.name === 'wahlFrei' ? { sichtbar: true, irgendAn: bleibt } : fn.name === 'schaltZustand' ? null : { dialog: [], blaetter: [] }) })
  const vorOhne = { art: 'wahl', selbst: false, gewaehlt: null, gewaehltKennung: null, gewaehltId: null }
  const rFrisch = await stelleZurueck(dFrisch(false), { idx: 3, testid: 'm-report-reason-hate' }, vorOhne, { oeffne: async () => void frisch.geoeffnet++ })
  const rBleibt = await stelleZurueck(dFrisch(true), { idx: 3, testid: 'm-report-reason-hate' }, vorOhne, { oeffne: async () => {} })
  const rOhneOeffnen = await pruefeFrischNachNeuoeffnen(dFrisch(false), { testid: 'm-report-reason-hate' }, { grund: 'x' })
  ok(N, 'A 23: eine Wahl ohne Vorgaenger (Grund im Blatt "report") gilt nur als verstellt, wenn sie nach dem Neuoeffnen noch ansteht', rFrisch.ok === true && frisch.geoeffnet === 1 && rBleibt.ok === false && /steht auch nach dem Neuoeffnen noch an/.test(rBleibt.grund) && rOhneOeffnen.ok === false, [rFrisch, rBleibt, rOhneOeffnen])
  ok(N, 'A 23: die vorherige Wahl wird nie in einer Gruppe der Seite unter einem Blatt gesucht, und eine Filterreihe nennt den, der vorher anstand', /filter\(\(g\) => g !== gruppe && !g\.closest\('\[inert\]'\)\)/.test(readFileSync(join(RAHMEN, 'lib', 'seite.mjs'), 'utf8')) && /reiheAn = gedrueckt\.length > 1 && !an\(el\) && andere\.length === 1/.test(readFileSync(join(RAHMEN, 'lib', 'seite.mjs'), 'utf8')))
  const zGut = zahlTreiber((w) => w)
  const rGut = await stelleZurueck(zGut.d, { idx: 7 }, { art: 'zahl', selbst: '4', wert: '4' })
  const zFest = zahlTreiber(() => '1')
  const rFest = await stelleZurueck(zFest.d, { idx: 7 }, { art: 'zahl', selbst: '4', wert: '4' })
  ok(N, 'H1: "Threads" wird auf den alten Wert geschrieben, ohne Tipp, und was sich nicht zurueckstellen laesst, nennt seinen Grund fuer die Liste "verstellt"', rGut.ok === true && zGut.z.gesetzt[0]?.wert === '4' && zGut.z.gesetzt[0].idx === 7 && zGut.z.tipps === 0 && rFest.ok === false && /steht auf 1 statt auf 4/.test(rFest.grund), [rGut, rFest])
  // H5: Die Dateiauswahl blaettert, und sie bleibt nicht offen, wenn die Datei fehlt.
  const groesse = leseAndroidGroesse('Physical size: 1080x2400\nOverride size: 720x1600\n')
  ok(N, 'H5: wm size, die eingestellte Groesse gilt, ohne Groesse null', groesse?.breite === 720 && groesse.hoehe === 1600 && leseAndroidGroesse('Physical size: 1080x2400')?.hoehe === 2400 && leseAndroidGroesse('') === null)
  const liste = (namen) => namen.map((t, i) => ({ text: t, beschreibung: '', id: 'android:id/title', x: 500, y: 400 + i * 200 }))
  const seiten = [liste(['a.txt', 'b.txt', 'c.txt']), liste(['c.txt', 'd.txt', 'e.txt']), liste(['e.txt', 'lu-test.txt'])]
  const picker = (folge) => {
    const z = { befehle: [], seite: 0 }
    return { z, d: { plattform: 'android', sleep: async () => {}, shell: async (c) => { z.befehle.push(c); if (/^input swipe/.test(c)) z.seite = Math.min(z.seite + 1, folge.length - 1); return /^wm size/.test(c) ? 'Physical size: 1080x2400' : '' } }, lies: async () => folge[z.seite] }
  }
  const p1 = picker(seiten)
  const gefunden = await blaettereZurAndroidDatei(p1.d, 'lu-test.txt', { lies: p1.lies })
  const wische = p1.z.befehle.filter((c) => /^input swipe/.test(c))
  ok(N, 'H5: die Dateiauswahl blaettert, bis die Datei zu sehen ist, und tippt ihren Titel', gefunden?.geblaettert === 2 && wische.length === 2 && wische[0] === 'input swipe 540 1728 540 816 350' && p1.z.befehle.at(-1) === 'input tap 500 600', [gefunden, p1.z.befehle])
  const p2 = picker(seiten.slice(0, 2))
  const nichtDa = await blaettereZurAndroidDatei(p2.d, 'lu-test.txt', { lies: p2.lies })
  ok(N, 'H5: am Ende der Liste hoert das Blaettern auf (zweimal dasselbe Bild), ohne zu tippen', nichtDa === null && p2.z.befehle.filter((c) => /^input swipe/.test(c)).length === 2 && !p2.z.befehle.some((c) => /^input tap/.test(c)), p2.z.befehle)
  // Gegenpruefung 4 Android, A 24: Die Auswahl stand nicht am Anfang, die Datei lag ueber dem sichtbaren Teil.
  const rueck = [liste(['x.txt', 'y.txt']), liste(['lu-test.txt', 'x.txt'])]
  const p3 = picker(rueck)
  const obenGefunden = await blaettereZurAndroidDatei(p3.d, 'lu-test.txt', { lies: p3.lies, richtung: 'hoch' })
  ok(N, 'A 24: das Blaettern geht auch zum Anfang der Liste (Wisch von oben nach unten) und tippt die Datei', obenGefunden?.geblaettert === 1 && p3.z.befehle.find((c) => /^input swipe/.test(c)) === 'input swipe 540 816 540 1728 350' && p3.z.befehle.at(-1) === 'input tap 500 400', p3.z.befehle)
  // Ein Treffer unter der Navigationsleiste wird nicht getippt, erst nach einem Stueck weiter.
  const amRand = [liste(['a.txt']), [{ text: 'lu-test.txt', beschreibung: '', id: 'android:id/title', x: 500, y: 2330 }], [{ text: 'lu-test.txt', beschreibung: '', id: 'android:id/title', x: 500, y: 1850 }]]
  const p4 = picker(amRand)
  const randGefunden = await blaettereZurAndroidDatei(p4.d, 'lu-test.txt', { lies: p4.lies })
  ok(N, 'A 24: ein Treffer am unteren Rand wird erst getippt, wenn er im Bild liegt', !!randGefunden && p4.z.befehle.filter((c) => /^input tap/.test(c)).join() === 'input tap 500 1850', p4.z.befehle)
  // Die Suche ohne Treffer bleibt nicht offen.
  const sucheOffen = { befehle: [] }
  const dSuche = { plattform: 'android', sleep: async () => {}, shell: async (c) => { sucheOffen.befehle.push(c); return /^wm size/.test(c) ? 'Physical size: 720x1280' : '' } }
  const zeitSuche = Date.now
  let ohneTreffer
  try {
    let jetzt = zeitSuche()
    Date.now = () => (jetzt += 3000)
    ohneTreffer = await sucheAndroidDatei(dSuche, 'lu-test.txt', { lies: async () => [{ text: '', beschreibung: '', id: 'com.google.android.documentsui:id/search_src_text', x: 300, y: 90 }] })
  } finally {
    Date.now = zeitSuche
  }
  ok(N, 'A 24: die Suche der Auswahl schickt die Eingabetaste und geht ohne Treffer wieder zu (Zurueck nur mit offenem Suchfeld)', ohneTreffer === null && sucheOffen.befehle.includes('input keyevent 66') && sucheOffen.befehle.at(-1) === 'input keyevent 4', sucheOffen.befehle)
  // waehleDatei als Ganzes: Die Datei gibt es nicht. Die Auswahl wird mit Zurueck geschlossen, dann erst der Fehler.
  const zw = { zurueck: 0, vorn: false }
  const leer = '<hierarchy><node text="Recent" resource-id="android:id/title" content-desc="" class="x" package="com.google.android.documentsui" clickable="true" bounds="[0,300][1080,400]" /></hierarchy>'
  const dWahl = { plattform: 'android', sleep: async () => {}, shell: async (c) => (/uiautomator dump/.test(c) ? leer : /^wm size/.test(c) ? 'Physical size: 1080x2400' : ''), back: async () => { zw.zurueck++; zw.vorn = true }, foreground: async () => ({ istApp: zw.vorn, fenster: zw.vorn ? 'app' : 'documentsui' }) }
  const echteZeit = Date.now
  let fWahl = null
  try {
    // Die Fristen der Suche laufen ueber Date.now: gespielt, damit die Probe nicht 20 s wartet.
    let jetzt = echteZeit()
    Date.now = () => (jetzt += 2500)
    await waehleDatei(dWahl, 'gibt-es-nicht.txt')
  } catch (err) {
    fWahl = err
  } finally {
    Date.now = echteZeit
  }
  ok(N, 'H5: fehlt die Datei, wird die Auswahl geschlossen, bevor der Schritt scheitert', fWahl instanceof NativFehlt && /nicht gefunden, auch nach dem Blaettern nicht\. Die Auswahl ist geschlossen/.test(fWahl.message) && zw.zurueck === 1, [fWahl?.message, zw])
  // H7: Hintergrundaufgaben mit einem Modell auf dem Handy
  const TR = '/chat/:id/tasks'
  const fTasks = await wirft(() => geheVorbereitetenWeg(dWeg, WEGE[TR], VORBEREITUNG[TR], spielWeg(true, false)), HakenFehlt)
  const wegBisMenue = gegangen.pop()
  await geheVorbereitetenWeg(dWeg, WEGE[TR], VORBEREITUNG[TR], spielWeg(true, true))
  const wegMitEintrag = gegangen.pop()
  ok(N, 'H7: fehlt der Eintrag "Background tasks" (Modell auf dem Handy), ist die Seite nicht herstellbar und nennt den Grund, auch mit Testhaken', !!fTasks && /braucht ein Cloud-Modell/.test(fTasks.message) && !/ohne Testhaken/.test(fTasks.message) && wegBisMenue[0].at(-1) === 'm-chat-menu' && /c-7/.test(wegBisMenue[1]?.['m-chats-item'] ?? ''), [fTasks?.message, wegBisMenue])
  ok(N, 'H7: ist der Eintrag da (Chat mit Aufgaben eines Cloud-Modells), wird er getippt', wegMitEintrag[0].at(-1) === 'm-chat-menu' && tipps.at(-1) === '[data-testid="m-chat-menu-tasks"]', [wegMitEintrag, tipps])
  // H3: die Zurueck-Pruefung hat einen eigenen Aufruf und ein Urteil
  const zUrteil = zurueckUrteil({ routen: [{ route: '/chats', ok: false, appNochVorn: false }, { route: '/settings/about', ok: true, appNochVorn: true }, { route: '/models/engine', ok: false, appNochVorn: false }, { route: '/chat/:id/tasks', ok: false, fehler: 'x', nichtHerstellbar: 'braucht ein Cloud-Modell' }] }, ['/chats', '/models'])
  const zurueckQuelle = readFileSync(join(RAHMEN, 'checks', 'zurueck.mjs'), 'utf8')
  ok(N, 'H3: checks/zurueck.mjs laeuft fuer sich (npm run zurueck). Eine Wurzelseite darf die App verlassen, jede andere Seite nicht', JSON.stringify(zUrteil) === JSON.stringify({ geprueft: 3, fehler: ['/models/engine'], verlassenGewollt: ['/chats'], nichtHerstellbar: ['/chat/:id/tasks'] }) && /istHauptmodul\(import\.meta\.url\)/.test(zurueckQuelle) && JSON.parse(readFileSync(join(RAHMEN, 'package.json'), 'utf8')).scripts.zurueck === 'node checks/zurueck.mjs', zUrteil)
  // H4: die zwei roten Eintraege des Selbsttests am Geraet
  const selbstQuelle = readFileSync(join(RAHMEN, 'selbsttest.mjs'), 'utf8')
  const kostenBlock = selbstQuelle.slice(selbstQuelle.indexOf("await versuch(T, 'Kostenregel'"))
  ok(N, 'H4: die Kostenprobe beginnt in einem leeren Ordner, und von der echten App verlangt der Selbsttest keine zu kleinen Ziele', kostenBlock.indexOf('rmSync(dir, { recursive: true, force: true })') > 0 && kostenBlock.indexOf('rmSync(dir, { recursive: true, force: true })') < kostenBlock.indexOf('kostenwaechter(dir') && !/ok\(T, 'Inventar der echten App meldet zu kleine Touch-Ziele'/.test(selbstQuelle))
  // H2 und H6: am Quelltext, der Lauf dazu steht in trocken/rahmen.mjs bzw. braucht ein Geraet
  const fehlerQuelle = readFileSync(join(RAHMEN, 'flows', 'fehlerfaelle.mjs'), 'utf8')
  ok(N, 'H2: "Download abgebrochen" nimmt beide richtigen Bilder an: die Zeile wartet auf das Netz, oder der Kasten mit "Resume"', /erstesVon\(\{ wartet, kasten \}, 60000\)/.test(fehlerQuelle) && SELEKTOREN.modelle.wartetAufNetz.sel === '[data-testid="m-models-transfer"][data-state="waiting-network"]' && /S\.modelle\.laeuftWieder\), 90000\)/.test(fehlerQuelle))
  const vollBlock = fehlerQuelle.slice(fehlerQuelle.indexOf("await schritt('speicher-voll'"), fehlerQuelle.indexOf('// ---------- 3'))
  ok(N, 'A 25: "Speicher voll" beantwortet die Rueckfrage "passt knapp" und nimmt eine andere Karte, wenn das Fehler-Modell schon installiert ist', /istDa\(S\.modelle\.knapp\)\) await f\.tapBewusst\(S\.rueckfrage\.bestaetigen/.test(vollBlock) && /id = await karteMitDownload\(fehlerModell\)/.test(vollBlock) && /raeumeDownloadAuf\(id\)/.test(vollBlock) && SELEKTOREN.modelle.knapp.sel === '[data-testid="m-dialog-tight-fit"]', vollBlock.length)
  const seiteQuelle = readFileSync(join(RAHMEN, 'lib', 'seite.mjs'), 'utf8')
  const treiberQuellen = ['android', 'ios', 'vorschau'].map((n) => readFileSync(join(RAHMEN, 'driver', `${n}.mjs`), 'utf8'))
  ok(N, 'H6: ein Ziel ausserhalb des Bildes wird von keinem Treiber an den Bildrand getippt', /ausserhalb = true/.test(seiteQuelle) && treiberQuellen.every((q) => /tippVerbot\(p, ziel, /.test(q)) && /ausserhalb des Bildes/.test(tippVerbot({ gefunden: true, ausserhalb: true }, 'm-x') ?? ''))
  // Neustart auf Android (A-28.9: "der Treiber bietet kein reboot()")
  const androidQuelle = treiberQuellen[0]
  const rb = androidQuelle.slice(androidQuelle.indexOf('async reboot('))
  ok(N, 'Android-Treiber: reboot() trennt, startet neu und wartet auf sys.boot_completed und den Paketdienst', androidQuelle.indexOf('async reboot(') > 0 && rb.indexOf('#trenne()') > 0 && rb.indexOf('#trenne()') < rb.indexOf("'reboot']") && rb.indexOf("'reboot']") < rb.indexOf('sys.boot_completed') && rb.indexOf('sys.boot_completed') < rb.indexOf('pm path') && /export const reboot = /.test(androidQuelle))

  const R = 'release-repo'
  const KOPF = (art = '') => `-----BEGIN ${art}PRIVATE` + ' KEY-----'
  const FUSS = (art = '') => `-----END ${art}PRIVATE` + ' KEY-----'
  const urteil = (text) => {
    const zeilen = text.split('\n')
    const i = zeilen.findIndex((z) => z.includes('PRIVATE' + ' KEY-----'))
    return zeileTraegtGeheimnis(zeilen[i], zeilen.slice(i + 1))
  }
  // Wie in src/lib/__tests__/signing-lanes.test.ts des Desktop: Base64 von "not a key" zwischen Kopf und Fuss.
  const testwert = `  const P8 = '${KOPF()}\\nbm90IGEga2V5\\n${FUSS()}'`
  ok(R, 'Schluesselfund: ein Testwert hinter der Kopfzeile ("not a key") ist kein Fund, die Kopfzeile allein auch nicht', !urteil(testwert) && pemMaterial(testwert) === 0 && !urteil(`// sucht nach ${KOPF()} in den verfolgten Dateien`) && !urteil(`const RE = /${KOPF('RSA ')}/\nconst andere = 'abcdefghijklmnopqrstuvwxyz0123456789'`) && !urteil(`${KOPF()}\n<hier den Schluessel einfuegen>\n${FUSS()}`), pemMaterial(testwert))
  const schluessel = {
    'Ed25519 PKCS8': generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
    'X25519 PKCS8': generateKeyPairSync('x25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
    'EC P-256 PKCS8 (.p8)': generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
    'EC P-256 SEC1': generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'sec1', format: 'pem' }),
    'RSA PKCS1': generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }),
    'RSA PKCS1 mit Kennwort': generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'selbsttest' }),
    'PKCS8 mit Kennwort': generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'selbsttest' }),
  }
  const formen = {
    'als Datei': (pem) => pem,
    'als eine Zeichenkette mit \\n': (pem) => `const KEY = ${JSON.stringify(pem)}`,
    'als verkettete Zeichenkette': (pem) => 'const KEY =\n' + pem.trim().split('\n').map((z) => `  '${z}\\n'`).join(' +\n'),
    'eingerueckt in YAML': (pem) => 'key: |\n' + pem.trim().split('\n').map((z) => `    ${z}`).join('\n'),
    'mit Windows-Zeilenenden': (pem) => pem.replace(/\n/g, '\r\n'),
  }
  const verpasst = Object.entries(schluessel).flatMap(([art, pem]) => Object.entries(formen).filter(([, form]) => !urteil(form(pem))).map(([form]) => `${art} ${form}`))
  ok(R, `Schluesselfund: jeder echte Schluessel ist ein Fund (${Object.keys(schluessel).length} Arten, ${Object.keys(formen).length} Schreibweisen), auch der kleinste liegt ueber der Schwelle`, verpasst.length === 0 && /Proc-Type/.test(schluessel['RSA PKCS1 mit Kennwort']) && pemMaterial(...((z) => [z[0], z.slice(1)])(schluessel['Ed25519 PKCS8'].trim().split('\n'))) >= PEM_MINDEST_ZEICHEN, verpasst)
  const SP = 'store' + 'Password'
  const KP = 'key' + 'Password'
  ok(R, 'Keystore-Passwort: ein ausgeschriebener Wert ist ein Fund, Platzhalter und Ausdruecke nicht (wie bisher)', zeileTraegtGeheimnis(`${SP}=hunter22`) && zeileTraegtGeheimnis(`    ${KP} = "geheim-123"`) && !zeileTraegtGeheimnis(`${SP}=`) && !zeileTraegtGeheimnis(`  printf '${SP}=%s\\n' "$PASS"`) && !zeileTraegtGeheimnis(`${KP} = keystoreProperties.getProperty("${KP}")`))
  // Ein eigenes Repo im Zwischenordner: Der Fund haengt am Inhalt, nicht am Ordner.
  const probe = mkdtempSync(join(tmpdir(), 'lu-selbsttest-repo-'))
  let repoFund = null
  try {
    const git = (...args) => spawnSync('git', args, { cwd: probe, encoding: 'utf8' })
    mkdirSync(join(probe, 'src', 'lib', '__tests__'), { recursive: true })
    mkdirSync(join(probe, 'docs'), { recursive: true })
    writeFileSync(join(probe, 'src', 'lib', '__tests__', 'testwert.test.ts'), `${testwert}\n`)
    writeFileSync(join(probe, 'src', 'lib', '__tests__', 'echt.test.ts'), `${formen['als eine Zeichenkette mit \\n'](schluessel['EC P-256 PKCS8 (.p8)'])}\n`)
    writeFileSync(join(probe, 'docs', 'schluessel.txt'), schluessel['RSA PKCS1'])
    writeFileSync(join(probe, 'docs', 'hinweis.md'), `Die Pruefung sucht nach ${KOPF()} und urteilt dann je Zeile.\n`)
    git('init', '-q')
    git('add', 'src/lib/__tests__/testwert.test.ts', 'src/lib/__tests__/echt.test.ts', 'docs/schluessel.txt', 'docs/hinweis.md')
    repoFund = pruefeSecrets(probe).pruefungen.find((x) => /privaten Schluessel/.test(x.name))
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
  ok(R, 'Repo-Pruefung: meldet den echten Schluessel im Testordner und in der Textdatei, den Testwert und den Hinweis nicht', repoFund?.ok === false && repoFund.detail === 'docs/schluessel.txt, src/lib/__tests__/echt.test.ts', repoFund)
  const eigen = pruefeSecrets(REPO).pruefungen
  ok(R, 'Repo-Pruefung: dieses Repo hat keinen Fund', eigen.length === 2 && eigen.every((x) => x.ok), eigen)

  // ---------- Gegenpruefung Android 4 GB, Teil 2: Funde am Pruefrahmen ----------
  const P2 = 'pruefrahmen-teil-2'

  // Ein Tipp, der etwas anderes traefe, ist kein Erfolg, auch ohne nurWennFrei.
  const tFrei = { gefunden: true, x: 10, y: 10, box: { x: 0, y: 0, w: 20, h: 20 } }
  const q_unterFuss = { ...tFrei, verdeckt: true, verdecktVon: 'div.m-foot > button', verdecktFest: 'unten' }
  ok(P2, 'tap: ein Ziel unter einer Fusszeile ist kein Erfolg, auch ohne nurWennFrei. auchVerdeckt nimmt es bewusst aus', /ist verdeckt von div\.m-foot/.test(tippVerbot(q_unterFuss, 'm-x')) && tippVerbot(q_unterFuss, 'm-x', { auchVerdeckt: true }) === null && tippVerbot(tFrei, 'm-x') === null)
  ok(P2, 'tap: nichts gefunden, ausserhalb und unter der Tastatur bleiben Fehler wie bisher', /nichts gefunden/.test(tippVerbot({ gefunden: false }, 'm-x')) && /ausserhalb des Bildes/.test(tippVerbot({ ...tFrei, ausserhalb: true }, 'm-x')) && /unter der Tastatur/.test(tippVerbot({ ...tFrei, unterTastatur: true }, 'm-x')) && tippVerbot({ ...tFrei, unterTastatur: true }, 'm-x', { auchUnterTastatur: true }) === null)
  const q_bild = { w: 640, h: 360 }
  const q_gOben = rollGeste({ gefunden: true, ausserhalb: true, box: { x: 10, y: -400, w: 80, h: 40 } }, q_bild)
  const q_gUnten = rollGeste({ gefunden: true, ausserhalb: true, box: { x: 10, y: 900, w: 80, h: 40 } }, q_bild)
  const q_gFuss = rollGeste({ ...q_unterFuss, box: { x: 10, y: 300, w: 80, h: 40 } }, q_bild)
  const q_gBlatt = rollGeste({ ...tFrei, verdeckt: true, verdecktVon: 'div.m-sheet', verdecktFest: null }, q_bild)
  ok(P2, 'Rollen: ein Ziel oberhalb zieht der Finger herunter, eines unterhalb hinauf, unter einer Fusszeile ein Stueck hinauf. Unter einem Blatt wird nicht gewischt', q_gOben?.nach.y > q_gOben?.von.y && q_gUnten?.nach.y < q_gUnten?.von.y && q_gFuss?.nach.y < q_gFuss?.von.y && q_gBlatt === null && rollGeste(tFrei, q_bild) === null, [q_gOben, q_gUnten, q_gFuss, q_gBlatt])
  // "Preview" im Chat: oberhalb des Bildes, scrollIntoView haelt nicht. Nach zwei Gesten steht es im Bild.
  const q_rolle = (lagen) => {
    const z = { wische: [], gefragt: [] }
    let i = 0
    return { z, d: { swipe: async (von, nach) => { z.wische.push([von, nach]); i = Math.min(i + 1, lagen.length - 1) }, sleep: async () => {}, evalJs: async () => q_bild }, finde: async (wie) => { z.gefragt.push(!!wie?.ohneRollen); return { gefunden: true, x: 50, y: 50, ...lagen[i] } } }
  }
  const q_r1 = q_rolle([{ ausserhalb: true, box: { x: 0, y: -700, w: 80, h: 40 } }, { ausserhalb: true, box: { x: 0, y: -300, w: 80, h: 40 } }, { ausserhalb: false, box: { x: 0, y: 80, w: 80, h: 40 } }])
  const q_p1r = await findeMitRollen(q_r1.d, q_r1.finde)
  ok(P2, 'Rollen: ein Ziel ausserhalb des Bildes wird mit echten Wischgesten hereingeholt und danach nicht wieder aus dem Skript gerollt', q_p1r.ausserhalb === false && q_p1r.gerollt === 2 && q_r1.z.wische.length === 2 && q_r1.z.wische[0][1].y > q_r1.z.wische[0][0].y && q_r1.z.gefragt[0] === false && q_r1.z.gefragt.slice(1).every(Boolean), [q_p1r, q_r1.z])
  const q_r2 = q_rolle([{ ausserhalb: true, box: { x: 0, y: -700, w: 80, h: 40 } }])
  const q_p2r = await findeMitRollen(q_r2.d, q_r2.finde)
  ok(P2, 'Rollen: bewegt die Geste nichts, hoert das Wischen auf, und der Tipp meldet "ausserhalb" statt Erfolg', q_p2r.ausserhalb === true && q_r2.z.wische.length === 1 && /ausserhalb/.test(tippVerbot(q_p2r, 'm-chat-code-preview')), [q_p2r, q_r2.z])
  const q_r3 = q_rolle([{ ausserhalb: false, box: { x: 0, y: 80, w: 80, h: 40 } }])
  const q_p3r = await findeMitRollen(q_r3.d, q_r3.finde)
  ok(P2, 'Rollen: ein Ziel, das frei im Bild liegt, wird nicht angefasst', q_r3.z.wische.length === 0 && q_p3r.gerollt === undefined)
  // Pruefung iOS Paket 11, F9: nach der Geste laeuft die Liste nach und federt zurueck. Getippt wird erst, wenn das Ziel steht.
  const q_federt = (ys) => {
    const z = { schlaefe: 0, gefragt: 0 }
    let i = 0
    let gewischt = false
    const d = { swipe: async () => { gewischt = true }, sleep: async () => { z.schlaefe++ }, evalJs: async () => q_bild }
    const finde = async () => {
      z.gefragt++
      if (!gewischt) return { gefunden: true, x: 50, y: 50, ausserhalb: true, box: { x: 0, y: 900, w: 80, h: 40 } }
      const y = ys[Math.min(i++, ys.length - 1)]
      return { gefunden: true, x: 40, y: y + 20, ausserhalb: false, box: { x: 0, y, w: 80, h: 40 } }
    }
    return { z, d, finde }
  }
  const q_f1 = q_federt([300, 240, 262, 262, 262])
  const q_pf1 = await findeMitRollen(q_f1.d, q_f1.finde)
  ok(P2, 'Rollen: laeuft die Liste nach der Geste nach oder federt zurueck, gilt erst die Lage, an der das Ziel zweimal steht', q_pf1.box.y === 262 && q_pf1.gerollt === 1, [q_pf1, q_f1.z])
  const q_f2 = q_federt([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500])
  await q_f2.d.swipe()
  const q_pf2 = await bisRuhig(q_f2.d, q_f2.finde, { max: 4 })
  ok(P2, 'Rollen: steht das Ziel nie still, misst der Rahmen hoechstens max Takte und gibt die letzte Lage', q_f2.z.gefragt === 5, [q_pf2, q_f2.z])

  // Die Einwilligung fuer LU Cloud: gesperrt, im Sweep nur als bewusster Schritt mit Ruecknahme.
  const q_zustimmen = { testid: 'm-consent-agree', name: 'Agree', risiko: null }
  const q_freiE = freigabeFuer(q_zustimmen, FREIGABEN)
  ok(P2, 'Einwilligung: "Agree" im Blatt ai-consent ist gesperrt, "Not now" nicht. Die Freigabe ist ein Schritt mit Ruecknahme', sperrGrund(q_zustimmen)?.art === 'destructive' && sperrGrund({ testid: 'm-consent-decline', name: 'Not now', risiko: null }) === null && q_freiE?.modus === 'mit-ruecknahme' && q_freiE.ruecknahme === 'einwilligung' && typeof RUECKNAHMEN.einwilligung?.nimmZurueck === 'function')
  const q_RE = RUECKNAHMEN.einwilligung
  ok(P2, 'Einwilligung: getippt wird nur, wenn sie vorher offen ist. War sie schon erteilt, fehlt der Rueckweg oder die Ruecknahme, bleibt der Knopf gesperrt, mit Grund', ruecknahmeSperre(q_freiE, q_RE, { stand: 'offen' }) === null && /^gesperrt \(destructive\).*schon erteilt/.test(ruecknahmeSperre(q_freiE, q_RE, { stand: 'erteilt', grund: 'die Einwilligung war vor dem Sweep schon erteilt' })) && /^gesperrt/.test(ruecknahmeSperre(q_freiE, q_RE, { stand: 'ohne-rueckweg', grund: 'kein Knopf' })) && /^gesperrt/.test(ruecknahmeSperre(q_freiE, q_RE, null)) && /die es in flows\/ruecknahmen\.mjs nicht gibt/.test(ruecknahmeSperre({ ruecknahme: 'x' }, undefined, { stand: 'offen' })))
  // Gespielte Seite Settings, Privacy: der Stand steht an m-settings-privacy-ai-state, der Widerruf fragt nach.
  const q_privacy = ({ erlaubt, fragt = true, taub = false, knopf = true }) => {
    const z = { tipps: [], erlaubt, dialog: false }
    const da = (sel) => (/m-dialog-ai-consent-withdraw/.test(sel) ? z.dialog : /m-settings-privacy-ai-state/.test(sel) ? knopf : true)
    const d = {
      sleep: async () => {},
      waitFor: async () => true,
      back: async () => {},
      evalJs: async () => '1,2,3,4',
      evalFn: async (fn, a, b) => {
        if (fn.name === 'lage') return { dialog: z.dialog ? ['m-dialog-ai-consent-withdraw'] : [], blaetter: [], reiterleiste: true, reiter: 'settings', route: '/settings' }
        if (fn.name === 'sichtbarDa') return { da: da(a) ? 1 : 0, sichtbar: da(a) ? 1 : 0 }
        if (fn.name === 'attributVon') return b === 'data-allowed' ? z.erlaubt : null
        return null
      },
      tap: async (sel) => {
        z.tipps.push(sel)
        if (/ai-withdraw-reset/.test(sel) && fragt) z.dialog = true
        if (/m-dialog-confirm/.test(sel)) { z.dialog = false; if (!taub) z.erlaubt = 'no' }
        if (/m-dialog-cancel/.test(sel)) z.dialog = false
      },
    }
    return { d, z }
  }
  const q_sOffen = await q_RE.stand(q_privacy({ erlaubt: 'no' }).d)
  const q_sErteilt = await q_RE.stand(q_privacy({ erlaubt: 'yes' }).d)
  const q_sOhne = await q_RE.stand(q_privacy({ erlaubt: null, knopf: false }).d)
  ok(P2, 'Einwilligung: der Stand wird in Settings, Privacy abgelesen: offen, schon erteilt, oder kein Knopf in diesem Paket', q_sOffen.stand === 'offen' && q_sErteilt.stand === 'erteilt' && q_sOhne.stand === 'ohne-rueckweg', [q_sOffen, q_sErteilt, q_sOhne])
  const q_pGut = q_privacy({ erlaubt: 'yes' })
  const q_zGutE = await q_RE.nimmZurueck(q_pGut.d)
  const q_pStumm = q_privacy({ erlaubt: 'yes', fragt: false })
  const q_zStumm = await q_RE.nimmZurueck(q_pStumm.d)
  const q_pTaub = q_privacy({ erlaubt: 'yes', taub: true })
  const q_zTaub = await q_RE.nimmZurueck(q_pTaub.d)
  const q_pNichts = q_privacy({ erlaubt: 'no' })
  const q_zNichts = await q_RE.nimmZurueck(q_pNichts.d)
  ok(P2, 'Einwilligung: die Ruecknahme tippt den Widerruf und bestaetigt seine Rueckfrage, dann steht "nicht erteilt"', q_zGutE.ok === true && q_pGut.z.erlaubt === 'no' && q_pGut.z.tipps.some((t) => /ai-withdraw-reset/.test(t)) && /m-dialog-confirm/.test(q_pGut.z.tipps.at(-1)), [q_zGutE, q_pGut.z])
  ok(P2, 'Einwilligung: kommt die Rueckfrage nicht oder bleibt der Stand stehen, heisst es "nicht zurueckgenommen" mit Grund (das steht dann unter "verstellt")', q_zStumm.ok === false && /^nicht zurueckgenommen: .*Rueckfrage/.test(q_zStumm.grund) && !q_pStumm.z.tipps.some((t) => /m-dialog-confirm/.test(t)) && q_zTaub.ok === false && /data-allowed="yes"/.test(q_zTaub.grund), [q_zStumm, q_zTaub])
  ok(P2, 'Einwilligung: hat der Tipp nichts erteilt, wird nichts widerrufen', q_zNichts.ok === true && !q_pNichts.z.tipps.some((t) => /withdraw|confirm/.test(t)), [q_zNichts, q_pNichts.z])
  const q_sweepText = readFileSync(join(RAHMEN, 'sweep.mjs'), 'utf8')
  ok(P2, 'Sweep: der Schritt mit Ruecknahme liest erst den Stand, nimmt nach dem Tipp zurueck (auch nach einem Fehler) und schreibt das Ergebnis nach "zurueckgestellt"', q_sweepText.indexOf('ruecknahme.stand(d)') > 0 && q_sweepText.indexOf('ruecknahme.stand(d)') < q_sweepText.indexOf('const einmal = async') && q_sweepText.indexOf('ruecknahme.nimmZurueck(d)') > q_sweepText.indexOf("klasse: 'fehler', grund: `Rahmenfehler:") && /r\.zurueckgestellt = z\.ok \? true : z\.grund\n\s+r\.bewusst/.test(q_sweepText))

  // Echte Seite und Ersatzseite werden getrennt gezaehlt.
  const q_uE = seitenUrteil([], 'testhaken (abgelegter Eintrag)')
  const q_uM = seitenUrteil(['m-workflow-gone', 'm-workflow-gone-back'], 'testhaken')
  const q_uB = seitenUrteil([], 'testhaken (Beispielwert, zeigt die Seite ohne echten Eintrag)')
  const q_zS = zaehleSeiten([{ route: '/settings', seite: q_uE }, { route: '/settings/workflows/:id', seite: q_uM }, { route: '/x/:id', seite: q_uB }, { route: '/chat/:id/tasks', nichtHerstellbar: 'braucht ein Cloud-Modell' }, { route: '/alt' }])
  ok(P2, 'Bericht: eine Seite mit "gone", "missing" oder Beispielwert ist eine Ersatzseite, und die Zahlen nennen echte Seite und Ersatzseite getrennt', q_uE.art === 'echt' && q_uM.art === 'ersatz' && /m-workflow-gone/.test(q_uM.grund) && q_uB.art === 'ersatz' && q_zS.angefahren === 5 && q_zS.hergestellt === 4 && q_zS.echt === 1 && q_zS.ersatz === 2 && q_zS.ohneUrteil === 1 && q_zS.nichtHerstellbar === 1 && JSON.stringify(q_zS.ersatzSeiten) === '["/settings/workflows/:id","/x/:id"]' && /4 hergestellt: 1 echte Seite, 2 Ersatzseite, 1 ohne Urteil\. 1 nicht herstellbar\./.test(seitenSatz(q_zS)), [q_zS, seitenSatz(q_zS)])

  // Testdaten: Der Haken legt sie ab, und die Seite wird mit ihren Kennwerten geoeffnet.
  const q_T_DATEN = { ok: true, chatId: 'c1', messageId: 'm1', blockId: 'b1', memoryId: 'mem1', workflowId: 'w1', stepId: 'test-step-1', groupChatId: null, groupModel: null, createItemId: 'test-create-item', missing: { groupChatId: 'no chat model is chosen' } }
  ok(P2, 'Testdaten: jede Seite, die einen Eintrag braucht, bekommt ihre Kennwerte. Fehlt der Eintrag (keine Gruppe ohne Modell), gibt es keine erfundenen', JSON.stringify(DATEN_PARAMS['/settings/workflows/:id/step/:stepId'](q_T_DATEN)) === '{"id":"w1","stepId":"test-step-1"}' && DATEN_PARAMS['/settings/memory/:id'](q_T_DATEN).id === 'mem1' && DATEN_PARAMS['/create/item/:id'](q_T_DATEN).id === 'test-create-item' && DATEN_PARAMS['/chat/:id/group'](q_T_DATEN) === null && BLATT_DATEN['agent-group-persona'](q_T_DATEN) === null && BLATT_DATEN.message(q_T_DATEN).messageId === 'm1' && Object.keys(DATEN_PARAMS).every((r) => OHNE_WEG[r] || WEGE[r]) && Object.keys(BLATT_DATEN).every((b) => OHNE_WEG[b]))
  const q_hakenSeite = (kann) => {
    const z = { rufe: [] }
    const d = {
      sleep: async () => {},
      waitFor: async () => true,
      back: async () => {},
      tap: async () => {},
      evalFn: async (fn) => (fn.name === 'lage' ? { dialog: [], blaetter: [], reiterleiste: true } : null),
      evalJs: async (src) => {
        const liste = /for \(const n of (\[[^\]]*\])\)/.exec(src)
        if (liste) return JSON.parse(liste[1]).find((n) => kann.includes(n)) ?? null
        const ruf = /window\.__LU_TEST__\[("[^"]+")\]\(\.\.\.(\[.*\])\); try/.exec(src)
        if (ruf) {
          const name = JSON.parse(ruf[1])
          z.rufe.push([name, JSON.parse(ruf[2])])
          return name === 'testData' ? q_T_DATEN : { ok: true }
        }
        if (/__LU_TEST__/.test(src)) return kann.length ? { da: true, alt: 99999, fertig: true } : { da: false, alt: 99999, fertig: true }
        return null
      },
    }
    return { d, z }
  }
  const q_hMit = q_hakenSeite(['go', 'openSheet', 'testData'])
  const q_wieMit = await oeffneRoute(q_hMit.d, { route: '/settings/workflows/:id', params: { id: 'sample-id' }, datenParams: DATEN_PARAMS['/settings/workflows/:id'], weg: null, screenTestid: null })
  const q_hAlt = q_hakenSeite(['go', 'openSheet'])
  const q_wieAlt = await oeffneRoute(q_hAlt.d, { route: '/settings/workflows/:id', params: { id: 'sample-id' }, datenParams: DATEN_PARAMS['/settings/workflows/:id'], weg: null, screenTestid: null })
  ok(P2, 'Testdaten: mit dem Haken wird die Workflow-Seite mit dem abgelegten Workflow geoeffnet, ein aelterer Abnahmebau ohne testData bekommt den Beispielwert und zaehlt als Ersatzseite', q_wieMit === 'testhaken (abgelegter Eintrag)' && JSON.stringify(q_hMit.z.rufe.at(-1)) === '["go",["/settings/workflows/:id",{"id":"w1"}]]' && seitenUrteil([], q_wieMit).art === 'echt' && /Beispielwert/.test(q_wieAlt) && JSON.stringify(q_hAlt.z.rufe.at(-1)) === '["go",["/settings/workflows/:id",{"id":"sample-id"}]]' && seitenUrteil([], q_wieAlt).art === 'ersatz', [q_wieMit, q_hMit.z.rufe, q_wieAlt, q_hAlt.z.rufe])
  const q_hBlatt = q_hakenSeite(['go', 'openSheet', 'testData'])
  const q_wieBlatt = await oeffneBlatt(q_hBlatt.d, { blatt: 'agent-add-step', testid: 'm-sheet-agent-add-step', datenProps: BLATT_DATEN['agent-add-step'], weg: null })
  const q_wieBlattOhne = await oeffneBlatt(q_hBlatt.d, { blatt: 'agent-group-persona', testid: 'm-sheet-agent-group-persona', datenProps: BLATT_DATEN['agent-group-persona'], weg: null })
  ok(P2, 'Testdaten: ein Blatt bekommt die Angaben, die sein Oeffner ihm gibt (der Workflow fuer "Add step"). Fehlt der Eintrag, oeffnet es wie bisher', q_wieBlatt === 'testhaken (abgelegter Eintrag)' && JSON.stringify(q_hBlatt.z.rufe.find((r) => r[0] === 'openSheet')) === '["openSheet",["agent-add-step",{"workflowId":"w1"}]]' && q_wieBlattOhne === 'testhaken' && JSON.stringify(q_hBlatt.z.rufe.at(-1)) === '["openSheet",["agent-group-persona",null]]', [q_wieBlatt, q_wieBlattOhne, q_hBlatt.z.rufe])

  // Die Repo-Pruefung hielt zwei Tests der Shell fuer Schluesselmaterial: ein Suchmuster und einen Platzhalter.
  const q_SP2 = ['store', 'Password'].join('')
  const q_KP2 = ['key', 'Password'].join('')
  ok(P2, 'Repo-Pruefung: ein Suchmuster (\\S) und die Platzhalter der eigenen Tests sind kein Passwort, ein ausgeschriebener Wert bleibt ein Fund', !zeileTraegtGeheimnis(`expect(text).not.toMatch(/${q_SP2}=\\S|${q_KP2}=\\S/)`) && !zeileTraegtGeheimnis(`${q_SP2}=placeholder`) && !zeileTraegtGeheimnis(`${q_SP2}=do-not-print-me\\n`) && zeileTraegtGeheimnis(`${q_SP2}=hunter22`) && zeileTraegtGeheimnis(`${q_KP2}=placeholder-und-mehr`))

  // Pruefung iOS Paket 15, F-R4: der Kundenfluss ab "erster-chat" auf einem Geraet, das ihn schon einmal lief.
  // Zwei Laeufe hintereinander auf derselben gespielten App (lib/kundenfluss-attrappe.mjs).
  const KF = 'kundenfluss-wiederholbar'
  const kfGeraet = geraetAttrappe()
  const kfLauf = async (stempel) => {
    const { f, d, rufe } = laufAttrappe(kfGeraet)
    const ctx = { memory: memoryEintrag(stempel) }
    const einstellung = async () => {}
    const oeffneChat = async () => {}
    const sendeLokal = async () => 'ready'
    const fehler = []
    await schrittMemory({ f, d, ctx, einstellung }).catch((e) => fehler.push(`memory: ${e.message}`))
    await schrittModellwechsel({ f, d, env: {}, id: 'qwen3-0.6b', oeffneChat, sendeLokal, benachrichtigungFallsGefragt: async () => {} }).catch((e) => fehler.push(`modellwechsel: ${e.message}`))
    return { fehler, rufe }
  }
  const kf1 = await kfLauf('lauf1')
  const kf1Laden = kf1.rufe.filter((r) => r.includes('m-models-download')).length
  const kf2 = await kfLauf('lauf2')
  const kf2Laden = kf2.rufe.filter((r) => r.includes('m-models-download')).length
  ok(KF, 'F-R4: frisches Geraet, memory und modellwechsel gruen, genau ein Download', kf1.fehler.length === 0 && kf1Laden === 1, kf1)
  ok(KF, 'F-R4: derselbe Fluss ein zweites Mal auf demselben Geraet: memory legt einen neuen Eintrag an, modellwechsel laedt nichts und wechselt trotzdem', kf2.fehler.length === 0 && kf2Laden === 0 && kfGeraet.erinnerungen.length === 2 && kf2.rufe.some((r) => /schon installiert/.test(r)), kf2)
  // Der zweite Lauf endete wie jeder auf dem ersten Modell. Steht das zweite noch im Chat (abgebrochener Lauf), entfaellt "Use in chat".
  kfGeraet.chatModell = 'qwen3-0.6b'
  const kf3 = await kfLauf('lauf3')
  ok(KF, 'F-R4: steht das zweite Modell schon im Chat, laeuft der Wechsel ohne "Use in chat"', kf3.fehler.length === 0 && kf3.rufe.some((r) => /schon das Modell des Chats/.test(r)), kf3)
  ok(KF, 'F-R4: jede Erinnerung eines Laufs hat ihren eigenen Text', new Set(['a', 'b', 'c'].map((x) => memoryEintrag(x).text)).size === 3 && memoryEintrag('a').text.startsWith('The user prefers short answers.'))

  // Pruefung iOS Paket 17, F-R9: der Port des Dokumentenmodells vor den Dokumentpruefungen.
  const R9 = 'f-r9'
  const LSOF_LU = 'p4711\nclu-llama-\nf12\np4711\nclu-llama-\n'
  const lsofLauf = (lsof, pfade) => {
    const rufe = []
    return { rufe, lauf: async (cmd, args) => { rufe.push([cmd, ...args].join(' ')); return cmd === 'lsof' ? lsof : `${pfade[args.at(-1)] ?? ''}\n` } }
  }
  ok(R9, 'lsof -Fpc wird gelesen: eine Kennung je Prozess, der Name dabei', JSON.stringify(leseLauscher(LSOF_LU + 'p99\ncLU\n')) === JSON.stringify([{ pid: 4711, name: 'lu-llama-' }, { pid: 99, name: 'LU' }]) && leseLauscher('').length === 0)
  const r9Fremd = lsofLauf(LSOF_LU, { 4711: '/Applications/LU.app/Contents/MacOS/lu-llama-server' })
  const r9Befund = await dokPortBelegt({ plattform: 'ios', lauf: r9Fremd.lauf })
  ok(R9, 'iOS: die Desktop-App haelt 8128, das ist ein Befund mit Programmname und ohne Maschinenpfad im Satz', r9Befund?.port === DOK_PORT && r9Befund.fremde[0].pid === 4711 && /lu-llama-server \(pid 4711\)/.test(dokPortSatz(r9Befund)) && /F-R9/.test(dokPortSatz(r9Befund)) && !/\/(?:Applications|Users)\b/.test(dokPortSatz(r9Befund)) && r9Fremd.rufe[0] === 'lsof -nP -iTCP:8128 -sTCP:LISTEN -Fpc', [r9Befund, r9Fremd.rufe])
  const r9Eigen = lsofLauf('p55\ncLU\n', { 55: '/x/Library/Developer/CoreSimulator/Devices/ABC/data/Containers/Bundle/Application/D/LU.app/LU' })
  const r9Leer = lsofLauf('', {})
  const r9Android = lsofLauf(LSOF_LU, {})
  ok(R9, 'kein Befund: die App im Simulator selbst, ein freier Port, und Android (eigenes Netz, kein Kommando)', (await dokPortBelegt({ plattform: 'ios', lauf: r9Eigen.lauf })) === null && (await dokPortBelegt({ plattform: 'ios', lauf: r9Leer.lauf })) === null && (await dokPortBelegt({ plattform: 'android', lauf: r9Android.lauf })) === null && r9Android.rufe.length === 0 && istSimulatorProzess('/a/CoreSimulator/Devices/x/LU') && !istSimulatorProzess('/Applications/LU.app/LU'))
  const r9f = () => { const notizen = []; return { notizen, notiz: (t) => notizen.push(t), nichtPruefbar: (g) => { throw new NichtPruefbar(g) } } }
  const r9a = r9f()
  const r9aFehler = await wirft(() => mitDokPort({ f: r9a, d: { plattform: 'ios' }, pruefe: async () => r9Befund }, async () => { throw new Error('Das Dokument ist als gescheitert gelistet') }), NichtPruefbar)
  const r9b = r9f()
  const r9bFehler = await wirft(() => mitDokPort({ f: r9b, d: { plattform: 'ios' }, pruefe: async () => null }, async () => { throw new Error('Das Dokument ist als gescheitert gelistet') }), Error)
  const r9c = r9f()
  await mitDokPort({ f: r9c, d: { plattform: 'ios' }, pruefe: async () => r9Befund }, async () => {})
  ok(R9, 'Schritt dokument: belegter Port und Fehler ist "nicht pruefbar" mit Grund, freier Port bleibt "fehler", gruen trotz Belegung steht in der Notiz', !!r9aFehler && /F-R9/.test(r9aFehler.message) && /gescheitert gelistet/.test(r9aFehler.message) && r9a.notizen.length === 1 && !!r9bFehler && !(r9bFehler instanceof NichtPruefbar) && r9b.notizen.length === 0 && /Trotz belegtem Port/.test(r9c.notizen.at(-1) ?? ''), [r9aFehler?.message, r9bFehler?.message, r9c.notizen])
  const kfQuelle = readFileSync(join(RAHMEN, 'flows', 'kundenfluss.mjs'), 'utf8')
  ok(R9, 'kundenfluss.mjs: der Schritt dokument laeuft in mitDokPort', /schritt\('dokument', [^\n]*mitDokPort\(\{ f, d \}/.test(kfQuelle))

  // Pruefung iOS Paket 17, D1-Rest im Kundenfluss: je Lauf ein frischer Name, nie Ueberschreiben vor der Wahl.
  const D1R = 'kundenfluss-datei'
  const namen = ['a1', 'a2'].flatMap((l) => ['anhang', 'dokument'].map((z) => testdateiName(l, z)))
  ok(D1R, 'je Lauf und Zweck ein eigener Name, nie "lu-test.txt", nur erlaubte Zeichen', new Set(namen).size === 4 && !namen.includes('lu-test.txt') && namen.every((n) => /^lu-test-[\w-]+\.txt$/.test(n)) && testdateiName('a/../b', 'dokument') === 'lu-test-ab-dokument.txt', namen)
  ok(D1R, 'kundenfluss.mjs legt die Testdatei nur noch unter dem frischen Namen ab und raeumt sie danach weg', !/legeDateiAb\(d, TESTDATEI\)/.test(kfQuelle) && /legeDateiAb\(d, TESTDATEI, \{ als: testdateiName\(ctx\.lauf, zweck\) \}\)/.test(kfQuelle) && /mitTestdatei\('anhang'/.test(kfQuelle) && /mitTestdatei\('dokument'/.test(kfQuelle) && /finally \{\s*await entferneDatei\(d, name\)/.test(kfQuelle))
  const d1Befehle = []
  const d1Android = { plattform: 'android', pushFile: async (l, z) => void d1Befehle.push(`push ${z}`), shell: async (c) => (d1Befehle.push(c), ''), sleep: async () => {} }
  const d1Name = await legeDateiAb(d1Android, '/fix/lu-test.txt', { als: 'lu-test-x1-dokument.txt' })
  const d1Tmp = mkdtempSync(join(tmpdir(), 'lu-d1-'))
  const d1Pfad = join(d1Tmp, 'lu-test-x1-anhang.txt')
  const d1Ios = { plattform: 'ios', pushFile: async (_l, ziel) => { writeFileSync(d1Pfad, 'x'); return ziel === 'dateien/lu-test-x1-anhang.txt' ? d1Pfad : null } }
  await legeDateiAb(d1Ios, '/fix/lu-test.txt', { als: 'lu-test-x1-anhang.txt' })
  const d1DaVorher = existsSync(d1Pfad)
  const d1Weg = await entferneDatei(d1Ios, 'lu-test-x1-anhang.txt')
  const d1Fremd = await entferneDatei(d1Ios, 'nicht-von-mir.txt')
  const d1Boese = await wirft(() => legeDateiAb(d1Android, '/fix/lu-test.txt', { als: '../x.txt' }), Error)
  rmSync(d1Tmp, { recursive: true, force: true })
  ok(D1R, 'legeDateiAb legt unter dem neuen Namen ab, iOS raeumt nur die eigene Datei weg, ein Name mit Pfad wird abgelehnt', d1Name === 'lu-test-x1-dokument.txt' && d1Befehle[0] === 'push /sdcard/Download/lu-test-x1-dokument.txt' && d1DaVorher && d1Weg === true && !existsSync(d1Pfad) && d1Fremd === false && !!d1Boese, [d1Befehle, d1Weg, d1Fremd, d1Boese?.message])

  // Pruefung iOS Paket 17, F-R10: N1 gilt nur, wenn das Ziel nicht schon in der Engine steht.
  const R10 = 'f-r10'
  const smol = { name: 'SmolLM2-360M-Instruct-Q4_K_M.gguf', path: '/m/SmolLM2-360M-Instruct-Q4_K_M.gguf' }
  const qwen = { name: 'Qwen3-0.6B-Q4_K_M.gguf', path: '/m/Qwen3-0.6B-Q4_K_M.gguf' }
  const nomic = { name: 'nomic-embed-text-v1.5.Q4_K_M.gguf', path: '/m/nomic-embed-text-v1.5.Q4_K_M.gguf' }
  const pGeladen = n1Plan({ modelle: [nomic, smol, qwen], geladen: smol.path })
  const pFrei = n1Plan({ modelle: [nomic, smol, qwen], geladen: qwen.path })
  const pLeer = n1Plan({ modelle: [smol, qwen], geladen: null })
  const pEins = n1Plan({ modelle: [nomic, smol], geladen: smol.path })
  ok(R10, 'SmolLM2 geladen: erst Qwen laden, dann SmolLM2 die Datei nehmen; nicht geladen: direkt', pGeladen.ziel === smol && pGeladen.zuerst === qwen && pFrei.ziel === smol && pFrei.zuerst === null && pLeer.ziel === smol && pLeer.zuerst === null, [pGeladen, pFrei, pLeer])
  ok(R10, 'das Dokumentenmodell zaehlt nie als Chatmodell; mit nur einem Chatmodell ist N1 nicht pruefbar', !!pEins.grund && /zwei Chatmodelle/.test(pEins.grund) && n1Plan({ modelle: [nomic, qwen, smol], geladen: null, wunsch: /nomic/ }).ziel !== nomic, pEins)
  ok(R10, 'Urteil: der Satz mit Namen ohne Pfad ist gut; ein Pfad oder .gguf irgendwo auf der Seite nicht', n1Urteil('The model file "SmolLM2 360M" is not on this device. Open Models and download it again.', 'Chat / SmolLM2 360M').ok && !n1Urteil('The model file "SmolLM2 360M" is not on this device. Open Models and download it again.', 'Model file not found: /Users/x/Library/a.gguf').ok && !n1Urteil('Something went wrong', '').ok)

  const Q = 'quelltext'
  const treiberTexte = ['android', 'ios', 'vorschau'].map((n) => readFileSync(join(RAHMEN, 'driver', `${n}.mjs`), 'utf8'))
  ok(Q, 'alle drei Treiber pruefen jeden Tipp mit tippVerbot und holen das Ziel mit findeMitRollen herein. Keiner tippt mehr nur mit nurWennFrei auf Verdeckung', treiberTexte.every((t) => /tippVerbot\(p, ziel, /.test(t) && /findeMitRollen\(this, /.test(t) && !/p\.verdeckt && opts\.nurWennFrei/.test(t)))

  const dateien = [...quelldateien(RAHMEN), ...quelldateien(join(REPO, 'scripts', 'mobile'))].filter((p) => !p.endsWith('selbsttest-ohne-geraet.mjs'))
  const ohneKommentar = (p) => readFileSync(p, 'utf8').split('\n').map((z, i) => [i + 1, z]).filter(([, z]) => !/^\s*(#|\/\/)/.test(z))
  const treffer = (re, erlaubt = () => false) => dateien.flatMap((p) => (erlaubt(relative(REPO, p)) ? [] : ohneKommentar(p).filter(([, z]) => re.test(z)).map(([n, z]) => `${relative(REPO, p)}:${n} ${z.trim().slice(0, 90)}`)))
  const muster = treffer(/\b(pkill|killall)\b|\bkill\s+-(9|KILL|s\s*KILL)\b[^\n]*\$\(\s*(pgrep|ps)\b|\bpgrep\b[^\n]*\|\s*xargs[^\n]*kill/)
  ok(Q, `kein pkill, killall oder kill ueber ein Namensmuster in mobile-tests/ und scripts/mobile/ (${dateien.length} Dateien)`, dateien.length > 40 && muster.length === 0, muster)
  const start = treffer(/simctl['", ]+boot\b(?!status)|\bemulator['"]?,? *\[?['"]?-avd\b|\bemulator\s+(-avd|@)/, (rel) => ['mobile-tests/geraet.mjs', 'mobile-tests/driver/ios.mjs', 'scripts/mobile/ios/simulator.sh'].includes(rel))
  ok(Q, 'Geraete starten nur geraet.mjs, der Neustart im iOS-Treiber und simulator.sh', start.length === 0, start)
  const ios = readFileSync(join(RAHMEN, 'driver', 'ios.mjs'), 'utf8')
  const neustart = ios.slice(ios.indexOf('async reboot()'))
  ok(Q, 'iOS-Treiber: reboot() prueft die Grenze, bevor er herunterfaehrt und bootet', neustart.indexOf('vorGeraetestart(') > 0 && neustart.indexOf('vorGeraetestart(') < neustart.indexOf("'shutdown'") && neustart.indexOf("'shutdown'") < neustart.indexOf("'boot'"))
  const sim = readFileSync(join(REPO, 'scripts', 'mobile', 'ios', 'simulator.sh'), 'utf8')
  ok(Q, 'simulator.sh: vor simctl boot steht die Pruefung ueber geraet.mjs pruefen', sim.indexOf('geraet.mjs" pruefen') > 0 && sim.indexOf('geraet.mjs" pruefen') < sim.indexOf('xcrun simctl boot'))
  const android = readFileSync(join(RAHMEN, 'driver', 'android.mjs'), 'utf8')
  ok(Q, 'beide Treiber lehnen die Geraete von David als Testgeraet ab', /pruefeNichtGeschuetzt\(name, 'als Testgeraet benutzt'\)/.test(android) && /pruefeNichtGeschuetzt\(g\.name, 'als Testgeraet benutzt'\)/.test(ios))
}
