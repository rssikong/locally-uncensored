#!/usr/bin/env node
// Prueft, ob die nativen Bibliotheken eines Android-Pakets auf einem Geraet mit
// 16-KB-Speicherseiten laden. Google Play verlangt das fuer jede App mit Ziel
// Android 15 oder neuer; ein Paket, das es nicht kann, wird abgelehnt oder
// startet auf einem solchen Geraet nicht.
//
// Zwei Bedingungen je 64-Bit-Bibliothek:
//   1. ELF: jedes LOAD-Segment hat eine Ausrichtung von 0x4000 (16384) oder mehr.
//      Das legt der Linker fest (-Wl,-z,max-page-size=16384).
//   2. ZIP: liegt die Bibliothek unkomprimiert im APK, beginnt ihr Inhalt auf einem
//      Vielfachen von 16384. Das legt das Packen fest (AGP ab 8.5.1). Eine
//      komprimierte Bibliothek wird beim Installieren ausgepackt, fuer sie zaehlt
//      nur Bedingung 1. Im AAB ist jede Bibliothek komprimiert.
// 32-Bit-Bibliotheken sind ausgenommen (es gibt keine 32-Bit-Geraete mit 16 KB).
//
// Gelesen wird das Paket selbst, ohne Werkzeug aus dem SDK. Findet sich ein
// zipalign, das -P kennt, laeuft es als zweite Meinung mit.
//
// Aufruf:  node scripts/mobile/release/pruefe-16kb.mjs <apk|aab> [<apk|aab> ...]
// Ende 0:  jede Bibliothek besteht. Ende 1: mindestens eine nicht. Ende 2: falscher Aufruf.
// Als Modul: pruefe16kb(pfad) liefert das Ergebnis je Bibliothek.

import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, fstatSync, openSync, readSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

export const SEITE_16KB = 16384

const PT_LOAD = 1
const ABI_64 = new Set(['arm64-v8a', 'x86_64', 'riscv64'])

/**
 * Liest die LOAD-Segmente einer ELF-Datei.
 * @param {Buffer} buf  der Anfang der Datei, mindestens Kopf und Programmkopftabelle
 * @returns {{ bit: 32 | 64, segmente: { offset: number, vaddr: number, align: number }[] }}
 */
export function leseElfLoad(buf) {
  if (buf.length < 64 || buf.readUInt32BE(0) !== 0x7f454c46) throw new Error('not an ELF file')
  const klasse = buf[4]
  if (klasse !== 1 && klasse !== 2) throw new Error(`unknown ELF class ${klasse}`)
  if (buf[5] !== 1) throw new Error('big-endian ELF is not supported')
  const bit = klasse === 2 ? 64 : 32
  const n64 = (o) => Number(buf.readBigUInt64LE(o))
  const phoff = bit === 64 ? n64(32) : buf.readUInt32LE(28)
  const phentsize = buf.readUInt16LE(bit === 64 ? 54 : 42)
  const phnum = buf.readUInt16LE(bit === 64 ? 56 : 44)
  if (phoff + phentsize * phnum > buf.length) throw new Error('program header table lies outside the bytes read')
  const segmente = []
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize
    if (buf.readUInt32LE(o) !== PT_LOAD) continue
    segmente.push(
      bit === 64
        ? { offset: n64(o + 8), vaddr: n64(o + 16), align: n64(o + 48) }
        : { offset: buf.readUInt32LE(o + 4), vaddr: buf.readUInt32LE(o + 8), align: buf.readUInt32LE(o + 28) },
    )
  }
  return { bit, segmente }
}

function lies(fd, laenge, position) {
  const buf = Buffer.alloc(laenge)
  const n = readSync(fd, buf, 0, laenge, position)
  return n === laenge ? buf : buf.subarray(0, n)
}

/**
 * Die Eintraege eines ZIP (APK, AAB) aus dem Zentralverzeichnis, mit dem Ort der Daten.
 * @returns {{ name: string, methode: number, gepackt: number, groesse: number, datenOffset: number }[]}
 */
