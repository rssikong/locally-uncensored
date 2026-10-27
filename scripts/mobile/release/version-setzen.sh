#!/bin/bash
# Setzt die Version der Handy-Pakete (Android und iOS) an EINER Stelle.
#
# Aufruf:   scripts/mobile/release/version-setzen.sh <version> <bau> [--dry-run]
# Beispiel: scripts/mobile/release/version-setzen.sh 3.0.7 1 --dry-run   (zeigt nur, was sich aendert)
#           scripts/mobile/release/version-setzen.sh 3.0.7 1             (schreibt)
#           scripts/mobile/release/version-setzen.sh 3.0.7 2             (dieselbe Version noch einmal in den Store)
#           scripts/mobile/release/version-setzen.sh 3.0.7-pre1 0        (Vorab-Paket, nur offener Bau)
#
# <bau> ist 1 bis 999 und zaehlt hoch, wenn dieselbe Version noch einmal in
# einen Store geladen wird. Aus Version und Bau entsteht die eine Zahl, die
# Android als versionCode und iOS als CFBundleVersion traegt
# (scripts/mobile/release/versionen.py, 3.0.7 mit Bau 1 ergibt 30007001).
#
# Vorab-Version X.Y.Z-preN (N 1 bis 99): ein Paket vor X.Y.Z fuer Tester, nur
# ueber android-offen.sh, nie in einem Store (die Store-Skripte lehnen es ab).
# <bau> ist dann 0, der Code der von X.Y.Z mit Bau 0 (3.0.7-pre1 ergibt
# 30007000): die echte X.Y.Z mit Bau 1 installiert darueber. Gesetzt wird so
# eine Version nur auf einem eigenen Zweig, nie auf der Lieferlinie.
#
# Geaendert werden genau diese vier Dateien (handy-version.mjs dateien):
#   src-tauri/tauri.android.conf.json                         version, bundle.android.versionCode
#   src-tauri/tauri.ios.conf.json                             version, bundle.iOS.bundleVersion
#   src-tauri/gen/apple/project.yml                           CFBundleShortVersionString, CFBundleVersion
#   src-tauri/gen/apple/locally-uncensored_iOS/Info.plist     CFBundleShortVersionString, CFBundleVersion
#
# Nie angefasst: die Desktop-Version (src-tauri/tauri.conf.json, package.json,
# src-tauri/Cargo.toml). Sie muss der Handy-Version nicht gleichen: ein
# Handy-Bau reicht der Seite About die Version seines Pakets als Bau-Konstante
# (src/dev/phone-version.ts), der Desktop liest weiter package.json.
#
# Das Skript committet nichts. Danach: git diff ansehen, dann committen.
set -euo pipefail
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VERSION=""
BAU=""
WEITER=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) WEITER+=(--dry-run) ;;
    --wurzel)
      [ $# -ge 2 ] || { echo "ABORT: --wurzel needs a directory" >&2; exit 2; }
      WEITER+=(--wurzel "$2"); shift ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "ABORT: unknown option '$1'" >&2; exit 2 ;;
    *)
      if [ -z "$VERSION" ]; then VERSION="$1"
      elif [ -z "$BAU" ]; then BAU="$1"
      else echo "ABORT: too many arguments. Usage: version-setzen.sh <version> <build> [--dry-run]" >&2; exit 2
      fi ;;
  esac
  shift
done
if [ -z "$VERSION" ] || [ -z "$BAU" ]; then
  echo "ABORT: usage: version-setzen.sh <version> <build> [--dry-run], for example: version-setzen.sh 3.0.7 1 --dry-run" >&2
  exit 2
fi
case "$BAU" in
  ''|*[!0-9]*) echo "ABORT: build '$BAU' is not a number (1 to 999)" >&2; exit 2 ;;
esac
if node "$HIER/handy-version.mjs" vorab "$VERSION"; then
  if [ "$BAU" != "0" ]; then
    echo "ABORT: $VERSION is a pre-release. Its build is 0 (its code lies below build 1 of the release), for example: version-setzen.sh $VERSION 0" >&2
    exit 2
  fi
elif [ "$BAU" -lt 1 ] || [ "$BAU" -gt 999 ]; then
  echo "ABORT: build $BAU is out of range (1 to 999)" >&2
  exit 2
fi

# Der Code kommt aus versionen.py, damit das Schema an einer Stelle steht.
CODE="$(python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); import versionen; print(versionen.codes(sys.argv[2], int(sys.argv[3])))' "$HIER" "$VERSION" "$BAU")"
echo "version $VERSION, build $BAU, code $CODE (Android versionCode, iOS CFBundleVersion)"
if [ ${#WEITER[@]} -gt 0 ]; then
  exec node "$HIER/handy-version.mjs" setze "$VERSION" "$CODE" "${WEITER[@]}"
fi
exec node "$HIER/handy-version.mjs" setze "$VERSION" "$CODE"
