#!/bin/bash
# App Store: baut das Archiv, exportiert es und liefert das IPA, Preset appstore.
#
# Aufruf:   scripts/mobile/release/ios-appstore.sh --version 3.0.7 --dry-run
#               prueft alle Vorbedingungen und sagt, was fehlt. Baut nichts.
#           APPLE_DEVELOPMENT_TEAM=... LU_IOS_BUNDLE_ID=... VITE_LU_REPORT_URL=https://... \
#             scripts/mobile/release/ios-appstore.sh --version 3.0.7
#               archiviert, exportiert, prueft das IPA und nennt am Ende die Datei.
#           ... ios-appstore.sh --version 3.0.7 --upload --confirm UPLOAD-TO-APP-STORE
#               laedt das IPA danach zu App Store Connect (landet in TestFlight).
#           ... ios-appstore.sh --version 3.0.7 --probe
#               Probelauf ohne echte Meldeadresse: das Paket heisst PROBE, liegt in
#               PROBE-appstore-..., wird nie hochgeladen. Team und Kennung braucht er trotzdem.
#
# Umgebung:
#   APPLE_DEVELOPMENT_TEAM   die Team-ID, zehn Zeichen (Pflicht). Steht nie in einer Datei des Repos.
#   LU_IOS_BUNDLE_ID         die Kennung der App im Entwicklerkonto (Pflicht). Muss der Kennung
#                            in der Konfiguration gleichen, sonst bricht das Skript ab.
#   VITE_LU_REPORT_URL       https-Adresse des Meldedienstes (Pflicht fuer appstore)
#   LU_IOS_SIGNING           automatic (Standard) oder manual: wie der Export signiert
#   LU_IOS_PROFILE           nur bei manual: Name des App-Store-Profils (Pflicht)
#   LU_IOS_SIGN_IDENTITY     nur bei manual: Zertifikat, Standard "Apple Distribution"
#   APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_PATH
#                            Schluessel fuer App Store Connect: Kennung, Aussteller, Pfad zur
#                            Datei AuthKey_<Kennung>.p8 ausserhalb jedes Repos. Freiwillig fuer
#                            den Bau (ohne sie muss Xcode am Team angemeldet sein), Pflicht fuer --upload.
#   LU_IOS_EXPORT_KONTO      xcode: der Export signiert ueber das in Xcode angemeldete Konto,
#                            auch wenn ein Schluessel gesetzt ist. Noetig, wenn der Schluessel
#                            archivieren, aber nicht fuer die Verteilung signieren darf
#                            ("Cloud signing permission error"). Standard: der Schluessel, wenn gesetzt.
#
# Ablauf: die Tauri-CLI archiviert (nie xcodebuild allein, die Bauphase braucht
# die laufende CLI). Den Export macht dieses Skript selbst mit
# ExportOptions.vorlage.plist, damit Ziel (export, nie upload) und Baunummer
# feststehen. Scheitert der eigene Export der CLI, stoert das nicht, solange
# das Archiv da ist.
#
# Das Skript bricht ab bei: fehlendem Team, fremder Kennung, fehlender
# Meldeadresse, falscher Versionsnummer, Feature abnahme, Testhaken im Paket,
# einer Signatur, die nicht fuer den Store taugt. Es nimmt keine
# Cargo-Features an. Hochgeladen wird nur mit --upload und dem
# Bestaetigungswort. Kein Zugang wird in eine Datei geschrieben.
#
# Ergebnis: ein eigener Ordner ausserhalb des Bauordners, mit Baubeleg und SHA-256
#   <release-pakete>/appstore-<version>-<baunummer>/LU-appstore-<version>-<baunummer>.ipa
# <release-pakete> ist der Ordner release-pakete neben dem Arbeitsbaum, oder
# was LU_RELEASE_PAKETE nennt. Das Skript nennt den Ordner am Ende.
set -euo pipefail
# shellcheck source=scripts/mobile/release/_gemeinsam.sh
source "$(dirname "${BASH_SOURCE[0]}")/_gemeinsam.sh"

