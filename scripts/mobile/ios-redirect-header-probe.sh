#!/bin/zsh
# Misst, welche Kopfzeilen URLSession bei einer Weiterleitung weitergibt.
#
#   scripts/mobile/ios-redirect-header-probe.sh
#
# Warum: Ein Hintergrund-Download auf iOS folgt Weiterleitungen von selbst, die
# App wird nicht gefragt (Downloads.swift, NetGuard.swift). Der Schluessel fuer
# Hugging Face steht als `Authorization` auf der ersten Anfrage und darf den
# Speicher-Host, auf den die Antwort weiterleitet, nicht erreichen.
#
# Das Programm startet zwei kleine Server auf diesem Rechner, schickt eine
# Anfrage mit `Authorization` und einer zweiten Kopfzeile ueber eine
# Weiterleitung (gleicher Host, anderer Port, anderer Host) und schreibt auf,
# was am Ziel ankam. Es laeuft mit der URLSession des Macs, dieselbe
# Netzschicht (CFNetwork) wie auf dem iPhone. Eine Hintergrund-Session laesst
# sich von der Kommandozeile nicht starten; fuer sie steht die Pruefung am
# Geraet in der iPhone-Pruefliste.
#
# Erwartet und Grund fuer NetGuard.headersForSystemTransfer:
#   Authorization kommt nach KEINER Weiterleitung an,
#   jede andere Kopfzeile kommt an.
# Weicht das einmal ab, bricht das Programm mit Fehler ab.
set -euo pipefail
ARBEIT="$(mktemp -d)"
trap 'kill "$(cat "$ARBEIT/pid" 2>/dev/null)" 2>/dev/null || true; rm -rf "$ARBEIT"' EXIT
A="${LU_PROBE_PORT_A:-18901}"
B="${LU_PROBE_PORT_B:-18902}"

cat > "$ARBEIT/server.py" <<'PY'
import http.server, json, sys, threading
LOG = []
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith("/log"):
            body = json.dumps(LOG).encode()
            self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
        if self.path.startswith("/reset"):
            LOG.clear(); self.send_response(200); self.send_header("Content-Length", "0"); self.end_headers(); return
        LOG.append({"path": self.path, "authorization": self.headers.get("Authorization"), "other": self.headers.get("X-Lu-Probe")})
        if self.path.startswith("/to/"):
            self.send_response(302); self.send_header("Location", self.path[4:].replace("__", "://", 1)); self.send_header("Content-Length", "0"); self.end_headers(); return
        body = b"x" * 2048
        self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
for p in (int(sys.argv[1]), int(sys.argv[2])):
    s = http.server.ThreadingHTTPServer(("127.0.0.1", p), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
threading.Event().wait()
PY

cat > "$ARBEIT/probe.swift" <<'SWIFT'
import Foundation

let a = CommandLine.arguments[1], b = CommandLine.arguments[2]

func fetch(_ url: String, headers: [String: String] = [:], download: Bool = false) -> Data? {
  var request = URLRequest(url: URL(string: url)!)
  for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
  let done = DispatchSemaphore(value: 0)
  var out: Data?
  // No delegate: redirects are followed by the system, as in a background session.
  let session = URLSession(configuration: .ephemeral)
  if download {
    session.downloadTask(with: request) { file, _, _ in if let f = file { out = try? Data(contentsOf: f) }; done.signal() }.resume()
  } else {
    session.dataTask(with: request) { data, _, _ in out = data; done.signal() }.resume()
  }
  done.wait()
  return out
}

let sent = ["Authorization": "Bearer probe-secret", "X-Lu-Probe": "other-secret"]
let cases: [(String, String)] = [
  ("same host and port", "http://127.0.0.1:\(a)/to/http__127.0.0.1:\(a)/file"),
  ("other port", "http://127.0.0.1:\(a)/to/http__127.0.0.1:\(b)/file"),
  ("other host", "http://127.0.0.1:\(a)/to/http__localhost:\(b)/file"),
]
var wrong = 0
for (name, url) in cases {
  for download in [false, true] {
    _ = fetch("http://127.0.0.1:\(a)/reset")
    _ = fetch(url, headers: sent, download: download)
    let log = try! JSONSerialization.jsonObject(with: fetch("http://127.0.0.1:\(a)/log")!) as! [[String: Any]]
    guard log.count == 2, let first = log.first, let last = log.last else { print("FALSCH: \(name): \(log.count) hops"); wrong += 1; continue }
    let firstAuth = !(first["authorization"] is NSNull), auth = !(last["authorization"] is NSNull), other = !(last["other"] is NSNull)
    print("\(name), \(download ? "download" : "data") task: first host got Authorization=\(firstAuth), target got Authorization=\(auth), other header=\(other)")
    if !firstAuth || auth { wrong += 1 }
  }
}
if wrong > 0 {
  print("FALSCH: the system no longer drops Authorization at a redirect. Downloads.swift must not rely on it.")
  exit(1)
}
print("ok: Authorization reaches the first host and no target of a redirect")
SWIFT

python3 "$ARBEIT/server.py" "$A" "$B" &
echo $! > "$ARBEIT/pid"
sleep 1
swiftc -O -o "$ARBEIT/probe" "$ARBEIT/probe.swift"
"$ARBEIT/probe" "$A" "$B"
