#!/bin/sh
# Prueft an einem fertigen iOS-Paket, was jeder Bau tragen muss, gleich ob
# Simulator, Abnahme, Release oder unsigniertes Geraetepaket: das Schema lu://,
# die Berechtigungstexte, die enge Netzausnahme und das Privacy Manifest.
#
# Warum: am 09.10.2026 fehlte CFBundleURLTypes im Abnahmepaket, simctl openurl
# scheiterte mit Fehler 115 und kein Deep Link kam an. Die Bauskripte rufen
# diese Pruefung nach jedem Bau und brechen ab, wenn sie etwas findet.
#
# Aufruf:  sh scripts/mobile/ios/pruefe-paket.sh PFAD/LU.app
#          VITE_LU_STORE_PRESET=appstore sh scripts/mobile/ios/pruefe-paket.sh PFAD/LU.app
#          (das Preset entscheidet, welche Berechtigungstexte das Paket tragen darf)
# Ende 0:  alles da. Ende 1: mindestens ein Punkt fehlt.
set -eu
APP="${1:?Pfad zum .app angeben}"
APP="${APP%/}"
PB=/usr/libexec/PlistBuddy
[ -f "$APP/Info.plist" ] || { echo "[paket] Kein App-Paket: $APP"; exit 2; }
WURZEL="$(cd "$(dirname "$0")/../../.." && pwd)"

FEHLER=0
ok()     { echo "[paket] OK      $1"; }
fehler() { echo "[paket] FEHLER  $1"; FEHLER=$((FEHLER + 1)); }
plist()  { $PB -c "Print :$1" "$APP/Info.plist" 2>/dev/null || echo "(fehlt)"; }

# Schema lu:// in CFBundleURLTypes, und zwar genau einmal. Bis Runde 6 stand es
# zweimal da (ein Eintrag je Host aus tauri.ios.conf.json); iOS kennt bei einem
# eigenen Schema keinen Host, der zweite Eintrag sagte nichts.
ANZAHL=0
i=0
while $PB -c "Print :CFBundleURLTypes:$i" "$APP/Info.plist" >/dev/null 2>&1; do
  j=0
  while S="$($PB -c "Print :CFBundleURLTypes:$i:CFBundleURLSchemes:$j" "$APP/Info.plist" 2>/dev/null)"; do
    [ "$S" = "lu" ] && ANZAHL=$((ANZAHL + 1))
    j=$((j + 1))
  done
  i=$((i + 1))
done
if [ "$ANZAHL" -eq 1 ]; then ok "URL-Schema lu ist genau einmal angemeldet (CFBundleURLTypes, $i Eintrag/Eintraege)"
elif [ "$ANZAHL" -eq 0 ]; then fehler "CFBundleURLTypes ohne das Schema lu: kein Deep Link (lu://oauth, lu://remote) erreicht die App"
else fehler "CFBundleURLTypes traegt das Schema lu $ANZAHL mal: tauri.ios.conf.json (plugins.deep-link.mobile) und src-tauri/Info.ios.plist nennen es je einmal, ohne Host"; fi

for k in NSMicrophoneUsageDescription NSCameraUsageDescription NSPhotoLibraryAddUsageDescription; do
  T="$(plist "$k")"
  if [ "$T" = "(fehlt)" ] || [ -z "$T" ]; then fehler "Berechtigungstext $k fehlt"; else ok "$k"; fi
done
# Was nur ein Bau mit Fernzugriff nennen darf (Schalter remoteDesktop des
# Store-Presets): das lokale Netz und den QR-Code der Kopplung. Apple verlangt,
# dass ein Berechtigungstext zu einer Funktion des Baus gehoert. Das Preset
# kommt aus VITE_LU_STORE_PRESET, sonst aus dem Baubeleg neben dem Paket,
# sonst ist es der offene Bau.
PRESET="$(node "$WURZEL/scripts/mobile/ios/preset-plist.mjs" preset-von "$APP")"
FERN=0
node "$WURZEL/scripts/mobile/ios/preset-plist.mjs" fernzugriff "$PRESET" || FERN=$?
case "$FERN" in
  0)
    ok "Preset $PRESET: mit Fernzugriff"
    T="$(plist NSLocalNetworkUsageDescription)"
    if [ "$T" = "(fehlt)" ] || [ -z "$T" ]; then fehler "Berechtigungstext NSLocalNetworkUsageDescription fehlt: das Preset $PRESET hat den Fernzugriff, ohne den Text fragt iOS ohne Begruendung nach dem lokalen Netz"; else ok "NSLocalNetworkUsageDescription"; fi
    if plist NSCameraUsageDescription | grep -q "QR code"; then ok "Kameratext nennt den QR-Code"; else fehler "Kameratext nennt den QR-Code nicht: das Preset $PRESET hat den Fernzugriff, Info.ios.fernzugriff.plist wurde nicht eingemischt"; fi ;;
  1)
    ok "Preset $PRESET: ohne Fernzugriff"
    if [ "$(plist NSLocalNetworkUsageDescription)" = "(fehlt)" ]; then ok "kein NSLocalNetworkUsageDescription"; else fehler "NSLocalNetworkUsageDescription steht im Paket, das Preset $PRESET hat keinen Fernzugriff: ein Text fuer eine Funktion, die der Bau nicht hat"; fi
    if plist NSCameraUsageDescription | grep -q -i -E "QR|pair|your computer"; then fehler "Kameratext nennt die Kopplung mit dem Rechner, das Preset $PRESET hat keinen Fernzugriff"; else ok "Kameratext nennt keinen Fernzugriff"; fi ;;
  *) fehler "Preset '$PRESET' ist unbekannt, die Berechtigungstexte lassen sich nicht pruefen" ;;
