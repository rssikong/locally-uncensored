#!/bin/bash
# Google Play: baut das signierte AAB (und das APK dazu) mit dem Preset play.
#
# Aufruf:   scripts/mobile/release/android-play.sh --version 3.0.7 --dry-run
#               prueft alle Vorbedingungen und sagt, was fehlt. Baut nichts.
#           LU_ANDROID_KEY_PROPERTIES=/pfad/key.properties VITE_LU_REPORT_URL=https://... \
#             scripts/mobile/release/android-play.sh --version 3.0.7
#               baut, prueft das Paket und nennt am Ende die zwei Dateien.
#           ... android-play.sh --version 3.0.7 --upload --confirm UPLOAD-TO-PLAY
#               laedt das AAB danach als Entwurf in die interne Testspur.
#           ... android-play.sh --version 3.0.7 --probe
#               Probelauf ohne echte Meldeadresse: baut mit einer Platzhalter-Adresse,
#               das Paket heisst PROBE, liegt in PROBE-play-..., wird nie hochgeladen.
#
# Umgebung:
#   LU_ANDROID_KEY_PROPERTIES   Pfad zur key.properties mit dem echten Schluessel (Pflicht, _android.sh)
#   VITE_LU_REPORT_URL          https-Adresse des Meldedienstes (Pflicht fuer play)
#   LU_ANDROID_CERT_SHA256      freiwillig: Fingerabdruck des echten Zertifikats, wird am Paket verglichen
#   nur fuer --upload:
#   LU_PLAY_SERVICE_ACCOUNT_JSON  Pfad zur Schluesseldatei des Dienstkontos, ausserhalb jedes Repos
#   LU_PLAY_TRACK                 Spur, Standard internal
#
# Das Skript bricht ab bei: fehlendem Schluessel, Wegwerf-Signatur, fehlender
# Meldeadresse, falscher Versionsnummer, Feature abnahme, Testhaken im Paket.
# Es nimmt keine Cargo-Features an. Hochgeladen wird nur mit --upload und dem
# Bestaetigungswort, und auch dann nur als Entwurf: freigeben muss ein Mensch
# in der Play Console.
#
# Ergebnis: ein eigener Ordner ausserhalb des Bauordners, mit Baubeleg und SHA-256
#   <release-pakete>/play-<version>-<baunummer>/LU-play-<version>-<baunummer>.aab   (das laedst du hoch)
#   <release-pakete>/play-<version>-<baunummer>/LU-play-<version>-<baunummer>.apk
# <release-pakete> ist der Ordner release-pakete neben dem Arbeitsbaum, oder
# was LU_RELEASE_PAKETE nennt. Das Skript nennt den Ordner am Ende.
set -euo pipefail
# shellcheck source=scripts/mobile/release/_gemeinsam.sh
source "$(dirname "${BASH_SOURCE[0]}")/_gemeinsam.sh"
# shellcheck source=scripts/mobile/release/_android.sh
source "$RELEASE_DIR/_android.sh"

PRESET=play
WORT="UPLOAD-TO-PLAY"
hilfe() { sed -n '2,33p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

argumente_lesen "$WORT" "$@"
umgebung_setzen
android_umgebung
cd "$WURZEL"

echo "LU for Google Play (preset $PRESET), signed AAB and APK"
echo "Preconditions"
pruefe_allgemein "$PRESET" android
android_vorpruefung

if [ "$UPLOAD" = "1" ]; then
  echo "Upload (asked for with --upload --confirm $WORT)"
  if command -v fastlane >/dev/null 2>&1; then ok "fastlane"; else missing "upload: fastlane is not installed (brew install fastlane). Without it, upload the AAB by hand in the Play Console."; fi
  if [ -z "${LU_PLAY_SERVICE_ACCOUNT_JSON:-}" ]; then
    missing "upload: LU_PLAY_SERVICE_ACCOUNT_JSON is not set (path to the key file of the Play service account)"
  elif [ ! -f "$LU_PLAY_SERVICE_ACCOUNT_JSON" ]; then
    missing "upload: LU_PLAY_SERVICE_ACCOUNT_JSON names a file that does not exist"
  elif im_git_baum "$LU_PLAY_SERVICE_ACCOUNT_JSON"; then
    missing "upload: the service account key lies inside a git working tree. Move it outside every repository."
  else
    ok "service account key file exists, outside every repository"
  fi
else
  note "upload: off (default). The script ends with the two files."
fi
vorpruefung_abschliessen "Google Play"

android_bauen_und_pruefen "$PRESET" 1

echo
if [ "$PROBE" = "1" ]; then
  echo "PROBE package, NOT for publication:"
else
  echo "Ready for Google Play:"
fi
paket_ablegen play android "$AAB" "$APK"
if [ "$UPLOAD" = "1" ]; then
  SPUR="${LU_PLAY_TRACK:-internal}"
  echo
  echo "Uploading the AAB to Google Play, track $SPUR, as a draft"
  # Die Schluesseldatei geht als Pfad an fastlane. Nichts davon wird in eine Datei geschrieben.
  kein_upload_im_probelauf
  fastlane supply \
    --aab "$AAB" \
    --package_name "$(node "$RELEASE_DIR/handy-version.mjs" kennung android)" \
    --track "$SPUR" \
    --release_status draft \
    --json_key "$LU_PLAY_SERVICE_ACCOUNT_JSON" \
    --skip_upload_apk true \
    --skip_upload_metadata true \
    --skip_upload_changelogs true \
    --skip_upload_images true \
    --skip_upload_screenshots true
  echo "Uploaded as a draft. Nothing is live: the release is rolled out by hand in the Play Console."
elif [ "$PROBE" = "1" ]; then
  echo
  echo "Not uploaded, and never to be: this is a probe package."
else
  echo
  echo "Not uploaded. Upload the AAB in the Play Console, or run again with --upload --confirm $WORT"
fi
hinweis_nach_dem_bau
