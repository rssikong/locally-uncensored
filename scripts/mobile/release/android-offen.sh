#!/bin/bash
# Direkter Download: baut das signierte APK mit dem Preset open.
#
# Aufruf:   scripts/mobile/release/android-offen.sh --version 3.0.7 --dry-run
#               prueft alle Vorbedingungen und sagt, was fehlt. Baut nichts.
#           LU_ANDROID_KEY_PROPERTIES=/pfad/key.properties \
#             scripts/mobile/release/android-offen.sh --version 3.0.7
#               baut, prueft das Paket und nennt am Ende die Datei.
#           ... android-offen.sh --version 3.0.7 --probe
#               Probelauf: das Paket heisst PROBE und liegt in PROBE-offen-...
#
# Umgebung:
#   LU_ANDROID_KEY_PROPERTIES   Pfad zur key.properties mit dem echten Schluessel (Pflicht, _android.sh)
#   VITE_LU_REPORT_URL          freiwillig: mit ihr werden Inhaltsmeldungen zugestellt,
#                               ohne sie warten sie auf dem Geraet
#   LU_ANDROID_CERT_SHA256      freiwillig: Fingerabdruck des echten Zertifikats, wird am Paket verglichen
#
# Das Preset open ist der offene Bau: ohne Altersfrage, mit allen Stufen und
# mit Links zur Webseite. Er gehoert NICHT in einen Store. Dieses Skript hat
# deshalb keinen Upload, das APK ist eine Datei zum Selbstverteilen.
#
# Das Skript bricht ab bei: fehlendem Schluessel, Wegwerf-Signatur, falscher
# Versionsnummer, Feature abnahme, Testhaken im Paket. Es nimmt keine
# Cargo-Features an.
#
# Ergebnis: ein eigener Ordner ausserhalb des Bauordners, mit Baubeleg und SHA-256
#   <release-pakete>/offen-<version>-<baunummer>/LU-offen-<version>-<baunummer>.apk
# <release-pakete> ist der Ordner release-pakete neben dem Arbeitsbaum, oder
# was LU_RELEASE_PAKETE nennt. Das Skript nennt den Ordner am Ende.
set -euo pipefail
# shellcheck source=scripts/mobile/release/_gemeinsam.sh
source "$(dirname "${BASH_SOURCE[0]}")/_gemeinsam.sh"
# shellcheck source=scripts/mobile/release/_android.sh
source "$RELEASE_DIR/_android.sh"

PRESET=open
hilfe() { sed -n '2,29p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

# Leeres Bestaetigungswort: dieses Ziel kennt keinen Upload.
argumente_lesen "" "$@"
umgebung_setzen
android_umgebung
cd "$WURZEL"

echo "LU for direct download (preset $PRESET), signed APK"
echo "Preconditions"
pruefe_allgemein "$PRESET" android
android_vorpruefung
case "${VITE_LU_REPORT_URL:-}" in
  https://?*) ok "report service address is set: content reports are delivered" ;;
  *) note "VITE_LU_REPORT_URL is not set: content reports stay in a queue on the phone (allowed in the open build)" ;;
esac
note "upload: none. This target has no upload step."
vorpruefung_abschliessen "Direct download"

android_bauen_und_pruefen "$PRESET" 0

echo
if [ "$PROBE" = "1" ]; then
  echo "PROBE package, NOT for publication:"
else
  echo "Ready for direct download:"
fi
paket_ablegen offen android "$APK"
hinweis_nach_dem_bau