export function leseZip(pfad) {
  const fd = openSync(pfad, 'r')
  try {
    const gesamt = fstatSync(fd).size
    const ende = lies(fd, Math.min(gesamt, 65557), Math.max(0, gesamt - 65557))
    let e = -1
    for (let i = ende.length - 22; i >= 0; i--) {
      if (ende.readUInt32LE(i) === 0x06054b50) {
        e = i
        break
      }
    }
    if (e < 0) throw new Error('not a ZIP file (no end of central directory)')
    const zahl = ende.readUInt16LE(e + 10)
    const cdGroesse = ende.readUInt32LE(e + 12)
    const cdOffset = ende.readUInt32LE(e + 16)
    if (zahl === 0xffff || cdOffset === 0xffffffff) throw new Error('ZIP64 archives are not supported')
    const cd = lies(fd, cdGroesse, cdOffset)
    const eintraege = []
    let p = 0
    for (let i = 0; i < zahl; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('broken central directory')
      const methode = cd.readUInt16LE(p + 10)
      const gepackt = cd.readUInt32LE(p + 20)
      const groesse = cd.readUInt32LE(p + 24)
      const nameLen = cd.readUInt16LE(p + 28)
      const extraLen = cd.readUInt16LE(p + 30)
      const kommentarLen = cd.readUInt16LE(p + 32)
      const lokal = cd.readUInt32LE(p + 42)
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen)
      eintraege.push({ name, methode, gepackt, groesse, lokal })
      p += 46 + nameLen + extraLen + kommentarLen
    }
    // Der Ort der Daten steht nicht im Zentralverzeichnis: Name und Zusatzfeld des
    // lokalen Kopfes koennen anders lang sein (dort sitzt das Fuellfeld von zipalign).
    return eintraege.map(({ lokal, ...rest }) => {
      const kopf = lies(fd, 30, lokal)
      if (kopf.length < 30 || kopf.readUInt32LE(0) !== 0x04034b50) throw new Error(`broken local header for ${rest.name}`)
      return { ...rest, datenOffset: lokal + 30 + kopf.readUInt16LE(26) + kopf.readUInt16LE(28) }
    })
  } finally {
    closeSync(fd)
  }
}

function liesEintrag(pfad, eintrag) {
  const fd = openSync(pfad, 'r')
  try {
    const roh = lies(fd, eintrag.gepackt, eintrag.datenOffset)
    if (eintrag.methode === 0) return roh
    if (eintrag.methode === 8) return inflateRawSync(roh)
    throw new Error(`compression method ${eintrag.methode} is not supported`)
  } finally {
    closeSync(fd)
  }
}

const hex = (n) => `0x${n.toString(16)}`

/**
 * Prueft jede Bibliothek eines APK oder AAB.
 * @returns {{ pfad: string, art: 'apk' | 'aab', ok: boolean, libs: object[] }}
 *   je Bibliothek: name, abi, bit, gespeichert (unkomprimiert), datenOffset, segmente,
 *   kleinsteAusrichtung, elfOk, zipOk, ok, grund (leer, wenn ok)
 */
export function pruefe16kb(pfad) {
  const eintraege = leseZip(pfad)
  const art = eintraege.some((x) => x.name === 'BundleConfig.pb') ? 'aab' : 'apk'
  const libs = []
  for (const eintrag of eintraege) {
    const m = /^(?:[^/]+\/)?lib\/([^/]+)\/([^/]+\.so)$/.exec(eintrag.name)
    if (!m) continue
    const abi = m[1]
    const lib = { name: eintrag.name, abi, gespeichert: eintrag.methode === 0, datenOffset: eintrag.datenOffset }
    try {
      const elf = leseElfLoad(liesEintrag(pfad, eintrag))
      lib.bit = elf.bit
      lib.segmente = elf.segmente
      lib.kleinsteAusrichtung = elf.segmente.length ? Math.min(...elf.segmente.map((s) => s.align)) : 0
      lib.pflicht = elf.bit === 64 || ABI_64.has(abi)
      lib.elfOk = elf.segmente.length > 0 && elf.segmente.every((s) => s.align >= SEITE_16KB && s.align % SEITE_16KB === 0)
      lib.zipOk = !lib.gespeichert || eintrag.datenOffset % SEITE_16KB === 0
      const gruende = []
      if (!lib.elfOk) gruende.push(`LOAD segments are aligned to ${hex(lib.kleinsteAusrichtung)}, 16 KB pages need ${hex(SEITE_16KB)} or more (linker flag -Wl,-z,max-page-size=16384)`)
      if (!lib.zipOk) gruende.push(`stored uncompressed at offset ${eintrag.datenOffset}, which is not a multiple of ${SEITE_16KB} (zipalign -P 16, AGP 8.5.1 or newer)`)
      lib.ok = !lib.pflicht || gruende.length === 0
      lib.grund = lib.pflicht ? gruende.join('; ') : ''
    } catch (err) {
      lib.ok = false
      lib.grund = `could not be read: ${err.message}`
    }
    libs.push(lib)
  }
  return { pfad, art, ok: libs.every((l) => l.ok), libs }
}

