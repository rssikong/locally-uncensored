#!/bin/zsh
# Simulatoren fuer die Abnahme: ein kleines und ein grosses iPhone, eigene Geraete mit festen Namen.
# Laeuft ohne Simulator.app (kein Fenster noetig), Screenshots und Fernsteuerung gehen trotzdem.
#
#   simulator.sh anlegen                      legt LU-iOS-klein (iPhone SE 3) und LU-iOS-gross (iPhone 17 Pro Max) an, falls sie fehlen
#   simulator.sh hoch [klein|gross|beide]     bootet und wartet, bis das Geraet bereit ist
#   simulator.sh udid <klein|gross>           gibt die UDID aus
#   simulator.sh einspielen <app> <bundle-id> [klein|gross|beide]   beendet, installiert und startet die App
#   simulator.sh runter [klein|gross|beide]   faehrt herunter
#   simulator.sh weg                          loescht beide Geraete samt Daten
set -euo pipefail
HIER="${0:A:h}"
# node fuer die Geraetegrenze (mobile-tests/geraet.mjs), aus nvm, falls die Shell es nicht schon hat.
if ! command -v node >/dev/null 2>&1; then
  NVM_NODE=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
  [ -n "$NVM_NODE" ] && export PATH="$NVM_NODE:$PATH"
fi
RUNTIME="${LU_SIM_RUNTIME:-com.apple.CoreSimulator.SimRuntime.iOS-26-5}"
NAME_KLEIN="${LU_SIM_KLEIN:-LU-iOS-klein}"
NAME_GROSS="${LU_SIM_GROSS:-LU-iOS-gross}"
TYP_KLEIN="com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation"
TYP_GROSS="com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max"

udid() {
  local name; [ "$1" = "klein" ] && name="$NAME_KLEIN" || name="$NAME_GROSS"
  xcrun simctl list devices -j | /usr/bin/python3 -c "
import json,sys
n=sys.argv[1]
for l in json.load(sys.stdin)['devices'].values():
    for d in l:
        if d['name']==n and d.get('isAvailable'): print(d['udid']); sys.exit(0)
" "$name"
}
welche() { case "${1:-beide}" in klein) echo klein ;; gross) echo gross ;; *) echo klein gross ;; esac }

case "${1:-}" in
  anlegen)
    [ -n "$(udid klein)" ] || xcrun simctl create "$NAME_KLEIN" "$TYP_KLEIN" "$RUNTIME"
    [ -n "$(udid gross)" ] || xcrun simctl create "$NAME_GROSS" "$TYP_GROSS" "$RUNTIME"
    echo "klein=$(udid klein)"; echo "gross=$(udid gross)" ;;
  udid) udid "${2:?klein oder gross}" ;;
  hoch)
    for g in $(welche "${2:-}"); do
      U=$(udid $g); [ -n "$U" ] || { echo "erst anlegen"; exit 1; }
      # Geraetegrenze der Maschine (hoechstens 2 Emulatoren oder Simulatoren): vor dem Start zaehlen.
      # Laeuft dieses Geraet schon, ist es kein neuer Start.
      if ! xcrun simctl list devices | grep -F "$U" | grep -q "(Booted)"; then
        node "$HIER/../../../mobile-tests/geraet.mjs" pruefen --ohne "$U" || exit 1
      fi
      xcrun simctl boot "$U" 2>/dev/null || true      # Fehler "already booted" ist in Ordnung
      xcrun simctl bootstatus "$U" >/dev/null
      echo "$g $U bereit"
    done ;;
  einspielen)
    APP="${2:?pfad zur .app}"; BUNDLE="${3:?bundle-id}"
    for g in $(welche "${4:-}"); do
      U=$(udid $g)
      xcrun simctl terminate "$U" "$BUNDLE" 2>/dev/null || true
      xcrun simctl install "$U" "$APP"                 # ueber eine vorhandene App: Daten bleiben erhalten
      xcrun simctl launch "$U" "$BUNDLE"
    done ;;
  runter) for g in $(welche "${2:-}"); do U=$(udid $g); [ -n "$U" ] && xcrun simctl shutdown "$U" 2>/dev/null || true; done ;;
  weg) for g in klein gross; do U=$(udid $g); [ -n "$U" ] && { xcrun simctl shutdown "$U" 2>/dev/null || true; xcrun simctl delete "$U"; }; done ;;
  *) sed -n 2,12p "$0"; exit 1 ;;
esac
