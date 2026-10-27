#!/bin/zsh
# Startet einen lokalen Appium-Server mit XCUITest-Treiber. Installiert beides beim ersten Lauf.
# Aufruf: appium-start.sh [ordner] [port]
# Der Ordner haelt node_modules und den gebauten WebDriverAgent (rund 600 MB).
set -euo pipefail
ORDNER="${1:-$HOME/.lu-appium}"
PORT="${2:-4733}"
mkdir -p "$ORDNER" && cd "$ORDNER"
export APPIUM_HOME="$ORDNER/.appium"
export LANG=en_US.UTF-8
[ -f package.json ] || npm init -y >/dev/null
[ -d node_modules/appium ] || npm i appium
npx appium driver list --installed 2>&1 | grep -q xcuitest || npx appium driver install xcuitest
if curl -s "http://127.0.0.1:$PORT/status" | grep -q '"ready":true'; then
  echo "[appium] laeuft schon auf Port $PORT"; exit 0
fi
# Direkt ueber node starten, nicht ueber npx: Die gemerkte Prozessnummer ist dann die des Servers selbst.
APPIUM_BIN=$(node -e 'const p = require(process.argv[1] + "/package.json"); console.log(require("path").join(process.argv[1], typeof p.bin === "string" ? p.bin : p.bin.appium))' "$PWD/node_modules/appium")
nohup node "$APPIUM_BIN" --port "$PORT" --log "$ORDNER/appium.log" --log-level info >/dev/null 2>&1 &
echo $! > "$ORDNER/appium.pid"
for i in {1..40}; do
  curl -s "http://127.0.0.1:$PORT/status" | grep -q '"ready":true' && { echo "[appium] bereit auf Port $PORT, pid $(cat "$ORDNER/appium.pid")"; exit 0; }
  sleep 0.5
done
echo "[appium] startet nicht, siehe $ORDNER/appium.log"; exit 1