esac

[ "$(plist NSAppTransportSecurity:NSAllowsLocalNetworking)" = "true" ] && ok "NSAllowsLocalNetworking" || fehler "NSAllowsLocalNetworking fehlt"
[ "$(plist NSAppTransportSecurity:NSAllowsArbitraryLoads)" = "(fehlt)" ] && ok "kein NSAllowsArbitraryLoads" || fehler "NSAllowsArbitraryLoads ist gesetzt"
[ "$(plist ITSAppUsesNonExemptEncryption)" = "false" ] && ok "ITSAppUsesNonExemptEncryption false" || fehler "ITSAppUsesNonExemptEncryption fehlt oder ist nicht false"
[ "$(plist UIFileSharingEnabled)" = "true" ] && ok "UIFileSharingEnabled" || fehler "UIFileSharingEnabled fehlt"
[ "$(plist LSSupportsOpeningDocumentsInPlace)" = "true" ] && ok "LSSupportsOpeningDocumentsInPlace" || fehler "LSSupportsOpeningDocumentsInPlace fehlt"
[ "$(plist UILaunchStoryboardName)" = "LaunchScreen" ] && ok "UILaunchStoryboardName" || fehler "UILaunchStoryboardName fehlt"
[ "$(plist MinimumOSVersion)" = "17.0" ] && ok "MinimumOSVersion 17.0" || fehler "MinimumOSVersion ist '$(plist MinimumOSVersion)', soll 17.0"
# Nur iPhone: die erste Veroeffentlichung meldet das iPad nicht an (Entscheidung
# in FUER-DAVID.md, umkehrbar). Mit dem iPad im Paket prueft Apple auch dort und
# verlangt iPad-Screenshots. Quelle: TARGETED_DEVICE_FAMILY in gen/apple/project.yml.
FAMILIE="$($PB -c 'Print :UIDeviceFamily' "$APP/Info.plist" 2>/dev/null | awk '/^[[:space:]]*[0-9]+[[:space:]]*$/{printf "%s%s", s, $1; s=","}')"
if [ "$FAMILIE" = "1" ]; then ok "UIDeviceFamily 1 (nur iPhone)"
elif [ -z "$FAMILIE" ]; then fehler "UIDeviceFamily fehlt: das Paket nennt nicht, fuer welche Geraete es ist"
else fehler "UIDeviceFamily ist '$FAMILIE', soll '1' (nur iPhone): das Paket meldet das iPad an (TARGETED_DEVICE_FAMILY in src-tauri/gen/apple/project.yml)"; fi
# Die Version des iOS-Pakets: ein eigenes Feld in tauri.ios.conf.json gewinnt gegen tauri.conf.json.
SOLL="$(node "$WURZEL/scripts/mobile/release/handy-version.mjs" zeige ios 2>/dev/null | cut -d' ' -f1)"
[ -n "$SOLL" ] || SOLL="?"
[ "$(plist CFBundleShortVersionString)" = "$SOLL" ] && ok "Version $SOLL" || fehler "CFBundleShortVersionString ist '$(plist CFBundleShortVersionString)', soll '$SOLL'"

# Privacy Manifest: liegt im Paket, ist eine gueltige plist und gleicht der eingecheckten Datei.
MANIFEST="$APP/PrivacyInfo.xcprivacy"
QUELLE="$WURZEL/src-tauri/gen/apple/locally-uncensored_iOS/PrivacyInfo.xcprivacy"
if [ ! -f "$MANIFEST" ]; then
  fehler "PrivacyInfo.xcprivacy fehlt im Paket"
elif ! plutil -lint "$MANIFEST" >/dev/null 2>&1; then
  fehler "PrivacyInfo.xcprivacy ist keine gueltige plist"
elif [ "$(plutil -convert json -o - "$MANIFEST")" != "$(plutil -convert json -o - "$QUELLE")" ]; then
  fehler "PrivacyInfo.xcprivacy im Paket weicht von der eingecheckten Datei ab"
else
  ok "PrivacyInfo.xcprivacy liegt im Paket und gleicht der eingecheckten Datei"
fi

# Der lange Produktname steht nicht im Paket: `strings` ueber jede Datei, erlaubt
# sind nur die internen Stellen (mobile-docs/r19/name-im-programm.md Abschnitt 6).
NAME_PRUEFUNG="$(cd "$(dirname "$0")/../release" && pwd)/pruefe-name-im-paket.sh"
if "$NAME_PRUEFUNG" "$APP"; then ok "der lange Produktname steht nicht im Paket"; else fehler "der lange Produktname steht im Paket (Zeilen oben)"; fi

if [ "$FEHLER" = "0" ]; then
  echo "[paket] alle Pruefungen bestanden: $APP"
else
  echo "[paket] $FEHLER Pruefung(en) nicht bestanden: $APP"
  exit 1
fi
