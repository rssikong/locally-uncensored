// Test der 16-KB-Pruefung an selbst gebauten Paketen: ein ELF mit bekannter
// Ausrichtung in einem ZIP mit bekanntem Datenort. Kein SDK, kein Geraet.
//
// Lauf: node --test scripts/mobile/release/pruefe-16kb.test.mjs

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { bericht16kb, leseElfLoad, leseZip, pruefe16kb, SEITE_16KB } from './pruefe-16kb.mjs'

const arbeit = mkdtempSync(join(tmpdir(), 'lu-16kb-test-'))
after(() => rmSync(arbeit, { recursive: true, force: true }))

/** Ein ELF64 fuer aarch64 mit zwei LOAD-Segmenten und einem GNU_RELRO dazwischen. */
function elf64(align) {
  const buf = Buffer.alloc(64 + 3 * 56 + 32)
  buf.writeUInt32BE(0x7f454c46, 0)
  buf[4] = 2
  buf[5] = 1
  buf.writeUInt16LE(183, 18)
  buf.writeBigUInt64LE(64n, 32)
  buf.writeUInt16LE(56, 54)
  buf.writeUInt16LE(3, 56)
  const kopf = (i, typ, ausrichtung) => {
    const o = 64 + i * 56
    buf.writeUInt32LE(typ, o)
    buf.writeBigUInt64LE(BigInt(i * align), o + 8)
    buf.writeBigUInt64LE(BigInt(i * align), o + 16)
    buf.writeBigUInt64LE(BigInt(ausrichtung), o + 48)
  }
  kopf(0, 1, align)
  kopf(1, 0x6474e552, 1)
  kopf(2, 1, align)
  return buf
}

/** Ein ELF32 mit einem LOAD-Segment. */
function elf32(align) {
  const buf = Buffer.alloc(52 + 32 + 16)
  buf.writeUInt32BE(0x7f454c46, 0)
  buf[4] = 1
  buf[5] = 1
  buf.writeUInt32LE(52, 28)
  buf.writeUInt16LE(32, 42)
  buf.writeUInt16LE(1, 44)
  buf.writeUInt32LE(1, 52)
  buf.writeUInt32LE(align, 52 + 28)
  return buf
}

/**
 * Schreibt ein ZIP. Je Eintrag: name, daten, gepackt (deflate) und, fuer unkomprimierte
 * Eintraege, das Vielfache, auf dem die Daten beginnen sollen (Fuellfeld wie bei zipalign).
 */
function zip(name, eintraege) {
  const teile = []
  const zentral = []
  let ort = 0
  for (const e of eintraege) {
    const n = Buffer.from(e.name)
    const inhalt = e.gepackt ? deflateRawSync(e.daten) : e.daten
    let extra = 0
    if (e.ausrichtung) extra = (e.ausrichtung - ((ort + 30 + n.length) % e.ausrichtung)) % e.ausrichtung
    if (e.versatz) extra += e.versatz
    const lokal = Buffer.alloc(30)
    lokal.writeUInt32LE(0x04034b50, 0)
    lokal.writeUInt16LE(e.gepackt ? 8 : 0, 8)
    lokal.writeUInt32LE(inhalt.length, 18)
    lokal.writeUInt32LE(e.daten.length, 22)
    lokal.writeUInt16LE(n.length, 26)
    lokal.writeUInt16LE(extra, 28)
    const z = Buffer.alloc(46)
    z.writeUInt32LE(0x02014b50, 0)
    z.writeUInt16LE(e.gepackt ? 8 : 0, 10)
    z.writeUInt32LE(inhalt.length, 20)
    z.writeUInt32LE(e.daten.length, 24)
    z.writeUInt16LE(n.length, 28)
    z.writeUInt32LE(ort, 42)
    zentral.push(z, n)
    teile.push(lokal, n, Buffer.alloc(extra), inhalt)
    ort += 30 + n.length + extra + inhalt.length
  }
  const cd = Buffer.concat(zentral)
  const ende = Buffer.alloc(22)
  ende.writeUInt32LE(0x06054b50, 0)
  ende.writeUInt16LE(eintraege.length, 8)
  ende.writeUInt16LE(eintraege.length, 10)
  ende.writeUInt32LE(cd.length, 12)
  ende.writeUInt32LE(ort, 16)
  const pfad = join(arbeit, name)
  writeFileSync(pfad, Buffer.concat([...teile, cd, ende]))
  return pfad
}

const manifest = { name: 'AndroidManifest.xml', daten: Buffer.from('x'.repeat(300)), gepackt: true }
const LIB = 'lib/arm64-v8a/libprobe.so'

test('leseElfLoad liest nur die LOAD-Segmente und ihre Ausrichtung', () => {
  const e = leseElfLoad(elf64(0x4000))
  assert.equal(e.bit, 64)
  assert.deepEqual(e.segmente.map((s) => s.align), [0x4000, 0x4000])
  assert.throws(() => leseElfLoad(Buffer.alloc(100)), /not an ELF/)
})

