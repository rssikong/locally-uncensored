#!/bin/zsh
# Schreibt neben ein fertiges Paket, womit es gebaut wurde.
#
# Aufruf: scripts/mobile/bau-beleg.sh <debug|release> <cargo-features> <paket>
#         <paket> ist eine .apk-Datei oder ein .app-Ordner.
# Ergebnis: <paket>.bau.json (liegt im Bauordner, der nicht verfolgt wird)
#
# Wozu: welches Store-Preset ein Paket traegt, steht in der gebauten Seite,
# und die liegt gepackt in der Bibliothek. Am Paket selbst laesst es sich
# nicht ablesen. Die Abnahme (mobile-tests/checks/release.mjs, Punkt 8) liest
# deshalb diesen Beleg: Preset genannt, Store-Preset mit Meldedienst und ohne
# Testhaken. Der Fingerabdruck bindet den Beleg an genau dieses Paket, ein
# liegengebliebener Beleg eines frueheren Baus zaehlt nicht.
#
# Die Adresse des Meldedienstes wird nicht abgelegt, nur ob eine gesetzt war.
# Ein Probelauf der Release-Skripte (--probe, LU_RELEASE_PROBE=1) baut mit einer
# Platzhalter-Adresse. Sein Beleg sagt `probe: true`, und die Paketpruefung
# laesst ein solches Paket nie als veroeffentlichbar durch.
set -eu
ART="$1"
FEATURES="${2:-}"
PAKET="$3"

if [ -d "$PAKET" ]; then
  DATEI="$PAKET/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$PAKET/Info.plist")"
else
  DATEI="$PAKET"
fi
[ -f "$DATEI" ] || { echo "[bau-beleg] FEHLER: $DATEI gibt es nicht."; exit 1; }
SHA="$(shasum -a 256 "$DATEI" | cut -d' ' -f1)"
MELDEDIENST=false
case "${VITE_LU_REPORT_URL:-}" in https://?*) MELDEDIENST=true ;; esac

BELEG_ART="$ART" BELEG_FEATURES="$FEATURES" BELEG_SHA="$SHA" BELEG_MELDEDIENST="$MELDEDIENST" BELEG_ZIEL="${PAKET%/}.bau.json" node -e '
const e = process.env
const beleg = {
  art: e.BELEG_ART,
  preset: (e.VITE_LU_STORE_PRESET ?? "").trim() || null,
  meldedienst: e.BELEG_MELDEDIENST === "true",
  features: e.BELEG_FEATURES.split(/[, ]+/).filter(Boolean),
  ...(e.LU_RELEASE_PROBE === "1" ? { probe: true } : {}),
  sha256: e.BELEG_SHA,
  zeit: new Date().toISOString(),
}
require("node:fs").writeFileSync(e.BELEG_ZIEL, JSON.stringify(beleg, null, 2) + "\n")
console.log(`[bau-beleg] ${e.BELEG_ZIEL}: ${beleg.art}, Preset ${beleg.preset ?? "keines (offener Bau)"}, Features ${beleg.features.join(" ") || "keine"}`)
'
