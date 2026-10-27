#!/bin/zsh
# Appium samt XCUITest-Treiber (WebDriverAgent) fuer den iOS-Treiber.
# Alles landet im Ordner mobile-tests/.werkzeug/appium (steht in .gitignore),
# nichts wird global installiert.
#
#   ios/appium.sh einrichten   installiert appium und den xcuitest-Treiber (einmalig, rund 2 Minuten)
#   ios/appium.sh start        startet den Server (richtet vorher ein, falls noetig)
#   ios/appium.sh stop         beendet den Server und den WebDriverAgent-Lauf dieses Ordners
#   ios/appium.sh status       zeigt, ob der Server antwortet
#
# Umgebung: APPIUM_PORT (Standard 4741), APPIUM_ORDNER (Standard mobile-tests/.werkzeug/appium)
set -euo pipefail
HIER="${0:A:h}"
ORDNER="${APPIUM_ORDNER:-$HIER/../.werkzeug/appium}"
PORT="${APPIUM_PORT:-4741}"
export LANG=en_US.UTF-8
if ! command -v node >/dev/null 2>&1; then
  NVM_NODE=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
  [ -n "$NVM_NODE" ] && export PATH="$NVM_NODE:$PATH"
fi
mkdir -p "$ORDNER" && cd "$ORDNER"
ORDNER="$PWD"
export APPIUM_HOME="$ORDNER/.appium"

laeuft() { curl -s --max-time 2 "http://127.0.0.1:$PORT/status" 2>/dev/null | grep -q '"ready":true'; }

# Appium merkt sich den Ort jedes Treibers als festen Pfad. Ein kopierter Ordner zeigt damit auf den Arbeitsbaum,
# aus dem er kam, und verliert seinen Treiber, sobald der weg ist (Gegenpruefung grosses iPhone, H2). Vor jedem
# Einrichten und Starten werden die Pfade deshalb auf diesen Ordner gestellt (lib/appium-pfad.mjs). Liegt ein
# eingetragener Treiber hier gar nicht, wird das Verzeichnis verworfen und der Treiber unten neu installiert.
richte_pfade() {
  local code=0
  node "$HIER/../lib/appium-pfad.mjs" richte "$APPIUM_HOME" || code=$?
  if [ "$code" = "3" ]; then rm -f "$APPIUM_HOME/node_modules/.cache/appium/extensions.yaml"; fi
}

einrichten() {
  [ -f package.json ] || npm init -y >/dev/null
  [ -d node_modules/appium ] || npm install --no-fund --no-audit appium
  richte_pfade
  npx appium driver list --installed 2>&1 | grep -q xcuitest || npx appium driver install xcuitest
}

case "${1:-}" in
  einrichten) einrichten; echo "[appium] eingerichtet in $ORDNER" ;;
  start)
    einrichten
    # Ein Server, der schon laeuft, kann einem anderen Ordner gehoeren (gleicher Port). Er wird nicht beendet,
    # aber es wird gesagt: Seine Treiber kommen dann von dort.
    if laeuft; then
      if [ -f "$ORDNER/appium.pid" ]; then echo "[appium] laeuft schon auf Port $PORT"; else echo "[appium] auf Port $PORT antwortet schon ein Server, den dieser Ordner nicht gestartet hat. Eigenen Port nehmen: APPIUM_PORT=<port>"; fi
      exit 0
    fi
    # Direkt ueber node starten, nicht ueber npx: Die gemerkte Prozessnummer ist dann die des Servers selbst.
    APPIUM_BIN=$(node -e 'const p = require(process.argv[1] + "/package.json"); console.log(require("path").join(process.argv[1], typeof p.bin === "string" ? p.bin : p.bin.appium))' "$ORDNER/node_modules/appium")
    nohup node "$APPIUM_BIN" --address 127.0.0.1 --port "$PORT" --log "$ORDNER/appium.log" --log-level info >/dev/null 2>&1 &
    echo $! > "$ORDNER/appium.pid"
    for i in {1..60}; do
      laeuft && { echo "[appium] bereit auf Port $PORT, pid $(cat "$ORDNER/appium.pid")"; exit 0; }
      sleep 0.5
    done
    echo "[appium] startet nicht, siehe $ORDNER/appium.log"; exit 1 ;;
  stop)
    # Nur ueber die gemerkte Prozessnummer beenden, samt Nachkommen (WebDriverAgent-Lauf von xcodebuild).
    # Kein pkill mit Namensmuster: Das trifft auch die Server und Laeufe anderer Agenten.
    if [ -f "$ORDNER/appium.pid" ]; then
      node "$HIER/../lib/prozess.mjs" beende "$(cat "$ORDNER/appium.pid")" appium || true
      rm -f "$ORDNER/appium.pid"
    else
      echo "[appium] kein Merkzettel $ORDNER/appium.pid: Dieser Ordner hat keinen Server gestartet, nichts beendet"
    fi
    echo "[appium] gestoppt" ;;
  status) laeuft && echo "[appium] bereit auf Port $PORT" || { echo "[appium] antwortet nicht auf Port $PORT"; exit 1; } ;;
  *) sed -n 2,13p "$0"; exit 1 ;;
esac
