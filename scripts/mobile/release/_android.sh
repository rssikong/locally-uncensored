#!/bin/bash
# Der Android-Teil der Release-Skripte. Wird nach _gemeinsam.sh eingelesen.
#
# Die Signatur kommt allein ueber LU_ANDROID_KEY_PROPERTIES: die Variable nennt
# eine key.properties, Gradle liest nur sie (app/build.gradle.kts). Die Datei
# braucht vier Felder:
#   storeFile      Pfad zum Keystore (.jks oder .keystore)
#   keyAlias       Name des Schluessels im Keystore
#   storePassword  Passwort des Keystores
#   keyPassword    Passwort des Schluessels
# Vorlage: src-tauri/gen/android/key.properties.example. Dieses Skript liest
# aus der Datei nur den Pfad und den Alias, nie ein Passwort, und gibt keinen
# der Werte aus.

ANDROID_PROJEKT="$WURZEL/src-tauri/gen/android"
# Was die Tauri-CLI (cargo-mobile2) fuer Android als rustflags des Ziels setzt.
TAURI_ANDROID_RUSTFLAGS="-Clink-arg=-landroid -Clink-arg=-llog -Clink-arg=-lOpenSLES"
APK="$ANDROID_PROJEKT/app/build/outputs/apk/universal/release/app-universal-release.apk"
AAB="$ANDROID_PROJEKT/app/build/outputs/bundle/universalRelease/app-universal-release.aab"

android_umgebung() {
  export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/27.2.12479018}"
}

android_schluessel_pruefen() {
  local lokal="$ANDROID_PROJEKT/key.properties" datei="${LU_ANDROID_KEY_PROPERTIES:-}" feld store alias luecke=0
  if [ -z "$datei" ]; then
    if [ -f "$lokal" ]; then
      missing "signing key: LU_ANDROID_KEY_PROPERTIES is not set. There is a src-tauri/gen/android/key.properties, but Gradle only reads the file this variable names: export LU_ANDROID_KEY_PROPERTIES=\"\$PWD/src-tauri/gen/android/key.properties\""
    else
      missing "signing key: LU_ANDROID_KEY_PROPERTIES is not set and there is no src-tauri/gen/android/key.properties. Fill a copy of key.properties.example (storeFile, keyAlias, storePassword, keyPassword), keep it outside the repository, and export LU_ANDROID_KEY_PROPERTIES=/path/to/key.properties"
    fi
    return 0
  fi
  if [ ! -f "$datei" ]; then
    missing "signing key: LU_ANDROID_KEY_PROPERTIES names a file that does not exist"
    return 0
  fi
  for feld in storeFile keyAlias storePassword keyPassword; do
    if ! grep -q "^${feld}=." "$datei"; then
      missing "signing key: key.properties has no value for $feld"
      luecke=1
    fi
  done
  [ "$luecke" = "0" ] || return 0
  store="$(sed -n 's/^storeFile=//p' "$datei" | head -1)"
  alias="$(sed -n 's/^keyAlias=//p' "$datei" | head -1)"
  # Gradle loest einen Pfad ohne Schraegstrich am Anfang vom Ordner app aus auf.
  case "$store" in /*) ;; *) store="$ANDROID_PROJEKT/app/$store" ;; esac
  if [ ! -f "$store" ]; then
    missing "signing key: storeFile in key.properties names a keystore that does not exist"
    return 0
  fi
  case "$(printf '%s %s %s' "$datei" "$store" "$alias" | tr '[:upper:]' '[:lower:]')" in
    *wegwerf*)
      missing "throwaway signature: LU_ANDROID_KEY_PROPERTIES points at the throwaway keystore (make-wegwerf-keystore.sh). A package signed with it must never be published. Point the variable at the real key.properties."
      return 0 ;;
  esac
  ok "signing key: key.properties has all four fields and the keystore exists (the certificate is checked on the finished package)"
}

android_vorpruefung() {
  local bt
  if [ -x "$JAVA_HOME/bin/java" ]; then ok "java (JAVA_HOME)"; else missing "JAVA_HOME has no bin/java (expected OpenJDK 17, BAUEN.md 4.1)"; fi
  if [ -d "$ANDROID_HOME/platform-tools" ]; then ok "Android SDK (ANDROID_HOME)"; else missing "ANDROID_HOME is not an Android SDK"; fi
  if [ -d "$NDK_HOME" ]; then ok "Android NDK (NDK_HOME)"; else missing "NDK_HOME does not exist (expected NDK 27.2.12479018)"; fi
  bt="$(find "$ANDROID_HOME/build-tools" -maxdepth 2 -name apksigner 2>/dev/null | sort -V | tail -1)"
  if [ -n "$bt" ] && [ -x "$(dirname "$bt")/aapt2" ]; then ok "apksigner and aapt2 (build-tools $(basename "$(dirname "$bt")"))"; else missing "apksigner or aapt2 not found under ANDROID_HOME/build-tools. Without them the finished package cannot be checked."; fi
  if command -v rustup >/dev/null 2>&1 && rustup target list --installed 2>/dev/null | grep -q '^aarch64-linux-android$'; then
    ok "rust target aarch64-linux-android"
  else
    missing "rust target aarch64-linux-android is not installed. Run: rustup target add aarch64-linux-android"
  fi
  android_schluessel_pruefen
}

# android_bauen_und_pruefen <preset> <mit-aab: 0|1>
android_bauen_und_pruefen() {
  local preset="$1" mit_aab="$2" version code start
  version="$ERWARTETE_VERSION"
  code="$(node "$RELEASE_DIR/handy-version.mjs" zeige android | cut -d' ' -f2)"
  start="$(date +%s)"
  # Alte Pakete weg: was am Ende geprueft wird, stammt sicher aus diesem Lauf.
  rm -f "$APK" "$APK.bau.json" "$AAB" "$AAB.bau.json"
  # Keine Pfade des Baurechners im Programm (r49, N2). Die drei Linker-Flags
  # setzt die Tauri-CLI sonst selbst als rustflags des Ziels; die Variable
  # von pfade_umschreiben schlaegt diese, darum stehen sie hier mit.
  pfade_umschreiben aarch64-linux-android $TAURI_ANDROID_RUSTFLAGS
  # Zweites Argument leer: KEINE Cargo-Features. Nur arm64-v8a.
  if [ "$mit_aab" = "1" ]; then
    VITE_LU_STORE_PRESET="$preset" LU_ANDROID_AAB=1 "$WURZEL/scripts/mobile/android-bauen.sh" release "" aarch64
  else
    VITE_LU_STORE_PRESET="$preset" "$WURZEL/scripts/mobile/android-bauen.sh" release "" aarch64
  fi
  [ -f "$APK" ] || abbruch "the build ended without an APK at ${APK#"$WURZEL"/}"
  if [ "$(stat -f %m "$WURZEL/dist/index.html" 2>/dev/null || echo 0)" -lt "$start" ]; then
    abbruch "dist/index.html is older than this build. The page in the package cannot be checked for the test hook."
  fi
  echo
  echo "Checking the finished package"
  seite_traegt_version "$version"
  if [ "$mit_aab" = "1" ]; then
    node "$RELEASE_DIR/pruefe-android-paket.mjs" "$preset" "$version" "$code" "$APK" "$AAB" || abbruch "the package failed its checks and must not be published"
  else
    node "$RELEASE_DIR/pruefe-android-paket.mjs" "$preset" "$version" "$code" "$APK" || abbruch "the package failed its checks and must not be published"
  fi
}
