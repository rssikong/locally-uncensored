#!/bin/bash
# Prueft ein fertiges iOS-Paket darauf, ob es in den App Store darf.
#
# Aufruf:  scripts/mobile/release/pruefe-ios-ipa.sh <version> <code> <team> <kennung> <ipa oder .app>
#          <version>  die Version, die das Paket tragen soll (3.0.7)
#          <code>     die Baunummer dazu (30007001)
#          <team>     die Team-ID, mit der es signiert sein muss
#          <kennung>  die Kennung der App (CFBundleIdentifier)
# Umgebung: LU_RELEASE_DIST (freiwillig): der Ordner der gebauten Seite, Standard dist.
# Ende 0:  alles bestanden. Ende 1: mindestens ein Punkt nicht. Ende 2: falscher Aufruf.
#
# Die Grundpruefungen (Schema lu, Berechtigungstexte des Presets appstore,
# Privacy Manifest, Metal, Mindest-iOS, keine inspizierbare WebView) machen
# scripts/mobile/ios/pruefe-paket.sh und pruefe-geraete-paket.sh. Hier kommt dazu, was nur ein Store-Paket braucht:
# Verteilungs-Signatur des genannten Teams, kein get-task-allow, ein Profil
# ohne Geraeteliste, Version und Baunummer wie genannt, nur iPhone, kein Testhaken.
set -euo pipefail
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WURZEL="$(cd "$HIER/../../.." && pwd)"
PB=/usr/libexec/PlistBuddy

if [ $# -ne 5 ]; then
  echo "usage: pruefe-ios-ipa.sh <version> <code> <team> <bundle-id> <ipa or .app>" >&2
  exit 2
fi
VERSION="$1"; CODE="$2"; TEAM="$3"; KENNUNG="$4"; PAKET="${5%/}"

FEHLER=0
ok()   { echo "[package] ok    $1"; }
fail() { echo "[package] FAIL  $1"; FEHLER=$((FEHLER + 1)); }

ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
case "$PAKET" in
  *.ipa)
    [ -f "$PAKET" ] || { echo "[package] FAIL  no IPA at $PAKET"; exit 1; }
    unzip -q "$PAKET" -d "$ARBEIT"
    APP="$(find "$ARBEIT/Payload" -maxdepth 1 -name '*.app' -type d | head -1)" ;;
  *) APP="$PAKET" ;;
esac
if [ -z "${APP:-}" ] || [ ! -f "$APP/Info.plist" ]; then
  echo "[package] FAIL  no app with an Info.plist in $PAKET"
  exit 1
fi
plist() { $PB -c "Print :$1" "$APP/Info.plist" 2>/dev/null || echo "(missing)"; }
BIN="$APP/$(plist CFBundleExecutable)"

echo "== Basic checks of every iOS package (pruefe-paket.sh)"
if VITE_LU_STORE_PRESET=appstore sh "$WURZEL/scripts/mobile/ios/pruefe-paket.sh" "$APP"; then ok "pruefe-paket.sh passed"; else fail "pruefe-paket.sh found problems, see above"; fi
echo "== Checks of a signed device package (pruefe-geraete-paket.sh --signiert)"
if VITE_LU_STORE_PRESET=appstore sh "$WURZEL/scripts/mobile/ios/pruefe-geraete-paket.sh" "$APP" --signiert; then ok "pruefe-geraete-paket.sh passed"; else fail "pruefe-geraete-paket.sh found problems, see above"; fi

echo "== What only a store package needs"
if [ "$(plist CFBundleIdentifier)" = "$KENNUNG" ]; then ok "bundle id $KENNUNG"; else fail "bundle id is $(plist CFBundleIdentifier), expected $KENNUNG"; fi
if [ "$(plist CFBundleShortVersionString)" = "$VERSION" ]; then ok "version $VERSION"; else fail "wrong version: the package carries $(plist CFBundleShortVersionString), expected $VERSION"; fi
if [ "$(plist CFBundleVersion)" = "$CODE" ]; then ok "build number $CODE"; else fail "wrong version: the package carries build number $(plist CFBundleVersion), expected $CODE"; fi

# Nur iPhone: mit dem iPad im Paket prueft Apple auch dort und verlangt iPad-Screenshots.
FAMILIE="$($PB -c 'Print :UIDeviceFamily' "$APP/Info.plist" 2>/dev/null | awk '/^[[:space:]]*[0-9]+[[:space:]]*$/{printf "%s%s", s, $1; s=","}')"
if [ "$FAMILIE" = "1" ]; then ok "iPhone only (UIDeviceFamily 1)"; else fail "the package declares device family '${FAMILIE:-none}', expected 1 (iPhone only). With the iPad in it Apple reviews on an iPad and demands iPad screenshots."; fi

