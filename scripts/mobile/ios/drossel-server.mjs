// Gedrosselter Testserver auf dem Mac. Der Simulator teilt sich das Netz mit dem Mac,
// die App erreicht ihn deshalb unter http://127.0.0.1:<port>.
//   /gross?mb=20&kbps=2000  liefert mb Megabyte mit kbps Kilobyte pro Sekunde, mit Content-Length, ETag und Range (fuer Fortsetzen)
//   /sse                    sendet jede 300 ms ein SSE-Ereignis, endlos (zum Abschiessen mitten im Strom)
//   /ping                   JSON
// Aufruf: node scripts/mobile/ios/drossel-server.mjs [port]
import { createServer } from "node:http";
const port = Number(process.argv[2] ?? 8799);
createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const cors = { "access-control-allow-origin": "*" };
  console.log(new Date().toISOString(), req.method, req.url, req.headers.range ?? "", req.headers["user-agent"] ?? "");
  if (u.pathname === "/ping") {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    return res.end(JSON.stringify({ ok: true, von: "mac" }));
  }
  if (u.pathname === "/sse") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", ...cors });
    let i = 0;
    const t = setInterval(() => res.write(`data: teil-${++i}\n\n`), 300);
    req.on("close", () => clearInterval(t));
    return;
  }
  if (u.pathname === "/gross") {
    const gesamt = Number(u.searchParams.get("mb") ?? 20) * 1024 * 1024;
    const rate = Number(u.searchParams.get("kbps") ?? 2000) * 1024;
    let start = 0;
    const m = /bytes=(\d+)-/.exec(req.headers.range ?? "");
    if (m) start = Number(m[1]);
    const kopf = { "content-type": "application/octet-stream", "accept-ranges": "bytes", etag: '"lu-test-1"', "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT", ...cors };
    if (m) res.writeHead(206, { ...kopf, "content-length": gesamt - start, "content-range": `bytes ${start}-${gesamt - 1}/${gesamt}` });
    else res.writeHead(200, { ...kopf, "content-length": gesamt });
    let gesendet = start;
    const stueck = Buffer.alloc(Math.max(1024, Math.floor(rate / 10)), 0x4c);
    const t = setInterval(() => {
      const rest = gesamt - gesendet;
      if (rest <= 0) { clearInterval(t); console.log(new Date().toISOString(), "fertig gesendet", req.url); return res.end(); }
      const b = rest < stueck.length ? stueck.subarray(0, rest) : stueck;
      res.write(b); gesendet += b.length;
    }, 100);
    req.on("close", () => { clearInterval(t); if (gesendet < gesamt) console.log(new Date().toISOString(), "abgebrochen bei", gesendet); });
    return;
  }
  res.writeHead(404, cors); res.end();
}).listen(port, "127.0.0.1", () => console.log("drossel-server auf", port));
