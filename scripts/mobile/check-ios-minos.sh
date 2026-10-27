#!/bin/sh
# Prueft, fuer welche iOS-Mindestversion die C++-Objekte von llama.cpp in der
# fertigen Bibliothek gebaut wurden.
#
# Hintergrund (mobile-docs/BAUEN.md, Falle B): Ohne IPHONEOS_DEPLOYMENT_TARGET
# baut CMake llama.cpp fuer die SDK-Version (z. B. 26.5). Im Simulator faellt
# das nicht auf, auf einem iPhone mit aelterem iOS kann die App beim Start
# abstuerzen. Und das Build-Skript von llama-cpp-sys-2 bemerkt eine geaenderte
# Variable nicht, ein alter Zwischenstand bleibt also liegen.
#
# Aufruf:   scripts/mobile/check-ios-minos.sh [ziel] [profil] [erwartet]
# Beispiel: scripts/mobile/check-ios-minos.sh aarch64-apple-ios-sim debug 17.0
# Ende 0:   jedes llama- und ggml-Objekt traegt genau die erwartete Version.
set -eu

ZIEL="${1:-aarch64-apple-ios-sim}"
PROFIL="${2:-debug}"
ERWARTET="${3:-17.0}"
WURZEL="$(cd "$(dirname "$0")/../.." && pwd)"
LIB="$WURZEL/src-tauri/target/$ZIEL/$PROFIL/liblocally_uncensored_lib.a"

if [ ! -f "$LIB" ]; then
  echo "Nicht gefunden: $LIB"
  echo "Erst bauen: (cd src-tauri && cargo build --target $ZIEL --lib)"
  exit 2
fi

# otool druckt je Objekt "…(name.o):" und darunter dessen Ladebefehle. Je
# Objekt wird die erste minos- (LC_BUILD_VERSION) oder version-Zeile
# (LC_VERSION_MIN_IPHONEOS) genommen, und nur die Objekte aus llama.cpp zaehlen.
VERSIONEN="$(otool -l "$LIB" 2>/dev/null | awk '
  /^.*\(.*\.o\):$/ { obj = $0; gesehen = 0; next }
  (/^ *minos / || /^ *version [0-9]/) && !gesehen {
    gesehen = 1
    if (obj ~ /(llama|ggml|common|sampling|unicode|gguf)[^\/]*\.(c|cpp|m|mm)\.o\)/) print $2
  }
' | sort | uniq -c)"

if [ -z "$VERSIONEN" ]; then
  echo "Keine llama.cpp-Objekte in $LIB gefunden. Ist die In-Prozess-Engine eingebaut?"
  exit 2
fi

echo "iOS-Mindestversion der llama.cpp-Objekte in $ZIEL/$PROFIL (Anzahl, Version):"
echo "$VERSIONEN"

ANDERE="$(echo "$VERSIONEN" | awk -v e="$ERWARTET" '$2 != e' | wc -l | tr -d ' ')"
if [ "$ANDERE" != "0" ]; then
  echo "FEHLER: erwartet wurde ueberall $ERWARTET."
  echo "Abhilfe: (cd src-tauri && cargo clean --target $ZIEL -p llama-cpp-sys-2) und neu bauen."
  exit 1
fi
echo "OK: alle Objekte stehen auf $ERWARTET."
