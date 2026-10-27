#!/bin/bash
# Prueft, dass ein Paket fuer eine Veroeffentlichung den Testhaken nicht traegt.
#
# Aufruf:  scripts/mobile/release/pruefe-testhaken.sh <dist-ordner> [programm ...]
#          <dist-ordner>  die gebaute Seite, aus der der Bau das Paket gefuellt hat (dist)
#          [programm]     die native Bibliothek oder das Programm aus dem Paket
#                         (Android: lib/arm64-v8a/*.so, iOS: LU.app/LU)
# Ende 0:  kein Fund. Ende 1: mindestens ein Fund. Ende 2: falscher Aufruf.
#
# Zwei Stellen, weil keine allein reicht:
#   1. Die Seite. Der Abnahmebau (VITE_LU_ABNAHME=1) haengt window.__LU_TEST__
#      an die Seite. Im Paket liegt die Seite gepackt in der Bibliothek und
#      laesst sich dort nicht durchsuchen (BAUEN.md 4.7), deshalb wird der
#      Ordner dist durchsucht, aus dem der Bau sie genommen hat.
#   2. Das Programm. Das Cargo-Feature abnahme macht die WebView inspizierbar.
#      Dann stehen diese Namen als Text im Programm: auf Android
#      setWebContentsDebuggingEnabled, auf iOS developerExtrasEnabled und
#      setInspectable. In einem gewoehnlichen Release kommen sie 0-mal vor.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: pruefe-testhaken.sh <dist-dir> [binary ...]" >&2
  exit 2
fi
DIST="$1"
shift
FUNDE=0

if [ ! -f "$DIST/index.html" ]; then
  echo "[test-hook] FAIL  $DIST is not a built page (no index.html), nothing to check"
  exit 1
fi
TREFFER="$(grep -rl -e '__LU_TEST__' "$DIST" 2>/dev/null || true)"
if [ -n "$TREFFER" ]; then
  echo "[test-hook] FAIL  the test hook __LU_TEST__ is in the built page:"
  printf '%s\n' "$TREFFER" | head -5 | sed "s|^$DIST/|[test-hook]         |"
  FUNDE=$((FUNDE + 1))
else
  echo "[test-hook] ok    no __LU_TEST__ in the built page ($(find "$DIST" -type f | wc -l | tr -d ' ') files)"
fi

for PROGRAMM in "$@"; do
  if [ ! -f "$PROGRAMM" ]; then
    echo "[test-hook] FAIL  $PROGRAMM does not exist"
    FUNDE=$((FUNDE + 1))
    continue
  fi
  TEXT="$(strings -a "$PROGRAMM")"
  for MARKE in __LU_TEST__ setWebContentsDebuggingEnabled developerExtrasEnabled setInspectable; do
    N="$(printf '%s\n' "$TEXT" | grep -c -e "$MARKE" || true)"
    if [ "$N" != "0" ]; then
      echo "[test-hook] FAIL  '$MARKE' is in $(basename "$PROGRAMM") ($N times): this is an acceptance build (feature abnahme) or a debug build"
      FUNDE=$((FUNDE + 1))
    fi
  done
  if [ "$FUNDE" = "0" ]; then
    echo "[test-hook] ok    no acceptance marker in $(basename "$PROGRAMM")"
  fi
done

if [ "$FUNDE" != "0" ]; then
  echo "[test-hook] $FUNDE finding(s). This package must not be published."
  exit 1
fi