test('leseZip nennt den Ort der Daten, nicht den des Kopfes', () => {
  const pfad = zip('ort.apk', [manifest, { name: LIB, daten: elf64(0x4000), ausrichtung: SEITE_16KB }])
  const lib = leseZip(pfad).find((x) => x.name === LIB)
  assert.equal(lib.methode, 0)
  assert.equal(lib.datenOffset % SEITE_16KB, 0)
  assert.ok(lib.datenOffset > 0)
})

test('ein APK mit 16-KB-Bibliothek auf 16-KB-Grenze besteht', () => {
  const e = pruefe16kb(zip('gut.apk', [manifest, { name: LIB, daten: elf64(0x4000), ausrichtung: SEITE_16KB }]))
  assert.equal(e.art, 'apk')
  assert.equal(e.libs.length, 1)
  assert.equal(e.ok, true)
  assert.equal(e.libs[0].kleinsteAusrichtung, 0x4000)
})

test('eine groessere Ausrichtung (64 KB) besteht ebenfalls', () => {
  assert.equal(pruefe16kb(zip('gross.apk', [manifest, { name: LIB, daten: elf64(0x10000), ausrichtung: SEITE_16KB }])).ok, true)
})

test('eine Bibliothek mit 4-KB-Segmenten faellt durch, auch wenn das ZIP stimmt', () => {
  const e = pruefe16kb(zip('elf4k.apk', [manifest, { name: LIB, daten: elf64(0x1000), ausrichtung: SEITE_16KB }]))
  assert.equal(e.ok, false)
  assert.equal(e.libs[0].elfOk, false)
  assert.equal(e.libs[0].zipOk, true)
  assert.match(e.libs[0].grund, /max-page-size=16384/)
})

test('eine unkomprimierte Bibliothek neben der 16-KB-Grenze faellt durch', () => {
  const e = pruefe16kb(zip('zip4k.apk', [manifest, { name: LIB, daten: elf64(0x4000), ausrichtung: SEITE_16KB, versatz: 4096 }]))
  assert.equal(e.ok, false)
  assert.equal(e.libs[0].elfOk, true)
  assert.equal(e.libs[0].zipOk, false)
})

test('eine komprimierte Bibliothek braucht keine ZIP-Grenze, aber das ELF zaehlt', () => {
  assert.equal(pruefe16kb(zip('gepackt-gut.apk', [manifest, { name: LIB, daten: elf64(0x4000), gepackt: true }])).ok, true)
  assert.equal(pruefe16kb(zip('gepackt-schlecht.apk', [manifest, { name: LIB, daten: elf64(0x1000), gepackt: true }])).ok, false)
})

test('im AAB liegt die Bibliothek unter base/lib und wird genauso gelesen', () => {
  const bundle = { name: 'BundleConfig.pb', daten: Buffer.from('b'), gepackt: true }
  const gut = pruefe16kb(zip('gut.aab', [bundle, { name: `base/${LIB}`, daten: elf64(0x4000), gepackt: true }]))
  assert.equal(gut.art, 'aab')
  assert.equal(gut.libs.length, 1)
  assert.equal(gut.ok, true)
  assert.equal(pruefe16kb(zip('schlecht.aab', [bundle, { name: `base/${LIB}`, daten: elf64(0x1000), gepackt: true }])).ok, false)
})

test('eine 32-Bit-Bibliothek ist ausgenommen, eine 64-Bit-Bibliothek daneben nicht', () => {
  const e = pruefe16kb(zip('gemischt.apk', [manifest, { name: 'lib/armeabi-v7a/libprobe.so', daten: elf32(0x1000), gepackt: true }, { name: LIB, daten: elf64(0x1000), gepackt: true }]))
  assert.equal(e.libs[0].ok, true)
  assert.equal(e.libs[0].pflicht, false)
  assert.equal(e.libs[1].ok, false)
  assert.equal(e.ok, false)
})

test('eine kaputte Bibliothek ist ein Fund, kein Absturz', () => {
  const e = pruefe16kb(zip('kaputt.apk', [manifest, { name: LIB, daten: Buffer.from('kein elf'), gepackt: true }]))
  assert.equal(e.ok, false)
  assert.match(e.libs[0].grund, /could not be read/)
})

test('der Bericht nennt je Bibliothek eine Zeile und das Urteil', () => {
  const schlecht = bericht16kb(zip('bericht.aab', [{ name: 'BundleConfig.pb', daten: Buffer.from('b'), gepackt: true }, { name: `base/${LIB}`, daten: elf64(0x1000), gepackt: true }]))
  assert.equal(schlecht.ok, false)
  assert.equal(schlecht.zeilen.filter((z) => z.ok === false).length, 1)
  assert.match(schlecht.zeilen[0].text, /0x1000/)
  const fehlt = bericht16kb(join(arbeit, 'gibt-es-nicht.apk'))
  assert.equal(fehlt.ok, false)
})
