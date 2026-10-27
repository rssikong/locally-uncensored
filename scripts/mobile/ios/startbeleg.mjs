#!/usr/bin/env node
// Startbeleg: haengt sich an die laufende LU-App im iOS-Simulator, liest die
// Startseite aus dem DOM, sammelt Konsole und Netzfehler und macht einen
// Screenshot. Ende 0 nur, wenn die Seite steht und die Konsole keinen Fehler
// ausser den unten dokumentierten zeigt.
//
// Aufruf: node scripts/mobile/ios/startbeleg.mjs <udid|name> [screenshot.png] [--neustart]
import { connect } from "./ios-harness.mjs";

const BUNDLE = process.env.LU_IOS_BUNDLE || "com.purpledoubled.lu";
const args = process.argv.slice(2);
const neustart = args.includes("--neustart");
const [geraet, bild] = args.filter((a) => !a.startsWith("--"));
if (!geraet) {
  console.error("Aufruf: startbeleg.mjs <udid|name> [screenshot.png] [--neustart]");
  process.exit(2);
}

// Bekannte, dokumentierte Konsolenfehler (mobile-docs/BAUEN.md, Abschnitt iOS).
// Jeder Eintrag braucht dort eine Begruendung.
const BEKANNT = [
  // Der Desktop-Code meldet beim Start seine Modellordner an ComfyUI. Das
  // Kommando gibt es auf dem Handy nicht (BAUEN.md Abschnitt 8), der Aufruf
  // wird abgelehnt und als Warnung ueber console.error protokolliert. Ohne
  // Folgen. Verschwindet, sobald die Mobile-Shell den Aufruf auslaesst.
  /Command sync_custom_model_paths not found/,
];

const s = await connect({ bundleId: BUNDLE, geraet, neustart });
let ok = true;
try {
  await s.warteAuf("document.readyState === 'complete' && !!document.querySelector('#root') && document.querySelector('#root').children.length > 0", { timeoutMs: 20000 });
  await new Promise((r) => setTimeout(r, 2500));
  const seite = await s.evalJs(`({
    href: location.href,
    title: document.title,
    ua: navigator.userAgent,
    breite: innerWidth, hoehe: innerHeight, dpr: devicePixelRatio,
    sicher: isSecureContext,
    tauri: typeof window.__TAURI_INTERNALS__ === 'object',
    text: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 400),
    knoepfe: [...document.querySelectorAll('button')].map((b) => (b.innerText || b.getAttribute('aria-label') || b.title || '').trim()).slice(0, 20),
  })`);
  console.log(JSON.stringify(seite, null, 1));
  const konsole = s.consoleLog();
  const fehler = konsole.filter((k) => k.level === "error" && !BEKANNT.some((re) => re.test(k.text)));
  console.log("Konsole gesamt:", konsole.length, "davon Fehler:", konsole.filter((k) => k.level === "error").length, "unbekannte Fehler:", fehler.length);
  for (const k of konsole) console.log(`  ${k.level}: ${String(k.text).slice(0, 300)}`);
  const netz = s.netzFehler();
  console.log("Netzfehler:", JSON.stringify(netz));
  if (bild) await s.screenshot(bild);
  if (!seite.text || !seite.tauri || fehler.length > 0) ok = false;
} finally {
  await s.trennen();
}
console.log(ok ? "STARTBELEG OK" : "STARTBELEG FEHLER");
process.exit(ok ? 0 : 1);
