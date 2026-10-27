#!/usr/bin/env node
// Fuehrt einen JavaScript-Ausdruck im WebView der laufenden Android-App aus
// und druckt das Ergebnis. Nur fuer Debug-Bauten: ein Release-Bau oeffnet den
// Debug-Socket nicht (siehe release-opens-no-debug-socket.test.ts).
//
// Wozu: ein Tauri-Kommando am Geraet ausloesen, ohne die Oberflaeche zu
// bedienen, zum Beispiel die Engine starten und ihren Status lesen.
//
// Aufruf:
//   node scripts/mobile/android-webview-eval.mjs '<ausdruck>'
//   node scripts/mobile/android-webview-eval.mjs --invoke <kommando> '<json-argumente>'
//
// Beispiele:
//   node scripts/mobile/android-webview-eval.mjs 'document.title'
//   node scripts/mobile/android-webview-eval.mjs --invoke bundled_engine_status
//   node scripts/mobile/android-webview-eval.mjs --invoke start_bundled_engine \
//     '{"modelPath":"/data/user/0/com.purpledoubled.locallyuncensored/models/m.gguf"}'
//
// Braucht adb im PATH und Node 22 oder neuer (eingebautes WebSocket und fetch).
// Umgebung: ANDROID_SERIAL waehlt das Geraet, LU_ANDROID_PACKAGE das Paket,
// LU_CDP_PORT den lokalen Port (Standard 9333).
import { execFileSync } from 'node:child_process'

const PACKAGE = process.env.LU_ANDROID_PACKAGE || 'com.purpledoubled.locallyuncensored'
const PORT = Number(process.env.LU_CDP_PORT || 9333)
// Nie "das einzige angeschlossene Geraet": ohne ANDROID_SERIAL wird abgebrochen (wie die Treiber des Rahmens,
// mobile-tests/lib/geraete.mjs). adb liest ANDROID_SERIAL selbst, hier wird es zusaetzlich ausdruecklich uebergeben.
const SERIAL = String(process.env.ANDROID_SERIAL ?? '').trim()
if (!SERIAL) {
  console.error('Kein Geraet genannt: ANDROID_SERIAL setzen (Seriennummer aus `adb devices`). Dieses Skript waehlt nie von selbst ein Geraet.')
  process.exit(2)
}
const adb = (...args) => execFileSync('adb', ['-s', SERIAL, ...args], { encoding: 'utf8' }).trim()

const argv = process.argv.slice(2)
let expression
if (argv[0] === '--invoke') {
  const command = argv[1]
  const args = argv[2] ? JSON.parse(argv[2]) : {}
  if (!command) throw new Error('--invoke braucht einen Kommandonamen')
  // Fehler eines Kommandos sollen als Wert zurueckkommen, nicht als Ausnahme
  // ohne Text.
  expression = `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})
    .then((ok) => ({ ok }), (err) => ({ err: String(err && err.message ? err.message : err) }))`
} else {
  expression = argv.join(' ')
}
if (!expression) {
  console.error("Aufruf: android-webview-eval.mjs '<ausdruck>' | --invoke <kommando> '<json>'")
  process.exit(2)
}

const pid = adb('shell', 'pidof', PACKAGE).split(/\s+/)[0]
if (!pid) throw new Error(`${PACKAGE} laeuft nicht`)
adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`)

try {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('kein WebView gefunden (ist es ein Debug-Bau?)')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('WebSocket zum WebView kam nicht zustande'))
  })
  const answer = await new Promise((resolve) => {
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id === 1) resolve(message)
    }
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }))
  })
  ws.close()

  if (answer.result?.exceptionDetails) {
    console.error(JSON.stringify(answer.result.exceptionDetails, null, 2))
    process.exitCode = 1
  } else {
    const value = answer.result?.result?.value
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
  }
} finally {
  try { adb('forward', '--remove', `tcp:${PORT}`) } catch { /* schon weg */ }
}
