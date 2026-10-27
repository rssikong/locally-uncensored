#!/bin/zsh
# Baut LU fuer das ECHTE Geraeteziel (aarch64-apple-ios, SDK iphoneos, Release),
# ohne Team, ohne Zertifikat, ohne Profil. Das Ergebnis ist unsigniert: es
# belegt, dass die App fuer das iPhone vollstaendig kompiliert und linkt. Es
# laesst sich auf keinem iPhone installieren und nicht hochladen.
#
# Aufruf:   scripts/mobile/ios/bauen-geraet-unsigniert.sh [--ohne-pruefung]
# Ergebnis: src-tauri/gen/apple/build/locally-uncensored_iOS.xcarchive
#           darin Products/Applications/LU.app und dSYMs/LU.app.dSYM
#
# Der Weg, belegt am 08.10.2026 (mobile-docs/BAUEN.md 5.10):
#   `npx tauri ios build --target aarch64` ruft xcodebuild dreimal: build,
#   archive, -exportArchive. Ohne Team bricht schon der erste Aufruf ab
#   ("Signing for ... requires a development team"). Die CLI reicht weder
#   Bau-Einstellungen noch die Umgebung an xcodebuild durch
#   (XCODE_XCCONFIG_FILE kommt dort nicht an, gemessen), sie sucht xcodebuild
#   aber ueber den PATH. Deshalb legt dieses Skript einen Vorschalter namens
#   xcodebuild in einen Wegwerfordner vorn in den PATH. Er haengt an build und
#   archive die drei Schalter gegen die Signatur und ueberspringt den Export,
#   denn eine IPA gibt es ohne Signatur nicht. xcodebuild allein geht nicht:
#   die Bauphase "Build Rust Code" braucht die laufende Tauri-CLI.
#
# Cargo-Features nimmt dieses Skript mit Absicht nicht an. Das Feature
# `abnahme` macht die WebView inspizierbar und hat in einem Geraete-Bau nichts
# verloren (BAUEN.md, Falle 21).
set -euo pipefail
PRUEFEN=1
for a in "$@"; do
  case "$a" in
    --ohne-pruefung) PRUEFEN=0 ;;
    *) echo "Unbekanntes Argument: $a (erlaubt: --ohne-pruefung)"; exit 2 ;;
  esac
done
WURZEL="$(cd "$(dirname "$0")/../../.." && pwd)"

export LANG=en_US.UTF-8
export IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-17.0}"
if ! command -v node >/dev/null 2>&1; then
  NVM_NODE=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
  [ -n "$NVM_NODE" ] && export PATH="$NVM_NODE:$PATH"
fi
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"

# Dieser Bau ist der Beleg OHNE Signatur. Ein gesetztes Team wuerde ins
# Projekt durchgereicht, Zertifikate aus der Umgebung wuerden importiert.
unset APPLE_DEVELOPMENT_TEAM IOS_CERTIFICATE IOS_CERTIFICATE_PASSWORD IOS_MOBILE_PROVISION || true

ECHT="$(xcrun -f xcodebuild)"
VORSCHALTER="$(mktemp -d "${TMPDIR:-/tmp}/lu-xcodebuild-unsigniert.XXXXXX")"
trap 'rm -rf "$VORSCHALTER"' EXIT
cat > "$VORSCHALTER/xcodebuild" <<VORSCHALTER_ENDE
#!/bin/sh
# Wegwerf-Vorschalter aus scripts/mobile/ios/bauen-geraet-unsigniert.sh.
case " \$* " in
  *" -exportArchive "*)
    echo "[unsigniert] Export uebersprungen: ohne Signatur gibt es keine IPA." >&2
    exit 0 ;;
  *" build "*|*" archive "*)
    exec "$ECHT" "\$@" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= ;;
  *)
    exec "$ECHT" "\$@" ;;
esac
VORSCHALTER_ENDE
chmod +x "$VORSCHALTER/xcodebuild"
export PATH="$VORSCHALTER:$PATH"

cd "$WURZEL"
# Nur =mobile packt die Handy-Oberflaeche ein (src/main.tsx). Ohne die Variable
# ist das Paket ein Desktop-Paket. Die Tauri-Konfiguration des Handys setzt sie
# im beforeBuildCommand auch, hier steht sie ausdruecklich fuer alles, was das
# Skript sonst noch startet.
export VITE_LU_BUILD_TARGET=mobile
# tauri-build beobachtet ../dist nicht (BAUEN.md, Falle 5).
touch src-tauri/tauri.conf.json

ARCHIV="src-tauri/gen/apple/build/locally-uncensored_iOS.xcarchive"
rm -rf "$ARCHIV" src-tauri/gen/apple/build/arm64

# Berechtigungstexte je Store-Preset: nur ein Bau mit Fernzugriff nennt das
# lokale Netz und den QR-Code (scripts/mobile/ios/preset-plist.mjs). Der Aufruf
# nimmt zuerst heraus, was ein frueherer Bau in die Info.plist gemischt hat.
PRESET_ARGS=()
PRESET_CONFIG="$(node "$WURZEL/scripts/mobile/ios/preset-plist.mjs" vorbereiten "${VITE_LU_STORE_PRESET:-open}")"
[ -n "$PRESET_CONFIG" ] && PRESET_ARGS=(--config "$PRESET_CONFIG")
echo "[geraet] npx tauri ios build --target aarch64 --ci ${PRESET_ARGS[*]}  (unsigniert, IPHONEOS_DEPLOYMENT_TARGET=$IPHONEOS_DEPLOYMENT_TARGET, node $(node -v))"
START=$(date +%s)
npx tauri ios build --target aarch64 --ci "${PRESET_ARGS[@]}"
echo "[geraet] fertig nach $(( $(date +%s) - START )) s"

APP="$ARCHIV/Products/Applications/LU.app"
if [ ! -x "$APP/LU" ]; then
  echo "[geraet] FEHLER: $APP/LU fehlt. Der Bau hat kein Archiv geliefert."
  exit 1
fi
echo "[geraet] Archiv: $ARCHIV"
echo "[geraet] App:    $APP"
echo "[geraet] Danach: git checkout -- src-tauri/gen/schemas   (BAUEN.md, Falle 6)"

if [ "$PRUEFEN" = "1" ]; then
  sh "$WURZEL/scripts/mobile/ios/pruefe-geraete-paket.sh" "$ARCHIV"
fi
