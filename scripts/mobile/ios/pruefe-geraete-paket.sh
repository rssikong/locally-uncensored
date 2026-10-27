#!/bin/sh
# Prueft ein iOS-Paket fuer das ECHTE Geraet: das, was sich ohne iPhone an der
# Datei selbst belegen laesst. Geschrieben fuer das unsignierte Archiv aus
# scripts/mobile/ios/bauen-geraet-unsigniert.sh, taugt genauso fuer ein
# signiertes Archiv (dann mit --signiert).
#
# Aufruf:   sh scripts/mobile/ios/pruefe-geraete-paket.sh PFAD [--signiert]
#           PFAD ist ein .xcarchive oder ein .app
# Ende 0:   jede Pruefung bestanden. Ende 1: mindestens eine nicht.
#
# Was hier NICHT geprueft werden kann: ob die App auf einem iPhone startet.
set -eu
PFAD="${1:?Pfad zum .xcarchive oder .app angeben}"
SIGNIERT=0
[ "${2:-}" = "--signiert" ] && SIGNIERT=1
HIER="$(cd "$(dirname "$0")" && pwd)"
WURZEL="$(cd "$HIER/../../.." && pwd)"
PB=/usr/libexec/PlistBuddy

case "$PFAD" in
  *.xcarchive|*.xcarchive/) ARCHIV="${PFAD%/}"; APP="$(ls -d "$ARCHIV"/Products/Applications/*.app | head -1)" ;;
  *) ARCHIV=""; APP="${PFAD%/}" ;;
esac
[ -f "$APP/Info.plist" ] || { echo "Kein App-Paket: $APP"; exit 2; }
NAME="$($PB -c 'Print :CFBundleExecutable' "$APP/Info.plist")"
BIN="$APP/$NAME"

FEHLER=0
ok()      { echo "OK      $1"; }
fehler()  { echo "FEHLER  $1"; FEHLER=$((FEHLER + 1)); }
hinweis() { echo "HINWEIS $1"; }
gleich()  { # Beschreibung, ist, soll
  if [ "$2" = "$3" ]; then ok "$1: $2"; else fehler "$1: ist '$2', soll '$3'"; fi
}
plist()   { $PB -c "Print :$1" "$APP/Info.plist" 2>/dev/null || echo "(fehlt)"; }
json()    { # Datei, Pfad als JS-Ausdruck hinter dem Objekt
  node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(eval("o"+process.argv[2]))' "$1" "$2"
}

echo "Paket:    $APP"
echo "Programm: $BIN"
echo

echo "== Binary =="
gleich "Architekturen" "$(lipo -archs "$BIN")" "arm64"
BUILD="$(vtool -show-build "$BIN" 2>/dev/null)"
gleich "LC_BUILD_VERSION platform (IOS ist das Geraet, IOSSIMULATOR waere der Simulator)" \
  "$(echo "$BUILD" | awk '$1=="platform"{print $2}')" "IOS"
gleich "LC_BUILD_VERSION minos" "$(echo "$BUILD" | awk '$1=="minos"{print $2}')" "17.0"
echo "        sdk $(echo "$BUILD" | awk '$1=="sdk"{print $2}')"
LIBS="$(otool -L "$BIN")"
for fw in Metal MetalKit Accelerate WebKit UIKit Security Foundation; do
  if echo "$LIBS" | grep -q "/$fw.framework/$fw "; then ok "linkt $fw.framework"; else fehler "linkt $fw.framework NICHT"; fi
done
if echo "$LIBS" | grep -v -E '^\S|/System/Library/|/usr/lib/' | grep -q .; then
  fehler "linkt etwas ausserhalb des Systems: $(echo "$LIBS" | grep -v -E '^\S|/System/Library/|/usr/lib/' | tr -d '\t')"
else
  ok "linkt nur Systembibliotheken, nichts Eingebettetes fehlt"
fi

