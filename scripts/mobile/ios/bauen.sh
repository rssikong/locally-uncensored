#!/bin/zsh
# Baut LU fuer den iOS-Simulator, ohne Signatur und ohne Team.
#
# Aufruf:   scripts/mobile/ios/bauen.sh [debug|release] [cargo-features]
# Beispiel: scripts/mobile/ios/bauen.sh debug
#           VITE_LU_STORE_PRESET=appstore VITE_LU_REPORT_URL=https://... scripts/mobile/ios/bauen.sh release
#           VITE_LU_STORE_PRESET=open scripts/mobile/ios/bauen.sh release abnahme   (WebView inspizierbar, nie fuer den Store)
#
# Store-Preset: ein Release verlangt VITE_LU_STORE_PRESET ausdruecklich (open,
# play, appstore), sonst bricht das Skript ab. play und appstore verlangen
# dazu VITE_LU_REPORT_URL. Siehe scripts/mobile/store-bau-pruefen.sh.
# Ergebnis: src-tauri/gen/apple/build/arm64-sim/LU.app
#
# Belegter Weg, siehe mobile-docs/IOS-BAUWEG.md A2 und mobile-docs/BAUEN.md.
set -euo pipefail
ART="${1:-debug}"
FEATURES="${2:-}"
WURZEL="$(cd "$(dirname "$0")/../../.." && pwd)"

case "$ART" in debug|release) ;; *) echo "Erstes Argument: debug oder release"; exit 2 ;; esac

# CocoaPods und xcodebuild wollen UTF-8.
export LANG=en_US.UTF-8
# Mindestversion fuer alles, was C oder C++ mitbaut (llama.cpp ueber cmake).
# Muss zu bundle.iOS.minimumSystemVersion in src-tauri/tauri.ios.conf.json passen.
export IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-17.0}"
# node aus nvm in den PATH legen, falls die Shell es nicht schon hat. Die
# Xcode-Bauphase "Build Rust Code" ruft "npm run -- tauri ios xcode-script"
# auf und erbt diesen PATH.
if ! command -v node >/dev/null 2>&1; then
  NVM_NODE=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
  [ -n "$NVM_NODE" ] && export PATH="$NVM_NODE:$PATH"
fi
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"

# Ein Simulator-Bau braucht kein Team. Ein gesetztes Team wuerde ins Projekt
# durchgereicht, deshalb hier ausdruecklich leer.
unset APPLE_DEVELOPMENT_TEAM || true

# Der Testhaken window.__LU_TEST__ (src/mobile/dev/test-hook.ts) gehoert zum
# Abnahmebau und nur zu ihm. Die Web-Seite liest dafuer VITE_LU_ABNAHME, das
# `npm run build` (beforeBuildCommand) von hier erbt. Die Variable wird zuerst
# IMMER geloescht, damit ein Store-Bau sie nie aus der Shell erbt. Gesetzt wird
# danach nur, was der Aufrufer als Feature nennt: jedes genannte Feature wird
# zu VITE_LU_<NAME>=1. Kein Feature steht hier als fester Wert.
unset VITE_LU_ABNAHME || true
if [ -n "$FEATURES" ]; then
  for FEATURE in $(printf '%s' "$FEATURES" | tr ',' ' '); do
    NAME="$(printf '%s' "$FEATURE" | tr '[:lower:]-' '[:upper:]_' | tr -cd 'A-Z0-9_')"
    [ -n "$NAME" ] && export "VITE_LU_${NAME}=1"
  done
fi

cd "$WURZEL"
# Ein Release nennt sein Store-Preset, und ein Store-Preset braucht den
# Meldedienst (Durchsicht M4, M5). Abbruch hier, bevor irgendetwas baut.
"$WURZEL/scripts/mobile/store-bau-pruefen.sh" "$ART"
# Nur =mobile packt die Handy-Oberflaeche ein (src/main.tsx). Ohne die Variable
# ist das Paket ein Desktop-Paket. Die Tauri-Konfiguration des Handys setzt sie
# im beforeBuildCommand auch, hier steht sie ausdruecklich fuer alles, was das
# Skript sonst noch startet.
export VITE_LU_BUILD_TARGET=mobile
# tauri-build beobachtet ../dist nicht (BAUEN.md, Falle 5).
touch src-tauri/tauri.conf.json

# Die CLI verschiebt das fertige Paket nach build/arm64-sim/LU.app und scheitert,
# wenn dort schon eines liegt ("failed to rename app ... Directory not empty",
# gesehen am 08.10.2026 beim zweiten Bau). Also vorher wegraeumen.
rm -rf src-tauri/gen/apple/build/arm64-sim

ARGS=(ios build --target aarch64-sim --ci)
[ "$ART" = "debug" ] && ARGS+=(--debug)
[ -n "$FEATURES" ] && ARGS+=(--features "$FEATURES")
# Berechtigungstexte je Store-Preset: nur ein Bau mit Fernzugriff nennt das
# lokale Netz und den QR-Code (scripts/mobile/ios/preset-plist.mjs). Der Aufruf
# nimmt zuerst heraus, was ein frueherer Bau in die Info.plist gemischt hat.
PRESET_CONFIG="$(node "$WURZEL/scripts/mobile/ios/preset-plist.mjs" vorbereiten "${VITE_LU_STORE_PRESET:-open}")"
[ -n "$PRESET_CONFIG" ] && ARGS+=(--config "$PRESET_CONFIG")
echo "[bauen] npx tauri ${ARGS[*]}  (IPHONEOS_DEPLOYMENT_TARGET=$IPHONEOS_DEPLOYMENT_TARGET, node $(node -v))"
START=$(date +%s)
npx tauri "${ARGS[@]}"
echo "[bauen] fertig nach $(( $(date +%s) - START )) s"
APP="$(find src-tauri/gen/apple/build/arm64-sim -maxdepth 1 -name '*.app' -type d | head -1)"
[ -n "$APP" ] || { echo "[bauen] FEHLER: kein Paket unter src-tauri/gen/apple/build/arm64-sim"; exit 1; }
echo "$APP"
# Schema lu://, Berechtigungstexte, Privacy Manifest: ohne sie ist das Paket
# kein Paket (iOS-Abnahme 09.10.2026). Bricht den Bau ab.
sh "$WURZEL/scripts/mobile/ios/pruefe-paket.sh" "$APP"
# Womit das Paket gebaut wurde, fuer die Abnahme (Punkt 8 liest das Preset hier).
"$WURZEL/scripts/mobile/bau-beleg.sh" "$ART" "$FEATURES" "$APP"
