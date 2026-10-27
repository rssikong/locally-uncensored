#!/bin/zsh
# Die simctl-Griffe fuer die Abnahme an einer Stelle. Alles hier ist im Simulator iOS 26.5 belegt.
# Aufruf: steuerung.sh <udid> <befehl> [argumente]
set -euo pipefail
U="${1:?udid}"; B="${2:?befehl}"; shift 2
case "$B" in
  dunkel)        xcrun simctl ui "$U" appearance dark ;;
  hell)          xcrun simctl ui "$U" appearance light ;;
  schrift)       xcrun simctl ui "$U" content_size "${1:-accessibility-extra-extra-extra-large}" ;;  # zurueck: large
  kontrast)      xcrun simctl ui "$U" increase_contrast "${1:-enabled}" ;;
  deeplink)      xcrun simctl openurl "$U" "${1:?url}" ;;       # zeigt beim ersten Mal je App-Start den Dialog "In ... oeffnen?"
  abschuss)      xcrun simctl terminate "$U" "${1:?bundle-id}" ;;
  start)         xcrun simctl launch "$U" "${1:?bundle-id}" ;;   # bei laufender App: holt sie in den Vordergrund
  startlog)      xcrun simctl launch --console-pty "$U" "${1:?bundle-id}" ;;   # println und stderr der Rust-Seite im Terminal
  hintergrund)   xcrun simctl launch "$U" com.apple.Preferences ;;            # andere App nach vorn, unsere wird nach wenigen Sekunden angehalten
  statusleiste)  xcrun simctl status_bar "$U" override --time 9:41 --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularBars 4 ;;
  statusleiste-weg) xcrun simctl status_bar "$U" clear ;;
  erlauben)      xcrun simctl privacy "$U" grant "${1:?dienst, z.B. microphone photos camera}" "${2:?bundle-id}" ;;
  entziehen)     xcrun simctl privacy "$U" revoke "${1:?dienst}" "${2:?bundle-id}" ;;
  rechte-neu)    xcrun simctl privacy "$U" reset all "${1:?bundle-id}" ;;
  container)     xcrun simctl get_app_container "$U" "${1:?bundle-id}" data ;;
  bild)          xcrun simctl io "$U" screenshot --type=png "${1:?pfad}" ;;
  film)          xcrun simctl io "$U" recordVideo --codec=h264 "${1:?pfad.mp4}" ;;   # mit Strg-C beenden
  zwischenablage) xcrun simctl pbpaste "$U" ;;
  log)           xcrun simctl spawn "$U" log stream --level debug --predicate "process == \"${1:?prozessname}\"" ;;
  *) grep -E '^\s+[a-z-]+\)' "$0" | sed 's/).*//' ; exit 1 ;;
esac