echo
echo "== Info.plist =="
gleich "CFBundleShortVersionString (tauri.ios.conf.json, sonst tauri.conf.json)" "$(plist CFBundleShortVersionString)" "$(node "$WURZEL/scripts/mobile/release/handy-version.mjs" zeige ios | cut -d' ' -f1)"
gleich "CFBundleVersion (tauri.ios.conf.json)" "$(plist CFBundleVersion)" "$(json "$WURZEL/src-tauri/tauri.ios.conf.json" .bundle.iOS.bundleVersion)"
gleich "MinimumOSVersion" "$(plist MinimumOSVersion)" "17.0"
# Die Kennung des iOS-Pakets: das Feld in tauri.ios.conf.json gewinnt gegen tauri.conf.json (seit Runde 15 com.purpledoubled.lu).
gleich "CFBundleIdentifier (tauri.ios.conf.json, sonst tauri.conf.json)" "$(plist CFBundleIdentifier)" "$(node "$WURZEL/scripts/mobile/release/handy-version.mjs" kennung ios)"
gleich "DTPlatformName" "$(plist DTPlatformName)" "iphoneos"
gleich "CFBundleSupportedPlatforms" "$(plist CFBundleSupportedPlatforms:0)" "iPhoneOS"
gleich "UILaunchStoryboardName" "$(plist UILaunchStoryboardName)" "LaunchScreen"
gleich "NSAllowsLocalNetworking" "$(plist NSAppTransportSecurity:NSAllowsLocalNetworking)" "true"
gleich "NSAllowsArbitraryLoads (darf nicht gesetzt sein)" "$(plist NSAppTransportSecurity:NSAllowsArbitraryLoads)" "(fehlt)"
gleich "ITSAppUsesNonExemptEncryption" "$(plist ITSAppUsesNonExemptEncryption)" "false"
gleich "UIRequiredDeviceCapabilities" "$(plist UIRequiredDeviceCapabilities:0) $(plist UIRequiredDeviceCapabilities:1)" "arm64 metal"
for k in NSMicrophoneUsageDescription NSCameraUsageDescription NSPhotoLibraryAddUsageDescription; do
  T="$(plist "$k")"
  if [ "$T" = "(fehlt)" ] || [ -z "$T" ]; then fehler "Berechtigungstext $k fehlt"; else ok "$k: $T"; fi
done
# NSLocalNetworkUsageDescription gehoert nur in einen Bau mit Fernzugriff
# (Schalter remoteDesktop des Store-Presets, scripts/mobile/ios/preset-plist.mjs).
PRESET="$(node "$HIER/preset-plist.mjs" preset-von "$APP")"
FERN=0
node "$HIER/preset-plist.mjs" fernzugriff "$PRESET" || FERN=$?
T="$(plist NSLocalNetworkUsageDescription)"
case "$FERN" in
  0) if [ "$T" = "(fehlt)" ] || [ -z "$T" ]; then fehler "Berechtigungstext NSLocalNetworkUsageDescription fehlt (Preset $PRESET hat den Fernzugriff)"; else ok "NSLocalNetworkUsageDescription: $T"; fi ;;
  1) if [ "$T" = "(fehlt)" ]; then ok "kein NSLocalNetworkUsageDescription (Preset $PRESET hat keinen Fernzugriff)"; else fehler "NSLocalNetworkUsageDescription steht im Paket, Preset $PRESET hat keinen Fernzugriff"; fi ;;
  *) fehler "Preset '$PRESET' ist unbekannt" ;;
esac
SCHEMA="$(plist CFBundleURLTypes:0:CFBundleURLSchemes:0)"
if [ "$SCHEMA" = "(fehlt)" ]; then
  hinweis "CFBundleURLTypes fehlt: das Schema lu:// ist noch nicht im Paket (kommt mit dem Deep-Link-Plugin)"
else
  ok "URL-Schema: $SCHEMA"
fi
if [ "$(plist UIBackgroundModes)" = "(fehlt)" ]; then
  hinweis "UIBackgroundModes fehlt (gewollt: Hintergrund-Downloads ueber URLSession brauchen keinen Eintrag)"
else
  hinweis "UIBackgroundModes: $(plist UIBackgroundModes | tr -d '\n ')"
fi

echo
echo "== Inhalt des Pakets =="
for f in Assets.car LaunchScreen.storyboardc PrivacyInfo.xcprivacy PkgInfo; do
  if [ -e "$APP/$f" ]; then ok "$f liegt im Paket"; else fehler "$f fehlt im Paket"; fi
done
if plutil -lint "$APP/PrivacyInfo.xcprivacy" >/dev/null 2>&1; then ok "PrivacyInfo.xcprivacy ist eine gueltige plist"; else fehler "PrivacyInfo.xcprivacy ist keine gueltige plist"; fi
if find "$APP" -name '*.a' -o -name '*.gguf' -o -name '*.dSYM' | grep -q .; then
  fehler "Im Paket liegt etwas, das nicht hineingehoert: $(find "$APP" -name '*.a' -o -name '*.gguf' -o -name '*.dSYM' | tr '\n' ' ')"
