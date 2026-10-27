#!/bin/zsh
# Baut LU fuer ein echtes iPhone (Ziel aarch64-apple-ios), UNSIGNIERT.
#
# Aufruf:   scripts/mobile/ios/geraet-bauen.sh [cargo-features]
# Beispiel: VITE_LU_STORE_PRESET=appstore VITE_LU_REPORT_URL=https://... scripts/mobile/ios/geraet-bauen.sh
#                                                          (gewoehnlicher Release-Bau)
#           VITE_LU_STORE_PRESET=open scripts/mobile/ios/geraet-bauen.sh abnahme
#                                                          (inspizierbar, NIE fuer den Store)
# Ohne VITE_LU_STORE_PRESET bricht das Skript ab (scripts/mobile/store-bau-pruefen.sh).
# Ergebnis: src-tauri/gen/apple/build/geraet-unsigniert/LU.app
#
# Wozu: der Simulator-Bau (bauen.sh) beweist nicht, dass das Geraeteziel
# baut und linkt (andere Bibliotheken, Metal an, eigenes Entitlement). Dieser
# Bau beweist es ohne Developer-Konto. Das Paket laeuft auf KEINEM Geraet und
# laesst sich nicht hochladen: es traegt keine Signatur und kein Profil. Die
# echte Signatur macht David, dann ueber `npx tauri ios build` mit
# APPLE_DEVELOPMENT_TEAM in der Umgebung.
#
# Wie: die Tauri-CLI archiviert mit xcodebuild und laesst dabei die
# automatische Signatur an. Eine xcconfig-Datei ueber XCODE_XCCONFIG_FILE
# reicht nicht (gemessen am 08.10.2026: "requires a development team", die
# Einstellungen des Ziels gewinnen). Deshalb legt das Skript fuer diesen einen
# Aufruf einen Vorschalter vor xcodebuild, der die Signatur auf der
# Kommandozeile abschaltet. Das Archiv entsteht, der anschliessende Export der
# CLI (IPA) scheitert erwartungsgemaess, weil ein Export eine Signatur braucht.
# Das Skript nimmt die fertige App aus dem Archiv und prueft sie.
set -euo pipefail
FEATURES="${1:-}"
WURZEL="$(cd "$(dirname "$0")/../../.." && pwd)"

export LANG=en_US.UTF-8
export IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-17.0}"
if ! command -v node >/dev/null 2>&1; then
  NVM_NODE=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
  [ -n "$NVM_NODE" ] && export PATH="$NVM_NODE:$PATH"
fi
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"
unset APPLE_DEVELOPMENT_TEAM || true

# Wie in bauen.sh: der Testhaken nur, wenn das Feature genannt ist.
unset VITE_LU_ABNAHME || true
if [ -n "$FEATURES" ]; then
  for FEATURE in $(printf '%s' "$FEATURES" | tr ',' ' '); do
    NAME="$(printf '%s' "$FEATURE" | tr '[:lower:]-' '[:upper:]_' | tr -cd 'A-Z0-9_')"
    [ -n "$NAME" ] && export "VITE_LU_${NAME}=1"
  done
fi

ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
# Ein Vorschalter mit dem Namen xcodebuild, der vorn im PATH liegt und dem
# echten Aufruf die Schalter anhaengt. Auf der Kommandozeile gewinnt der
# letzte Wert, und die Kommandozeile gewinnt gegen Projekt und xcconfig.
ECHT="$(xcrun -f xcodebuild)"
mkdir -p "$ARBEIT/bin"
cat > "$ARBEIT/bin/xcodebuild" <<XC
#!/bin/zsh
case " \$* " in
  *" archive "*|*" build "*)
    exec "$ECHT" "\$@" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= ;;
  *) exec "$ECHT" "\$@" ;;
esac
XC
chmod +x "$ARBEIT/bin/xcodebuild"
export PATH="$ARBEIT/bin:$PATH"