/** zipalign aus den neuesten build-tools, die es haben. Null, wenn keins da ist. */
function zipalignPfad() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(homedir(), 'Library/Android/sdk')
  const dir = join(sdk, 'build-tools')
  if (!existsSync(dir)) return null
  const versionen = readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).reverse()
  for (const v of versionen) if (existsSync(join(dir, v, 'zipalign'))) return join(dir, v, 'zipalign')
  return null
}

/**
 * Zweite Meinung: zipalign -c -P 16 -v 4. Liefert null, wenn kein zipalign da ist oder es -P
 * nicht kennt (build-tools vor 35). zipalign prueft nur Bedingung 2, nie das ELF.
 */
export function zipalignGegenprobe(pfad) {
  const werkzeug = zipalignPfad()
  if (!werkzeug) return null
  const r = spawnSync(werkzeug, ['-c', '-P', '16', '-v', '4', pfad], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const aus = `${r.stdout ?? ''}${r.stderr ?? ''}`
  if (r.status === null || /Usage:|invalid option|unrecognized/i.test(aus)) return null
  return { ok: r.status === 0, zeilen: aus.split('\n').filter((z) => /\.so\b/.test(z)).map((z) => z.trim()) }
}

/**
 * Die Zeilen des Berichts fuer ein Paket, fuer den eigenen Aufruf und fuer pruefe-android-paket.mjs.
 * @returns {{ ok: boolean, zeilen: { ok: boolean | null, text: string }[] }}  ok null ist ein Hinweis
 */
export function bericht16kb(pfad) {
  const zeilen = []
  let e
  try {
    e = pruefe16kb(pfad)
  } catch (err) {
    return { ok: false, zeilen: [{ ok: false, text: `16 KB pages: ${pfad} could not be read: ${err.message}` }] }
  }
  if (!e.libs.length) zeilen.push({ ok: null, text: `16 KB pages: no native library in the ${e.art}` })
  for (const l of e.libs) {
    const lage = l.gespeichert ? `stored at offset ${l.datenOffset}` : 'compressed'
    if (l.ok && !l.pflicht) zeilen.push({ ok: null, text: `16 KB pages: ${l.name} is a 32-bit library and exempt` })
    else if (l.ok) zeilen.push({ ok: true, text: `16 KB pages: ${l.name} (LOAD alignment ${hex(l.kleinsteAusrichtung)}, ${lage})` })
    else zeilen.push({ ok: false, text: `16 KB pages: ${l.name}: ${l.grund}. Google Play refuses the package for Android 15 and newer` })
  }
  let ok = e.ok
  if (e.art === 'apk') {
    const z = zipalignGegenprobe(pfad)
    if (!z) zeilen.push({ ok: null, text: '16 KB pages: no zipalign with -P found (build-tools 35 or newer), the ZIP offsets were only read directly' })
    else {
      zeilen.push({ ok: z.ok, text: z.ok ? '16 KB pages: zipalign -c -P 16 passes (it checks the ZIP offsets only, not the ELF segments)' : `16 KB pages: zipalign -c -P 16 fails: ${z.zeilen.filter((x) => !/\(OK/.test(x)).join(', ') || 'see zipalign'}` })
      ok = ok && z.ok
    }
  }
  return { ok, zeilen }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pakete = process.argv.slice(2)
  if (!pakete.length) {
    console.error('usage: pruefe-16kb.mjs <apk|aab> [<apk|aab> ...]')
    process.exit(2)
  }
  let fehler = 0
  for (const pfad of pakete) {
    console.log(`[16kb] ${pfad}`)
    const b = bericht16kb(pfad)
    for (const z of b.zeilen) console.log(`[16kb] ${z.ok === null ? 'note ' : z.ok ? 'ok   ' : 'FAIL '} ${z.text}`)
    if (!b.ok) fehler += 1
  }
  console.log(fehler ? `[16kb] ${fehler} package(s) are not ready for 16 KB pages.` : '[16kb] all packages are ready for 16 KB pages.')
  process.exit(fehler ? 1 : 0)
}