if codesign --verify --deep --strict "$APP" 2>/dev/null; then ok "signature is valid (codesign --verify --deep --strict)"; else fail "the signature is missing or not valid"; fi
SIG="$(codesign -dvv "$APP" 2>&1 || true)"
if printf '%s\n' "$SIG" | grep -q -E '^Authority=(Apple Distribution|iPhone Distribution)'; then
  ok "signed for distribution"
else
  fail "not signed with a distribution certificate (expected Authority Apple Distribution). A development or ad hoc signature cannot go to the App Store."
fi
IST_TEAM="$(printf '%s\n' "$SIG" | sed -n 's/^TeamIdentifier=//p' | head -1)"
if [ "$IST_TEAM" = "$TEAM" ]; then ok "signed by the expected team"; else fail "signed by team '${IST_TEAM:-none}', expected the team in APPLE_DEVELOPMENT_TEAM"; fi

ENT="$(codesign -d --entitlements - --xml "$APP" 2>/dev/null | plutil -convert json -o - - 2>/dev/null || echo '{}')"
case "$ENT" in
  *'"get-task-allow":true'*) fail "get-task-allow is true: this is a development build, the App Store refuses it" ;;
  *) ok "no get-task-allow" ;;
esac
case "$ENT" in
  *"\"application-identifier\":\"$TEAM.$KENNUNG\""*) ok "application-identifier matches team and bundle id" ;;
  *) fail "application-identifier in the signature is not $TEAM.$KENNUNG" ;;
esac
# Round 15: the page Account offers "Sign in with Apple" next to Google and GitHub (App Review rule 4.8).
# Without this entitlement in the signature the system refuses the sheet.
case "$ENT" in
  *'"com.apple.developer.applesignin":["Default"]'*) ok "entitlement com.apple.developer.applesignin (Default)" ;;
  *) fail "entitlement com.apple.developer.applesignin is missing: switch on Sign in with Apple at the App ID and renew the profile" ;;
esac

PROFIL="$APP/embedded.mobileprovision"
if [ ! -f "$PROFIL" ]; then
  fail "no embedded.mobileprovision in the package"
else
  security cms -D -i "$PROFIL" > "$ARBEIT/profil.plist" 2>/dev/null || true
  if $PB -c 'Print :ProvisionedDevices' "$ARBEIT/profil.plist" >/dev/null 2>&1; then
    fail "the profile lists devices: it is a development or ad hoc profile, not an App Store profile"
  elif [ "$($PB -c 'Print :ProvisionsAllDevices' "$ARBEIT/profil.plist" 2>/dev/null || echo false)" = "true" ]; then
    fail "the profile is an enterprise profile, not an App Store profile"
  else
    ok "App Store profile (no device list)"
  fi
fi

# Ein Probe-Paket (--probe: Platzhalter statt der Meldeadresse) besteht nur als Probe.
BELEG_PROBE="$(node -e 'try { process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).probe === true ? "1" : "0") } catch { process.stdout.write("0") }' "$PAKET.bau.json")"
if [ "${LU_RELEASE_PROBE:-}" = "1" ]; then
  if [ "$BELEG_PROBE" = "1" ]; then ok "the build receipt says probe"; else fail "this is a probe run, but the build receipt of the package does not say probe: the package is not from this run"; fi
else
  if [ "$BELEG_PROBE" = "1" ]; then fail "this package comes from a probe run (--probe) and must never be published: a probe of a store preset carries a placeholder instead of the report service address"; else ok "not a probe package"; fi
fi

# Keine Baupfade dieses Rechners im Programm (r49, N2; Integration 306 Abschnitt 35):
# Heimordner und Benutzername stuenden sonst in Panikorten und __FILE__ von llama.cpp.
echo "== Build paths"
HEIM_TREFFER="$(strings -a "$BIN" | grep -c -F "${HOME%/}/" || true)"
if [ "$HEIM_TREFFER" = "0" ]; then ok "no build path of this machine (home folder, user name) in the program"; else fail "$HEIM_TREFFER build path(s) with the home folder of this machine in the program (CFLAGS/CXXFLAGS of the build did not rewrite them)"; fi

echo "== Test hook"
if "$HIER/pruefe-testhaken.sh" "${LU_RELEASE_DIST:-$WURZEL/dist}" "$BIN"; then :; else FEHLER=$((FEHLER + 1)); fi

# Der lange Produktname steht nicht im Paket (mobile-docs/r19/name-im-programm.md).
echo "== Product name"
if "$HIER/pruefe-name-im-paket.sh" "$APP"; then :; else FEHLER=$((FEHLER + 1)); fi

echo
if [ "$FEHLER" = "0" ]; then
  echo "[package] all checks passed."
else
  echo "[package] $FEHLER check(s) failed. This package must not be published."
  exit 1
fi