cd "$WURZEL"
# Immer ein Release: das Store-Preset muss genannt sein (Durchsicht M4, M5).
"$WURZEL/scripts/mobile/store-bau-pruefen.sh" release
# Nur =mobile packt die Handy-Oberflaeche ein (src/main.tsx). Ohne die Variable
# ist das Paket ein Desktop-Paket.
export VITE_LU_BUILD_TARGET=mobile
touch src-tauri/tauri.conf.json
APPLE="src-tauri/gen/apple"
ZIEL="$APPLE/build/geraet-unsigniert"
# Ohne Muster der Shell: zsh bricht ab, wenn ein Muster nichts trifft, und mit
# null_glob wuerde aus "ls <muster>" ein "ls" des ganzen Ordners.
rm -rf "$ZIEL" "$APPLE/build/arm64"
mkdir -p "$APPLE/build"
find "$APPLE/build" -maxdepth 1 -name '*.xcarchive' -exec rm -rf {} +

ARGS=(ios build --target aarch64 --ci)
[ -n "$FEATURES" ] && ARGS+=(--features "$FEATURES")
# Berechtigungstexte je Store-Preset: nur ein Bau mit Fernzugriff nennt das
# lokale Netz und den QR-Code (scripts/mobile/ios/preset-plist.mjs). Der Aufruf
# nimmt zuerst heraus, was ein frueherer Bau in die Info.plist gemischt hat.
PRESET_CONFIG="$(node "$WURZEL/scripts/mobile/ios/preset-plist.mjs" vorbereiten "${VITE_LU_STORE_PRESET:-open}")"
[ -n "$PRESET_CONFIG" ] && ARGS+=(--config "$PRESET_CONFIG")
echo "[geraet] npx tauri ${ARGS[*]}  (unsigniert, IPHONEOS_DEPLOYMENT_TARGET=$IPHONEOS_DEPLOYMENT_TARGET)"
START=$(date +%s)
set +e
npx tauri "${ARGS[@]}" > "$ARBEIT/bau.log" 2>&1
CODE=$?
set -e
echo "[geraet] CLI endete mit $CODE nach $(( $(date +%s) - START )) s"

APP="$(find "$APPLE/build" -maxdepth 4 -path '*.xcarchive/Products/Applications/*.app' -type d 2>/dev/null | head -1)"
if [ -z "$APP" ] || [ ! -f "$APP/Info.plist" ]; then
  echo "[geraet] FEHLER: kein Archiv entstanden. Ende des Bauprotokolls:"
  tail -40 "$ARBEIT/bau.log"
  exit 1
fi
if [ "$CODE" -ne 0 ]; then
  # Erwartet: der Export braucht eine Signatur. Alles andere ist ein Fehler.
  if ! grep -qiE "exportArchive|export.*(sign|provision|team)|No signing certificate|requires a development team|failed to export" "$ARBEIT/bau.log"; then
    echo "[geraet] FEHLER: die CLI scheiterte nicht am Export. Ende des Bauprotokolls:"
    tail -40 "$ARBEIT/bau.log"
    exit 1
  fi
  echo "[geraet] Export uebersprungen (braucht eine Signatur), Archiv ist da."
fi
mkdir -p "$ZIEL"
cp -R "$APP" "$ZIEL/"
APP="$ZIEL/$(basename "$APP")"
BIN="$APP/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Info.plist")"
# Schema lu://, Berechtigungstexte, Privacy Manifest: bricht den Bau ab, wenn etwas fehlt.
sh "$WURZEL/scripts/mobile/ios/pruefe-paket.sh" "$APP"
# Womit das Paket gebaut wurde, fuer die Abnahme (Punkt 8 liest das Preset hier).
"$WURZEL/scripts/mobile/bau-beleg.sh" release "$FEATURES" "$APP"

echo "[geraet] Paket: $APP ($(du -sh "$APP" | cut -f1))"
echo "[geraet] Plattform:   $(xcrun vtool -show-build "$BIN" 2>/dev/null | grep -E 'platform|minos' | tr -s ' ' | tr '\n' ' ')"
echo "[geraet] Architektur: $(lipo -archs "$BIN")"
SIGNATUR="$(codesign -dv "$APP" 2>&1 | grep -E 'Signature|not signed' | head -1 || true)"
echo "[geraet] Signatur:    ${SIGNATUR:-keine Angabe}"
if ! printf '%s' "$SIGNATUR" | grep -q 'not signed'; then
  echo "[geraet] FEHLER: das Paket traegt eine Signatur, erwartet war keine."
  exit 1
fi
echo "[geraet] Version:     $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Info.plist") ($(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Info.plist"))"
