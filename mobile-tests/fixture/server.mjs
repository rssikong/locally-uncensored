// Winziger Server fuer die Testseite. Nur fuer den Selbsttest.
// Start: node fixture/server.mjs [port]   (Standard 8765, bindet nur an 127.0.0.1)

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const hier = dirname(fileURLToPath(import.meta.url))

export function starteFixture(port = 8765) {
  const zaehler = { bezahlt: 0, zerstoert: 0 }
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const pfad = new URL(req.url, 'http://x').pathname
      if (pfad === '/' || pfad === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(readFileSync(join(hier, 'index.html')))
      } else if (pfad === '/zustand.html') {
        // Zweite Testseite der Rahmenprobe ohne Geraet (trocken/rahmen.mjs): Zaehler, Schalter im Blatt, festgehaltene Liste.
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(readFileSync(join(hier, 'zustand.html')))
      } else if (pfad === '/strom') {
        // Langsamer Strom fuer die Persistenzpruefung "Abschuss waehrend eines Streams":
        // n Teile im Abstand von ms. Von jeder Herkunft lesbar (die App laeuft auf tauri://localhost).
        const q = new URL(req.url, 'http://x').searchParams
        const n = Math.min(Number(q.get('n')) || 100, 1000)
        const ms = Math.min(Number(q.get('ms')) || 100, 5000)
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' })
        let i = 0
        const t = setInterval(() => {
          i++
          res.write(`teil-${i}\n`)
          if (i >= n) {
            clearInterval(t)
            res.end()
          }
        }, ms)
        req.on('close', () => clearInterval(t))
      } else if (pfad === '/bezahlt' || pfad === '/zerstoert') {
        // Zaehlt, ob ein gesperrter Knopf der Testseite doch ausgeloest wurde.
        zaehler[pfad.slice(1)]++
        res.writeHead(204)
        res.end()
      } else {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('nicht gefunden')
      }
    })
    server.on('error', reject)
    // closeAllConnections: Ein offener Strom haelt den Server sonst am Leben.
    server.listen(port, '127.0.0.1', () => resolve({ server, port, zaehler, stop: () => new Promise((r) => { server.close(r); server.closeAllConnections?.() }) }))
  })
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  const { port } = await starteFixture(Number(process.argv[2]) || 8765)
  console.log(`Fixture auf http://127.0.0.1:${port}/`)
}
