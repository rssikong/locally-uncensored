#!/usr/bin/env node
// Fetch the HEAD of a GGUF on Hugging Face (metadata and tensor table, never
// the weights) and write it slimmed and gzipped as a test fixture for the VRAM
// plan (src-tauri/src/commands/vram_plan.rs).
//
//   node scripts/fetch-gguf-head.mjs <repo> <file> [<out-name>]
//
// Reads with HTTP Range requests, a few MB at most, so a 60 GB model costs the
// same as a 1 GB one. The slimmed head is a valid GGUF up to the end of its
// tensor table: every key is kept except arrays of more than 1024 elements
// (the tokenizer's vocabulary, scores and merges), which become empty arrays
// of the same element type. Nothing the plan reads is in those arrays. The
// file's real size is written into fixtures/gguf-heads/heads.json, because the
// plan needs it and the slimmed head no longer has it.
//
// A split model (`-00001-of-00003.gguf`) is fetched part by part, each part
// its own fixture, exactly as the app reads it from disk.

import { gzipSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'src-tauri', 'fixtures', 'gguf-heads')

const [repo, file, outName] = process.argv.slice(2)
if (!repo || !file) {
  console.error('usage: node scripts/fetch-gguf-head.mjs <repo> <file> [<out-name>]')
  process.exit(2)
}

const url = `https://huggingface.co/${repo}/resolve/main/${encodeURI(file)}`

async function range(from, to) {
  const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` }, redirect: 'follow' })
  if (res.status !== 206 && res.status !== 200) throw new Error(`${res.status} for ${url}`)
  const total = Number((res.headers.get('content-range') || '').split('/')[1] || 0)
  return { buf: Buffer.from(await res.arrayBuffer()), total }
}

class Need extends Error {}

// A reader over a growing buffer: throws Need when the bytes run out, and the
// caller fetches more and starts over. Heads are small, so starting over is
// cheaper than being clever.
function parse(buf) {
  let o = 0
  const need = (n) => { if (o + n > buf.length) throw new Need() }
  const u32 = () => { need(4); const v = buf.readUInt32LE(o); o += 4; return v }
  const u64 = () => { need(8); const v = buf.readBigUInt64LE(o); o += 8; return Number(v) }
  const str = () => { const n = u64(); need(n); const s = buf.subarray(o, o + n); o += n; return s }
  const FIXED = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 }
  const out = []
  const w32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); out.push(b) }
  const w64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); out.push(b) }
  const wstr = (s) => { w64(s.length); out.push(Buffer.from(s)) }

  need(4)
  if (buf.subarray(0, 4).toString() !== 'GGUF') throw new Error('not a GGUF')
  o = 4
  out.push(Buffer.from('GGUF'))
  const version = u32(); w32(version)
  const nTensors = u64(); w64(nTensors)
  const nKv = u64(); w64(nKv)
  let alignment = 32
  let dropped = 0
  for (let i = 0; i < nKv; i++) {
    const key = str(); wstr(key)
    const ty = u32(); w32(ty)
    if (ty === 8) { wstr(str()) }
    else if (ty === 9) {
      const ety = u32(); const n = u64()
      const start = o
      if (ety === 8) { for (let j = 0; j < n; j++) str() }
      else if (FIXED[ety]) { need(n * FIXED[ety]); o += n * FIXED[ety] }
      else throw new Error(`nested array in ${key}`)
      w32(ety)
      if (n > 1024) { w64(0); dropped++ } else { w64(n); out.push(buf.subarray(start, o)) }
    } else {
      const n = FIXED[ty]
      if (!n) throw new Error(`unknown type ${ty} at ${key}`)
      need(n)
      const raw = buf.subarray(o, o + n); o += n
      out.push(raw)
      if (key.toString() === 'general.alignment') alignment = raw.readUInt32LE(0)
    }
  }
  for (let i = 0; i < nTensors; i++) {
    wstr(str())
    const nd = u32(); w32(nd)
    for (let d = 0; d < nd; d++) w64(u64())
    w32(u32())
    w64(u64())
  }
  return { head: Buffer.concat(out), headBytes: o, nTensors, nKv, dropped, alignment }
}

let size = 4 * 1024 * 1024
let total = 0
let parsed = null
for (;;) {
  const r = await range(0, size - 1)
  total = r.total || total
  try {
    parsed = parse(r.buf)
    break
  } catch (e) {
    if (!(e instanceof Need)) throw e
    if (size >= 256 * 1024 * 1024) throw new Error('head larger than 256 MB')
    size *= 2
  }
}

mkdirSync(outDir, { recursive: true })
const name = outName || file.replace(/\.gguf$/i, '')
const gz = gzipSync(parsed.head, { level: 9 })
writeFileSync(join(outDir, `${name}.head.gguf.gz`), gz)
const manifestPath = join(outDir, 'heads.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
manifest[name] = { repo, file, fileBytes: total, headBytes: parsed.headBytes, tensors: parsed.nTensors, keys: parsed.nKv, droppedArrays: parsed.dropped }
const sorted = Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]]))
writeFileSync(manifestPath, JSON.stringify(sorted, null, 2) + '\n')
console.log(`${name}: ${parsed.nTensors} tensors, ${parsed.nKv} keys, head ${parsed.headBytes} bytes, file ${total} bytes, fixture ${gz.length} bytes`)