PRESET=appstore
WORT="UPLOAD-TO-APP-STORE"
hilfe() { sed -n '2,47p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

argumente_lesen "$WORT" "$@"
umgebung_setzen
cd "$WURZEL"

APPLE="$WURZEL/src-tauri/gen/apple"
ZIEL="$APPLE/build/release-appstore"
VORLAGE="$RELEASE_DIR/ExportOptions.vorlage.plist"
PB=/usr/libexec/PlistBuddy
TEAM="${APPLE_DEVELOPMENT_TEAM:-}"
SIGNATUR="${LU_IOS_SIGNING:-automatic}"
IDENTITAET="${LU_IOS_SIGN_IDENTITY:-Apple Distribution}"
KENNUNG=""
if command -v node >/dev/null 2>&1; then KENNUNG="$(node "$RELEASE_DIR/handy-version.mjs" kennung ios 2>/dev/null || true)"; fi

# Schluessel fuer App Store Connect: alle drei oder keiner.
api_schluessel_da() {
  [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]
}
api_schluessel_pruefen() {
  local wozu="$1"
  if [ -z "${APPLE_API_KEY:-}" ]; then missing "$wozu: APPLE_API_KEY is not set (key id of the App Store Connect API key)"; fi
  if [ -z "${APPLE_API_ISSUER:-}" ]; then missing "$wozu: APPLE_API_ISSUER is not set (issuer id of the App Store Connect API key)"; fi
  if [ -z "${APPLE_API_KEY_PATH:-}" ]; then
    missing "$wozu: APPLE_API_KEY_PATH is not set (path to AuthKey_<key id>.p8)"
  elif [ ! -f "$APPLE_API_KEY_PATH" ]; then
    missing "$wozu: APPLE_API_KEY_PATH names a file that does not exist"
  elif [ "$(basename "$APPLE_API_KEY_PATH")" != "AuthKey_${APPLE_API_KEY:-}.p8" ]; then
    missing "$wozu: the key file has to be named AuthKey_<key id>.p8, altool finds it by that name"
  elif im_git_baum "$APPLE_API_KEY_PATH"; then
    missing "$wozu: the API key lies inside a git working tree. Move it outside every repository."
  else
    ok "$wozu: App Store Connect API key is named and the file exists"
  fi
}

echo "LU for the App Store (preset $PRESET), archive, export, IPA"
echo "Preconditions"
pruefe_allgemein "$PRESET" ios

if command -v xcodebuild >/dev/null 2>&1; then ok "$(xcodebuild -version 2>/dev/null | head -1)"; else missing "xcodebuild is not in the PATH (Xcode)"; fi
if command -v rustup >/dev/null 2>&1 && rustup target list --installed 2>/dev/null | grep -q '^aarch64-apple-ios$'; then
  ok "rust target aarch64-apple-ios"
else
  missing "rust target aarch64-apple-ios is not installed. Run: rustup target add aarch64-apple-ios"
fi
if [ -f "$VORLAGE" ] && plutil -lint "$VORLAGE" >/dev/null 2>&1 && [ "$($PB -c 'Print :destination' "$VORLAGE" 2>/dev/null)" = "export" ]; then
  ok "ExportOptions.vorlage.plist (destination export)"
else
  missing "scripts/mobile/release/ExportOptions.vorlage.plist is missing, broken, or its destination is not export"
fi

case "$TEAM" in
  "") missing "Apple team: APPLE_DEVELOPMENT_TEAM is not set (the ten character team id of the developer account)" ;;
  [A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]) ok "Apple team id is set" ;;
  *) missing "Apple team: APPLE_DEVELOPMENT_TEAM is not a team id (ten characters, capitals and digits)" ;;
esac
if [ -z "${LU_IOS_BUNDLE_ID:-}" ]; then
  missing "bundle id: LU_IOS_BUNDLE_ID is not set. Name the bundle id registered in the developer account. The project carries: ${KENNUNG:-unknown}"
elif [ "$LU_IOS_BUNDLE_ID" != "$KENNUNG" ]; then
  missing "bundle id: LU_IOS_BUNDLE_ID is $LU_IOS_BUNDLE_ID, the project carries $KENNUNG (identifier in src-tauri/tauri.conf.json or tauri.ios.conf.json, and src-tauri/gen/apple/project.yml). Change the project first, this script does not rewrite it."
else
  ok "bundle id $KENNUNG"
fi

case "$SIGNATUR" in
  automatic)
    if api_schluessel_da; then
      api_schluessel_pruefen "signing"
    elif [ -n "$TEAM" ] && security find-identity -v -p codesigning 2>/dev/null | grep -q -E "(Apple|iPhone) Distribution: .*\\($TEAM\\)"; then
      ok "signing: automatic, a distribution certificate of the team is in the keychain"
    else
      note "signing: automatic. No distribution certificate of the team was found in the keychain and no APPLE_API_* key is set: the export only works if Xcode is signed in to the team (Xcode, Settings, Accounts)."
    fi ;;
  manual)
    if [ -z "${LU_IOS_PROFILE:-}" ]; then missing "signing: LU_IOS_SIGNING=manual needs LU_IOS_PROFILE (name of the App Store provisioning profile)"; fi
    if security find-identity -v -p codesigning 2>/dev/null | grep -q -F "$IDENTITAET"; then
      ok "signing: manual, a certificate matching LU_IOS_SIGN_IDENTITY is in the keychain"
    else
      missing "signing: no certificate matching LU_IOS_SIGN_IDENTITY (\"$IDENTITAET\") is in the keychain"
    fi ;;
  *) missing "signing: LU_IOS_SIGNING is '$SIGNATUR', expected automatic or manual" ;;
