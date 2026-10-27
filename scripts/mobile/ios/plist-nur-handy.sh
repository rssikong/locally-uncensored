#!/bin/sh
# Nimmt aus der Info.plist eines gebauten iOS-Pakets heraus, was nur der
# Rechner meint.
#
# Warum: die Tauri-CLI mischt bei jedem iOS-Bau auch src-tauri/Info.plist ein.
# Das ist die Datei des Mac-Programms. Seit sie dort den Schluessel
# NSLocalNetworkUsageDescription traegt (der Mac fragt ab macOS 15 vor dem
# lokalen Netz), stand er mit dem Satz des Rechners in jedem iOS-Paket, auch
# im Bau ohne Fernzugriff (Preset appstore), der kein Geraet im WLAN
# anspricht. Ein Berechtigungstext muss zu einer Funktion des Baus gehoeren
# (scripts/mobile/ios/preset-plist.mjs). Die CLI kann beim Mischen keinen
# Schluessel herausnehmen, und die Datei des Rechners bleibt, wie sie ist.
#
# Regel: ein Schluessel, der im fertigen Paket WORTGLEICH den Wert aus
# src-tauri/Info.plist traegt, kommt vom Rechner und wird entfernt. Was das
# Handy selbst sagt (Info.ios.plist, Info.ios.fernzugriff.plist), steht nach
# der Datei des Rechners und hat einen eigenen Wortlaut, bleibt also stehen.
# src/lib/__tests__/mobile-ios-fallen.test.ts haelt, dass kein Text des Handys
# dem des Rechners gleicht.
#
# Aufruf:  sh scripts/mobile/ios/plist-nur-handy.sh PFAD/Info.plist [WURZEL]
#          Xcode ruft es als Bauphase nach dem Verarbeiten der Info.plist und
#          vor der Signatur (gen/apple/project.yml, postBuildScripts).
# Ende 0:  nichts zu tun oder entfernt. Ende 1: die Datei gibt es nicht.
set -eu
ZIEL="${1:?Pfad zur Info.plist des Pakets angeben}"
WURZEL="${2:-$(cd "$(dirname "$0")/../../.." && pwd)}"
PB=/usr/libexec/PlistBuddy
RECHNER="$WURZEL/src-tauri/Info.plist"
[ -f "$ZIEL" ] || { echo "[plist] keine Info.plist: $ZIEL"; exit 1; }
[ -f "$RECHNER" ] || exit 0
/usr/bin/plutil -convert xml1 -o - "$RECHNER" | sed -n 's/^[[:space:]]*<key>\([^<]*\)<\/key>.*$/\1/p' | while IFS= read -r KEY; do
  VOM_RECHNER="$($PB -c "Print :$KEY" "$RECHNER" 2>/dev/null || true)"
  IM_PAKET="$($PB -c "Print :$KEY" "$ZIEL" 2>/dev/null || true)"
  if [ -n "$VOM_RECHNER" ] && [ "$IM_PAKET" = "$VOM_RECHNER" ]; then
    $PB -c "Delete :$KEY" "$ZIEL"
    echo "[plist] $KEY entfernt: der Text ist der des Rechners, das Handy hat keinen eigenen dafuer"
  fi
done
