#!/bin/zsh
# Baut LU fuer Android mit der Tauri-CLI. Gegenstueck zu scripts/mobile/ios/bauen.sh.
#
# Aufruf:   scripts/mobile/android-bauen.sh [debug|release] [cargo-features] [abi ...]
# Beispiel: scripts/mobile/android-bauen.sh debug
#           VITE_LU_STORE_PRESET=play VITE_LU_REPORT_URL=https://... scripts/mobile/android-bauen.sh release
#                                                                    (gewoehnlicher Bau, so geht er in den Store)
#           VITE_LU_STORE_PRESET=open scripts/mobile/android-bauen.sh release abnahme
#                                                                    (WebView inspizierbar, Testhaken, NIE fuer den Store)
#           VITE_LU_STORE_PRESET=open scripts/mobile/android-bauen.sh release "" aarch64 armv7 (zwei ABIs)
#
# Store-Preset: ein Release verlangt VITE_LU_STORE_PRESET ausdruecklich (open,
# play, appstore), sonst bricht das Skript ab. play und appstore verlangen
# dazu VITE_LU_REPORT_URL. Siehe scripts/mobile/store-bau-pruefen.sh.
# Ergebnis: src-tauri/gen/android/app/build/outputs/apk/universal/<art>/app-universal-<art>.apk
#
# ABI: Standard ist nur aarch64 (arm64-v8a). Ohne Angabe baute die CLI alle
# vier (arm64, armv7, x86, x86_64), jede mit einer eigenen Kopie der
# Bibliothek samt llama.cpp. Die App laedt Modelle ab rund 400 MB in den
# Speicher und setzt 64 Bit voraus, die x86-Varianten braucht nur ein
# Emulator auf einem Intel-Rechner.
#
# AAB: mit LU_ANDROID_AAB=1 entsteht neben dem APK das Bundle fuer Google Play:
# src-tauri/gen/android/app/build/outputs/bundle/universal<Art>/app-universal-<art>.aab
#
# Signatur des Release: nur ueber LU_ANDROID_KEY_PROPERTIES (BAUEN.md 4.3).
# Ohne die Variable ist das Paket unsigniert und laesst sich nicht installieren.
set -euo pipefail
ART="${1:-debug}"
FEATURES="${2:-}"
shift $(( $# > 2 ? 2 : $# ))
ABIS=("$@")
[ ${#ABIS[@]} -eq 0 ] && ABIS=(aarch64)
WURZEL="$(cd "$(dirname "$0")/../.." && pwd)"

case "$ART" in debug|release) ;; *) echo "Erstes Argument: debug oder release"; exit 2 ;; esac

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/27.2.12479018}"
export ANDROID_NDK_HOME="$NDK_HOME"
export ANDROID_NDK_ROOT="$NDK_HOME"
export ANDROID_API_LEVEL="${ANDROID_API_LEVEL:-24}"
if ! command -v node >/dev/null 2>&1; then
  NVM_NODE=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
  [ -n "$NVM_NODE" ] && export PATH="$NVM_NODE:$PATH"
fi
export PATH="$HOME/.cargo/bin:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:/opt/homebrew/bin:$PATH"

# Der Testhaken window.__LU_TEST__ gehoert zum Abnahmebau und nur zu ihm.
# Die Variable wird zuerst IMMER geloescht, damit ein Store-Bau sie nie aus
# der Shell erbt. Gesetzt wird danach nur, was der Aufrufer als Feature nennt.
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

ARGS=(android build --apk --ci --target "${ABIS[@]}")
[ "$ART" = "debug" ] && ARGS+=(--debug)
# Google Play nimmt nur ein AAB. LU_ANDROID_AAB=1 baut es zusaetzlich zum APK
# (scripts/mobile/release/android-play.sh setzt die Variable).
[ "${LU_ANDROID_AAB:-}" = "1" ] && ARGS+=(--aab)
[ -n "$FEATURES" ] && ARGS+=(--features "$FEATURES")
if [ "$ART" = "release" ] && [ -z "${LU_ANDROID_KEY_PROPERTIES:-}" ]; then
  echo "[bauen] Hinweis: LU_ANDROID_KEY_PROPERTIES ist nicht gesetzt, das Release-Paket wird unsigniert."
fi
echo "[bauen] npx tauri ${ARGS[*]}  (node $(node -v), ABI ${ABIS[*]})"
START=$(date +%s)
npx tauri "${ARGS[@]}"
echo "[bauen] fertig nach $(( $(date +%s) - START )) s"
APK="src-tauri/gen/android/app/build/outputs/apk/universal/$ART/app-universal-$ART.apk"
ls -la "$APK"
# Womit das Paket gebaut wurde, fuer die Abnahme (Punkt 8 liest das Preset hier).
"$WURZEL/scripts/mobile/bau-beleg.sh" "$ART" "$FEATURES" "$APK"
if [ "${LU_ANDROID_AAB:-}" = "1" ]; then
  # universalRelease oder universalDebug, je nach Art.
  AAB="src-tauri/gen/android/app/build/outputs/bundle/universal${(C)ART}/app-universal-$ART.aab"
  ls -la "$AAB"
  "$WURZEL/scripts/mobile/bau-beleg.sh" "$ART" "$FEATURES" "$AAB"
fi
# Der lange Produktname steht nicht im Paket (mobile-docs/r19/name-im-programm.md
# Abschnitt 6). Bricht den Bau ab, wie die Paketpruefung unter iOS.
"$WURZEL/scripts/mobile/release/pruefe-name-im-paket.sh" "$APK"
