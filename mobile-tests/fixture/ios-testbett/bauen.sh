#!/bin/zsh
# Baut das Testbett fuer den iOS-Simulator, ohne Signatur und ohne Apple-ID.
# Gebaut wird in einer Kopie ausserhalb des Repos, weil der Bau mehrere GB anlegt.
#
#   fixture/ios-testbett/bauen.sh [bauordner] [debug|release]
#
# bauordner: Standard $TMPDIR/lu-ios-testbett. Ergebnis (wird am Ende ausgegeben):
#   <bauordner>/src-tauri/gen/apple/build/arm64-sim/testbett.app
# release baut mit dem Feature abnahme, damit die WebView inspizierbar bleibt.
# Voraussetzungen: Xcode mit iOS-Simulator, Rust mit Ziel aarch64-apple-ios-sim,
# node, sowie brew install cocoapods xcodegen.
set -euo pipefail
HIER="${0:A:h}"
BAU="${1:-${TMPDIR:-/tmp}/lu-ios-testbett}"
ART="${2:-debug}"
export LANG=en_US.UTF-8
export IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-17.0}"
if ! command -v node >/dev/null 2>&1; then
  NVM_NODE=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
  [ -n "$NVM_NODE" ] && export PATH="$NVM_NODE:$PATH"
fi
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"

mkdir -p "$BAU"
# Quelltext hinueberkopieren, Bauergebnisse im Bauordner stehen lassen.
rsync -a --exclude node_modules --exclude target --exclude gen --exclude icons --exclude .tauri --exclude .build "$HIER/" "$BAU/"
cd "$BAU"
[ -d node_modules/@tauri-apps/cli ] || npm install --no-fund --no-audit
if [ ! -f src-tauri/icons/icon.png ]; then
  # Einfarbiges Icon erzeugen, damit kein Bild im Repo liegen muss.
  node -e '
    const z = require("zlib"), fs = require("fs")
    const n = 1024, zeile = Buffer.alloc(1 + n * 4)
    for (let i = 0; i < n; i++) zeile.set([124, 58, 237, 255], 1 + i * 4)
    const roh = Buffer.concat(Array.from({ length: n }, () => zeile))
    const crc = (b) => { let c, t = []; for (let i = 0; i < 256; i++) { c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0 } let r = 0xffffffff; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0 }
    const stueck = (typ, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(typ), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
    const kopf = Buffer.alloc(13); kopf.writeUInt32BE(n, 0); kopf.writeUInt32BE(n, 4); kopf.set([8, 6, 0, 0, 0], 8)
    fs.writeFileSync("icon-quelle.png", Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), stueck("IHDR", kopf), stueck("IDAT", z.deflateSync(roh)), stueck("IEND", Buffer.alloc(0))]))
  '
  npx tauri icon icon-quelle.png >/dev/null
fi
[ -d src-tauri/gen/apple ] || npx tauri ios init
ARGS=(ios build --target aarch64-sim --ci)
[ "$ART" = "debug" ] && ARGS+=(--debug) || ARGS+=(--features abnahme)
echo "[testbett] npx tauri ${ARGS[*]}"
START=$(date +%s)
npx tauri "${ARGS[@]}"
echo "[testbett] fertig nach $(( $(date +%s) - START )) s"
ls -d "$BAU"/src-tauri/gen/apple/build/arm64-sim/*.app
