#!/usr/bin/env node
// Ein Schritt am Geraet ueber die Treiber aus mobile-tests/driver, fuer das
// Erkunden von Hand und fuer kurze Belege.
//
//   PLATFORM=android ANDROID_SERIAL=emulator-5560 APP_PKG=com.purpledoubled.locallyuncensored \
//     node scripts/mobile/geraet-schritt.mjs 'await d.tap("[data-testid=m-onboarding-next]"); return d.viewport()'
//   PLATFORM=ios IOS_SIM=LU-R2Rust-klein APP_PKG=com.purpledoubled.lu \
//     node scripts/mobile/geraet-schritt.mjs --ohne 'return d.info()'
//
// Das Argument ist der Rumpf einer async-Funktion mit `d` (verbundener
// Treiber, Vertrag in mobile-tests/driver/INTERFACE.md) und `tid(id)` fuer
// `[data-testid="id"]`. Der Rueckgabewert wird als JSON ausgegeben.
// `--ohne` verbindet nicht mit der WebView (fuer Installieren, Starten,
// Bildschirmfotos eines gewoehnlichen Baus, dessen WebView sich nicht
// inspizieren laesst).
import { ladeTreiber } from '../../mobile-tests/driver/index.mjs'

const args = process.argv.slice(2)
const ohne = args[0] === '--ohne'
if (ohne) args.shift()
const rumpf = args[0]
if (!rumpf) {
  console.error('Aufruf: geraet-schritt.mjs [--ohne] "<rumpf>"')
  process.exit(2)
}
const tid = (id) => `[data-testid="${id}"]`
const d = await ladeTreiber()
let code = 0
try {
  if (!ohne) await d.connect({ pkg: process.env.APP_PKG, start: false })
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const ergebnis = await new AsyncFunction('d', 'tid', rumpf)(d, tid)
  if (ergebnis !== undefined) console.log(typeof ergebnis === 'string' ? ergebnis : JSON.stringify(ergebnis, null, 1))
} catch (e) {
  console.error('FEHLER:', e?.message ?? e)
  code = 1
} finally {
  try { await d.disconnect() } catch { /* war nie verbunden */ }
}
process.exit(code)
