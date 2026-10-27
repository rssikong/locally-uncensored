#!/usr/bin/env node
// Engine-Beleg im iOS-Simulator: legt ein GGUF in den Modellordner der App,
// startet die In-Prozess-Engine ueber die echten Tauri-Kommandos und fragt sie
// aus der WebView heraus ueber den Proxy in Rust, einmal am Stueck und einmal
// als Strom. Der Proxy haengt das Engine-Token an, das die Seite nie sieht;
// ein fetch direkt auf den Port muss abgewiesen werden und wird mitgeprueft.
// Danach Einbettungen auf 8128 und das Loeschen des geladenen Modells.
//
// Aufruf:
//   node scripts/mobile/ios/engine-beleg.mjs <udid|name> <chat.gguf> [embed.gguf] [--gpu-erzwingen] [--behalten]
//
//   --gpu-erzwingen  startet die App mit LU_INPROC_FORCE_GPU=1 neu. Im Simulator
//                    rechnet Metal falsch, der Selbsttest muss das fangen und die
//                    Engine sichtbar auf den Prozessor zurueckfallen.
//   --behalten       loescht das Modell am Ende nicht (fuer Lebenszyklus-Messungen).
//
// Alle Tokens pro Sekunde sind SIMULATORWERTE: der Simulator rechnet auf dem
// Prozessor des Macs. Sie sagen nichts ueber ein iPhone.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { connect, udidVon } from "./ios-harness.mjs";