esac

if [ "$UPLOAD" = "1" ]; then
  echo "Upload (asked for with --upload --confirm $WORT)"
  if xcrun -f altool >/dev/null 2>&1; then ok "altool"; else missing "upload: altool is not available (Xcode command line tools)"; fi
  api_schluessel_pruefen "upload"
else
  note "upload: off (default). The script ends with the IPA."
fi
vorpruefung_abschliessen "App Store"

# ── Bau ─────────────────────────────────────────────────────────────────────
export LANG=en_US.UTF-8
export IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-17.0}"
export VITE_LU_STORE_PRESET="$PRESET"
# Nur =mobile packt die Handy-Oberflaeche ein (src/main.tsx). umgebung_setzen
# hat die Variable schon gesetzt; sie steht hier noch einmal ausdruecklich vor
# dem Aufruf der CLI, wie in jedem Bauskript des Handys (Waechter
# desktop-bau-ohne-handy.test.ts).
export VITE_LU_BUILD_TARGET=mobile
export APPLE_DEVELOPMENT_TEAM="$TEAM"
# Keine Pfade des Baurechners im Programm (r49, N2). Fuer iOS setzt die
# Tauri-CLI keine eigenen rustflags.
pfade_umschreiben aarch64-apple-ios
VERSION="$ERWARTETE_VERSION"
CODE="$(node "$RELEASE_DIR/handy-version.mjs" zeige ios | cut -d' ' -f2)"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"; pfade_konfig_entfernen' EXIT
# Die C-Flags von pfade_umschreiben erreichen cargo hinter Xcode nicht, darum
# fuer diesen Lauf als Cargo-Konfiguration (_gemeinsam.sh).
pfade_als_cargo_konfig aarch64-apple-ios "$(xcrun --sdk iphoneos --show-sdk-path)"

# Dieselbe Pruefung wie in den Bauskripten, jetzt mit dem gesetzten Preset.
"$WURZEL/scripts/mobile/store-bau-pruefen.sh" release
# tauri-build beobachtet ../dist nicht (BAUEN.md, Falle 5).
touch src-tauri/tauri.conf.json
rm -rf "$ZIEL" "$APPLE/build/arm64"
mkdir -p "$APPLE/build"
find "$APPLE/build" -maxdepth 1 -name '*.xcarchive' -exec rm -rf {} +

# Berechtigungstexte: das Preset appstore hat keinen Fernzugriff, sein Paket
# nennt weder das lokale Netz noch den QR-Code. Der Aufruf nimmt heraus, was
# ein frueherer Bau mit Fernzugriff in die Info.plist gemischt hat, und er
# darf fuer dieses Preset nichts zum Einmischen nennen.
PRESET_CONFIG="$(node "$WURZEL/scripts/mobile/ios/preset-plist.mjs" vorbereiten "$PRESET")"
[ -z "$PRESET_CONFIG" ] || abbruch "preset $PRESET carries the remote desktop switch. Its permission texts were never reviewed for the App Store, this script does not build it."

# KEINE Cargo-Features. Der Export der CLI darf scheitern, das Archiv zaehlt.
ARGS=(ios build --target aarch64 --ci --export-method app-store-connect)
echo "[appstore] npx tauri ${ARGS[*]}"
START="$(date +%s)"
set +e
npx tauri "${ARGS[@]}" > "$ARBEIT/bau.log" 2>&1
CLI_ENDE=$?
set -e
pfade_konfig_entfernen
echo "[appstore] the CLI ended with $CLI_ENDE after $(( $(date +%s) - START )) s"
ARCHIV="$(find "$APPLE/build" -maxdepth 1 -name '*.xcarchive' -type d | head -1)"
if [ -z "$ARCHIV" ] || [ -z "$(find "$ARCHIV/Products/Applications" -maxdepth 1 -name '*.app' -type d 2>/dev/null | head -1)" ]; then
  echo "[appstore] no archive. End of the build log:"
  tail -40 "$ARBEIT/bau.log"
  abbruch "the archive was not built"
fi
if [ "$CLI_ENDE" -ne 0 ]; then
  echo "[appstore] the CLI failed after the archive (its own export). End of its log, for the record:"
  tail -8 "$ARBEIT/bau.log"
fi
if [ "$(stat -f %m "$WURZEL/dist/index.html" 2>/dev/null || echo 0)" -lt "$START" ]; then
  abbruch "dist/index.html is older than this build. The page in the package cannot be checked for the test hook."
fi

