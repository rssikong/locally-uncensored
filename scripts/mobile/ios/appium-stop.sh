#!/bin/zsh
# Beendet den Appium-Server und den WebDriverAgent-Lauf (xcodebuild), den er gestartet hat.
# Nur ueber die gemerkte Prozessnummer aus appium-start.sh, samt Nachkommen. Kein pkill mit
# Namensmuster: Das trifft auch die Server und Laeufe anderer Agenten auf derselben Maschine.
HIER="${0:A:h}"
ORDNER="${1:-$HOME/.lu-appium}"
if ! command -v node >/dev/null 2>&1; then
  NVM_NODE=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
  [ -n "$NVM_NODE" ] && export PATH="$NVM_NODE:$PATH"
fi
if [ -f "$ORDNER/appium.pid" ]; then
  node "$HIER/../../../mobile-tests/lib/prozess.mjs" beende "$(cat "$ORDNER/appium.pid")" appium
  rm -f "$ORDNER/appium.pid"
  echo "[appium] gestoppt"
else
  echo "[appium] kein Merkzettel $ORDNER/appium.pid: Dieser Ordner hat keinen Server gestartet, nichts beendet"
fi
