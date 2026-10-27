// Laufverzeichnis, Konfiguration und kleine Dateihilfen.

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function zeitstempel(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`
}

// mobile-tests/out/<plattform>/<zeitstempel>/. Mit LAUF_DIR laesst sich ein
// bestehender Lauf weiterfuellen (mehrere Werkzeuge, ein Bericht, ein Kostenzaehler).
export function laufVerzeichnis(plattform) {
  const dir = process.env.LAUF_DIR ? resolve(process.env.LAUF_DIR) : join(WURZEL, 'out', plattform, zeitstempel())
  mkdirSync(dir, { recursive: true })
  return dir
}

export function dateiName(s) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9._]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'ohne-name'
  )
}

export function schreibeJson(dir, rel, daten) {
  const p = join(dir, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(daten, null, 2) + '\n')
  return p
}

export function liesJson(pfad, ersatz = null) {
  if (!existsSync(pfad)) return ersatz
  try {
    return JSON.parse(readFileSync(pfad, 'utf8'))
  } catch {
    return ersatz
  }
}

export function liste(dir, endung) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(endung))
    .sort()
    .map((f) => join(dir, f))
}

export function rel(dir, pfad) {
  return relative(dir, pfad)
}

// Konfiguration: MT_CONFIG=<pfad zu .mjs> oder config.mjs neben diesem Projekt.
export async function ladeConfig(pfad = process.env.MT_CONFIG) {
  const p = pfad ? resolve(pfad) : join(WURZEL, 'config.mjs')
  const mod = await import(pathToFileURL(p).href)
  return { ...mod.default, _pfad: p }
}

export function istHauptmodul(metaUrl) {
  return !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === metaUrl
}