# ── Export ──────────────────────────────────────────────────────────────────
# Archiviert die CLI mit dem Schluessel, traegt die Signatur des Archivs keine
# Entitlements, und der Export uebernimmt nur, was dort steht. Dann bekommt die
# App im Archiv die Entitlements des Geraete-Baus mit einer Platzhalter-Signatur;
# der Export ersetzt sie durch die echte und nimmt die Entitlements mit.
ARCHIV_APP="$(find "$ARCHIV/Products/Applications" -maxdepth 1 -name '*.app' -type d | head -1)"
GERAETE_RECHTE="$APPLE/locally-uncensored_iOS/LU-Geraet.entitlements"
if ! codesign -d --entitlements - --xml "$ARCHIV_APP" 2>/dev/null | grep -q 'com.apple.developer.applesignin'; then
  [ -f "$GERAETE_RECHTE" ] || abbruch "the archive carries no entitlements and ${GERAETE_RECHTE#"$WURZEL"/} is missing"
  echo "[appstore] the archive carries no entitlements, adding those of the device build before the export"
  codesign -f -s - --entitlements "$GERAETE_RECHTE" "$ARCHIV_APP" > "$ARBEIT/rechte.log" 2>&1 || { cat "$ARBEIT/rechte.log"; abbruch "the entitlements could not be added to the archive"; }
fi
OPTIONEN="$ARBEIT/ExportOptions.plist"
cp "$VORLAGE" "$OPTIONEN"
$PB -c "Set :teamID $TEAM" -c "Set :signingStyle $SIGNATUR" "$OPTIONEN"
EXPORT=(-exportArchive -archivePath "$ARCHIV" -exportOptionsPlist "$OPTIONEN" -exportPath "$ZIEL")
if [ "$SIGNATUR" = "manual" ]; then
  $PB -c "Add :signingCertificate string $IDENTITAET" -c "Add :provisioningProfiles dict" -c "Add :provisioningProfiles:$KENNUNG string $LU_IOS_PROFILE" "$OPTIONEN"
else
  EXPORT+=(-allowProvisioningUpdates)
  if api_schluessel_da && [ "${LU_IOS_EXPORT_KONTO:-}" != "xcode" ]; then
    EXPORT+=(-authenticationKeyPath "$APPLE_API_KEY_PATH" -authenticationKeyID "$APPLE_API_KEY" -authenticationKeyIssuerID "$APPLE_API_ISSUER")
  fi
fi
[ "$($PB -c 'Print :destination' "$OPTIONEN")" = "export" ] || abbruch "the export options do not say destination export"
echo "[appstore] xcodebuild -exportArchive ($SIGNATUR signing)"
xcodebuild "${EXPORT[@]}" > "$ARBEIT/export.log" 2>&1 || { tail -30 "$ARBEIT/export.log"; abbruch "the export of the archive failed"; }
IPA="$(find "$ZIEL" -maxdepth 1 -name '*.ipa' -type f | head -1)"
[ -n "$IPA" ] || abbruch "the export ended without an IPA in ${ZIEL#"$WURZEL"/}"
# Womit das Paket gebaut wurde: zweites Argument leer, keine Features.
"$WURZEL/scripts/mobile/bau-beleg.sh" release "" "$IPA"

echo
echo "Checking the finished package"
seite_traegt_version "$VERSION"
"$RELEASE_DIR/pruefe-ios-ipa.sh" "$VERSION" "$CODE" "$TEAM" "$KENNUNG" "$IPA" || abbruch "the package failed its checks and must not be published"

echo
if [ "$PROBE" = "1" ]; then
  echo "PROBE package, NOT for publication:"
else
  echo "Ready for the App Store:"
fi
paket_ablegen appstore ios "$IPA"
if [ "$UPLOAD" = "1" ]; then
  echo
  echo "Validating and uploading the IPA to App Store Connect"
  # altool sucht die Schluesseldatei ueber ihren Namen in diesem Ordner. Nichts wird kopiert oder geschrieben.
  export API_PRIVATE_KEYS_DIR
  API_PRIVATE_KEYS_DIR="$(cd "$(dirname "$APPLE_API_KEY_PATH")" && pwd)"
  kein_upload_im_probelauf
  xcrun altool --validate-app -f "$IPA" -t ios --apiKey "$APPLE_API_KEY" --apiIssuer "$APPLE_API_ISSUER"
  xcrun altool --upload-app -f "$IPA" -t ios --apiKey "$APPLE_API_KEY" --apiIssuer "$APPLE_API_ISSUER"
  echo "Uploaded. The build shows up in App Store Connect under TestFlight after processing. Nothing is submitted for review."
elif [ "$PROBE" = "1" ]; then
  echo
  echo "Not uploaded, and never to be: this is a probe package."
else
  echo
  echo "Not uploaded. Upload the IPA with the Transporter app, or run again with --upload --confirm $WORT"
fi
hinweis_nach_dem_bau