else
  ok "keine Bibliothek (.a), kein Modell (.gguf), keine Symbole im Paket"
fi
KB="$(du -sk "$APP" | awk '{print $1}')"
BINB="$(stat -f %z "$BIN")"
echo "        Groesse Paket: $((KB / 1024)) MB ($KB KB), Programm: $((BINB / 1048576)) MB ($BINB Bytes)"
if [ "$KB" -gt 153600 ]; then fehler "Paket groesser als 150 MB"; else ok "Paket kleiner als 150 MB"; fi
if [ -n "$ARCHIV" ]; then
  if ls "$ARCHIV"/dSYMs/*.dSYM/Contents/Resources/DWARF/* >/dev/null 2>&1; then ok "dSYM liegt im Archiv"; else fehler "dSYM fehlt im Archiv"; fi
  echo "        Archiv: $($PB -c 'Print :ApplicationProperties:CFBundleShortVersionString' "$ARCHIV/Info.plist") ($($PB -c 'Print :ApplicationProperties:CFBundleVersion' "$ARCHIV/Info.plist")), Architektur $($PB -c 'Print :ApplicationProperties:Architectures:0' "$ARCHIV/Info.plist")"
fi

echo
echo "== Keine Abnahme- und Debug-Schalter =="
# Mit debug_assertions oder dem Feature devtools (bei uns: abnahme) uebersetzt
# wry den Zweig, der setInspectable(true) ruft und den privaten Schluessel
# developerExtrasEnabled setzt. Beide Namen stehen dann als Text im Programm.
STR="$(strings -a "$BIN")"
for s in developerExtrasEnabled setInspectable; do
  N="$(printf '%s\n' "$STR" | grep -c "$s" || true)"
  if [ "$N" = "0" ]; then ok "'$s' kommt im Programm nicht vor: die WebView ist nicht inspizierbar"; else fehler "'$s' steht $N mal im Programm: die WebView ist inspizierbar (Feature abnahme oder Debug-Bau)"; fi
done
# Gegenprobe, falls ein Debug-Bau der Bibliothek herumliegt: dort MUSS der Text stehen.
for lib in "$WURZEL/src-tauri/target/aarch64-apple-ios-sim/debug/liblocally_uncensored_lib.a" "$WURZEL/src-tauri/target/aarch64-apple-ios/debug/liblocally_uncensored_lib.a"; do
  if [ -f "$lib" ]; then
    N="$(strings -a "$lib" | grep -c developerExtrasEnabled || true)"
    echo "        Gegenprobe $(echo "$lib" | sed "s|$WURZEL/||"): 'developerExtrasEnabled' $N mal (muss groesser 0 sein, sonst taugt die Probe nicht)"
    [ "$N" = "0" ] && fehler "Gegenprobe ohne Treffer: die Textsuche unterscheidet Debug und Release nicht mehr"
    break
  fi
done
if grep -q -E '^abnahme *= *\["tauri/devtools"\]' "$WURZEL/src-tauri/Cargo.toml" && grep -q -E '^default *= *\[[^]]*abnahme' "$WURZEL/src-tauri/Cargo.toml"; then
  fehler "Cargo.toml: abnahme steht in den Standard-Features"
else
  ok "Cargo.toml: abnahme ist kein Standard-Feature"
fi
if printf '%s\n' "$STR" | grep -q 'get-task-allow'; then fehler "get-task-allow steht im Programm"; else ok "kein get-task-allow im Programm"; fi

echo
echo "== Signatur und Entitlements =="
if [ "$SIGNIERT" = "0" ]; then
  if codesign -dv "$APP" 2>&1 | grep -q 'not signed at all'; then ok "unsigniert (codesign: code object is not signed at all)"; else fehler "das Paket traegt eine Signatur, erwartet war keine"; fi
  [ -e "$APP/embedded.mobileprovision" ] && fehler "embedded.mobileprovision liegt im Paket" || ok "kein Profil im Paket"
  [ -e "$APP/_CodeSignature" ] && fehler "_CodeSignature liegt im Paket" || ok "kein _CodeSignature im Paket"
  if [ -n "$ARCHIV" ]; then
    gleich "Archiv: Team" "$($PB -c 'Print :ApplicationProperties:Team' "$ARCHIV/Info.plist")" ""
    gleich "Archiv: SigningIdentity" "$($PB -c 'Print :ApplicationProperties:SigningIdentity' "$ARCHIV/Info.plist")" ""
  fi
else
  codesign -dv "$APP" 2>&1 | grep -E 'Authority|TeamIdentifier|Signature' | sed 's/^/        /' || true
  ENT="$(codesign -d --entitlements - "$APP" 2>/dev/null || true)"
  if echo "$ENT" | grep -q 'increased-memory-limit'; then ok "Entitlement increased-memory-limit steht in der Signatur"; else fehler "Entitlement increased-memory-limit fehlt in der Signatur"; fi
  # Runde 15: ohne dieses Entitlement in der Signatur antwortet "Sign in with Apple" mit Fehler 1000.
  if echo "$ENT" | grep -q 'com.apple.developer.applesignin'; then ok "Entitlement applesignin steht in der Signatur"; else fehler "Entitlement com.apple.developer.applesignin fehlt in der Signatur (Faehigkeit Sign in with Apple an der App-ID und im Profil?)"; fi
  if echo "$ENT" | grep -A1 'get-task-allow' | grep -q true; then hinweis "get-task-allow ist wahr: Entwicklungs-Signatur, kein Store-Bau"; fi
fi
# Welche Entitlements-Datei der Geraete-Bau nimmt, sagt das Projekt selbst.
PROJ="$WURZEL/src-tauri/gen/apple/locally-uncensored.xcodeproj"
ENTDATEI="$(xcodebuild -project "$PROJ" -scheme locally-uncensored_iOS -sdk iphoneos -configuration release -showBuildSettings 2>/dev/null | awk '$1=="CODE_SIGN_ENTITLEMENTS"{print $3}')"
gleich "Entitlements-Datei des Geraete-Baus (sdk iphoneos)" "$ENTDATEI" "locally-uncensored_iOS/LU-Geraet.entitlements"
SIMDATEI="$(xcodebuild -project "$PROJ" -scheme locally-uncensored_iOS -sdk iphonesimulator -configuration release -showBuildSettings 2>/dev/null | awk '$1=="CODE_SIGN_ENTITLEMENTS"{print $3}')"
gleich "Entitlements-Datei des Simulator-Baus" "$SIMDATEI" "locally-uncensored_iOS/locally-uncensored_iOS.entitlements"
gleich "increased-memory-limit in LU-Geraet.entitlements" \
  "$($PB -c 'Print :com.apple.developer.kernel.increased-memory-limit' "$WURZEL/src-tauri/gen/apple/locally-uncensored_iOS/LU-Geraet.entitlements" 2>/dev/null || echo '(fehlt)')" "true"
gleich "applesignin in LU-Geraet.entitlements" \
  "$($PB -c 'Print :com.apple.developer.applesignin:0' "$WURZEL/src-tauri/gen/apple/locally-uncensored_iOS/LU-Geraet.entitlements" 2>/dev/null || echo '(fehlt)')" "Default"

echo
echo "== Privacy Manifest gegen das Programm =="
RR="$(sh "$HIER/pruefe-required-reason-apis.sh" "$APP")"
echo "$RR" | sed 's/^/        /'
ERKLAERT="$($PB -c 'Print :NSPrivacyAccessedAPITypes' "$APP/PrivacyInfo.xcprivacy" 2>/dev/null | grep -o 'NSPrivacyAccessedAPICategory[A-Za-z]*' | sed 's/NSPrivacyAccessedAPICategory//' | sort -u)"
GEFUNDEN="$(echo "$RR" | awk '$1=="GEFUNDEN"{print $2}' | tr -d ':' | sort -u)"
for kat in $GEFUNDEN; do
  if echo "$ERKLAERT" | grep -qx "$kat"; then ok "$kat: im Programm gefunden und im Manifest erklaert"; else fehler "$kat: im Programm gefunden, im Manifest NICHT erklaert"; fi
done
for kat in $ERKLAERT; do
  echo "$GEFUNDEN" | grep -qx "$kat" || hinweis "$kat: im Manifest erklaert, im Programm nicht gefunden (vorsorglich, kein Fehler)"
done

echo
if [ "$FEHLER" = "0" ]; then
  echo "ERGEBNIS: alle Pruefungen bestanden."
else
  echo "ERGEBNIS: $FEHLER Pruefung(en) nicht bestanden."
  exit 1
fi