const BUNDLE = process.env.LU_IOS_BUNDLE || "com.purpledoubled.lu";
const argv = process.argv.slice(2);
const gpuErzwingen = argv.includes("--gpu-erzwingen");
const behalten = argv.includes("--behalten");
const [geraet, chatGguf, embedGguf] = argv.filter((a) => !a.startsWith("--"));
if (!geraet || !chatGguf) {
  console.error("Aufruf: engine-beleg.mjs <udid|name> <chat.gguf> [embed.gguf] [--gpu-erzwingen] [--behalten]");
  process.exit(2);
}
const simctl = (...a) => execFileSync("xcrun", ["simctl", ...a], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const udid = await udidVon(geraet);
const fehler = [];
const pruefe = (name, ok, detail = "") => {
  console.log(`${ok ? "OK    " : "FEHLER"} ${name}${detail ? "  " + detail : ""}`);
  if (!ok) fehler.push(name);
};

// App frisch starten, damit die Umgebungsvariable sicher gilt oder sicher fehlt.
try { simctl("terminate", udid, BUNDLE); } catch { /* lief nicht */ }
const env = { ...process.env };
delete env.SIMCTL_CHILD_LU_INPROC_FORCE_GPU;
if (gpuErzwingen) env.SIMCTL_CHILD_LU_INPROC_FORCE_GPU = "1";
execFileSync("xcrun", ["simctl", "launch", udid, BUNDLE], { env, encoding: "utf8" });
await sleep(1500);

const s = await connect({ bundleId: BUNDLE, geraet: udid });
const invoke = (kommando, args = {}) =>
  s.evalJs(
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(kommando)}, ${JSON.stringify(args)})
      .then((ok) => ({ ok }), (err) => ({ err: String(err && err.message ? err.message : err) }))`,
    { timeoutMs: 180000 },
  );

try {
  await s.warteAuf("document.readyState === 'complete' && typeof window.__TAURI_INTERNALS__ === 'object'", { timeoutMs: 20000 });

  const liste = await invoke("list_bundled_models");
  const ordner = liste.ok.dir;
  mkdirSync(ordner, { recursive: true });
  const chatZiel = join(ordner, basename(chatGguf));
  if (!existsSync(chatZiel)) copyFileSync(chatGguf, chatZiel);
  console.log("Modellordner:", ordner.replace(/^.*\/Containers\/Data\/Application\/[^/]+/, "<container>"));

  // 1. Start
  let t0 = Date.now();
  const start = await invoke("start_bundled_engine", { modelPath: chatZiel });
  console.log("start_bundled_engine", `(${Date.now() - t0} ms)`, JSON.stringify(start));
  pruefe("Engine startet", !!start.ok && !start.err);
  const status = await invoke("bundled_engine_status");
  console.log("bundled_engine_status", JSON.stringify(status));
  pruefe("Status inProcess", status.ok?.inProcess === true);
  pruefe("Status running und healthy", status.ok?.running === true && status.ok?.healthy === true);
  pruefe("Beschleuniger ist cpu", status.ok?.accelerator === "cpu", `accelerator=${status.ok?.accelerator}`);
  if (gpuErzwingen) {
    pruefe("Selbsttest hat den Rueckfall ausgeloest (retried)", start.ok?.retried === true);
    pruefe("Antwort und Status sagen cpuOnly", start.ok?.cpuOnly === true && status.ok?.cpuOnly === true);
    pruefe("Hinweistext vorhanden", typeof (start.ok?.note ?? status.ok?.sanityNote) === "string", String(start.ok?.note ?? status.ok?.sanityNote));
  } else {
    pruefe("kein Rueckfall noetig (retried fehlt)", !start.ok?.retried);
  }
  const port = start.ok?.port ?? 8127;

  // Seit der Durchsicht verlangt die Engine auf jedem Weg ihr Token
  // (engine_token.rs). Die Seite kennt es nicht: ein fetch aus der WebView
  // direkt auf den Port wird abgewiesen, jede Anfrage laeuft ueber den Proxy
  // in Rust (proxy_localhost, proxy_localhost_stream_chunked), der das Token
  // anhaengt. So fragt auch die App, und so fragt dieser Beleg.
  const direkt = await s.evalJs(
    `fetch("http://127.0.0.1:${port}/health").then((r) => ({ status: r.status }), (e) => ({ status: 0, fehler: String(e) }))`,
    { timeoutMs: 20000 },
  );
  console.log("direkt ohne Token:", JSON.stringify(direkt));
  pruefe("Direkter Aufruf ohne Token wird abgewiesen", direkt.status !== 200, `status=${direkt.status}`);

  // 2. Chat am Stueck, aus der WebView ueber den Proxy
  const chat = await s.evalJs(
    `(async () => {
      const t = performance.now();
      try {
        const antwort = await window.__TAURI_INTERNALS__.invoke("proxy_localhost", {
          url: "http://127.0.0.1:${port}/v1/chat/completions", method: "POST", timeoutMs: 120000,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: "Count from 1 to 10." }], temperature: 0, max_tokens: 48 }),
        });
        const j = JSON.parse(antwort);
        return { status: 200, ms: Math.round(performance.now() - t), text: j.choices?.[0]?.message?.content, usage: j.usage, timings: j.timings };
      } catch (e) {
        return { status: 0, ms: Math.round(performance.now() - t), fehler: String(e && e.message ? e.message : e) };
      }
    })()`,
    { timeoutMs: 120000 },
  );
  console.log("chat (Proxy):", JSON.stringify(chat));
  pruefe("Chat ueber den Proxy antwortet", chat.status === 200, chat.fehler || "");
  pruefe("Chat-Text plausibel (zaehlt bis 10)", /1\D+2\D+3\D+4\D+5\D+6\D+7\D+8\D+9\D+10/.test(chat.text || ""), JSON.stringify(chat.text));
  if (chat.usage?.completion_tokens) {
    console.log(`SIMULATORWERT am Stueck: ${chat.usage.completion_tokens} Tokens in ${chat.ms} ms einschliesslich Prompt, ${(chat.usage.completion_tokens / (chat.ms / 1000)).toFixed(1)} Tokens/s`);
  }

  // 3. Chat als Strom, aus der WebView ueber den Proxy. Der Kanal ist derselbe,
  // den @tauri-apps/api als Channel baut: eine Rueckrufnummer, uebergeben als
  // "__CHANNEL__:<nummer>", Nachrichten mit laufendem Index.
  const strom = await s.evalJs(
    `(async () => {
      const T = window.__TAURI_INTERNALS__;
      const t = performance.now(); const dec = new TextDecoder();
      let puffer = "", text = "", teile = 0, lesungen = 0, erstes = null, letztes = null, fertig = false;
      const nimm = (m) => {
        const bytes = m instanceof ArrayBuffer ? new Uint8Array(m) : ArrayBuffer.isView(m) ? m : Uint8Array.from(m);
        lesungen++;
        puffer += dec.decode(bytes, { stream: true });
        let i;
        while ((i = puffer.indexOf("\\n")) >= 0) {
          const zeile = puffer.slice(0, i).trim(); puffer = puffer.slice(i + 1);
          if (!zeile.startsWith("data:")) continue;
          const d = zeile.slice(5).trim();
          if (d === "[DONE]") { fertig = true; continue; }
          const delta = JSON.parse(d).choices?.[0]?.delta?.content;
          if (delta) { teile++; text += delta; letztes = performance.now(); if (erstes === null) erstes = letztes; }
        }
      };
      // Nachrichten koennen ueberholen: nach dem Index ordnen.
      const wartend = new Map(); let naechster = 0;
      const kanal = T.transformCallback((roh) => {
        if (!roh || typeof roh !== "object" || "end" in roh) return;
        wartend.set(roh.index, roh.message);
        while (wartend.has(naechster)) { const m = wartend.get(naechster); wartend.delete(naechster); naechster++; nimm(m); }
      });
      let fehler = null;
      try {
        await T.invoke("proxy_localhost_stream_chunked", {
          url: "http://127.0.0.1:${port}/v1/chat/completions", method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: "Write three short sentences about the sea." }], temperature: 0, max_tokens: 96, stream: true }),
          onChunk: "__CHANNEL__:" + kanal,
        });
      } catch (e) {
        fehler = String(e && e.message ? e.message : e);
      }
      // Die letzten Teile koennen nach dem Ende des Kommandos eintreffen.
      for (let n = 0; n < 40 && !fertig && !fehler; n++) await new Promise((r) => setTimeout(r, 50));
      return { status: fehler ? 0 : 200, fehler, teile, lesungen, fertig, text,
               msBisErstes: Math.round(erstes - t), msErzeugung: Math.round(letztes - erstes), msGesamt: Math.round(performance.now() - t) };
    })()`,
    { timeoutMs: 120000 },
  );
  console.log("chat (Strom):", JSON.stringify(strom));
  pruefe("Strom ueber den Proxy endet ohne Fehler", strom.status === 200, strom.fehler || "");
  pruefe("Strom kommt in vielen Teilen und endet mit [DONE]", strom.teile > 5 && strom.lesungen > 3 && strom.fertig, `teile=${strom.teile} lesungen=${strom.lesungen}`);
  pruefe("Strom-Text plausibel", /\bsea\b/i.test(strom.text || "") && !/(.)\1{9,}/.test(strom.text || ""), JSON.stringify((strom.text || "").slice(0, 120)));
  if (strom.teile > 1 && strom.msErzeugung > 0) {
    console.log(`SIMULATORWERT Strom: ${strom.teile} Teile in ${strom.msErzeugung} ms nach dem ersten Token, ${((strom.teile - 1) / (strom.msErzeugung / 1000)).toFixed(1)} Tokens/s, erstes Token nach ${strom.msBisErstes} ms`);
  }

  // 4. Einbettungen
  if (embedGguf) {
    const embedZiel = join(ordner, basename(embedGguf));
    if (!existsSync(embedZiel)) copyFileSync(embedGguf, embedZiel);
    const es = await invoke("start_bundled_embed", { modelPath: embedZiel });
    console.log("start_bundled_embed", JSON.stringify(es));
    pruefe("Einbettungs-Engine startet", !!es.ok && !es.err);
    const eport = es.ok?.port ?? 8128;
    const emb = await s.evalJs(
      `(async () => {
        try {
          const antwort = await window.__TAURI_INTERNALS__.invoke("proxy_localhost", {
            url: "http://127.0.0.1:${eport}/v1/embeddings", method: "POST", timeoutMs: 120000,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input: "search_document: The sea is wide." }),
          });
          const v = JSON.parse(antwort).data?.[0]?.embedding || [];
          return { status: 200, laenge: v.length, norm: Math.sqrt(v.reduce((a, b) => a + b * b, 0)), anfang: v.slice(0, 3) };
        } catch (e) {
          return { status: 0, laenge: 0, norm: 0, fehler: String(e && e.message ? e.message : e) };
        }
      })()`,
      { timeoutMs: 120000 },
    );
    console.log("embeddings:", JSON.stringify(emb));
    pruefe("Einbettung liefert 768 Werte", emb.status === 200 && emb.laenge === 768, `port=${eport}`);
    pruefe("Einbettung ist kein Nullvektor", emb.norm > 0.5);
    console.log("bundled_embed_status", JSON.stringify(await invoke("bundled_embed_status")));
    console.log("stop_bundled_embed", JSON.stringify(await invoke("stop_bundled_embed")));
  }

  // 5. Das geladene Modell loeschen
  if (!behalten) {
    const del = await invoke("delete_bundled_model", { path: chatZiel });
    console.log("delete_bundled_model", JSON.stringify(del));
    pruefe("Loeschen des geladenen Modells stoppt die Engine", del.ok?.stopped === true);
    pruefe("Datei ist weg", !existsSync(chatZiel));
    const danach = await invoke("bundled_engine_status");
    console.log("bundled_engine_status danach", JSON.stringify(danach));
    pruefe("Engine laeuft danach nicht mehr", danach.ok?.running === false);
  }

  const fehlerKonsole = s.consoleLog().filter((k) => k.level === "error" && !/sync_custom_model_paths/.test(k.text));
  pruefe("keine neuen Konsolenfehler", fehlerKonsole.length === 0, fehlerKonsole.map((k) => k.text).join(" | ").slice(0, 400));
  const netz = s.netzFehler();
  pruefe("keine Netzfehler", netz.length === 0, JSON.stringify(netz).slice(0, 300));
} finally {
  await s.trennen();
}
console.log(fehler.length === 0 ? "ENGINE-BELEG OK" : `ENGINE-BELEG FEHLER: ${fehler.join(", ")}`);
process.exit(fehler.length === 0 ? 0 : 1);
