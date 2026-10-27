#!/usr/bin/env node
// Fuehrt einen JS-Ausdruck in der laufenden LU-App im iOS-Simulator aus und
// gibt das Ergebnis als JSON aus. Gegenstueck zu ../android-webview-eval.mjs.
//
// Aufruf:
//   node scripts/mobile/ios/eval.mjs <udid|name|booted> '<ausdruck>'
//   node scripts/mobile/ios/eval.mjs <udid|name|booted> --invoke <kommando> ['<json-argumente>']
//
// Beispiele:
//   node scripts/mobile/ios/eval.mjs LU-iOS-klein 'document.title'
//   node scripts/mobile/ios/eval.mjs LU-iOS-klein --invoke bundled_engine_status
//
// Die WebView muss inspizierbar sein: Debug-Bau, oder Release-Bau mit dem
// Cargo-Feature `abnahme`. Umgebung: LU_IOS_BUNDLE waehlt die Kennung.
import { connect } from "./ios-harness.mjs";

const BUNDLE = process.env.LU_IOS_BUNDLE || "com.purpledoubled.lu";
const [geraet, ...rest] = process.argv.slice(2);
let src;
if (rest[0] === "--invoke") {
  const kommando = rest[1];
  const args = rest[2] ? JSON.parse(rest[2]) : {};
  if (!kommando) throw new Error("--invoke braucht einen Kommandonamen");
  // Fehler eines Kommandos kommen als Wert zurueck, nicht als Ausnahme ohne Text.
  src = `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(kommando)}, ${JSON.stringify(args)})
    .then((ok) => ({ ok }), (err) => ({ err: String(err && err.message ? err.message : err) }))`;
} else {
  src = rest.join(" ");
}
if (!geraet || !src) {
  console.error("Aufruf: eval.mjs <udid|name|booted> '<ausdruck>' | --invoke <kommando> '<json>'");
  process.exit(2);
}
const s = await connect({ bundleId: BUNDLE, geraet });
try {
  console.log(JSON.stringify(await s.evalJs(src), null, 1));
} finally {
  await s.trennen();
}
