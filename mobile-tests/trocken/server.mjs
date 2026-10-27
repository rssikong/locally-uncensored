// Startet die Vite-Vorschau eines Worktrees fuer den Trockenlauf, ohne in den
// Worktree zu schreiben: eigene Konfiguration, eigener Cache und eigener Port
// liegen unter mobile-tests/out/trocken/ (steht in .gitignore).
//
//   VORSCHAU_WT    Worktree, dessen Shell gezeigt wird. Standard: ../../shell
//   VORSCHAU_PORT  Standard 5411
//   VORSCHAU_URL   fremder, schon laufender Server. Dann startet hier nichts.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, symlinkSync, lstatSync, rmSync, openSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { WURZEL } from '../lib/lauf.mjs'

export const VORSCHAU_WT = resolve(process.env.VORSCHAU_WT ?? join(WURZEL, '..', '..', 'shell'))
export const VORSCHAU_PORT = Number(process.env.VORSCHAU_PORT) || 5411

async function antwortet(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch {
    return false
  }
}

export async function starteVorschau({ wt = VORSCHAU_WT, port = VORSCHAU_PORT } = {}) {
  if (process.env.VORSCHAU_URL) return { url: process.env.VORSCHAU_URL.replace(/\/$/, ''), wt: null, fremd: true, stop: async () => {} }
  const url = `http://localhost:${port}`
  const vite = join(wt, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!existsSync(vite)) throw new Error(`kein vite in ${wt}/node_modules. Im Worktree fehlt npm ci.`)
  const dir = join(WURZEL, 'out', 'trocken', `vite-${port}`)
  mkdirSync(dir, { recursive: true })
  // Die Konfiguration des Worktrees importiert vite und Plugins. Aufgeloest wird
  // vom Ort DIESER Datei aus, deshalb ein Verweis auf node_modules des Worktrees.
  const nm = join(dir, 'node_modules')
  try {
    if (lstatSync(nm)) rmSync(nm, { recursive: false, force: true })
  } catch {}
  symlinkSync(join(wt, 'node_modules'), nm)
  const cfg = join(dir, 'vite.config.ts')
  writeFileSync(
    cfg,
    [
      '// Erzeugt von mobile-tests/trocken/server.mjs. Nicht von Hand aendern.',
      `import basis from ${JSON.stringify(join(wt, 'vite.config.ts'))}`,
      'export default {',
      '  ...basis,',
      `  root: ${JSON.stringify(wt)},`,
      `  cacheDir: ${JSON.stringify(join(dir, 'cache'))},`,
      '  clearScreen: false,',
      // Ohne das Plugin lu-dev-server: Es startet beim Hochfahren lokale Dienste
      // (Whisper, Suche nach Ollama und ComfyUI) und haengt /local-api an. Die
      // Mobile-Shell braucht nichts davon, und der Trockenlauf soll nichts starten.
      "  plugins: (basis.plugins ?? []).flat(Infinity).filter((p) => p && p.name !== 'lu-dev-server'),",
      // Kein Proxy: Die Vorschau darf nichts an fremde Rechner weiterreichen.
      `  server: { ...basis.server, port: ${port}, strictPort: true, proxy: {}, hmr: false, open: false },`,
      '}',
      '',
    ].join('\n'),
  )
  if (await antwortet(url)) throw new Error(`auf Port ${port} laeuft schon etwas. VORSCHAU_PORT aendern oder VORSCHAU_URL setzen.`)
  const log = openSync(join(dir, 'vite.log'), 'w')
  const kind = spawn(process.execPath, [vite, '--config', cfg, '--configLoader', 'runner', '--port', String(port), '--strictPort'], {
    cwd: dir,
    // VITE_LU_ABNAHME=1 baut den Testhaken ein (src/mobile/dev/test-hook.ts). OHNE_HAKEN=1 laesst ihn weg.
    // VITE_LU_BUILD_TARGET=mobile: nur damit packt der Entwicklungsserver die Handy-Oberflaeche ein (src/main.tsx).
    // Ohne die Variable zeigt die Vorschau den Desktop, und Tabelle wie Aufnahme saehen keine Handy-Seite.
    env: { ...process.env, VITE_LU_BUILD_TARGET: 'mobile', LU_DEV_PORT: String(port), BROWSER: 'none', VITE_LU_ABNAHME: process.env.OHNE_HAKEN === '1' ? '' : '1' },
    stdio: ['ignore', log, log],
  })
  let ende = null
  kind.on('exit', (code) => (ende = code ?? -1))
  const bis = Date.now() + 90000
  while (Date.now() < bis) {
    if (ende !== null) throw new Error(`vite ist beendet (Code ${ende}). Log: ${join(dir, 'vite.log')}`)
    if (await antwortet(url)) return { url, wt, fremd: false, log: join(dir, 'vite.log'), stop: async () => { kind.kill('SIGTERM') } }
    await new Promise((r) => setTimeout(r, 400))
  }
  kind.kill('SIGTERM')
  throw new Error(`vite antwortet nach 90 s nicht. Log: ${join(dir, 'vite.log')}`)
}
