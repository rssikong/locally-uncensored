#!/bin/zsh
# Prueft VOR einem Bau, ob er als Store-Bau entstehen darf.
#
# Aufruf: scripts/mobile/store-bau-pruefen.sh <debug|release>
# Ende 0: der Bau darf starten. Ende 2: Abbruch, mit der Begruendung.
#
# Zwei Regeln (Durchsicht M4 und M5), dieselben wie in
# src/dev/store-build-check.ts, das jeder `vite build` noch einmal fragt:
#
#   1. Ein Release-Bau nennt sein Preset ausdruecklich in VITE_LU_STORE_PRESET
#      (open, play, appstore). Fehlte die Variable, war das Paket still der
#      offene Bau: ohne Altersfrage, mit dem ungefilterten Katalog, mit
#      Kauflinks. Ein Debug-Bau darf ohne Preset entstehen (dann open).
#   2. Ein Bau mit play oder appstore braucht VITE_LU_REPORT_URL (https).
#      Beide Stores verlangen, dass eine Meldung beim Hersteller ankommt.
#      Ohne die Adresse bliebe jede Meldung fuer immer auf dem Handy.
#
# Ein unbekannter Wert (Tippfehler) ist in jedem Bau ein Abbruch, weil die App
# daraus still "open" gemacht haette.
set -eu
ART="${1:-debug}"
PRESET="${VITE_LU_STORE_PRESET:-}"
URL="${VITE_LU_REPORT_URL:-}"

if [ -z "$PRESET" ]; then
  if [ "$ART" = "release" ]; then
    echo "[store-bau] ABBRUCH: VITE_LU_STORE_PRESET ist nicht gesetzt."
    echo "[store-bau] Ein Release-Bau nennt sein Preset ausdruecklich: open, play oder appstore."
    echo "[store-bau] Beispiel: VITE_LU_STORE_PRESET=play VITE_LU_REPORT_URL=https://... $0:h/android-bauen.sh release"
    echo "[store-bau] Fuer einen Abnahmebau ohne Store-Regeln: VITE_LU_STORE_PRESET=open"
    exit 2
  fi
  echo "[store-bau] Debug-Bau ohne Preset: die App ist der offene Bau (open)."
  exit 0
fi

case "$PRESET" in
  open) ;;
  play|appstore)
    case "$URL" in
      https://?*) ;;
      *)
        echo "[store-bau] ABBRUCH: Preset $PRESET ohne VITE_LU_REPORT_URL (https)."
        echo "[store-bau] Ein Store-Bau muss Meldungen zu erzeugten Inhalten zustellen koennen."
        echo "[store-bau] Setze die Adresse des Meldedienstes, oder baue das Preset open."
        exit 2 ;;
    esac ;;
  *)
    echo "[store-bau] ABBRUCH: VITE_LU_STORE_PRESET=$PRESET ist kein bekanntes Preset (open, play, appstore)."
    exit 2 ;;
esac
echo "[store-bau] Preset $PRESET, Meldedienst: ${URL:-keiner (offener Bau)}"
