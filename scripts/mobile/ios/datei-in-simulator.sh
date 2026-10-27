#!/bin/zsh
# Bringt eine Datei in den Simulator.
# Aufruf: datei-in-simulator.sh <udid> <datei> [files|fotos|app <bundle-id>]
#   files  legt sie unter "Auf meinem iPhone" der Dateien-App ab (Standard), damit die Dateiauswahl sie findet
#   fotos  legt ein Bild oder Video in die Fotomediathek (simctl addmedia)
#   app    kopiert sie nach Documents im Daten-Container der App
set -euo pipefail
UDID="${1:?udid}"; DATEI="${2:?datei}"; ZIEL="${3:-files}"
case "$ZIEL" in
  fotos) xcrun simctl addmedia "$UDID" "$DATEI" ;;
  app)
    C=$(xcrun simctl get_app_container "$UDID" "${4:?bundle-id}" data)
    mkdir -p "$C/Documents" && cp "$DATEI" "$C/Documents/" && echo "$C/Documents/$(basename "$DATEI")" ;;
  files)
    BASIS="$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data/Containers/Shared/AppGroup"
    for g in "$BASIS"/*; do
      id=$(plutil -extract MCMMetadataIdentifier raw "$g/.com.apple.mobile_container_manager.metadata.plist" 2>/dev/null || true)
      if [ "$id" = "group.com.apple.FileProvider.LocalStorage" ]; then
        mkdir -p "$g/File Provider Storage" && cp "$DATEI" "$g/File Provider Storage/" && echo "$g/File Provider Storage/$(basename "$DATEI")"; exit 0
      fi
    done
    echo "Container group.com.apple.FileProvider.LocalStorage nicht gefunden (Simulator einmal booten)"; exit 1 ;;
esac
